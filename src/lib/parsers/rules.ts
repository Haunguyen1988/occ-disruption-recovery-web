import { parse } from "yaml";
import type { OccRules } from "@/lib/types";

export function parseRulesYaml(text: string): OccRules {
  const data = parse(text);
  return data as OccRules;
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
`;

export function getDefaultRules(): OccRules {
  return parseRulesYaml(DEFAULT_RULES_YAML);
}
