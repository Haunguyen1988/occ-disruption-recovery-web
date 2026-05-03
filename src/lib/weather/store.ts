import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
  isSupabaseConfigured,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/server";
import { configuredWeatherAirports, findWeatherAirport } from "./airports";
import { buildWeatherSnapshot } from "./service";
import type {
  WeatherAlert,
  WeatherProduct,
  WeatherProvider,
  WeatherReport,
  WeatherSnapshot,
} from "./types";

interface WeatherReportRow {
  id: number;
  airport_icao: string;
  airport_iata: string;
  provider: WeatherProvider;
  product: WeatherProduct;
  raw_text: string;
  issued_at: string | null;
  observed_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  flight_category: WeatherReport["flight_category"] | null;
  visibility_m: number | null;
  ceiling_ft: number | null;
  wind_dir_deg: number | null;
  wind_speed_kt: number | null;
  wind_gust_kt: number | null;
  qnh_hpa: number | null;
  weather_codes: string[] | null;
  parsed_json: Record<string, unknown> | null;
  source_url: string;
  fetched_at: string;
  stale_after: string;
  report_hash: string;
}

interface WeatherAlertRow {
  id: number;
  airport_icao: string;
  airport_iata: string;
  severity: WeatherAlert["severity"];
  alert_type: WeatherAlert["alert_type"];
  message: string;
  window_start: string;
  window_end: string | null;
  source_report_hash: string;
  source_report_id: number | null;
  created_at: string;
}

function reportToRow(report: WeatherReport) {
  return {
    airport_icao: report.airport_icao,
    airport_iata: report.airport_iata,
    provider: report.provider,
    product: report.product,
    raw_text: report.raw_text,
    issued_at: report.issued_at?.toISOString() ?? null,
    observed_at: report.observed_at?.toISOString() ?? null,
    valid_from: report.valid_from?.toISOString() ?? null,
    valid_to: report.valid_to?.toISOString() ?? null,
    flight_category: report.flight_category,
    visibility_m: report.visibility_m,
    ceiling_ft: report.ceiling_ft,
    wind_dir_deg: report.wind_dir_deg,
    wind_speed_kt: report.wind_speed_kt,
    wind_gust_kt: report.wind_gust_kt,
    qnh_hpa: report.qnh_hpa,
    weather_codes: report.weather_codes,
    parsed_json: report.parsed_json,
    source_url: report.source_url,
    fetched_at: report.fetched_at.toISOString(),
    stale_after: report.stale_after.toISOString(),
    report_hash: report.report_hash,
  };
}

function rowToReport(row: WeatherReportRow): WeatherReport {
  return {
    id: row.id,
    airport_icao: row.airport_icao,
    airport_iata: row.airport_iata,
    provider: row.provider,
    product: row.product,
    raw_text: row.raw_text,
    issued_at: row.issued_at ? new Date(row.issued_at) : null,
    observed_at: row.observed_at ? new Date(row.observed_at) : null,
    valid_from: row.valid_from ? new Date(row.valid_from) : null,
    valid_to: row.valid_to ? new Date(row.valid_to) : null,
    flight_category: row.flight_category ?? "UNKNOWN",
    visibility_m: row.visibility_m,
    ceiling_ft: row.ceiling_ft,
    wind_dir_deg: row.wind_dir_deg,
    wind_speed_kt: row.wind_speed_kt,
    wind_gust_kt: row.wind_gust_kt,
    qnh_hpa: row.qnh_hpa,
    weather_codes: row.weather_codes ?? [],
    parsed_json: row.parsed_json ?? {},
    source_url: row.source_url,
    fetched_at: new Date(row.fetched_at),
    stale_after: new Date(row.stale_after),
    report_hash: row.report_hash,
  };
}

function alertToRow(alert: WeatherAlert) {
  return {
    airport_icao: alert.airport_icao,
    airport_iata: alert.airport_iata,
    severity: alert.severity,
    alert_type: alert.alert_type,
    message: alert.message,
    window_start: alert.window_start.toISOString(),
    window_end: alert.window_end?.toISOString() ?? null,
    source_report_hash: alert.source_report_hash,
    source_report_id: alert.source_report_id ?? null,
  };
}

