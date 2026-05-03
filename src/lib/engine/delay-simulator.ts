import type {
  DisruptionEvent,
  FlightChange,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  RecoveryOption,
} from "@/lib/types";
import {
  addMinutes,
  minTurnaroundForType,
  minutesBetween,
} from "./time-utils";
import {
  getAircraftRotation,
  resolveScheduleIndex,
  type ScheduleIndex,
} from "./schedule-index";
import { isOperatedFlight } from "./flight-status";

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function flightChangeFromDelay(
  flight: FlightLeg,
  delayMinutes: number,
  reason: string,
): FlightChange {
  return {
    flight_id: flight.flight_id,
    flight_number: flight.flight_number,
    origin: flight.origin,
    destination: flight.destination,
    original_aircraft: flight.aircraft_id,
    new_aircraft: flight.aircraft_id,
    original_std: flight.std,
    original_sta: flight.sta,
    new_std: addMinutes(flight.std, delayMinutes),
    new_sta: addMinutes(flight.sta, delayMinutes),
    delay_minutes: Math.max(0, delayMinutes),
    reason,
  };
}

function recalculateMetrics(option: RecoveryOption): void {
  option.total_delay_minutes = option.flight_changes.reduce(
    (sum, c) => sum + Math.max(0, c.delay_minutes),
    0,
  );
  option.max_delay_minutes = option.flight_changes.length
    ? Math.max(...option.flight_changes.map((c) => Math.max(0, c.delay_minutes)))
    : 0;
  option.impacted_flight_count = option.flight_changes.filter(
    (c) => c.delay_minutes > 0 || c.original_aircraft !== c.new_aircraft,
  ).length;
  option.swap_count = Object.keys(option.aircraft_changes).length;
}

function blockingEndByFlightId(
  impacted: ImpactedFlight[],
  fallbackEndTime: Date,
): Map<string, Date | null> {
  return new Map(
    impacted.map((item) => [
      item.flight.flight_id,
      item.blocking_end_time === undefined
        ? fallbackEndTime
        : item.blocking_end_time,
    ]),
  );
}

/**
 * Bug fix K2: only propagate delay through the rotation(s) of impacted aircraft,
 * not all aircraft in the schedule. This produces operationally realistic
 * total/max delay numbers.
 */
export function simulateDelayOnly(
  impacted: ImpactedFlight[],
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  rules: OccRules,
  scheduleIndex?: ScheduleIndex,
): RecoveryOption {
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  const impactedIds = new Set(impacted.map((i) => i.flight.flight_id));
  const blockEndByFlightId = blockingEndByFlightId(
    impacted,
    disruption.end_time,
  );
  const impactedAircraftIds = new Set(
    impacted.map((i) => i.flight.aircraft_id),
  );
  const changes: FlightChange[] = [];

  for (const acId of [...impactedAircraftIds].sort()) {
    const rotation = getAircraftRotation(index, acId);
    let previousNewSta: Date | null = null;
    let delayCarry = 0;
    for (const flight of rotation) {
      if (isOperatedFlight(flight)) {
        previousNewSta = flight.actual_arrival_time ?? flight.sta;
        delayCarry = 0;
        continue;
      }
      if (!impactedIds.has(flight.flight_id) && delayCarry === 0) {
        previousNewSta = flight.sta;
        continue;
      }
      const minTurn = minTurnaroundForType(flight.aircraft_type, rules);
      let requiredStd = flight.std;
      if (impactedIds.has(flight.flight_id)) {
        const flightBlockEnd = blockEndByFlightId.get(flight.flight_id);
        if (flightBlockEnd) {
          const blockEnd = addMinutes(flightBlockEnd, minTurn);
          if (blockEnd > requiredStd) requiredStd = blockEnd;
        }
      }
      if (previousNewSta) {
        const turnEnd = addMinutes(previousNewSta, minTurn);
        if (turnEnd > requiredStd) requiredStd = turnEnd;
      }
      const delay = Math.max(0, minutesBetween(flight.std, requiredStd));
      if (delay > 0 || impactedIds.has(flight.flight_id)) {
        changes.push(
          flightChangeFromDelay(flight, delay, "Delay-only propagation"),
        );
      }
      delayCarry = delay;
      previousNewSta = addMinutes(flight.sta, delay);
    }
  }

  const option: RecoveryOption = {
    option_id: randomId("OPT-DELAY"),
    option_type: "DELAY_ONLY",
    flight_changes: changes,
    aircraft_changes: {},
    total_delay_minutes: 0,
    max_delay_minutes: 0,
    impacted_flight_count: 0,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: "MEDIUM",
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      "Keep original aircraft and propagate delay through impacted aircraft rotation only",
    ],
    score_breakdown: {},
  };
  recalculateMetrics(option);
  return option;
}

