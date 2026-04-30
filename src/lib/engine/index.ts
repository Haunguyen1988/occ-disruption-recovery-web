import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  RecoveryOption,
  SimulationFeedback,
} from "@/lib/types";
import { findImpactedFlights } from "./impact-detector";
import { rankRecoveryOptions } from "./option-scorer";
import { generateRecoveryOptions } from "./recovery-option-generator";
import { buildScheduleIndex } from "./schedule-index";

export interface SimulationResult {
  event: DisruptionEvent;
  impacted_flights: ImpactedFlight[];
  ranked_options: RecoveryOption[];
  feedback: SimulationFeedback | null;
}

export interface MultiSimulationResult {
  events: DisruptionEvent[];
  impacted_flights: ImpactedFlight[];
  ranked_options: RecoveryOption[];
  feedback: SimulationFeedback | null;
}

export function runSimulation(input: {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: DisruptionEvent;
  rules: OccRules;
}): SimulationResult {
  const { schedule, aircraft, disruption, rules } = input;
  const scheduleIndex = buildScheduleIndex(schedule);
  const impacted = findImpactedFlights(
    disruption,
    schedule,
    rules,
    scheduleIndex,
  );
  const generated = generateRecoveryOptions(
    impacted,
    disruption,
    schedule,
    aircraft,
    rules,
    scheduleIndex,
  );
  const ranked = rankRecoveryOptions(generated.options, rules, schedule);
  return {
    event: disruption,
    impacted_flights: impacted,
    ranked_options: ranked,
    feedback: generated.feedback,
  };
}

/**
 * K10 — multi-event simulation.
 *
 * Combines several concurrent disruption events (e.g. AOG + weather + late
 * arrival) into a single recovery search. Impacted-flight sets from each event
 * are unioned (with reasons preserved); aircraft AOG'd by any event are
 * excluded from the swap candidate pool; delay propagation uses the latest
 * event end_time so options account for the full disruption window.
 *
 * Lesson learned from Southwest 2022: a recovery tool that handles only one
 * event at a time cannot scale during cascading IROPS.
 */
export function runMultiEventSimulation(input: {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruptions: DisruptionEvent[];
  rules: OccRules;
}): MultiSimulationResult {
  const { schedule, aircraft, disruptions, rules } = input;

  if (disruptions.length === 0) {
    return { events: [], impacted_flights: [], ranked_options: [], feedback: null };
  }

  const scheduleIndex = buildScheduleIndex(schedule);

  if (disruptions.length === 1) {
    const impacted = findImpactedFlights(
      disruptions[0],
      schedule,
      rules,
      scheduleIndex,
    );
    const generated = generateRecoveryOptions(
      impacted,
      disruptions[0],
      schedule,
      aircraft,
      rules,
      scheduleIndex,
    );
    const ranked = rankRecoveryOptions(generated.options, rules, schedule);
    return {
      events: [disruptions[0]],
      impacted_flights: impacted,
      ranked_options: ranked,
      feedback: generated.feedback,
    };
  }

  // 1. Union of impacted flights with merged reason codes.
  const impactedById = new Map<string, ImpactedFlight>();
  for (const event of disruptions) {
    for (const im of findImpactedFlights(event, schedule, rules, scheduleIndex)) {
      const key = im.flight.flight_id;
      const existing = impactedById.get(key);
      if (existing) {
        for (const reason of im.reason_codes) {
          if (!existing.reason_codes.includes(reason)) {
            existing.reason_codes.push(reason);
          }
        }
      } else {
        impactedById.set(key, {
          flight: im.flight,
          reason_codes: [...im.reason_codes],
        });
      }
    }
  }
  const impacted = [...impactedById.values()];
  if (impacted.length === 0) {
    return { events: disruptions, impacted_flights: [], ranked_options: [], feedback: null };
  }

  // 2. Combined disruption window — start = earliest, end = latest.
  const startMs = Math.min(...disruptions.map((d) => d.start_time.getTime()));
  const endMs = Math.max(...disruptions.map((d) => d.end_time.getTime()));
  const combined: DisruptionEvent = {
    event_id: "MULTI",
    event_type: "AOG",
    start_time: new Date(startMs),
    end_time: new Date(endMs),
    severity: "HIGH",
    description: `Combined window of ${disruptions.length} events`,
    affected_aircraft: null,
    affected_airport: null,
    affected_flight_id: null,
  };

  // 3. Exclude AOG'd aircraft from the swap candidate pool across ALL events.
  const excluded = new Set(
    disruptions
      .filter((d) => d.event_type === "AOG" && d.affected_aircraft)
      .map((d) => d.affected_aircraft as string),
  );
  const usableAircraft = aircraft.filter(
    (a) => !excluded.has(a.aircraft_id),
  );

  const generated = generateRecoveryOptions(
    impacted,
    combined,
    schedule,
    usableAircraft,
    rules,
    scheduleIndex,
  );
  const ranked = rankRecoveryOptions(generated.options, rules, schedule);

  return {
    events: disruptions,
    impacted_flights: impacted,
    ranked_options: ranked,
    feedback: generated.feedback,
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
export { buildScheduleIndex } from "./schedule-index";
export {
  isInCurfew,
  getAirportUtcOffsetHours,
  getAirportTimezone,
  localToUtc,
  utcToLocalMinuteOfDay,
} from "./time-utils";
