import { describe, expect, it } from "vitest";
import { collectOperationalLoadErrors } from "@/lib/supabase/queries";

describe("collectOperationalLoadErrors", () => {
  it("returns null when every query succeeds", () => {
    expect(
      collectOperationalLoadErrors([
        { source: "flights", error: null },
        { source: "aircraft", error: null },
        { source: "disruption_events", error: null },
      ]),
    ).toBeNull();
  });

  it("aggregates source, message, details, hint, and code", () => {
    const result = collectOperationalLoadErrors([
      {
        source: "flights",
        error: {
          message: "permission denied",
          details: "RLS rejected the query",
          hint: "Check policies",
          code: "42501",
        },
      },
      { source: "aircraft", error: null },
      {
        source: "disruption_events",
        error: { message: "relation does not exist", code: "42P01" },
      },
    ]);

    expect(result).not.toBeNull();
    expect(result?.message).toContain("flights");
    expect(result?.message).toContain("disruption_events");
    expect(result?.issues).toEqual([
      {
        source: "flights",
        message: "permission denied RLS rejected the query Check policies",
        code: "42501",
      },
      {
        source: "disruption_events",
        message: "relation does not exist",
        code: "42P01",
      },
    ]);
  });

  it("uses a fallback message for unknown query errors", () => {
    const result = collectOperationalLoadErrors([
      { source: "flights", error: {} },
    ]);

    expect(result?.issues[0].message).toBe("Unknown Supabase query error");
  });
});
