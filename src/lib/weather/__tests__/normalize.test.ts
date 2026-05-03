import { describe, expect, it } from "vitest";
import {
  inferFlightCategory,
  normalizeAviationWeatherMetar,
  normalizeAviationWeatherTaf,
} from "../normalize";

describe("weather normalization", () => {
  it("normalizes AviationWeather METAR rows", () => {
    const report = normalizeAviationWeatherMetar(
      {
        icaoId: "VVTS",
        obsTime: "2026-05-03T08:00:00Z",
        rawOb: "METAR VVTS 030800Z 18012G22KT 9999 SCT018 BKN025CB 30/24 Q1010 NOSIG",
        fltCat: "MVFR",
        visib: "6+",
        wspd: 12,
        wgst: 22,
      },
      "https://example.test/metar",
      new Date("2026-05-03T08:02:00Z"),
    );

    expect(report?.airport_iata).toBe("SGN");
    expect(report?.product).toBe("METAR");
    expect(report?.flight_category).toBe("MVFR");
    expect(report?.wind_gust_kt).toBe(22);
    expect(report?.weather_codes).toEqual([]);
    expect(report?.report_hash).toHaveLength(64);
  });

  it("normalizes AviationWeather TAF rows", () => {
    const report = normalizeAviationWeatherTaf(
      {
        icaoId: "VVDN",
        issueTime: "2026-05-03T00:00:00Z",
        validTimeFrom: 1777766400,
        validTimeTo: 1777852800,
        rawTAF:
          "TAF VVDN 030000Z 0300/0324 05010KT 9999 SCT017 TEMPO 0308/0312 4000 TSRA BKN010 FEW015CB",
      },
      "https://example.test/taf",
      new Date("2026-05-03T00:02:00Z"),
    );

    expect(report?.airport_iata).toBe("DAD");
    expect(report?.product).toBe("TAF");
    expect(report?.valid_from?.toISOString()).toBe("2026-05-03T00:00:00.000Z");
    expect(report?.weather_codes).toContain("TS");
    expect(report?.weather_codes).toContain("CB");
  });

  it("infers flight categories from ceiling and visibility", () => {
    expect(
      inferFlightCategory({
        visibility_m: 900,
        ceiling_ft: 1000,
      }),
    ).toBe("LIFR");
    expect(
      inferFlightCategory({
        visibility_m: 6000,
        ceiling_ft: 2500,
      }),
    ).toBe("MVFR");
    expect(
      inferFlightCategory({
        visibility_m: 10000,
        ceiling_ft: null,
      }),
    ).toBe("VFR");
  });
});
