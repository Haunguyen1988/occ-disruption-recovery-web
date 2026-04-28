import { describe, it, expect } from "vitest";
import {
  getAirportUtcOffsetHours,
  isInCurfew,
  localTimeOfDayMinutes,
} from "@/lib/engine/time-utils";
import { getDefaultRules } from "@/lib/parsers/rules";

describe("getAirportUtcOffsetHours", () => {
  it("returns canonical offsets for major Asia/Pacific stations", () => {
    expect(getAirportUtcOffsetHours("HAN")).toBe(7);
    expect(getAirportUtcOffsetHours("BKK")).toBe(7);
    expect(getAirportUtcOffsetHours("SIN")).toBe(8);
    expect(getAirportUtcOffsetHours("HKG")).toBe(8);
    expect(getAirportUtcOffsetHours("ICN")).toBe(9);
    expect(getAirportUtcOffsetHours("NRT")).toBe(9);
    expect(getAirportUtcOffsetHours("SYD")).toBe(10);
    expect(getAirportUtcOffsetHours("KHV")).toBe(10);
  });

  it("supports fractional offsets for IST stations", () => {
    expect(getAirportUtcOffsetHours("BOM")).toBe(5.5);
    expect(getAirportUtcOffsetHours("DEL")).toBe(5.5);
  });

  it("falls back to UTC+7 for unknown codes", () => {
    expect(getAirportUtcOffsetHours("XYZ")).toBe(7);
  });

  it("includes domestic VN stations PXU and VII", () => {
    expect(getAirportUtcOffsetHours("PXU")).toBe(7);
    expect(getAirportUtcOffsetHours("VII")).toBe(7);
  });
});

describe("localTimeOfDayMinutes", () => {
  it("converts UTC to local minute-of-day correctly for UTC+8", () => {
    // 2026-04-28T15:30:00Z → 23:30 local in HKG (+8)
    const utc = new Date("2026-04-28T15:30:00Z");
    expect(localTimeOfDayMinutes(utc, "HKG")).toBe(23 * 60 + 30);
  });

  it("converts UTC to local minute-of-day for IST (UTC+5:30)", () => {
    // 2026-04-28T18:30:00Z → 00:00 local in BOM (+5:30)
    const utc = new Date("2026-04-28T18:30:00Z");
    expect(localTimeOfDayMinutes(utc, "BOM")).toBe(0);
  });
});

describe("isInCurfew with non-VN offsets", () => {
  it("flags a 23:30 HKG arrival as curfew when HKG window is 23:00-06:00", () => {
    const rules = getDefaultRules();
    rules.airport_rules.enforce_curfew = true;
    rules.airport_rules.curfews = {
      HKG: { start: "23:00", end: "06:00" },
    };
    // 15:30Z = 23:30 local in HKG
    expect(isInCurfew("HKG", new Date("2026-04-28T15:30:00Z"), rules)).toBe(true);
    // 14:30Z = 22:30 local — outside curfew
    expect(isInCurfew("HKG", new Date("2026-04-28T14:30:00Z"), rules)).toBe(false);
  });

  it("flags a 23:00 ICN arrival as curfew when ICN window is 23:00-06:00", () => {
    const rules = getDefaultRules();
    rules.airport_rules.enforce_curfew = true;
    rules.airport_rules.curfews = {
      ICN: { start: "23:00", end: "06:00" },
    };
    // 14:00Z = 23:00 local in ICN (+9)
    expect(isInCurfew("ICN", new Date("2026-04-28T14:00:00Z"), rules)).toBe(true);
  });
});
