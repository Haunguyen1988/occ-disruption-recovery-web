import { parse } from "yaml";
import type { OccRules } from "@/lib/types";

export function parseRulesYaml(text: string): OccRules {
  const data = parse(text);
  validateRules(data);
  return data as OccRules;
}

type RuleRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): RuleRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as RuleRecord;
}

function requireObject(parent: RuleRecord, key: string): RuleRecord {
  return asRecord(parent[key], `${key}`);
}

function requireBoolean(parent: RuleRecord, key: string): void {
  if (typeof parent[key] !== "boolean") {
    throw new Error(`${key} must be true or false`);
  }
}

function requireNumber(parent: RuleRecord, key: string): void {
  if (typeof parent[key] !== "number" || !Number.isFinite(parent[key])) {
    throw new Error(`${key} must be a number`);
  }
}

function requireStringArrayRecord(parent: RuleRecord, key: string): void {
  const record = requireObject(parent, key);
  for (const [recordKey, value] of Object.entries(record)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      throw new Error(`${key}.${recordKey} must be a list of strings`);
    }
  }
}

function requireNumberRecord(parent: RuleRecord, key: string): void {
  const record = requireObject(parent, key);
  for (const [recordKey, value] of Object.entries(record)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${key}.${recordKey} must be a number`);
    }
  }
}

function validateCurfews(airportRules: RuleRecord): void {
  if (airportRules.curfews === undefined) return;
  const curfews = asRecord(airportRules.curfews, "curfews");
  for (const [airport, value] of Object.entries(curfews)) {
    const window = asRecord(value, `curfews.${airport}`);
    if (typeof window.start !== "string" || typeof window.end !== "string") {
      throw new Error(`curfews.${airport} must include string start and end`);
    }
  }
}

function validatePassengerRules(root: RuleRecord): void {
  if (root.passenger_rules === undefined) return;
  const passengerRules = requireObject(root, "passenger_rules");
  requireBoolean(passengerRules, "enabled");
  requireNumberRecord(passengerRules, "default_seat_capacity_by_type");
  requireNumber(passengerRules, "fallback_seat_capacity");
  requireNumber(passengerRules, "misconnect_delay_threshold_minutes");
  requireNumber(passengerRules, "high_impact_passenger_threshold");
  requireNumber(passengerRules, "international_priority_multiplier");
  requireNumber(passengerRules, "last_flight_priority_multiplier");
  requireNumber(passengerRules, "vip_priority_multiplier");
  requireNumber(passengerRules, "special_service_priority_multiplier");
}

function requireOptionalNumber(parent: RuleRecord, key: string): void {
  if (parent[key] === undefined) return;
  requireNumber(parent, key);
}

function validateRules(value: unknown): void {
  const root = asRecord(value, "Rules YAML");

  const aircraftRules = requireObject(root, "aircraft_rules");
  requireBoolean(aircraftRules, "allow_same_fleet_swap");
  requireBoolean(aircraftRules, "allow_cross_fleet_swap");
  requireNumber(aircraftRules, "max_swap_chain_length");
  requireStringArrayRecord(aircraftRules, "compatible_types");

  const turnaroundRules = requireObject(root, "turnaround_rules");
  requireNumber(turnaroundRules, "default_minutes");
  requireNumberRecord(turnaroundRules, "by_aircraft_type");

  const airportRules = requireObject(root, "airport_rules");
  requireBoolean(airportRules, "enforce_closure_window");
  requireNumber(airportRules, "reopen_buffer_minutes");
  requireBoolean(airportRules, "enforce_curfew");
  validateCurfews(airportRules);

  const maintenanceRules = requireObject(root, "maintenance_rules");
  requireBoolean(maintenanceRules, "prohibit_swap_if_next_check_risk");
  requireNumber(maintenanceRules, "next_check_buffer_minutes");

  const priorityRules = requireObject(root, "priority_rules");
  requireBoolean(priorityRules, "protect_last_flight_of_day");
  requireBoolean(priorityRules, "protect_high_load_factor");
  requireNumber(priorityRules, "high_load_factor_threshold");
  requireBoolean(priorityRules, "protect_international_flight");

  validatePassengerRules(root);

  const spreadDelayRules = requireObject(root, "spread_delay_rules");
  requireBoolean(spreadDelayRules, "enabled");
  requireNumber(spreadDelayRules, "max_delay_per_flight_minutes");

  const flatDelayRules = requireObject(root, "flat_delay_rules");
  requireNumber(flatDelayRules, "max_normal_delay_minutes");
  requireNumber(flatDelayRules, "max_deep_delay_minutes");

  const scoreWeights = requireObject(root, "score_weights");
  requireNumber(scoreWeights, "total_delay_weight");
  requireNumber(scoreWeights, "max_delay_weight");
  requireNumber(scoreWeights, "impacted_flight_weight");
  requireNumber(scoreWeights, "swap_penalty");
  requireNumber(scoreWeights, "maintenance_risk_penalty");
  requireNumber(scoreWeights, "closure_violation_penalty");
  requireNumber(scoreWeights, "curfew_risk_penalty");
  requireNumber(scoreWeights, "priority_protection_bonus");
  requireOptionalNumber(scoreWeights, "passenger_delay_weight");
  requireOptionalNumber(scoreWeights, "passenger_priority_weight");
  requireOptionalNumber(scoreWeights, "misconnect_risk_penalty");
  requireOptionalNumber(scoreWeights, "risk_penalty_multiplier");
}

export const DEFAULT_RULES_YAML = `aircraft_rules:
  allow_same_fleet_swap: true
  allow_cross_fleet_swap: false
  max_swap_chain_length: 3
  compatible_types:
    A320: [A320]
    A321: [A321]

turnaround_rules:
  default_minutes: 40
  by_aircraft_type:
    A320: 35
    A321: 40

airport_rules:
  enforce_closure_window: true
  reopen_buffer_minutes: 30
  enforce_curfew: true
  curfews:
    PQC: { start: "23:00", end: "05:00" }
    VCL: { start: "22:00", end: "06:00" }
    VCS: { start: "22:00", end: "06:00" }
    BMV: { start: "22:00", end: "06:00" }

maintenance_rules:
  prohibit_swap_if_next_check_risk: true
  next_check_buffer_minutes: 60

priority_rules:
  protect_last_flight_of_day: true
  protect_high_load_factor: true
  high_load_factor_threshold: 0.85
  protect_international_flight: true

passenger_rules:
  enabled: true
  default_seat_capacity_by_type:
    A320: 180
    A321: 230
    A330: 377
  fallback_seat_capacity: 180
  misconnect_delay_threshold_minutes: 45
  high_impact_passenger_threshold: 150
  international_priority_multiplier: 1.3
  last_flight_priority_multiplier: 1.4
  vip_priority_multiplier: 4.0
  special_service_priority_multiplier: 2.0

spread_delay_rules:
  enabled: true
  max_delay_per_flight_minutes: 90

flat_delay_rules:
  max_normal_delay_minutes: 180
  max_deep_delay_minutes: 360

score_weights:
  total_delay_weight: 1.0
  max_delay_weight: 1.5
  impacted_flight_weight: 10
  swap_penalty: 25
  maintenance_risk_penalty: 150
  closure_violation_penalty: 200
  curfew_risk_penalty: 120
  priority_protection_bonus: 40
  passenger_delay_weight: 0.02
  passenger_priority_weight: 15
  misconnect_risk_penalty: 80
`;

export function getDefaultRules(): OccRules {
  return parseRulesYaml(DEFAULT_RULES_YAML);
}