/**
 * Buffer-aware spread delay (S2 upgrade).
 *
 * Instead of applying an averaged flat delay to every flight, this algorithm:
 * 1. Forward-propagates delay through the rotation (like DELAY_ONLY).
 * 2. Caps each individual flight's delay at `max_delay_per_flight_minutes`.
 * 3. If a cap forces a turnaround violation on the next leg, that leg's delay
 *    is increased just enough to satisfy the constraint.
 *
 * The result is a schedule where no single flight absorbs excessive delay
 * while still respecting turnaround and station-continuity constraints.
 */
export function simulateSpreadDelay(
  impacted: ImpactedFlight[],
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  rules: OccRules,
  scheduleIndex?: ScheduleIndex,
): RecoveryOption {
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  const impactedIds = new Set(impacted.map((i) => i.flight.flight_id));
  const blockEndByFlightId = blockingEndByFlightId(
    impacted,
    disruption.end_time,
  );
  const impactedAircraftIds = new Set(
    impacted.map((i) => i.flight.aircraft_id),
  );
  const maxPerFlight =
    rules.spread_delay_rules?.max_delay_per_flight_minutes ?? 90;

  if (!impacted.length) {
    return simulateDelayOnly(impacted, disruption, schedule, rules, index);
  }

  const changes: FlightChange[] = [];

  for (const acId of [...impactedAircraftIds].sort()) {
    const rotation = getAircraftRotation(index, acId);

    // Pass 1: compute unconstrained delays (same as DELAY_ONLY)
    const legInfos: Array<{
      flight: FlightLeg;
      unconstrainedDelay: number;
      isImpacted: boolean;
    }> = [];
    let prevNewSta: Date | null = null;
    let delayCarry = 0;
    for (const flight of rotation) {
      if (isOperatedFlight(flight)) {
        prevNewSta = flight.actual_arrival_time ?? flight.sta;
        delayCarry = 0;
        continue;
      }
      if (!impactedIds.has(flight.flight_id) && delayCarry === 0) {
        prevNewSta = flight.sta;
        continue;
      }
      const minTurn = minTurnaroundForType(flight.aircraft_type, rules);
      let requiredStd = flight.std;
      if (impactedIds.has(flight.flight_id)) {
        const flightBlockEnd = blockEndByFlightId.get(flight.flight_id);
        if (flightBlockEnd) {
          const blockEnd = addMinutes(flightBlockEnd, minTurn);
          if (blockEnd > requiredStd) requiredStd = blockEnd;
        }
      }
      if (prevNewSta) {
        const turnEnd = addMinutes(prevNewSta, minTurn);
        if (turnEnd > requiredStd) requiredStd = turnEnd;
      }
      const delay = Math.max(0, minutesBetween(flight.std, requiredStd));
      legInfos.push({
        flight,
        unconstrainedDelay: delay,
        isImpacted: impactedIds.has(flight.flight_id),
      });
      delayCarry = delay;
      prevNewSta = addMinutes(flight.sta, delay);
    }

    if (legInfos.length === 0) continue;

    // Pass 2: cap each leg at maxPerFlight
    const delays = legInfos.map((li) =>
      Math.min(li.unconstrainedDelay, maxPerFlight),
    );

    // Pass 3: forward fix — ensure turnaround feasibility after capping
    let pSta: Date | null = null;
    for (let i = 0; i < legInfos.length; i++) {
      const fl = legInfos[i].flight;
      const newStd = addMinutes(fl.std, delays[i]);
      if (pSta) {
        const minTurn = minTurnaroundForType(fl.aircraft_type, rules);
        const turnEnd = addMinutes(pSta, minTurn);
        if (turnEnd > newStd) {
          delays[i] = Math.max(
            delays[i],
            minutesBetween(fl.std, turnEnd),
          );
        }
      }
      pSta = addMinutes(fl.sta, delays[i]);
    }

    // Generate flight changes
    for (let i = 0; i < legInfos.length; i++) {
      const li = legInfos[i];
      const delay = delays[i];
      if (delay > 0 || li.isImpacted) {
        changes.push(
          flightChangeFromDelay(
            li.flight,
            delay,
            delay < li.unconstrainedDelay
              ? "Buffer-aware spread delay (capped)"
              : "Buffer-aware spread delay",
          ),
        );
      }
    }
  }

  const option: RecoveryOption = {
    option_id: randomId("OPT-SPREAD"),
    option_type: "SPREAD_DELAY",
    flight_changes: changes,
    aircraft_changes: {},
    total_delay_minutes: 0,
    max_delay_minutes: 0,
    impacted_flight_count: 0,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: "MEDIUM",
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      "Buffer-aware spread delay: caps per-flight delay and uses natural gaps to absorb excess",
      `Per-flight cap: ${maxPerFlight}min; turnaround constraints enforced`,
    ],
    score_breakdown: {},
  };
  recalculateMetrics(option);
  return option;
}

