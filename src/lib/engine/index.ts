import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  RecoveryOption,
} from "@/lib/types";
import { findImpactedFlights } from "./impact-detector";
import { rankRecoveryOptions } from "./option-scorer";
import { generateRecoveryOptions } from "./recovery-option-generator";

export interface SimulationResult {
  event: DisruptionEvent;
  impacted_flights: ImpactedFlight[];
  ranked_options: RecoveryOption[];
}

export function runSimulation(input: {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: DisruptionEvent;
  rules: OccRules;
}): SimulationResult {
  const { schedule, aircraft, disruption, rules } = input;
  const impacted = findImpactedFlights(disruption, schedule, rules);
  const options = generateRecoveryOptions(
    impacted,
    disruption,
    schedule,
    aircraft,
    rules,
  );
  const ranked = rankRecoveryOptions(options, rules);
  return {
    event: disruption,
    impacted_flights: impacted,
    ranked_options: ranked,
  };
}

export { findImpactedFlights } from "./impact-detector";
export { findCandidateAircraft } from "./candidate-finder";
export {
  simulateDelayOnly,
  simulateSpreadDelay,
  simulateDeepDelay,
} from "./delay-simulator";
export { generateRecoveryOptions } from "./recovery-option-generator";
export { rankRecoveryOptions, calculateRecoveryScore } from "./option-scorer";
