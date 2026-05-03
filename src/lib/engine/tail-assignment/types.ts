import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  RecoveryOption,
} from "@/lib/types";
import type { ScheduleIndex } from "../schedule-index";

export interface TailAssignmentConfig {
  horizon_hours: number;
  max_leg_delay_minutes: number;
  max_paths_per_aircraft: number;
  max_labels_per_aircraft: number;
  max_master_search_nodes: number;
  max_solutions: number;
  enable_connection_fixing: boolean;
  connection_fixing_min_solution_count: number;
  connection_fixing_max_connections: number;
}

export type TailAssignmentMode = "fast" | "balanced" | "deep";

export type AircraftRecoveryObjective =
  | "balanced"
  | "min_delay"
  | "min_swap"
  | "risk_averse"
  | "protect_priority";

export const DEFAULT_TAIL_ASSIGNMENT_CONFIG: TailAssignmentConfig = {
  horizon_hours: 18,
  max_leg_delay_minutes: 360,
  max_paths_per_aircraft: 80,
  max_labels_per_aircraft: 500,
  max_master_search_nodes: 50_000,
  max_solutions: 3,
  enable_connection_fixing: true,
  connection_fixing_min_solution_count: 2,
  connection_fixing_max_connections: 24,
};

export interface TailAssignmentInput {
  impacted: ImpactedFlight[];
  disruption: DisruptionEvent;
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  rules: OccRules;
  scheduleIndex: ScheduleIndex;
  config?: Partial<TailAssignmentConfig>;
  mode?: TailAssignmentMode;
  objective?: AircraftRecoveryObjective;
}

export interface TailAssignmentNetwork {
  flights: FlightLeg[];
  aircraft: Aircraft[];
  horizonStart: Date;
  horizonEnd: Date;
  startArcs: Map<string, string[]>;
  flightArcs: Map<string, string[]>;
  originalArcCount: number;
  reducedArcCount: number;
  removedArcCount: number;
  fixedConnections: Map<string, string>;
  blockerCounts: Map<string, number>;
}

export interface TailAssignmentLeg {
  flight: FlightLeg;
  aircraft_id: string;
  new_std: Date;
  new_sta: Date;
  delay_minutes: number;
  assignment_cost: number;
}

export interface TailAssignmentPath {
  path_id: string;
  aircraft_id: string;
  legs: TailAssignmentLeg[];
  coveredFlightIds: Set<string>;
  total_delay_minutes: number;
  max_delay_minutes: number;
  cost: number;
}

export interface TailAssignmentSolution {
  paths: TailAssignmentPath[];
  coveredFlightIds: Set<string>;
  cost: number;
  searchNodes: number;
  complete: boolean;
}

export interface TailAssignmentPathGenerationResult {
  pathsByAircraft: Map<string, TailAssignmentPath[]>;
  pathCount: number;
  blockerCounts: Map<string, number>;
}

export interface TailAssignmentSelectionResult {
  solutions: TailAssignmentSolution[];
  searchNodes: number;
  requiredFlightCount: number;
  bestCoveredFlightCount: number;
}

export interface TailAssignmentConnectionFix {
  from_flight_id: string;
  to_flight_id: string;
  support_count: number;
}

export interface TailAssignmentConnectionFixingMetrics {
  applied: boolean;
  fixedConnectionCount: number;
  initialPathCount: number;
  finalPathCount: number;
  initialSearchNodes: number;
  finalSearchNodes: number;
}

export interface TailAssignmentOptimizationResult {
  options: RecoveryOption[];
  network: TailAssignmentNetwork;
  pathCount: number;
  searchNodes: number;
  connectionFixing: TailAssignmentConnectionFixingMetrics;
  diagnostics: {
    requiredFlightCount: number;
    bestCoveredFlightCount: number;
    completeSolutionCount: number;
    noOptionReason: string | null;
    topBlockingReasons: { reason: string; count: number }[];
  };
}
