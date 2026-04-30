import { describe, expect, it } from "vitest";
import type { RecoveryOption } from "@/lib/types";
import {
  hydrateComparePayload,
  selectCompareOptions,
} from "@/lib/compare";

function makeOption(optionId: string, score: number): RecoveryOption {
  return {
    option_id: optionId,
    option_type: "DELAY_ONLY",
    flight_changes: [
      {
        flight_id: `${optionId}-FLIGHT`,
        flight_number: "VJ100",
        origin: "SGN",
        destination: "HAN",
        original_aircraft: "VN-A100",
        new_aircraft: "VN-A100",
        original_std: new Date("2026-04-28T01:00:00.000Z"),
        original_sta: new Date("2026-04-28T03:00:00.000Z"),
        new_std: new Date("2026-04-28T01:30:00.000Z"),
        new_sta: new Date("2026-04-28T03:30:00.000Z"),
        delay_minutes: 30,
        reason: "Delay",
      },
    ],
    aircraft_changes: {},
    total_delay_minutes: 30,
    max_delay_minutes: 30,
    impacted_flight_count: 1,
    swap_count: 0,
    curfew_violations: 0,
    risk_level: "LOW",
    score,
    rank: 1,
    recommendation: "Delay only",
    reason_codes: ["TEST"],
    score_breakdown: { total_delay_component: score },
  };
}

describe("hydrateComparePayload", () => {
  it("hydrates serialized flight change dates back into Date objects", () => {
    const payload = {
      saved_at: "2026-04-30T03:00:00.000Z",
      options: [
        {
          ...makeOption("OPT-1", 10),
          flight_changes: [
            {
              ...makeOption("OPT-1", 10).flight_changes[0],
              original_std: "2026-04-28T01:00:00.000Z" as unknown as Date,
              original_sta: "2026-04-28T03:00:00.000Z" as unknown as Date,
              new_std: "2026-04-28T01:30:00.000Z" as unknown as Date,
              new_sta: "2026-04-28T03:30:00.000Z" as unknown as Date,
            },
          ],
        },
      ],
    };

    const hydrated = hydrateComparePayload(payload);

    expect(hydrated.options[0].flight_changes[0].original_std).toBeInstanceOf(Date);
    expect(hydrated.options[0].flight_changes[0].new_sta).toBeInstanceOf(Date);
  });
});

describe("selectCompareOptions", () => {
  const options = [makeOption("OPT-1", 10), makeOption("OPT-2", 20)];

  it("returns options in the requested id order", () => {
    const selected = selectCompareOptions(options, ["OPT-2", "OPT-1"]);
    expect(selected?.map((option) => option.option_id)).toEqual(["OPT-2", "OPT-1"]);
  });

  it("returns null when the same option id is selected twice", () => {
    expect(selectCompareOptions(options, ["OPT-1", "OPT-1"])).toBeNull();
  });

  it("returns null when an option id is missing", () => {
    expect(selectCompareOptions(options, ["OPT-1", "OPT-9"])).toBeNull();
  });
});
