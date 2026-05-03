import { describe, expect, it } from "vitest";
import {
  buildScheduleIndex,
  findImpactedFlights,
  runSimulation,
} from "@/lib/engine";
import {
  buildTailAssignmentNetwork,
  optimizeTailAssignment,
} from "@/lib/engine/tail-assignment";
import type { Aircraft, DisruptionEvent, FlightLeg, OccRules } from "@/lib/types";

function d(value: string): Date {
  return new Date(value);
}

const rules: OccRules = {
  aircraft_rules: {
    allow_same_fleet_swap: true,
    allow_cross_fleet_swap: false,
    max_swap_chain_length: 3,
    compatible_types: { A321: ["A321"] },
  },
  turnaround_rules: {
    default_minutes: 40,
    by_aircraft_type: { A321: 40 },
  },
  airport_rules: {
    enforce_closure_window: true,
    reopen_buffer_minutes: 30,
    enforce_curfew: false,
  },
  maintenance_rules: {
    prohibit_swap_if_next_check_risk: true,
    next_check_buffer_minutes: 60,
  },
  priority_rules: {
    protect_last_flight_of_day: true,
    protect_high_load_factor: true,
    high_load_factor_threshold: 0.85,
    protect_international_flight: true,
  },
  spread_delay_rules: {
    enabled: true,
    max_delay_per_flight_minutes: 90,
  },
  flat_delay_rules: {
    max_normal_delay_minutes: 180,
    max_deep_delay_minutes: 360,
  },
  score_weights: {
    total_delay_weight: 1,
    max_delay_weight: 1.5,
    impacted_flight_weight: 10,
    swap_penalty: 25,
    maintenance_risk_penalty: 150,
    closure_violation_penalty: 200,
    curfew_risk_penalty: 120,
    priority_protection_bonus: 40,
  },
};

const schedule: FlightLeg[] = [
  {
    flight_id: "F1",
    flight_number: "VJ101",
    origin: "SGN",
    destination: "HAN",
    std: d("2026-04-28T10:00:00Z"),
    sta: d("2026-04-28T12:00:00Z"),
    aircraft_id: "TAIL-A",
    aircraft_type: "A321",
    priority_level: 1,
    load_factor: 0.9,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "F2",
    flight_number: "VJ102",
    origin: "HAN",
    destination: "SGN",
    std: d("2026-04-28T12:50:00Z"),
    sta: d("2026-04-28T14:50:00Z"),
    aircraft_id: "TAIL-A",
    aircraft_type: "A321",
    priority_level: 1,
    load_factor: 0.88,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "G1",
    flight_number: "VJ201",
    origin: "SGN",
    destination: "DAD",
    std: d("2026-04-28T12:00:00Z"),
    sta: d("2026-04-28T13:00:00Z"),
    aircraft_id: "TAIL-B",
    aircraft_type: "A321",
    priority_level: 3,
    load_factor: 0.55,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "G2",
    flight_number: "VJ202",
    origin: "DAD",
    destination: "SGN",
    std: d("2026-04-28T13:45:00Z"),
    sta: d("2026-04-28T14:45:00Z"),
    aircraft_id: "TAIL-B",
    aircraft_type: "A321",
    priority_level: 3,
    load_factor: 0.5,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "X1",
    flight_number: "VJ900",
    origin: "DAD",
    destination: "PQC",
    std: d("2026-04-28T12:10:00Z"),
    sta: d("2026-04-28T13:10:00Z"),
    aircraft_id: "TAIL-C",
    aircraft_type: "A321",
    priority_level: 3,
    load_factor: 0.4,
    is_international: false,
    is_last_flight_of_day: false,
  },
];

const aircraft: Aircraft[] = [
  {
    aircraft_id: "TAIL-A",
    aircraft_type: "A321",
    current_station: "SGN",
    available_from: d("2026-04-28T09:00:00Z"),
    status: "ACTIVE",
    next_maintenance_time: d("2026-04-29T00:00:00Z"),
    restriction: null,
  },
  {
    aircraft_id: "TAIL-B",
    aircraft_type: "A321",
    current_station: "SGN",
    available_from: d("2026-04-28T09:00:00Z"),
    status: "ACTIVE",
    next_maintenance_time: d("2026-04-29T00:00:00Z"),
    restriction: null,
  },
  {
    aircraft_id: "TAIL-C",
    aircraft_type: "A321",
    current_station: "DAD",
    available_from: d("2026-04-28T09:00:00Z"),
    status: "ACTIVE",
    next_maintenance_time: d("2026-04-29T00:00:00Z"),
    restriction: null,
  },
];

const disruption: DisruptionEvent = {
  event_id: "AOG-TAIL-A",
  event_type: "AOG",
  affected_aircraft: "TAIL-A",
  affected_airport: null,
  affected_flight_id: "F1",
  start_time: d("2026-04-28T09:45:00Z"),
  end_time: d("2026-04-28T11:00:00Z"),
  severity: "HIGH",
  description: "TAIL-A AOG before first SGN departure",
};

