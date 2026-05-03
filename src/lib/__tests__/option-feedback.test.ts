import { describe, expect, it } from "vitest";
import {
  getOptionWatchouts,
  getTailRankingExplanations,
} from "@/lib/option-feedback";
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

function makeTailOption(overrides: Partial<RecoveryOption> = {}): RecoveryOption {
  return makeOption({
    option_id: "OPT-TAIL",
    option_type: "TAIL_ASSIGNMENT_OPTIMIZED",
    rank: 1,
    score: 318,
    total_delay_minutes: 0,
    max_delay_minutes: 0,
    swap_count: 2,
    score_breakdown: {
      total_delay_component: 0,
      max_delay_component: 0,
      impacted_flight_component: 20,
      swap_component: 50,
      risk_penalty: 30,
    },
    ...overrides,
  });
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

describe("getTailRankingExplanations", () => {
  it("explains why a tail option beats the best delay/swap heuristic", () => {
    const tail = makeTailOption();
    const delay = makeOption({
      option_id: "OPT-DELAY",
      option_type: "DELAY_ONLY",
      rank: 2,
      score: 428,
      score_breakdown: {
        total_delay_component: 180,
        max_delay_component: 90,
        impacted_flight_component: 20,
        swap_component: 0,
        risk_penalty: 0,
      },
    });

    expect(getTailRankingExplanations(tail, [tail, delay])).toEqual([
      "Wins vs best delay/swap heuristic #2 DELAY_ONLY by 110 score point(s).",
      "Lower-cost drivers: total delay: -180, max delay: -90.",
      "Tradeoffs: swap complexity: +50, operational risk: +30.",
    ]);
  });

  it("explains why a tail option loses to the best delay/swap heuristic", () => {
    const tail = makeTailOption({
      rank: 3,
      score: 470,
      score_breakdown: {
        total_delay_component: 160,
        max_delay_component: 120,
        impacted_flight_component: 20,
        swap_component: 75,
        risk_penalty: 100,
      },
    });
    const swap = makeOption({
      option_id: "OPT-SWAP",
      option_type: "SINGLE_SWAP",
      rank: 1,
      score: 430,
      score_breakdown: {
        total_delay_component: 200,
        max_delay_component: 130,
        impacted_flight_component: 20,
        swap_component: 25,
        risk_penalty: 30,
      },
    });

    expect(getTailRankingExplanations(tail, [swap, tail])[0]).toBe(
      "Loses vs best delay/swap heuristic #1 SINGLE_SWAP by 40 score point(s).",
    );
    expect(getTailRankingExplanations(swap, [swap, tail])).toEqual([]);
  });
});
