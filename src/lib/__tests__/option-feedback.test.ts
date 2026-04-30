import { describe, expect, it } from "vitest";
import { getOptionWatchouts } from "@/lib/option-feedback";
import type { RecoveryOption } from "@/lib/types";

function makeOption(overrides: Partial<RecoveryOption> = {}): RecoveryOption {
  return {
    option_id: "OPT-1",
    option_type: "DELAY_ONLY",
    flight_changes: [],
    aircraft_changes: {},
    total_delay_minutes: 120,
    max_delay_minutes: 60,
    impacted_flight_count: 2,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: "LOW",
    score: 0,
    rank: 1,
    recommendation: "Recommended",
    reason_codes: [],
    score_breakdown: {},
    ...overrides,
  };
}

describe("getOptionWatchouts", () => {
  it("surfaces risk, curfew, and restriction watchouts", () => {
    const watchouts = getOptionWatchouts(
      makeOption({
        risk_level: "HIGH",
        reason_codes: ["Restriction note: ETOPS dispatch review required"],
        score_breakdown: {
          curfew_component: 120,
          risk_penalty: 100,
        },
      }),
    );

    expect(watchouts).toEqual([
      "High operational risk; review the constraint reasons before approval.",
      "Curfew penalty applied (120).",
      "Risk penalty applied (100).",
    ]);
  });

  it("keeps medium-risk guidance concise when no score penalties exist", () => {
    const watchouts = getOptionWatchouts(
      makeOption({
        risk_level: "MEDIUM",
        reason_codes: ["Restriction note: Spare cabin crew callout required"],
      }),
    );

    expect(watchouts).toEqual([
      "Operational constraints are present; review the reason codes before approval.",
      "Restriction note: Spare cabin crew callout required",
    ]);
  });
});
