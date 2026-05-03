import { describe, expect, it } from "vitest";
import { getDefaultRules } from "@/lib/parsers/rules";
import type { RecoveryOption } from "@/lib/types";
import { calculateRecoveryScore } from "../option-scorer";
import { applyRecoveryObjectiveProfile } from "../objective-profiles";

function option(riskLevel: RecoveryOption["risk_level"]): RecoveryOption {
  return {
    option_id: `OPT-${riskLevel}`,
    option_type: "DELAY_ONLY",
    flight_changes: [],
    aircraft_changes: {},
    total_delay_minutes: 20,
    max_delay_minutes: 20,
    impacted_flight_count: 1,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: riskLevel,
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [],
    score_breakdown: {},
  };
}

describe("recovery objective profiles", () => {
  it("adjusts weights without mutating the base rules", () => {
    const rules = getDefaultRules();
    const passengerWeight = rules.score_weights.passenger_delay_weight;
    const profiled = applyRecoveryObjectiveProfile(
      rules,
      "protect_passengers",
    );

    expect(profiled).not.toBe(rules);
    expect(profiled.score_weights.passenger_delay_weight).toBeGreaterThan(
      passengerWeight ?? 0,
    );
    expect(rules.score_weights.passenger_delay_weight).toBe(passengerWeight);
  });

  it("lets low-risk mode increase risk penalties during scoring", () => {
    const rules = getDefaultRules();
    const defaultScored = calculateRecoveryScore(option("HIGH"), rules);
    const lowRiskRules = applyRecoveryObjectiveProfile(rules, "low_risk");
    const lowRiskScored = calculateRecoveryScore(option("HIGH"), lowRiskRules);

    expect(defaultScored.score_breakdown.risk_penalty).toBe(100);
    expect(lowRiskScored.score_breakdown.risk_penalty).toBeGreaterThan(100);
    expect(lowRiskScored.score).toBeGreaterThan(defaultScored.score);
  });

  it("raises swap cost in fewest-swaps mode", () => {
    const rules = getDefaultRules();
    const profiled = applyRecoveryObjectiveProfile(rules, "fewest_swaps");

    expect(profiled.score_weights.swap_penalty).toBeGreaterThan(
      rules.score_weights.swap_penalty,
    );
  });
});
