export type DisruptionType =
  | "AOG"
  | "AIRPORT_CLOSE"
  | "WEATHER"
  | "LATE_ARRIVAL";

export type OptionType =
  | "DELAY_ONLY"
  | "SPREAD_DELAY"
  | "DEEP_DELAY"
  | "SINGLE_SWAP"
  | "SWAP_CHAIN"
  | "CANCEL_OR_FERRY";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface FlightLeg {
  flight_id: string;
  flight_number: string;
  origin: string;
  destination: string;
  std: Date;
  sta: Date;
  aircraft_id: string;
  aircraft_type: string;
  priority_level: number;
  load_factor: number;
  is_international: boolean;
  is_last_flight_of_day: boolean;
}

export interface Aircraft {
  aircraft_id: string;
  aircraft_type: string;
  current_station: string;
  available_from: Date;
  status: string;
  next_maintenance_time: Date | null;
  restriction: string | null;
}

export interface DisruptionEvent {
  event_id: string;
  event_type: DisruptionType;
  start_time: Date;
  end_time: Date;
  severity: Severity;
  description: string;
  affected_aircraft: string | null;
  affected_airport: string | null;
  affected_flight_id: string | null;
}

export interface ImpactedFlight {
  flight: FlightLeg;
  reason_codes: string[];
}

export interface CandidateAircraft {
  aircraft: Aircraft;
  target_flight_id: string;
  feasible: boolean;
  risk_level: RiskLevel;
  reason_codes: string[];
}

export interface FlightChange {
  flight_id: string;
  flight_number: string;
  original_aircraft: string;
  new_aircraft: string;
  original_std: Date;
  original_sta: Date;
  new_std: Date;
  new_sta: Date;
  delay_minutes: number;
  reason: string;
}

export interface RecoveryOption {
  option_id: string;
  option_type: OptionType;
  flight_changes: FlightChange[];
  aircraft_changes: Record<string, string>;
  total_delay_minutes: number;
  max_delay_minutes: number;
  impacted_flight_count: number;
  swap_count: number;
  risk_level: RiskLevel;
  score: number;
  rank: number | null;
  recommendation: string;
  reason_codes: string[];
  score_breakdown: Record<string, number>;
}

export interface OccRules {
  aircraft_rules: {
    allow_same_fleet_swap: boolean;
    allow_cross_fleet_swap: boolean;
    max_swap_chain_length: number;
    compatible_types: Record<string, string[]>;
  };
  turnaround_rules: {
    default_minutes: number;
    by_aircraft_type: Record<string, number>;
  };
  airport_rules: {
    enforce_closure_window: boolean;
    reopen_buffer_minutes: number;
    enforce_curfew: boolean;
    curfews?: Record<string, { start: string; end: string }>;
  };
  maintenance_rules: {
    prohibit_swap_if_next_check_risk: boolean;
    next_check_buffer_minutes: number;
  };
  priority_rules: {
    protect_last_flight_of_day: boolean;
    protect_high_load_factor: boolean;
    high_load_factor_threshold: number;
    protect_international_flight: boolean;
  };
  spread_delay_rules: {
    enabled: boolean;
    max_delay_per_flight_minutes: number;
  };
  flat_delay_rules: {
    max_normal_delay_minutes: number;
    max_deep_delay_minutes: number;
  };
  score_weights: {
    total_delay_weight: number;
    max_delay_weight: number;
    impacted_flight_weight: number;
    swap_penalty: number;
    maintenance_risk_penalty: number;
    closure_violation_penalty: number;
    curfew_risk_penalty: number;
    priority_protection_bonus: number;
  };
}
