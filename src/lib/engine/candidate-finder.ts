import type {
  Aircraft,
  CandidateAircraft,
  FlightLeg,
  OccRules,
  RiskLevel,
} from "@/lib/types";
import { addMinutes, minTurnaroundForType, overlaps } from "./time-utils";
import {
  getAircraftRotation,
  resolveScheduleIndex,
  type ScheduleIndex,
} from "./schedule-index";

function compatibleTypes(
  targetType: string,
  candidateType: string,
  rules: OccRules,
): boolean {
  const compat = rules.aircraft_rules?.compatible_types ?? {};
  const allowed = compat[targetType] ?? [targetType];
  return allowed.includes(candidateType);
}

function hasConflict(
  candidate: Aircraft,
  target: FlightLeg,
  scheduleIndex: ScheduleIndex,
): boolean {
  return getAircraftRotation(scheduleIndex, candidate.aircraft_id).some((f) =>
    overlaps(f.std, f.sta, target.std, target.sta),
  );
}

/**
 * Derive the **projected station** of an aircraft at a given point in time
 * by examining its rotation in the schedule.
 *
 * 1. Find the latest flight whose STA ≤ `atTime` — the aircraft is at that
 *    flight's destination after landing.
 * 2. If no such flight exists (the aircraft hasn't flown yet, or it's a
 *    standby/reserve), fall back to the static `current_station` field
 *    from the Aircraft CSV.
 *
 * This is critical for real operational data where the CSV snapshot records
 * the aircraft's station at file-creation time, not at disruption time.
 */
export function getProjectedStation(
  aircraftId: string,
  atTime: Date,
  scheduleIndex: ScheduleIndex,
  fallbackStation: string,
): string {
  const rotation = getAircraftRotation(scheduleIndex, aircraftId);
  let lastLanded: FlightLeg | null = null;
  for (const flight of rotation) {
    if (flight.sta <= atTime) {
      if (!lastLanded || flight.sta > lastLanded.sta) {
        lastLanded = flight;
      }
    }
  }
  return lastLanded ? lastLanded.destination : fallbackStation;
}

export function findCandidateAircraft(
  targetFlight: FlightLeg,
  aircraftList: Aircraft[],
  schedule: FlightLeg[],
  rules: OccRules,
  scheduleIndex?: ScheduleIndex,
): CandidateAircraft[] {
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  const candidates: CandidateAircraft[] = [];
  const minTurn = minTurnaroundForType(targetFlight.aircraft_type, rules);
  const requiredAvailableTime = addMinutes(targetFlight.std, -minTurn);

  for (const ac of aircraftList) {
    if (ac.aircraft_id === targetFlight.aircraft_id) continue;
    const reasons: string[] = [];
    let feasible = true;
    let risk: RiskLevel = "LOW";

    if (ac.status.toUpperCase() !== "ACTIVE") {
      feasible = false;
      risk = "HIGH";
      reasons.push(`Aircraft status is ${ac.status}`);
    }

    if (!compatibleTypes(targetFlight.aircraft_type, ac.aircraft_type, rules)) {
      feasible = false;
      risk = "HIGH";
      reasons.push(
        `Aircraft type ${ac.aircraft_type} not compatible with ${targetFlight.aircraft_type}`,
      );
    } else {
      reasons.push("Aircraft type compatible");
    }

    // --- FIX: use projected station from schedule instead of static CSV ---
    const projectedStation = getProjectedStation(
      ac.aircraft_id,
      targetFlight.std,
      index,
      ac.current_station,
    );
    if (projectedStation !== targetFlight.origin) {
      feasible = false;
      if (risk !== "HIGH") risk = "MEDIUM";
      reasons.push(
        `Aircraft projected at ${projectedStation} (CSV: ${ac.current_station}), target origin is ${targetFlight.origin}`,
      );
    } else {
      reasons.push(`Aircraft projected at target origin ${targetFlight.origin}`);
    }

    if (ac.available_from > requiredAvailableTime) {
      feasible = false;
      if (risk !== "HIGH") risk = "MEDIUM";
      reasons.push(
        `Available from ${ac.available_from.toISOString()}, required by ${requiredAvailableTime.toISOString()}`,
      );
    } else {
      reasons.push("Availability satisfies turnaround requirement");
    }

    if (hasConflict(ac, targetFlight, index)) {
      feasible = false;
      risk = "HIGH";
      reasons.push("Schedule conflict with candidate aircraft existing assignment");
    } else {
      reasons.push("No overlapping schedule conflict detected");
    }

    if (
      ac.next_maintenance_time &&
      targetFlight.sta > ac.next_maintenance_time
    ) {
      feasible = false;
      risk = "HIGH";
      reasons.push("Target flight arrival exceeds candidate next maintenance time");
    }

    if (ac.restriction) {
      if (feasible && risk !== "HIGH") risk = "MEDIUM";
      reasons.push(`Restriction note: ${ac.restriction}`);
    }

    candidates.push({
      aircraft: ac,
      target_flight_id: targetFlight.flight_id,
      feasible,
      risk_level: risk,
      reason_codes: reasons,
    });
  }

  const riskOrder: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return candidates.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.risk_level !== b.risk_level)
      return riskOrder[a.risk_level] - riskOrder[b.risk_level];
    return a.aircraft.available_from.getTime() - b.aircraft.available_from.getTime();
  });
}
