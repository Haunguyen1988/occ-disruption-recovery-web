import { createHash } from "crypto";
import { decodeMetar } from "@/lib/decoders/metar";
import { findWeatherAirport } from "./airports";
import type {
  FlightCategory,
  WeatherProduct,
  WeatherProvider,
  WeatherReport,
} from "./types";

export function weatherReportHash(input: {
  provider: WeatherProvider;
  product: WeatherProduct;
  airport_icao: string;
  raw_text: string;
  observed_at?: Date | null;
  issued_at?: Date | null;
}): string {
  return createHash("sha256")
    .update(
      [
        input.provider,
        input.product,
        input.airport_icao,
        input.raw_text,
        input.observed_at?.toISOString() ?? "",
        input.issued_at?.toISOString() ?? "",
      ].join("|"),
    )
    .digest("hex");
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace("+", "").trim();
  if (normalized.startsWith("P")) return Number(normalized.slice(1));
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function visibilityToMeters(value: unknown): number | null {
  const numeric = numberFromUnknown(value);
  if (numeric === null) return null;
  // AviationWeather JSON often returns statute miles for `visib`.
  if (numeric <= 20) return Math.round(numeric * 1609.344);
  return Math.round(numeric);
}

function qnhHpaFromUnknown(value: unknown): number | null {
  const numeric = numberFromUnknown(value);
  if (numeric === null) return null;
  return numeric < 100 ? Math.round(numeric * 33.8639) : Math.round(numeric);
}

export function inferFlightCategory(input: {
  providerCategory?: unknown;
  visibility_m: number | null;
  ceiling_ft: number | null;
}): FlightCategory {
  if (typeof input.providerCategory === "string") {
    const normalized = input.providerCategory.toUpperCase();
    if (
      normalized === "VFR" ||
      normalized === "MVFR" ||
      normalized === "IFR" ||
      normalized === "LIFR"
    ) {
      return normalized;
    }
  }

  const visibility = input.visibility_m;
  const ceiling = input.ceiling_ft;
  if (
    (ceiling !== null && ceiling < 500) ||
    (visibility !== null && visibility < 1600)
  ) {
    return "LIFR";
  }
  if (
    (ceiling !== null && ceiling < 1000) ||
    (visibility !== null && visibility < 4800)
  ) {
    return "IFR";
  }
  if (
    (ceiling !== null && ceiling <= 3000) ||
    (visibility !== null && visibility <= 8000)
  ) {
    return "MVFR";
  }
  if (ceiling !== null || visibility !== null) return "VFR";
  return "UNKNOWN";
}

function cloudCeilingFromAwc(row: Record<string, unknown>): number | null {
  const clouds = row.clouds;
  if (!Array.isArray(clouds)) return null;
  const ceilingLayers = clouds
    .map((cloud) => {
      if (!cloud || typeof cloud !== "object") return null;
      const item = cloud as Record<string, unknown>;
      const cover = String(item.cover ?? item.coverage ?? "").toUpperCase();
      const base = numberFromUnknown(item.base);
      if ((cover === "BKN" || cover === "OVC") && base !== null) {
        return Math.round(base);
      }
      return null;
    })
    .filter((item): item is number => item !== null);
  return ceilingLayers.length ? Math.min(...ceilingLayers) : null;
}

export function normalizeAviationWeatherMetar(
  row: Record<string, unknown>,
  sourceUrl: string,
  fetchedAt = new Date(),
): WeatherReport | null {
  const airportIcao = String(row.icaoId ?? row.station_id ?? row.icao ?? "")
    .trim()
    .toUpperCase();
  const rawText = String(row.rawOb ?? row.raw_text ?? row.rawText ?? "").trim();
  if (!airportIcao || !rawText) return null;

  const decoded = decodeMetar(rawText);
  const airport = findWeatherAirport(airportIcao);
  const observedAt =
    parseIsoDate(row.obsTime) ??
    parseIsoDate(row.reportTime) ??
    parseIsoDate(row.observation_time);
  const visibility_m =
    visibilityToMeters(row.visib) ?? decoded.visibility_m ?? null;
  const ceiling_ft =
    cloudCeilingFromAwc(row) ?? decoded.ceiling_ft ?? null;
  const windSpeed = numberFromUnknown(row.wspd) ?? decoded.wind?.speed_kt ?? null;
  const windGust = numberFromUnknown(row.wgst) ?? decoded.wind?.gust_kt ?? null;
  const windDir = numberFromUnknown(row.wdir) ?? decoded.wind?.direction_deg ?? null;
  const qnh =
    qnhHpaFromUnknown(row.altim) ??
    qnhHpaFromUnknown(row.qnh) ??
    decoded.qnh_hpa ??
    null;
  const category = inferFlightCategory({
    providerCategory: row.fltCat,
    visibility_m,
    ceiling_ft,
  });
  const reportHash = weatherReportHash({
    provider: "aviationweather",
    product: "METAR",
    airport_icao: airportIcao,
    raw_text: rawText,
    observed_at: observedAt,
  });

  return {
    airport_icao: airportIcao,
    airport_iata: airport.iata,
    provider: "aviationweather",
    product: "METAR",
    raw_text: rawText,
    issued_at: observedAt,
    observed_at: observedAt,
    valid_from: observedAt,
    valid_to: null,
    flight_category: category,
    visibility_m,
    ceiling_ft,
    wind_dir_deg: windDir,
    wind_speed_kt: windSpeed,
    wind_gust_kt: windGust,
    qnh_hpa: qnh,
    weather_codes: decoded.weather,
    parsed_json: row,
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    stale_after: new Date(fetchedAt.getTime() + 75 * 60000),
    report_hash: reportHash,
  };
}

export function normalizeAviationWeatherTaf(
  row: Record<string, unknown>,
  sourceUrl: string,
  fetchedAt = new Date(),
): WeatherReport | null {
  const airportIcao = String(row.icaoId ?? row.station_id ?? row.icao ?? "")
    .trim()
    .toUpperCase();
  const rawText = String(row.rawTAF ?? row.raw_taf ?? row.raw_text ?? "").trim();
  if (!airportIcao || !rawText) return null;

  const airport = findWeatherAirport(airportIcao);
  const issuedAt = parseIsoDate(row.issueTime) ?? parseIsoDate(row.issue_time);
  const validFrom =
    parseIsoDate(row.validTimeFrom) ?? parseIsoDate(row.valid_time_from);
  const validTo =
    parseIsoDate(row.validTimeTo) ?? parseIsoDate(row.valid_time_to);
  const reportHash = weatherReportHash({
    provider: "aviationweather",
    product: "TAF",
    airport_icao: airportIcao,
    raw_text: rawText,
    issued_at: issuedAt,
  });

  return {
    airport_icao: airportIcao,
    airport_iata: airport.iata,
    provider: "aviationweather",
    product: "TAF",
    raw_text: rawText,
    issued_at: issuedAt,
    observed_at: null,
    valid_from: validFrom,
    valid_to: validTo,
    flight_category: "UNKNOWN",
    visibility_m: null,
    ceiling_ft: null,
    wind_dir_deg: null,
    wind_speed_kt: null,
    wind_gust_kt: null,
    qnh_hpa: null,
    weather_codes: extractTafWeatherCodes(rawText),
    parsed_json: row,
    source_url: sourceUrl,
    fetched_at: fetchedAt,
    stale_after: new Date(fetchedAt.getTime() + 6 * 60 * 60000),
    report_hash: reportHash,
  };
}

function extractTafWeatherCodes(rawText: string): string[] {
  const codes = ["TS", "TSRA", "VCTS", "CB", "+RA", "RA", "SHRA", "FG", "BR"];
  return codes.filter((code) => rawText.includes(code));
}
