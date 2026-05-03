import type { FlightLeg, OccRules, RecoveryOption } from "@/lib/types";
import { isInCurfew } from "./time-utils";
import { calculatePassengerImpact } from "./passenger-impact";

/**
 * Count curfew violations across all flight changes in the option.
 *
 * A "violation" is one endpoint (origin departure or destination arrival)
 * whose proposed time falls inside the configured curfew window for that
 * airport. Each FlightChange can contribute at most 2 violations.
 *
 * Returns 0 when curfew enforcement is disabled in rules — the helper
 * `isInCurfew` short-circuits in that case.
 */
function countCurfewViolations(
  option: RecoveryOption,
  rules: OccRules,
): number {
  let count = 0;
  for (const change of option.flight_changes) {
    if (isInCurfew(change.origin, change.new_std, rules)) count++;
    if (isInCurfew(change.destination, change.new_sta, rules)) count++;
  }
  return count;
}

/**
 * Priority protection penalty (S5 fix + multi-criteria upgrade).
 *
 * When a recovery option delays or re-assigns flights that carry priority
 * attributes (international, last-flight-of-day, high-load-factor), the
 * option receives an additional penalty so the scorer prefers options that
 * protect those flights.
 *
 * The `schedule` parameter is optional for backwards-compatibility; when
 * omitted, the protection bonus is simply 0.
 */
function calculatePriorityPenalty(
  option: RecoveryOption,
  rules: OccRules,
  schedule?: FlightLeg[],
): number {
  if (!schedule || !schedule.length) return 0;

  const protectionBonus =
    rules.score_weights?.priority_protection_bonus ?? 40;
  const pr = rules.priority_rules;
  if (!pr) return 0;

  const flightById = new Map<string, FlightLeg>();
  for (const f of schedule) flightById.set(f.flight_id, f);

  let penalty = 0;
  for (const change of option.flight_changes) {
    // Only penalize changes that actually disrupt the flight
    if (change.delay_minutes <= 0 && change.original_aircraft === change.new_aircraft) {
      continue;
    }
    const orig = flightById.get(change.flight_id);
    if (!orig) continue;

    if (pr.protect_international_flight && orig.is_international) {
      penalty += protectionBonus;
    }
    if (pr.protect_last_flight_of_day && orig.is_last_flight_of_day) {
      penalty += protectionBonus;
    }
    if (
      pr.protect_high_load_factor &&
      orig.load_factor >= (pr.high_load_factor_threshold ?? 0.85)
    ) {
      penalty += Math.round(protectionBonus * 0.5);
    }
  }
  return penalty;
}

/**
 * Downstream ripple estimate (Phase 3 — network cost element).
 *
 * Estimates how much additional delay an option's changes will cause on
 * OTHER aircraft sharing the same stations. This approximation counts
 * station-time conflicts rather than doing a full network re-simulation.
 */
function estimateDownstreamRipple(
  option: RecoveryOption,
  schedule?: FlightLeg[],
): number {
  if (!schedule || !schedule.length) return 0;

  // Build a map of (station, hour) → number of movements
  const stationLoad = new Map<string, number>();
  for (const f of schedule) {
    const depKey = `${f.origin}:${Math.floor(f.std.getTime() / 3600000)}`;
    const arrKey = `${f.destination}:${Math.floor(f.sta.getTime() / 3600000)}`;
    stationLoad.set(depKey, (stationLoad.get(depKey) ?? 0) + 1);
    stationLoad.set(arrKey, (stationLoad.get(arrKey) ?? 0) + 1);
  }

  let ripple = 0;
  for (const change of option.flight_changes) {
    if (change.delay_minutes <= 0) continue;
    // If the new departure time shifts into a busy hour slot, add ripple cost
    const newDepKey = `${change.origin}:${Math.floor(change.new_std.getTime() / 3600000)}`;
    const congestion = stationLoad.get(newDepKey) ?? 0;
    // More flights at the same station+hour = higher ripple risk
    if (congestion > 2) {
      ripple += change.delay_minutes * (congestion - 2) * 0.3;
    }
  }
  return Math.round(ripple);
}

