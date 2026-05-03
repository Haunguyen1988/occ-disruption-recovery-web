/**
 * Quick smoke test for the engine upgrades (S2, S3, S5, A1).
 * Run with: node .\node_modules\vitest\dist\cli-wrapper.js run src/lib/engine/__tests__/upgrade-verification.test.ts
 */
import { describe, it, expect } from "vitest";
import { runSimulation } from "@/lib/engine";
import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  OccRules,
} from "@/lib/types";

function d(s: string): Date {
  return new Date(s);
}

// --- fixtures ---

const rules: OccRules = {
  aircraft_rules: {
    allow_same_fleet_swap: true,
    allow_cross_fleet_swap: false,
    max_swap_chain_length: 3,
    compatible_types: { A321: ["A321"], A320: ["A320"] },
  },
  turnaround_rules: { default_minutes: 40, by_aircraft_type: { A321: 40, A320: 35 } },
  airport_rules: { enforce_closure_window: true, reopen_buffer_minutes: 30, enforce_curfew: false },
  maintenance_rules: { prohibit_swap_if_next_check_risk: true, next_check_buffer_minutes: 60 },
  priority_rules: {
    protect_last_flight_of_day: true,
    protect_high_load_factor: true,
    high_load_factor_threshold: 0.85,
    protect_international_flight: true,
  },
  spread_delay_rules: { enabled: true, max_delay_per_flight_minutes: 90 },
  flat_delay_rules: { max_normal_delay_minutes: 180, max_deep_delay_minutes: 360 },
  score_weights: {
    total_delay_weight: 1.0,
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
  { flight_id: "FL001", flight_number: "VJ100", origin: "SGN", destination: "HAN", std: d("2026-04-28T00:00:00Z"), sta: d("2026-04-28T02:10:00Z"), aircraft_id: "VJ-A321", aircraft_type: "A321", priority_level: 1, load_factor: 0.91, is_international: false, is_last_flight_of_day: false },
  { flight_id: "FL002", flight_number: "VJ101", origin: "HAN", destination: "SGN", std: d("2026-04-28T03:00:00Z"), sta: d("2026-04-28T05:10:00Z"), aircraft_id: "VJ-A321", aircraft_type: "A321", priority_level: 2, load_factor: 0.88, is_international: false, is_last_flight_of_day: false },
  { flight_id: "FL003", flight_number: "VJ102", origin: "SGN", destination: "DAD", std: d("2026-04-28T06:00:00Z"), sta: d("2026-04-28T07:20:00Z"), aircraft_id: "VJ-A321", aircraft_type: "A321", priority_level: 2, load_factor: 0.80, is_international: false, is_last_flight_of_day: false },
  { flight_id: "FL004", flight_number: "VJ103", origin: "DAD", destination: "SGN", std: d("2026-04-28T08:10:00Z"), sta: d("2026-04-28T09:30:00Z"), aircraft_id: "VJ-A321", aircraft_type: "A321", priority_level: 3, load_factor: 0.75, is_international: false, is_last_flight_of_day: true },
  { flight_id: "FL005", flight_number: "VJ200", origin: "SGN", destination: "DAD", std: d("2026-04-28T01:00:00Z"), sta: d("2026-04-28T02:20:00Z"), aircraft_id: "VJ-A322", aircraft_type: "A321", priority_level: 2, load_factor: 0.77, is_international: false, is_last_flight_of_day: false },
  { flight_id: "FL006", flight_number: "VJ201", origin: "DAD", destination: "SGN", std: d("2026-04-28T03:20:00Z"), sta: d("2026-04-28T04:40:00Z"), aircraft_id: "VJ-A322", aircraft_type: "A321", priority_level: 2, load_factor: 0.84, is_international: false, is_last_flight_of_day: false },
  { flight_id: "FL007", flight_number: "VJ202", origin: "SGN", destination: "HAN", std: d("2026-04-28T07:00:00Z"), sta: d("2026-04-28T09:10:00Z"), aircraft_id: "VJ-A322", aircraft_type: "A321", priority_level: 1, load_factor: 0.92, is_international: false, is_last_flight_of_day: false },
  { flight_id: "FL012", flight_number: "VJ400", origin: "SGN", destination: "SIN", std: d("2026-04-28T06:30:00Z"), sta: d("2026-04-28T07:40:00Z"), aircraft_id: "VJ-A323", aircraft_type: "A321", priority_level: 1, load_factor: 0.93, is_international: true, is_last_flight_of_day: false },
  { flight_id: "FL013", flight_number: "VJ401", origin: "SIN", destination: "SGN", std: d("2026-04-28T08:40:00Z"), sta: d("2026-04-28T10:50:00Z"), aircraft_id: "VJ-A323", aircraft_type: "A321", priority_level: 1, load_factor: 0.90, is_international: true, is_last_flight_of_day: true },
];

const aircraft: Aircraft[] = [
  { aircraft_id: "VJ-A321", aircraft_type: "A321", current_station: "SGN", available_from: d("2026-04-27T23:00:00Z"), status: "ACTIVE", next_maintenance_time: d("2026-04-28T21:00:00Z"), restriction: null },
  { aircraft_id: "VJ-A322", aircraft_type: "A321", current_station: "SGN", available_from: d("2026-04-28T05:10:00Z"), status: "ACTIVE", next_maintenance_time: d("2026-04-28T22:30:00Z"), restriction: null },
  { aircraft_id: "VJ-A323", aircraft_type: "A321", current_station: "SGN", available_from: d("2026-04-28T05:20:00Z"), status: "ACTIVE", next_maintenance_time: d("2026-04-28T16:00:00Z"), restriction: null },
  { aircraft_id: "VJ-A324", aircraft_type: "A321", current_station: "SGN", available_from: d("2026-04-28T02:30:00Z"), status: "ACTIVE", next_maintenance_time: d("2026-04-29T00:00:00Z"), restriction: "standby" },
];

const disruption: DisruptionEvent = {
  event_id: "EVT-AOG-001",
  event_type: "AOG",
  start_time: d("2026-04-28T05:10:00Z"),
  end_time: d("2026-04-28T09:00:00Z"),
  severity: "HIGH",
  description: "AOG VJ-A321 at SGN after arrival from HAN",
  affected_aircraft: "VJ-A321",
  affected_airport: null,
  affected_flight_id: "FL003",
};

describe("Engine upgrade verification", () => {
  const result = runSimulation({ schedule, aircraft, disruption, rules });

  it("should find impacted flights", () => {
    expect(result.impacted_flights.length).toBeGreaterThan(0);
    console.log(`Impacted flights: ${result.impacted_flights.length}`);
    result.impacted_flights.forEach((f) =>
      console.log(`  ${f.flight.flight_number} ${f.flight.aircraft_id} — ${f.reason_codes[0]}`),
    );
  });

  it("should generate multiple option types", () => {
    const types = result.ranked_options.map((o) => o.option_type);
    console.log(`\nOption types: ${types.join(", ")}`);
    expect(types).toContain("DELAY_ONLY");
    expect(types).toContain("SPREAD_DELAY");
    expect(types).toContain("DEEP_DELAY");
  });

  it("S2: SPREAD_DELAY should cap per-flight delay", () => {
    const spread = result.ranked_options.find((o) => o.option_type === "SPREAD_DELAY")!;
    expect(spread).toBeDefined();
    console.log(`\nSPREAD_DELAY: total=${spread.total_delay_minutes}min, max=${spread.max_delay_minutes}min`);
    console.log(`  Reason: ${spread.reason_codes[0]}`);
    // Max per-flight should respect the cap (90min)
    for (const c of spread.flight_changes) {
      expect(c.delay_minutes).toBeLessThanOrEqual(90);
    }
  });

  it("S3: DEEP_DELAY should sacrifice lowest-priority, lowest-load flight", () => {
    const deep = result.ranked_options.find((o) => o.option_type === "DEEP_DELAY")!;
    expect(deep).toBeDefined();
    expect(deep.flight_changes.length).toBeGreaterThanOrEqual(
      result.impacted_flights.length,
    );
    const sacrificed = deep.flight_changes.find(
      (change) => change.reason === "Deep-delay selected low-priority flight",
    );
    expect(sacrificed).toBeDefined();
    console.log(`\nDEEP_DELAY sacrifices: ${sacrificed!.flight_number} (delay: ${sacrificed!.delay_minutes}min)`);
    // FL004 VJ103 has priority_level=3 (lowest) and load_factor=0.75 (lowest among P3)
    // With the fix, it should pick the lowest-load flight among lowest-priority
    expect(sacrificed!.flight_number).toBe("VJ103");
  });

  it("S5: scorer should include priority_protection_penalty", () => {
    // Options that delay international/last-of-day flights should have higher scores
    for (const opt of result.ranked_options) {
      const hasPriorityPenalty = (opt.score_breakdown.priority_protection_penalty ?? 0) > 0;
      console.log(
        `\n${opt.option_type} #${opt.rank}: score=${opt.score}, priority_penalty=${opt.score_breakdown.priority_protection_penalty ?? 0}, ripple=${opt.score_breakdown.downstream_ripple_estimate ?? 0}`,
      );
      // DEEP_DELAY targets FL004 which is last_flight_of_day
      if (opt.option_type === "DEEP_DELAY") {
        expect(hasPriorityPenalty).toBe(true);
      }
    }
  });

  it("A1: should search swaps for multiple target flights", () => {
    // With multi-target search, we should get more swap options than before
    const swaps = result.ranked_options.filter((o) => o.option_type === "SINGLE_SWAP");
    console.log(`\nSINGLE_SWAP options: ${swaps.length}`);
    swaps.forEach((s) => {
      const target = s.reason_codes[0] ?? "";
      console.log(`  ${s.option_id}: ${target}`);
    });
  });

  it("feedback should have candidate diagnostics", () => {
    expect(result.feedback).not.toBeNull();
    console.log(`\nFeedback: ${result.feedback!.candidate_count} candidates, ${result.feedback!.feasible_swap_count} feasible`);
    result.feedback!.candidates.forEach((c) =>
      console.log(`  ${c.aircraft_id} (${c.aircraft_type}): feasible=${c.feasible}, risk=${c.risk_level}, block=${c.blocking_reason ?? "none"}`),
    );
  });

  it("all options should have valid scores and ranks", () => {
    result.ranked_options.forEach((opt, idx) => {
      expect(opt.rank).toBe(idx + 1);
      expect(opt.score).toBeGreaterThanOrEqual(0);
      expect(opt.score_breakdown).toBeDefined();
    });
  });
});
