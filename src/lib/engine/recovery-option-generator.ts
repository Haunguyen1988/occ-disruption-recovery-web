import type {
  Aircraft,
  CandidateAircraft,
  DisruptionEvent,
  FlightChange,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  RecoveryOption,
} from "@/lib/types";
import { findCandidateAircraft } from "./candidate-finder";
import {
  simulateDeepDelay,
  simulateDelayOnly,
  simulateSpreadDelay,
} from "./delay-simulator";

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Bug fix K4: single-swap re-rotates the impacted rotation onto the new aircraft
 * starting from the target leg, so the orphan downstream legs of the impacted
 * tail are also covered (best-effort: same station, no conflict).
 */
function createSingleSwapOption(
  target: FlightLeg,
  candidate: CandidateAircraft,
  schedule: FlightLeg[],
): RecoveryOption {
  const downstream = schedule
    .filter(
      (f) =>
        f.aircraft_id === target.aircraft_id &&
        f.std.getTime() >= target.std.getTime(),
    )
    .sort((a, b) => a.std.getTime() - b.std.getTime());

  const newAcId = candidate.aircraft.aircraft_id;
  const candidateConflicts = new Set(
    schedule
      .filter((f) => f.aircraft_id === newAcId)
      .map((f) => f.flight_id),
  );

  const flightChanges: FlightChange[] = [];
  for (const flight of downstream) {
    if (candidateConflicts.has(flight.flight_id)) continue;
    flightChanges.push({
      flight_id: flight.flight_id,
      flight_number: flight.flight_number,
      original_aircraft: flight.aircraft_id,
      new_aircraft: newAcId,
      original_std: flight.std,
      original_sta: flight.sta,
      new_std: flight.std,
      new_sta: flight.sta,
      delay_minutes: 0,
      reason:
        flight.flight_id === target.flight_id
          ? "Single aircraft swap (target leg)"
          : "Re-rotate downstream leg onto swap aircraft",
    });
  }

  const option: RecoveryOption = {
    option_id: randomId("OPT-SWAP"),
    option_type: "SINGLE_SWAP",
    flight_changes: flightChanges,
    aircraft_changes: { [target.aircraft_id]: newAcId },
    total_delay_minutes: 0,
    max_delay_minutes: 0,
    impacted_flight_count: flightChanges.length,
    swap_count: 1,
    risk_level: candidate.risk_level,
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      `Swap target flight ${target.flight_number} (and downstream rotation) from ${target.aircraft_id} to ${newAcId}`,
      ...candidate.reason_codes,
    ],
    score_breakdown: {},
  };
  return option;
}

export function generateRecoveryOptions(
  impacted: ImpactedFlight[],
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  aircraftList: Aircraft[],
  rules: OccRules,
): RecoveryOption[] {
  if (!impacted.length) return [];
  const options: RecoveryOption[] = [];
  options.push(simulateDelayOnly(impacted, disruption, schedule, rules));
  options.push(simulateSpreadDelay(impacted, disruption, schedule, rules));
  options.push(simulateDeepDelay(impacted, disruption, schedule, rules));

  const target = [...impacted]
    .map((i) => i.flight)
    .sort((a, b) => a.std.getTime() - b.std.getTime())[0];
  const candidates = findCandidateAircraft(target, aircraftList, schedule, rules);
  const feasibleCandidates = candidates.filter((c) => c.feasible).slice(0, 3);
  for (const candidate of feasibleCandidates) {
    options.push(createSingleSwapOption(target, candidate, schedule));
  }
  return options;
}