function rowToAlert(row: WeatherAlertRow): WeatherAlert {
  return {
    id: row.id,
    airport_icao: row.airport_icao,
    airport_iata: row.airport_iata,
    severity: row.severity,
    alert_type: row.alert_type,
    message: row.message,
    window_start: new Date(row.window_start),
    window_end: row.window_end ? new Date(row.window_end) : null,
    source_report_hash: row.source_report_hash,
    source_report_id: row.source_report_id,
    created_at: new Date(row.created_at),
  };
}

async function writableClient() {
  if (isSupabaseServiceConfigured()) return createSupabaseServiceClient();
  if (!isSupabaseConfigured()) return null;
  return createSupabaseServerClient();
}

export async function persistWeatherSnapshot(
  snapshot: WeatherSnapshot,
): Promise<{ stored: boolean; message?: string }> {
  const supabase = await writableClient();
  if (!supabase) return { stored: false, message: "Supabase not configured" };

  const reports = snapshot.airports.flatMap((airport) =>
    [airport.metar, airport.taf].filter(
      (report): report is WeatherReport => Boolean(report),
    ),
  );
  if (reports.length === 0) return { stored: true };

  const { data: reportRows, error: reportError } = await supabase
    .from("weather_reports")
    .upsert(reports.map(reportToRow), {
      onConflict: "provider,product,airport_icao,report_hash",
    })
    .select("id, report_hash");

  if (reportError) {
    return { stored: false, message: reportError.message };
  }

  const idByHash = new Map(
    (reportRows ?? []).map((row) => [
      row.report_hash as string,
      row.id as number,
    ]),
  );
  const alerts = snapshot.airports.flatMap((airport) => airport.alerts);
  if (alerts.length > 0) {
    const rows = alerts.map((alert) =>
      alertToRow({
        ...alert,
        source_report_id: idByHash.get(alert.source_report_hash) ?? null,
      }),
    );
    const { error: alertError } = await supabase
      .from("weather_alerts")
      .upsert(rows, {
        onConflict: "source_report_hash,alert_type,message",
      });
    if (alertError) return { stored: false, message: alertError.message };
  }

  return { stored: true };
}

export async function loadLatestWeatherSnapshot(): Promise<WeatherSnapshot | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const airports = configuredWeatherAirports();
  const airportIds = airports.map((airport) => airport.icao);

  const { data: reportData, error: reportError } = await supabase
    .from("weather_reports")
    .select("*")
    .in("airport_icao", airportIds)
    .order("fetched_at", { ascending: false })
    .limit(80);
  if (reportError || !reportData) return null;

  const reportsByKey = new Map<string, WeatherReport>();
  for (const row of reportData as WeatherReportRow[]) {
    const key = `${row.airport_icao}:${row.product}`;
    if (!reportsByKey.has(key)) reportsByKey.set(key, rowToReport(row));
  }
  const reports = [...reportsByKey.values()];
  if (reports.length === 0) return null;

  const hashes = reports.map((report) => report.report_hash);
  let alerts: WeatherAlert[] = [];
  if (hashes.length > 0) {
    const { data: alertData } = await supabase
      .from("weather_alerts")
      .select("*")
      .in("source_report_hash", hashes)
      .order("created_at", { ascending: false });
    alerts = ((alertData ?? []) as WeatherAlertRow[]).map(rowToAlert);
  }

  return buildWeatherSnapshot({
    provider: "aviationweather",
    reports,
    alerts,
    fetched_at: reports.length
      ? new Date(Math.max(...reports.map((report) => report.fetched_at.getTime())))
      : new Date(),
  });
}

export function emptyWeatherSnapshot(): WeatherSnapshot {
  return {
    provider: "aviationweather",
    fetched_at: new Date(),
    errors: [],
    airports: configuredWeatherAirports().map((airport) => ({
      airport: findWeatherAirport(airport.icao),
      metar: null,
      taf: null,
      alerts: [],
      status: "INFO",
      updated_at: null,
    })),
  };
}