export function calculateRecoveryScore(
  option: RecoveryOption,
  rules: OccRules,
  schedule?: FlightLeg[],
): RecoveryOption {
  const w = rules.score_weights ?? ({} as OccRules["score_weights"]);
  const totalDelayWeight = w.total_delay_weight ?? 1.0;
  const maxDelayWeight = w.max_delay_weight ?? 1.5;
  const impactedWeight = w.impacted_flight_weight ?? 10;
  const swapPenalty = w.swap_penalty ?? 25;
  const curfewWeight = w.curfew_risk_penalty ?? 120;
  const passengerDelayWeight = w.passenger_delay_weight ?? 0.02;
  const passengerPriorityWeight = w.passenger_priority_weight ?? 15;
  const misconnectRiskPenalty = w.misconnect_risk_penalty ?? 80;

  const curfewViolations = countCurfewViolations(option, rules);
  option.curfew_violations = curfewViolations;
  if (curfewViolations > 0) {
    const reason = `Proposes ${curfewViolations} movement${
      curfewViolations === 1 ? "" : "s"
    } inside a configured curfew window`;
    if (!option.reason_codes.includes(reason)) {
      option.reason_codes.push(reason);
    }
  }

  let baseScore =
    option.total_delay_minutes * totalDelayWeight +
    option.max_delay_minutes * maxDelayWeight +
    option.impacted_flight_count * impactedWeight +
    option.swap_count * swapPenalty +
    curfewViolations * curfewWeight;

  let riskPenalty = 0;
  if (option.risk_level === "MEDIUM") riskPenalty = 30;
  else if (option.risk_level === "HIGH") riskPenalty = 100;

  // S5: priority protection penalty
  const priorityPenalty = calculatePriorityPenalty(option, rules, schedule);

  // Phase 3: downstream ripple estimate
  const rippleEstimate = estimateDownstreamRipple(option, schedule);
  const passengerImpact = calculatePassengerImpact(option, rules, schedule);
  const passengerDelayComponent =
    (passengerImpact?.passenger_delay_minutes ?? 0) * passengerDelayWeight;
  const passengerPriorityComponent =
    (passengerImpact?.priority_passenger_score ?? 0) * passengerPriorityWeight;
  const misconnectRiskComponent =
    (passengerImpact?.misconnect_risk_passengers ?? 0) * misconnectRiskPenalty;

  if (option.option_type === "SPREAD_DELAY") baseScore *= 0.95;

  option.score =
    Math.round(
      (
        baseScore +
        riskPenalty +
        priorityPenalty +
        rippleEstimate +
        passengerDelayComponent +
        passengerPriorityComponent +
        misconnectRiskComponent
      ) * 100,
    ) / 100;
  option.passenger_impact = passengerImpact ?? undefined;
  option.score_breakdown = {
    total_delay_component: option.total_delay_minutes * totalDelayWeight,
    max_delay_component: option.max_delay_minutes * maxDelayWeight,
    impacted_flight_component: option.impacted_flight_count * impactedWeight,
    swap_component: option.swap_count * swapPenalty,
    curfew_component: curfewViolations * curfewWeight,
    risk_penalty: riskPenalty,
    priority_protection_penalty: priorityPenalty,
    downstream_ripple_estimate: rippleEstimate,
    passenger_delay_component: passengerDelayComponent,
    passenger_priority_component: passengerPriorityComponent,
    misconnect_risk_component: misconnectRiskComponent,
  };
  if (passengerImpact?.high_impact) {
    const reason = `High passenger impact: approximately ${passengerImpact.estimated_affected_passengers} passengers affected`;
    if (!option.reason_codes.includes(reason)) option.reason_codes.push(reason);
  }
  return option;
}

export function rankRecoveryOptions(
  options: RecoveryOption[],
  rules: OccRules,
  schedule?: FlightLeg[],
): RecoveryOption[] {
  const scored = options.map((o) => calculateRecoveryScore(o, rules, schedule));
  const ranked = [...scored].sort((a, b) => a.score - b.score);
  ranked.forEach((option, idx) => {
    option.rank = idx + 1;
    option.recommendation = idx === 0 ? "Recommended" : "Alternative";
    if (idx === 0) {
      option.reason_codes.push("Lowest score among generated feasible options");
    }
  });
  return ranked;
}
