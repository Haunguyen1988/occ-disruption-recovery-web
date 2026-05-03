import type {
  AirportWeatherSnapshot,
  WeatherAlert,
  WeatherReport,
  WeatherSnapshot,
} from "./types";

type SerializableDate = string | null;

export interface SerializedWeatherReport
  extends Omit<
    WeatherReport,
    | "issued_at"
    | "observed_at"
    | "valid_from"
    | "valid_to"
    | "fetched_at"
    | "stale_after"
  > {
  issued_at: SerializableDate;
  observed_at: SerializableDate;
  valid_from: SerializableDate;
  valid_to: SerializableDate;
  fetched_at: string;
  stale_after: string;
}

export interface SerializedWeatherAlert
  extends Omit<WeatherAlert, "window_start" | "window_end" | "created_at"> {
  window_start: string;
  window_end: SerializableDate;
  created_at?: string;
}

export interface SerializedAirportWeatherSnapshot
  extends Omit<
    AirportWeatherSnapshot,
    "metar" | "taf" | "alerts" | "updated_at"
  > {
  metar: SerializedWeatherReport | null;
  taf: SerializedWeatherReport | null;
  alerts: SerializedWeatherAlert[];
  updated_at: SerializableDate;
}

export interface SerializedWeatherSnapshot
  extends Omit<WeatherSnapshot, "airports" | "fetched_at"> {
  airports: SerializedAirportWeatherSnapshot[];
  fetched_at: string;
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function serializeWeatherReport(
  report: WeatherReport,
): SerializedWeatherReport {
  return {
    ...report,
    issued_at: iso(report.issued_at),
    observed_at: iso(report.observed_at),
    valid_from: iso(report.valid_from),
    valid_to: iso(report.valid_to),
    fetched_at: report.fetched_at.toISOString(),
    stale_after: report.stale_after.toISOString(),
  };
}

export function serializeWeatherAlert(
  alert: WeatherAlert,
): SerializedWeatherAlert {
  return {
    ...alert,
    window_start: alert.window_start.toISOString(),
    window_end: iso(alert.window_end),
    created_at: iso(alert.created_at) ?? undefined,
  };
}

export function serializeWeatherSnapshot(
  snapshot: WeatherSnapshot,
): SerializedWeatherSnapshot {
  return {
    ...snapshot,
    fetched_at: snapshot.fetched_at.toISOString(),
    airports: snapshot.airports.map((airport) => ({
      ...airport,
      metar: airport.metar ? serializeWeatherReport(airport.metar) : null,
      taf: airport.taf ? serializeWeatherReport(airport.taf) : null,
      alerts: airport.alerts.map(serializeWeatherAlert),
      updated_at: iso(airport.updated_at),
    })),
  };
}
