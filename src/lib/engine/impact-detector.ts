import type {
  DisruptionEvent,
  FlightLeg,
  ImpactedFlight,
  OccRules,
} from "@/lib/types";
import { overlaps } from "./time-utils";
import { getProjectedStation } from "./candidate-finder";
import {
  getAircraftRotation,
  resolveScheduleIndex,
  type ScheduleIndex,
} from "./schedule-index";

/**
 * Find flights impacted by a disruption event.
 *
 * Bug fix vs Python MVP (K1): for AOG, only the first flight whose STD falls
 * within the AOG window OR overlaps it triggers downstream propagation. Flights
 * with STD strictly after end_time but no preceding overlap are NOT auto-marked
 * — they will only propagate if the previous downstream flight pushed them.
 */
export function findImpactedFlights(
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  _rules?: OccRules,
  scheduleIndex?: ScheduleIndex,
): ImpactedFlight[] {
  // Rules reserved for future curfew/closure-aware impact detection.
  void _rules;
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  switch (disruption.event_type) {
    case "AOG":
      return findAogImpacts(disruption, index);
    case "AIRPORT_CLOSE":
    case "WEATHER":
      return findAirportImpacts(disruption, index);
    case "LATE_ARRIVAL":
      return findLateArrivalImpacts(disruption, index);
    default:
      return [];
  }
}

function findAogImpacts(
  disruption: DisruptionEvent,
  scheduleIndex: ScheduleIndex,
): ImpactedFlight[] {
  if (!disruption.affected_aircraft) return [];
  const rotation = getAircraftRotation(
    scheduleIndex,
    disruption.affected_aircraft,
  );
  const impacted: ImpactedFlight[] = [];

  // Validate: check where the aircraft actually is at AOG start time
  const projStation = getProjectedStation(
    disruption.affected_aircraft,
    disruption.start_time,
    scheduleIndex,
    disruption.affected_airport ?? "",
  );
  const stationNote = disruption.affected_airport && projStation !== disruption.affected_airport
    ? `⚠️ Aircraft projected at ${projStation}, not ${disruption.affected_airport} — verify AOG location`
    : `Aircraft at ${projStation} when AOG reported`;

  for (const flight of rotation) {
    // A flight is impacted ONLY if:
    //   1) Its time range overlaps the AOG window, OR
    //   2) Its STD falls within the AOG window
    // Flights departing AFTER end_time are NOT impacted — aircraft is repaired.
    const directOverlap = overlaps(
      flight.std,
      flight.sta,
      disruption.start_time,
      disruption.end_time,
    );
    const startsDuring =
      flight.std >= disruption.start_time &&
      flight.std < disruption.end_time;

    if (directOverlap || startsDuring) {
      impacted.push({
        flight,
        reason_codes: [
          `AOG aircraft ${disruption.affected_aircraft} unavailable from ${disruption.start_time.toISOString()} to ${disruption.end_time.toISOString()}`,
          `Flight ${flight.flight_number} (${flight.origin}→${flight.destination}) STD ${flight.std.toISOString()} falls within AOG window`,
          stationNote,
        ],
      });
    }
  }
  return impacted;
}

function findAirportImpacts(
  disruption: DisruptionEvent,
  scheduleIndex: ScheduleIndex,
): ImpactedFlight[] {
  if (!disruption.affected_airport) return [];
  const airport = disruption.affected_airport;
  const eventLabel =
    disruption.event_type === "WEATHER" ? "Weather risk" : "Airport closure";
  const impacted: ImpactedFlight[] = [];
  for (const flight of scheduleIndex.flightsByStd) {
    const departureBlocked =
      flight.origin === airport &&
      flight.std >= disruption.start_time &&
      flight.std < disruption.end_time;
    const arrivalBlocked =
      flight.destination === airport &&
      flight.sta >= disruption.start_time &&
      flight.sta < disruption.end_time;
    if (departureBlocked || arrivalBlocked) {
      const reasons = [
        `${eventLabel} at ${airport} from ${disruption.start_time.toISOString()} to ${disruption.end_time.toISOString()}`,
      ];
      if (departureBlocked)
        reasons.push(`Departure from ${airport} falls within affected window`);
      if (arrivalBlocked)
        reasons.push(`Arrival into ${airport} falls within affected window`);
      impacted.push({ flight, reason_codes: reasons });
    }
  }
  return impacted;
}

function findLateArrivalImpacts(
  disruption: DisruptionEvent,
  scheduleIndex: ScheduleIndex,
): ImpactedFlight[] {
  if (!disruption.affected_flight_id) return [];
  const affected = scheduleIndex.flightsById.get(disruption.affected_flight_id);
  if (!affected) return [];
  const rotation = getAircraftRotation(scheduleIndex, affected.aircraft_id);
  const impacted: ImpactedFlight[] = [];
  let downstreamStarted = false;
  for (const flight of rotation) {
    if (flight.flight_id === affected.flight_id) downstreamStarted = true;
    if (downstreamStarted) {
      impacted.push({
        flight,
        reason_codes: [
          `Late arrival event starts from flight ${affected.flight_number}`,
          "Downstream same-aircraft rotation needs delay propagation check",
        ],
      });
    }
  }
  return impacted;
}
