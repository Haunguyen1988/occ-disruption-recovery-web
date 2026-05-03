import type { WeatherAirportConfig, WeatherReport } from "../types";
import {
  normalizeAviationWeatherMetar,
  normalizeAviationWeatherTaf,
} from "../normalize";

const AWC_BASE_URL = "https://aviationweather.gov/api/data";

interface AviationWeatherFetchResult {
  reports: WeatherReport[];
  errors: string[];
}

async function fetchJsonArray(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "OCC-Disruption-Recovery/0.1 (+https://example.invalid; contact: occ-demo)",
    },
    cache: "no-store",
  });

  if (res.status === 204) return [];
  if (!res.ok) {
    throw new Error(`AviationWeather ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as unknown;
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") return [body as Record<string, unknown>];
  return [];
}

function idsParam(airports: WeatherAirportConfig[]): string {
  return airports.map((airport) => airport.icao).join(",");
}

export async function fetchAviationWeatherReports(
  airports: WeatherAirportConfig[],
  now = new Date(),
): Promise<AviationWeatherFetchResult> {
  const ids = idsParam(airports);
  const metarUrl = `${AWC_BASE_URL}/metar?ids=${encodeURIComponent(ids)}&format=json`;
  const tafUrl = `${AWC_BASE_URL}/taf?ids=${encodeURIComponent(ids)}&format=json`;
  const reports: WeatherReport[] = [];
  const errors: string[] = [];

  try {
    const rows = await fetchJsonArray(metarUrl);
    for (const row of rows) {
      const report = normalizeAviationWeatherMetar(row, metarUrl, now);
      if (report) reports.push(report);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  try {
    const rows = await fetchJsonArray(tafUrl);
    for (const row of rows) {
      const report = normalizeAviationWeatherTaf(row, tafUrl, now);
      if (report) reports.push(report);
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return { reports, errors };
}
