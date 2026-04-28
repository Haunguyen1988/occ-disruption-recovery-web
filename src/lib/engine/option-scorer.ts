import type { OccRules, RecoveryOption } from "@/lib/types";
import { isInCurfew } from "./time-utils";

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

export function calculateRecoveryScore(
  option: RecoveryOption,
  rules: OccRules,
): RecoveryOption {
  const w = rules.score_weights ?? ({} as OccRules["score_weights"]);
  const totalDelayWeight = w.total_delay_weight ?? 1.0;
  const maxDelayWeight = w.max_delay_weight ?? 1.5;
  const impactedWeight = w.impacted_flight_weight ?? 10;
  const swapPenalty = w.swap_penalty ?? 25;
  const curfewWeight = w.curfew_risk_penalty ?? 120;

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

  if (option.option_type === "SPREAD_DELAY") baseScore *= 0.95;

  option.score = Math.round((baseScore + riskPenalty) * 100) / 100;
  option.score_breakdown = {
    total_delay_component: option.total_delay_minutes * totalDelayWeight,
    max_delay_component: option.max_delay_minutes * maxDelayWeight,
    impacted_flight_component: option.impacted_flight_count * impactedWeight,
    swap_component: option.swap_count * swapPenalty,
    curfew_component: curfewViolations * curfewWeight,
    risk_penalty: riskPenalty,
  };
  return option;
}

export function rankRecoveryOptions(
  options: RecoveryOption[],
  rules: OccRules,
): RecoveryOption[] {
  const scored = options.map((o) => calculateRecoveryScore(o, rules));
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
