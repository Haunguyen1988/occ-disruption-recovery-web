import type {
  DisruptionEvent,
  FlightLeg,
  ImpactedFlight,
  OccRules,
} from "@/lib/types";
import { overlaps } from "./time-utils";

function sortByAircraftRotation(
  schedule: FlightLeg[],
): Map<string, FlightLeg[]> {
  const rotations = new Map<string, FlightLeg[]>();
  for (const flight of schedule) {
    const list = rotations.get(flight.aircraft_id) ?? [];
    list.push(flight);
    rotations.set(flight.aircraft_id, list);
  }
  for (const [acId, list] of rotations) {
    rotations.set(
      acId,
      [...list].sort((a, b) => a.std.getTime() - b.std.getTime()),
    );
  }
  return rotations;
}

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
): ImpactedFlight[] {
  // Rules reserved for future curfew/closure-aware impact detection.
  void _rules;
  switch (disruption.event_type) {
    case "AOG":
      return findAogImpacts(disruption, schedule);
    case "AIRPORT_CLOSE":
    case "WEATHER":
      return findAirportImpacts(disruption, schedule);
    case "LATE_ARRIVAL":
      return findLateArrivalImpacts(disruption, schedule);
    default:
      return [];
  }
}

function findAogImpacts(
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
): ImpactedFlight[] {
  if (!disruption.affected_aircraft) return [];
  const rotation =
    sortByAircraftRotation(schedule).get(disruption.affected_aircraft) ?? [];
  const impacted: ImpactedFlight[] = [];
  let downstreamStarted = false;
  for (const flight of rotation) {
    const directOverlap = overlaps(
      flight.std,
      flight.sta,
      disruption.start_time,
      disruption.end_time,
    );
    // Bug fix K1: a flight whose STD is strictly after end_time and has no
    // preceding overlap is NOT impacted (aircraft is back in service).
    const startsDuring =
      flight.std >= disruption.start_time &&
      flight.std < disruption.end_time;
    const shouldImpact = directOverlap || startsDuring || downstreamStarted;
    if (shouldImpact) {
      downstreamStarted = true;
      const reasons = [
        `AOG aircraft ${disruption.affected_aircraft} unavailable from ${disruption.start_time.toISOString()} to ${disruption.end_time.toISOString()}`,
        `Flight ${flight.flight_number} assigned to affected aircraft`,
      ];
      if (!directOverlap && !startsDuring) {
        reasons.push("Downstream rotation may be impacted");
      }
      impacted.push({ flight, reason_codes: reasons });
    }
  }
  return impacted;
}

function findAirportImpacts(
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
): ImpactedFlight[] {
  if (!disruption.affected_airport) return [];
  const airport = disruption.affected_airport;
  const eventLabel =
    disruption.event_type === "WEATHER" ? "Weather risk" : "Airport closure";
  const impacted: ImpactedFlight[] = [];
  const sorted = [...schedule].sort(
    (a, b) => a.std.getTime() - b.std.getTime(),
  );
  for (const flight of sorted) {
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
  schedule: FlightLeg[],
): ImpactedFlight[] {
  if (!disruption.affected_flight_id) return [];
  const affected = schedule.find(
    (f) => f.flight_id === disruption.affected_flight_id,
  );
  if (!affected) return [];
  const rotation = schedule
    .filter((f) => f.aircraft_id === affected.aircraft_id)
    .sort((a, b) => a.std.getTime() - b.std.getTime());
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