export function simulateDeepDelay(
  impacted: ImpactedFlight[],
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  rules: OccRules,
  scheduleIndex?: ScheduleIndex,
): RecoveryOption {
  if (!impacted.length) {
    return {
      option_id: randomId("OPT-DEEP"),
      option_type: "DEEP_DELAY",
      flight_changes: [],
      aircraft_changes: {},
      total_delay_minutes: 0,
      max_delay_minutes: 0,
      impacted_flight_count: 0,
      swap_count: 0,
      curfew_violations: 0,
      risk_level: "LOW",
      score: 0,
      rank: null,
      recommendation: "",
      reason_codes: ["No impacted flights"],
      score_breakdown: {},
    };
  }
  // Pick the lowest-priority flight to sacrifice: highest priority_level
  // number (since 1=HIGH, 3=LOW), and among equals the lowest load_factor.
  const sorted = [...impacted]
    .map((i) => i.flight)
    .sort((a, b) => {
      if (a.priority_level !== b.priority_level)
        return a.priority_level - b.priority_level;
      // Descending load so lowest load ends up last → selected for sacrifice
      return b.load_factor - a.load_factor;
    });
  const selected = sorted[sorted.length - 1];
  const minTurn = minTurnaroundForType(selected.aircraft_type, rules);
  const selectedImpact = impacted.find(
    (item) => item.flight.flight_id === selected.flight_id,
  );
  const targetStd = (() => {
    const flightBlockEnd =
      selectedImpact?.blocking_end_time === undefined
        ? disruption.end_time
        : selectedImpact.blocking_end_time;
    if (!flightBlockEnd) return selected.std;
    const blockEnd = addMinutes(flightBlockEnd, minTurn);
    return blockEnd > selected.std ? blockEnd : selected.std;
  })();
  let delay = Math.max(0, minutesBetween(selected.std, targetStd));
  const deepLimit = rules.flat_delay_rules?.max_deep_delay_minutes ?? 360;
  delay = Math.min(Math.max(delay, Math.floor(deepLimit * 0.5)), deepLimit);
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  const baseline = simulateDelayOnly(impacted, disruption, schedule, rules, index);
  const changesByFlightId = new Map(
    baseline.flight_changes.map((change) => [change.flight_id, change]),
  );
  const existingSelectedDelay =
    changesByFlightId.get(selected.flight_id)?.delay_minutes ?? 0;
  const selectedDelay = Math.max(delay, existingSelectedDelay);
  changesByFlightId.set(
    selected.flight_id,
    flightChangeFromDelay(
      selected,
      selectedDelay,
      "Deep-delay selected low-priority flight",
    ),
  );
  const changes = [...changesByFlightId.values()].sort(
    (a, b) => a.original_std.getTime() - b.original_std.getTime(),
  );
  const option: RecoveryOption = {
    option_id: randomId("OPT-DEEP"),
    option_type: "DEEP_DELAY",
    flight_changes: changes,
    aircraft_changes: {},
    total_delay_minutes: 0,
    max_delay_minutes: 0,
    impacted_flight_count: 0,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: selectedDelay > 180 ? "HIGH" : "MEDIUM",
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      `Select lower-priority flight ${selected.flight_number} to absorb deeper delay`,
      "Delay propagation remains applied to every impacted aircraft rotation",
    ],
    score_breakdown: {},
  };
  recalculateMetrics(option);
  return option;
}
