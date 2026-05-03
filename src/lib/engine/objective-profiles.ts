import type { OccRules } from "@/lib/types";

export type RecoveryObjectiveProfile =
  | "balanced"
  | "min_delay"
  | "protect_passengers"
  | "low_risk"
  | "fewest_swaps";

export interface RecoveryObjectiveProfileDefinition {
  value: RecoveryObjectiveProfile;
  label: string;
  description: string;
}

export const RECOVERY_OBJECTIVE_PROFILES: RecoveryObjectiveProfileDefinition[] =
  [
    {
      value: "balanced",
      label: "Balanced",
      description: "Use the configured business-rule weights.",
    },
    {
      value: "min_delay",
      label: "Min delay",
      description: "Prefer lower total and maximum delay.",
    },
    {
      value: "protect_passengers",
      label: "Protect pax",
      description: "Prefer lower passenger delay and misconnect risk.",
    },
    {
      value: "low_risk",
      label: "Low risk",
      description: "Prefer operationally conservative options.",
    },
    {
      value: "fewest_swaps",
      label: "Fewest swaps",
      description: "Avoid aircraft reassignments unless they pay off clearly.",
    },
  ];

function cloneRules(rules: OccRules): OccRules {
  return {
    ...rules,
    aircraft_rules: {
      ...rules.aircraft_rules,
      compatible_types: { ...rules.aircraft_rules.compatible_types },
    },
    turnaround_rules: {
      ...rules.turnaround_rules,
      by_aircraft_type: { ...rules.turnaround_rules.by_aircraft_type },
    },
    airport_rules: {
      ...rules.airport_rules,
      curfews: rules.airport_rules.curfews
        ? { ...rules.airport_rules.curfews }
        : undefined,
    },
    maintenance_rules: { ...rules.maintenance_rules },
    priority_rules: { ...rules.priority_rules },
    passenger_rules: rules.passenger_rules
      ? {
          ...rules.passenger_rules,
          default_seat_capacity_by_type: {
            ...rules.passenger_rules.default_seat_capacity_by_type,
          },
        }
      : undefined,
    spread_delay_rules: { ...rules.spread_delay_rules },
    flat_delay_rules: { ...rules.flat_delay_rules },
    score_weights: { ...rules.score_weights },
  };
}

export function getRecoveryObjectiveProfile(
  value: RecoveryObjectiveProfile,
): RecoveryObjectiveProfileDefinition {
  return (
    RECOVERY_OBJECTIVE_PROFILES.find((profile) => profile.value === value) ??
    RECOVERY_OBJECTIVE_PROFILES[0]
  );
}

export function applyRecoveryObjectiveProfile(
  rules: OccRules,
  profile: RecoveryObjectiveProfile,
): OccRules {
  const next = cloneRules(rules);
  const weights = next.score_weights;

  switch (profile) {
    case "min_delay":
      weights.total_delay_weight *= 1.6;
      weights.max_delay_weight *= 1.45;
      weights.impacted_flight_weight *= 0.75;
      weights.swap_penalty *= 0.55;
      weights.passenger_delay_weight =
        (weights.passenger_delay_weight ?? 0.02) * 0.7;
      weights.passenger_priority_weight =
        (weights.passenger_priority_weight ?? 15) * 0.65;
      weights.risk_penalty_multiplier = 0.85;
      break;
    case "protect_passengers":
      weights.total_delay_weight *= 0.8;
      weights.max_delay_weight *= 0.85;
      weights.impacted_flight_weight *= 1.15;
      weights.swap_penalty *= 0.85;
      weights.priority_protection_bonus *= 2;
      weights.passenger_delay_weight =
        (weights.passenger_delay_weight ?? 0.02) * 3;
      weights.passenger_priority_weight =
        (weights.passenger_priority_weight ?? 15) * 2.4;
      weights.misconnect_risk_penalty =
        (weights.misconnect_risk_penalty ?? 80) * 2;
      break;
    case "low_risk":
      weights.max_delay_weight *= 1.25;
      weights.swap_penalty *= 2.4;
      weights.maintenance_risk_penalty *= 1.8;
      weights.closure_violation_penalty *= 1.5;
      weights.curfew_risk_penalty *= 1.8;
      weights.priority_protection_bonus *= 1.4;
      weights.risk_penalty_multiplier = 2.25;
      break;
    case "fewest_swaps":
      weights.total_delay_weight *= 0.85;
      weights.max_delay_weight *= 0.95;
      weights.impacted_flight_weight *= 0.8;
      weights.swap_penalty *= 4;
      weights.risk_penalty_multiplier = 1.25;
      break;
    case "balanced":
    default:
      break;
  }

  return next;
}
