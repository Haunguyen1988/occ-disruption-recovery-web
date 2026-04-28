import type {
  Aircraft,
  CandidateAircraft,
  FlightLeg,
  OccRules,
  RiskLevel,
} from "@/lib/types";
import { addMinutes, minTurnaroundForType, overlaps } from "./time-utils";

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
  schedule: FlightLeg[],
): boolean {
  return schedule.some(
    (f) =>
      f.aircraft_id === candidate.aircraft_id &&
      overlaps(f.std, f.sta, target.std, target.sta),
  );
}

export function findCandidateAircraft(
  targetFlight: FlightLeg,
  aircraftList: Aircraft[],
  schedule: FlightLeg[],
  rules: OccRules,
): CandidateAircraft[] {
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

    if (ac.current_station !== targetFlight.origin) {
      feasible = false;
      if (risk !== "HIGH") risk = "MEDIUM";
      reasons.push(
        `Aircraft at ${ac.current_station}, target origin is ${targetFlight.origin}`,
      );
    } else {
      reasons.push(`Aircraft available at target origin ${targetFlight.origin}`);
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

    if (hasConflict(ac, targetFlight, schedule)) {
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
