import { decodeMetar, evaluateMetar } from "@/lib/decoders/metar";
import type {
  AirportWeatherSnapshot,
  WeatherAlert,
  WeatherAlertSeverity,
  WeatherReport,
  WeatherThresholds,
} from "./types";

export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  min_visibility_m: 1500,
  min_ceiling_ft: 500,
  wind_warning_kt: 28,
  gust_warning_kt: 35,
  metar_stale_minutes: 75,
  taf_stale_minutes: 8 * 60,
};

const ALERT_LEVEL: Record<WeatherAlertSeverity, number> = {
  INFO: 0,
  WATCH: 1,
  WARNING: 2,
  CRITICAL: 3,
};

export function maxWeatherSeverity(
  severities: WeatherAlertSeverity[],
): WeatherAlertSeverity {
  return severities.reduce<WeatherAlertSeverity>(
    (best, item) => (ALERT_LEVEL[item] > ALERT_LEVEL[best] ? item : best),
    "INFO",
  );
}

function reportWindowStart(report: WeatherReport, now: Date): Date {
  return report.observed_at ?? report.valid_from ?? report.issued_at ?? now;
}

function reportWindowEnd(report: WeatherReport): Date | null {
  return report.valid_to ?? report.stale_after;
}

export function evaluateWeatherReport(
  report: WeatherReport,
  now = new Date(),
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const windowStart = reportWindowStart(report, now);
  const windowEnd = reportWindowEnd(report);

  if (report.stale_after < now) {
    alerts.push({
      airport_icao: report.airport_icao,
      airport_iata: report.airport_iata,
      severity: "WATCH",
      alert_type: "STALE_DATA",
      message: `${report.product} data is stale; last fetched ${report.fetched_at.toISOString()}`,
      window_start: report.stale_after,
      window_end: null,
      source_report_hash: report.report_hash,
    });
  }

  if (report.product === "METAR") {
    const decoded = decodeMetar(report.raw_text);
    for (const alert of evaluateMetar(decoded, {
      min_visibility_m: thresholds.min_visibility_m,
      min_ceiling_ft: thresholds.min_ceiling_ft,
      max_wind_kt: thresholds.wind_warning_kt,
      max_gust_kt: thresholds.gust_warning_kt,
      max_crosswind_kt: thresholds.gust_warning_kt,
    })) {
      if (alert.code === "CAVOK") continue;
      alerts.push({
        airport_icao: report.airport_icao,
        airport_iata: report.airport_iata,
        severity: alert.level === "danger" ? "CRITICAL" : "WARNING",
        alert_type:
          alert.code === "LOW_VIS"
            ? "LOW_VIS"
            : alert.code === "LOW_CEIL"
              ? "LOW_CEILING"
              : alert.code === "TS"
                ? "THUNDERSTORM"
                : alert.code === "CB"
                  ? "CB"
                  : alert.code === "FG"
                    ? "FOG"
                    : "WIND",
        message: alert.message,
        window_start: windowStart,
        window_end: windowEnd,
        source_report_hash: report.report_hash,
      });
    }

    if (report.flight_category === "IFR" || report.flight_category === "LIFR") {
      alerts.push({
        airport_icao: report.airport_icao,
        airport_iata: report.airport_iata,
        severity: report.flight_category === "LIFR" ? "CRITICAL" : "WARNING",
        alert_type: "IFR",
        message: `${report.flight_category} flight category reported`,
        window_start: windowStart,
        window_end: windowEnd,
        source_report_hash: report.report_hash,
      });
    }
  }

  if (report.product === "TAF") {
    const raw = report.raw_text.toUpperCase();
    if (raw.includes("TS") || raw.includes("CB")) {
      alerts.push({
        airport_icao: report.airport_icao,
        airport_iata: report.airport_iata,
        severity: "WARNING",
        alert_type: raw.includes("TS") ? "THUNDERSTORM" : "CB",
        message: "TAF contains thunderstorm or CB risk",
        window_start: report.valid_from ?? windowStart,
        window_end: report.valid_to,
        source_report_hash: report.report_hash,
      });
    }
    if (raw.includes("+RA") || raw.includes(" SHRA") || raw.includes(" RA ")) {
      alerts.push({
        airport_icao: report.airport_icao,
        airport_iata: report.airport_iata,
        severity: "WATCH",
        alert_type: "HEAVY_RAIN",
        message: "TAF contains rain or shower risk",
        window_start: report.valid_from ?? windowStart,
        window_end: report.valid_to,
        source_report_hash: report.report_hash,
      });
    }
  }

  return alerts;
}

export function snapshotStatus(
  snapshot: Pick<AirportWeatherSnapshot, "alerts" | "metar">,
): WeatherAlertSeverity {
  const severities = snapshot.alerts.map((alert) => alert.severity);
  if (snapshot.metar?.flight_category === "MVFR") severities.push("WATCH");
  if (snapshot.metar?.flight_category === "VFR") severities.push("INFO");
  return maxWeatherSeverity(severities);
}
