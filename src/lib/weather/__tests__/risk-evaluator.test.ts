import { describe, expect, it } from "vitest";
import type { WeatherReport } from "../types";
import { evaluateWeatherReport } from "../risk-evaluator";
import { weatherReportHash } from "../normalize";

function metar(rawText: string): WeatherReport {
  const observedAt = new Date("2026-05-03T08:00:00Z");
  return {
    airport_icao: "VVNB",
    airport_iata: "HAN",
    provider: "aviationweather",
    product: "METAR",
    raw_text: rawText,
    issued_at: observedAt,
    observed_at: observedAt,
    valid_from: observedAt,
    valid_to: null,
    flight_category: "IFR",
    visibility_m: 1200,
    ceiling_ft: 400,
    wind_dir_deg: 340,
    wind_speed_kt: 3,
    wind_gust_kt: null,
    qnh_hpa: 1013,
    weather_codes: ["RA", "BR"],
    parsed_json: {},
    source_url: "https://example.test",
    fetched_at: new Date("2026-05-03T08:01:00Z"),
    stale_after: new Date("2026-05-03T09:16:00Z"),
    report_hash: weatherReportHash({
      provider: "aviationweather",
      product: "METAR",
      airport_icao: "VVNB",
      raw_text: rawText,
      observed_at: observedAt,
    }),
  };
}

describe("weather risk evaluator", () => {
  it("creates operational alerts from low visibility and ceiling", () => {
    const alerts = evaluateWeatherReport(
      metar("METAR VVNB 030800Z 34003KT 1200 RA BR BKN004 22/21 Q1013"),
      new Date("2026-05-03T08:10:00Z"),
    );

    expect(alerts.map((alert) => alert.alert_type)).toContain("LOW_VIS");
    expect(alerts.map((alert) => alert.alert_type)).toContain("LOW_CEILING");
    expect(alerts.map((alert) => alert.alert_type)).toContain("IFR");
  });

  it("marks stale reports", () => {
    const alerts = evaluateWeatherReport(
      metar("METAR VVNB 030800Z 34003KT 9999 SCT040 22/21 Q1013"),
      new Date("2026-05-03T10:00:00Z"),
    );

    expect(alerts.map((alert) => alert.alert_type)).toContain("STALE_DATA");
  });
});
