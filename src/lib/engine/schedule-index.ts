import type { FlightLeg } from "@/lib/types";

export interface ScheduleIndex {
  flightsById: Map<string, FlightLeg>;
  flightsByStd: FlightLeg[];
  rotationsByAircraft: Map<string, FlightLeg[]>;
}

export function buildScheduleIndex(schedule: FlightLeg[]): ScheduleIndex {
  const flightsById = new Map<string, FlightLeg>();
  const rotationsByAircraft = new Map<string, FlightLeg[]>();

  for (const flight of schedule) {
    flightsById.set(flight.flight_id, flight);
    const rotation = rotationsByAircraft.get(flight.aircraft_id) ?? [];
    rotation.push(flight);
    rotationsByAircraft.set(flight.aircraft_id, rotation);
  }

  for (const [aircraftId, rotation] of rotationsByAircraft) {
    rotationsByAircraft.set(
      aircraftId,
      [...rotation].sort((a, b) => a.std.getTime() - b.std.getTime()),
    );
  }

  return {
    flightsById,
    flightsByStd: [...schedule].sort(
      (a, b) => a.std.getTime() - b.std.getTime(),
    ),
    rotationsByAircraft,
  };
}

export function resolveScheduleIndex(
  schedule: FlightLeg[],
  index?: ScheduleIndex,
): ScheduleIndex {
  return index ?? buildScheduleIndex(schedule);
}

export function getAircraftRotation(
  index: ScheduleIndex,
  aircraftId: string,
): FlightLeg[] {
  return index.rotationsByAircraft.get(aircraftId) ?? [];
}
