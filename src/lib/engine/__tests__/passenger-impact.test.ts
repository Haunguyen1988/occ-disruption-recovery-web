import { describe, expect, it } from "vitest";
import { calculateRecoveryScore } from "@/lib/engine/option-scorer";
import { calculatePassengerImpact } from "@/lib/engine/passenger-impact";
import { getDefaultRules } from "@/lib/parsers/rules";
import type { FlightLeg, RecoveryOption } from "@/lib/types";

function flight(overrides: Partial<FlightLeg>): FlightLeg {
  return {
    flight_id: "F1",
    flight_number: "VJ100",
    origin: "SGN",
    destination: "HAN",
    std: new Date("2026-04-28T00:00:00Z"),
    sta: new Date("2026-04-28T02:00:00Z"),
    aircraft_id: "TAIL-A",
    aircraft_type: "A321",
    priority_level: 2,
    load_factor: 0.5,
    is_international: false,
    is_last_flight_of_day: false,
    ...overrides,
  };
}

function option(flightId: string, delayMinutes: number): RecoveryOption {
  return {
    option_id: `OPT-${flightId}`,
    option_type: "DELAY_ONLY",
    flight_changes: [
      {
        flight_id: flightId,
        flight_number: flightId,
        origin: "SGN",
        destination: "HAN",
        original_aircraft: "TAIL-A",
        new_aircraft: "TAIL-A",
        original_std: new Date("2026-04-28T00:00:00Z"),
        original_sta: new Date("2026-04-28T02:00:00Z"),
        new_std: new Date(`2026-04-28T01:00:00Z`),
        new_sta: new Date("2026-04-28T03:00:00Z"),
        delay_minutes: delayMinutes,
        reason: "test",
      },
    ],
    aircraft_changes: {},
    total_delay_minutes: delayMinutes,
    max_delay_minutes: delayMinutes,
    impacted_flight_count: 1,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: "LOW",
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [],
    score_breakdown: {},
  };
}

describe("passenger impact scoring", () => {
  it("estimates affected passengers from capacity and load factor", () => {
    const rules = getDefaultRules();
    const schedule = [flight({ flight_id: "F1", load_factor: 0.5 })];

    const impact = calculatePassengerImpact(option("F1", 60), rules, schedule);

    expect(impact?.estimated_affected_passengers).toBe(115);
    expect(impact?.passenger_delay_minutes).toBe(6900);
    expect(impact?.misconnect_risk_passengers).toBe(115);
    expect(impact?.top_impacted_flights[0].flight_number).toBe("VJ100");
  });

  it("penalizes the same delay more when more passengers are affected", () => {
    const rules = getDefaultRules();
    const lowLoadSchedule = [flight({ flight_id: "LOW", load_factor: 0.3 })];
    const highLoadSchedule = [flight({ flight_id: "HIGH", load_factor: 0.95 })];

    const low = calculateRecoveryScore(option("LOW", 60), rules, lowLoadSchedule);
    const high = calculateRecoveryScore(
      option("HIGH", 60),
      rules,
      highLoadSchedule,
    );

    expect(high.passenger_impact?.estimated_affected_passengers).toBeGreaterThan(
      low.passenger_impact?.estimated_affected_passengers ?? 0,
    );
    expect(high.score_breakdown.passenger_delay_component).toBeGreaterThan(
      low.score_breakdown.passenger_delay_component,
    );
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("adds passenger priority cost for international last-flight disruptions", () => {
    const rules = getDefaultRules();
    const schedule = [
      flight({
        flight_id: "INTL",
        is_international: true,
        is_last_flight_of_day: true,
        load_factor: 0.9,
      }),
    ];

    const scored = calculateRecoveryScore(option("INTL", 30), rules, schedule);

    expect(scored.passenger_impact?.priority_passenger_score).toBeGreaterThan(0);
    expect(scored.score_breakdown.passenger_priority_component).toBeGreaterThan(0);
  });
});

