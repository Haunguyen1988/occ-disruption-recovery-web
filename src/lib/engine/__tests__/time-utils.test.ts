import { describe, it, expect } from "vitest";
import {
  getAirportTimezone,
  getAirportUtcOffsetHours,
  isInCurfew,
  localTimeOfDayMinutes,
  localToUtc,
  utcToLocalMinuteOfDay,
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

describe("getAirportTimezone", () => {
  it("maps known stations to IANA zones", () => {
    expect(getAirportTimezone("HAN")).toBe("Asia/Ho_Chi_Minh");
    expect(getAirportTimezone("SGN")).toBe("Asia/Ho_Chi_Minh");
    expect(getAirportTimezone("ICN")).toBe("Asia/Seoul");
    expect(getAirportTimezone("NRT")).toBe("Asia/Tokyo");
    expect(getAirportTimezone("HKG")).toBe("Asia/Hong_Kong");
    expect(getAirportTimezone("BOM")).toBe("Asia/Kolkata");
    expect(getAirportTimezone("SYD")).toBe("Australia/Sydney");
  });

  it("falls back to Asia/Ho_Chi_Minh for unknown codes", () => {
    expect(getAirportTimezone("XYZ")).toBe("Asia/Ho_Chi_Minh");
  });
});

describe("localToUtc (DST-aware)", () => {
  it("converts HAN local 10:30 (UTC+7) → 03:30Z", () => {
    const utc = localToUtc(2026, 4, 28, 10, 30, "Asia/Ho_Chi_Minh");
    expect(utc.toISOString()).toBe("2026-04-28T03:30:00.000Z");
  });

  it("converts ICN local 17:00 (UTC+9) → 08:00Z", () => {
    const utc = localToUtc(2026, 4, 28, 17, 0, "Asia/Seoul");
    expect(utc.toISOString()).toBe("2026-04-28T08:00:00.000Z");
  });

  it("converts BOM local 00:00 (UTC+5:30) → previous day 18:30Z", () => {
    const utc = localToUtc(2026, 4, 28, 0, 0, "Asia/Kolkata");
    expect(utc.toISOString()).toBe("2026-04-27T18:30:00.000Z");
  });

  it("respects Sydney DST (AEDT UTC+11 in January)", () => {
    // 2026-01-15 12:00 AEDT (UTC+11) → 01:00Z
    const utc = localToUtc(2026, 1, 15, 12, 0, "Australia/Sydney");
    expect(utc.toISOString()).toBe("2026-01-15T01:00:00.000Z");
  });

  it("respects Sydney non-DST (AEST UTC+10 in July)", () => {
    // 2026-07-15 12:00 AEST (UTC+10) → 02:00Z
    const utc = localToUtc(2026, 7, 15, 12, 0, "Australia/Sydney");
    expect(utc.toISOString()).toBe("2026-07-15T02:00:00.000Z");
  });
});

describe("utcToLocalMinuteOfDay (DST-aware)", () => {
  it("renders UTC in HKG-local clock correctly", () => {
    const utc = new Date("2026-04-28T15:30:00Z");
    expect(utcToLocalMinuteOfDay(utc, "HKG")).toBe(23 * 60 + 30);
  });

  it("renders UTC in BOM-local clock correctly", () => {
    const utc = new Date("2026-04-28T18:30:00Z");
    expect(utcToLocalMinuteOfDay(utc, "BOM")).toBe(0);
  });

  it("renders UTC in SYD-local clock during DST (AEDT UTC+11)", () => {
    // 2026-01-15T01:30Z → 12:30 AEDT
    const utc = new Date("2026-01-15T01:30:00Z");
    expect(utcToLocalMinuteOfDay(utc, "SYD")).toBe(12 * 60 + 30);
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
