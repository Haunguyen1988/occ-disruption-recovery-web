import type { FlightLeg } from "@/lib/types";

export function isCompletedFlight(flight: FlightLeg): boolean {
  return Boolean(flight.actual_arrival_time);
}

export function isOperatedFlight(flight: FlightLeg): boolean {
  return Boolean(flight.actual_departure_time || flight.actual_arrival_time);
}