describe("tail assignment optimizer", () => {
  it("preprocesses impossible arcs before path generation", () => {
    const scheduleIndex = buildScheduleIndex(schedule);
    const impacted = findImpactedFlights(disruption, schedule, rules, scheduleIndex);
    const network = buildTailAssignmentNetwork({
      impacted,
      disruption,
      schedule,
      aircraft,
      rules,
      scheduleIndex,
    });

    expect(network.originalArcCount).toBeGreaterThan(network.reducedArcCount);
    expect(network.removedArcCount).toBeGreaterThan(0);
    expect(network.flightArcs.get("F1")).toContain("F2");
    expect(network.flightArcs.get("F1")).not.toContain("X1");
  });

  it("excludes completed ATA flights from the recovery horizon", () => {
    const scheduleIndex = buildScheduleIndex(schedule);
    const impacted = findImpactedFlights(disruption, schedule, rules, scheduleIndex);
    const network = buildTailAssignmentNetwork({
      impacted,
      disruption,
      schedule: [
        ...schedule,
        {
          ...schedule[0],
          flight_id: "DONE-1",
          flight_number: "DONE1",
          std: new Date("2026-04-28T10:30:00Z"),
          sta: new Date("2026-04-28T11:30:00Z"),
          actual_arrival_time: new Date("2026-04-28T11:28:00Z"),
        },
      ],
      aircraft,
      rules,
      scheduleIndex: buildScheduleIndex(schedule),
    });

    expect(network.flights.map((flight) => flight.flight_id)).not.toContain("DONE-1");
  });

  it("excludes departed ATD flights from the recovery horizon", () => {
    const scheduleIndex = buildScheduleIndex(schedule);
    const impacted = findImpactedFlights(disruption, schedule, rules, scheduleIndex);
    const network = buildTailAssignmentNetwork({
      impacted,
      disruption,
      schedule: [
        ...schedule,
        {
          ...schedule[0],
          flight_id: "AIRBORNE-1",
          flight_number: "AIR1",
          std: new Date("2026-04-28T10:30:00Z"),
          sta: new Date("2026-04-28T11:30:00Z"),
          actual_departure_time: new Date("2026-04-28T10:34:00Z"),
        },
      ],
      aircraft,
      rules,
      scheduleIndex: buildScheduleIndex(schedule),
    });

    expect(network.flights.map((flight) => flight.flight_id)).not.toContain(
      "AIRBORNE-1",
    );
  });

  it("generates a network-level optimized recovery option", () => {
    const scheduleIndex = buildScheduleIndex(schedule);
    const impacted = findImpactedFlights(disruption, schedule, rules, scheduleIndex);
    const result = optimizeTailAssignment({
      impacted,
      disruption,
      schedule,
      aircraft,
      rules,
      scheduleIndex,
    });

    const option = result.options[0];
    expect(option).toBeDefined();
    expect(option.option_type).toBe("TAIL_ASSIGNMENT_OPTIMIZED");
    expect(option.reason_codes.some((reason) => reason.includes("Arc reduction"))).toBe(
      true,
    );
    expect(option.flight_changes.some(
      (change) => change.flight_id === "F1" && change.new_aircraft === "TAIL-B",
    )).toBe(true);
    expect(option.flight_changes.some(
      (change) => change.flight_id === "G1" && change.new_aircraft === "TAIL-A",
    )).toBe(true);
  });

  it("labels the selected aircraft recovery objective profile", () => {
    const scheduleIndex = buildScheduleIndex(schedule);
    const impacted = findImpactedFlights(disruption, schedule, rules, scheduleIndex);
    const result = optimizeTailAssignment({
      impacted,
      disruption,
      schedule,
      aircraft,
      rules,
      scheduleIndex,
      objective: "min_swap",
    });

    expect(
      result.options[0].reason_codes.some((reason) =>
        reason.includes("fewest aircraft swaps"),
      ),
    ).toBe(true);
  });

  it("locks stable flight connections before the second path search", () => {
    const scheduleIndex = buildScheduleIndex(schedule);
    const impacted = findImpactedFlights(disruption, schedule, rules, scheduleIndex);
    const result = optimizeTailAssignment({
      impacted,
      disruption,
      schedule,
      aircraft,
      rules,
      scheduleIndex,
    });

    expect(result.connectionFixing.applied).toBe(true);
    expect(result.network.fixedConnections.get("F1")).toBe("F2");
    expect(result.connectionFixing.finalPathCount).toBeLessThanOrEqual(
      result.connectionFixing.initialPathCount,
    );
    expect(
      result.options[0].reason_codes.some((reason) =>
        reason.includes("Connection fixing"),
      ),
    ).toBe(true);
  });

  it("is included in the ranked simulation output", () => {
    const result = runSimulation({ schedule, aircraft, disruption, rules });
    expect(result.ranked_options.map((option) => option.option_type)).toContain(
      "TAIL_ASSIGNMENT_OPTIMIZED",
    );
    const diagnostics = result.feedback?.tail_assignment;
    expect(diagnostics).toBeDefined();
    expect(diagnostics!.mode).toBe("balanced");
    expect(diagnostics!.option_count).toBeGreaterThan(0);
    expect(diagnostics!.connection_fixing_applied).toBe(true);
    expect(diagnostics!.no_option_reason).toBeNull();
    expect(diagnostics!.complete_solution_count).toBeGreaterThan(0);
    expect(diagnostics!.final_path_count).toBeLessThanOrEqual(
      diagnostics!.initial_path_count,
    );
  });

  it("passes operator-selected tail optimization mode into diagnostics", () => {
    const result = runSimulation({
      schedule,
      aircraft,
      disruption,
      rules,
      tailAssignmentMode: "deep",
    });

    expect(result.feedback?.tail_assignment?.mode).toBe("deep");
    expect(result.ranked_options.map((option) => option.option_type)).toContain(
      "TAIL_ASSIGNMENT_OPTIMIZED",
    );
  });
});
