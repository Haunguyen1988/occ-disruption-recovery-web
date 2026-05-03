import { configuredWeatherAirports } from "./airports";
import { fetchAviationWeatherReports } from "./providers/aviation-weather";
import { evaluateWeatherReport, snapshotStatus } from "./risk-evaluator";
import type {
  AirportWeatherSnapshot,
  WeatherAlert,
  WeatherProvider,
  WeatherReport,
  WeatherSnapshot,
} from "./types";

function latestByProduct(
  reports: WeatherReport[],
  airportIcao: string,
  product: WeatherReport["product"],
): WeatherReport | null {
  const matching = reports
    .filter(
      (report) =>
        report.airport_icao === airportIcao && report.product === product,
    )
    .sort((a, b) => {
      const aTime =
        a.observed_at?.getTime() ??
        a.issued_at?.getTime() ??
        a.fetched_at.getTime();
      const bTime =
        b.observed_at?.getTime() ??
        b.issued_at?.getTime() ??
        b.fetched_at.getTime();
      return bTime - aTime;
    });
  return matching[0] ?? null;
}

export function buildWeatherSnapshot(input: {
  provider: WeatherProvider;
  reports: WeatherReport[];
  alerts?: WeatherAlert[];
  errors?: string[];
  fetched_at?: Date;
}): WeatherSnapshot {
  const airports = configuredWeatherAirports();
  const allAlerts =
    input.alerts ??
    input.reports.flatMap((report) => evaluateWeatherReport(report));

  const airportSnapshots: AirportWeatherSnapshot[] = airports.map((airport) => {
    const metar = latestByProduct(input.reports, airport.icao, "METAR");
    const taf = latestByProduct(input.reports, airport.icao, "TAF");
    const alerts = allAlerts.filter(
      (alert) => alert.airport_icao === airport.icao,
    );
    const updatedTimes = [metar?.fetched_at, taf?.fetched_at].filter(
      (item): item is Date => Boolean(item),
    );
    const snapshot = {
      airport,
      metar,
      taf,
      alerts,
      status: "INFO" as AirportWeatherSnapshot["status"],
      updated_at: updatedTimes.length
        ? new Date(Math.max(...updatedTimes.map((item) => item.getTime())))
        : null,
    };
    snapshot.status = snapshotStatus(snapshot);
    return snapshot;
  });

  return {
    provider: input.provider,
    airports: airportSnapshots,
    fetched_at: input.fetched_at ?? new Date(),
    errors: input.errors ?? [],
  };
}

export async function fetchLiveWeatherSnapshot(): Promise<WeatherSnapshot> {
  const airports = configuredWeatherAirports();
  const now = new Date();
  const { reports, errors } = await fetchAviationWeatherReports(airports, now);
  return buildWeatherSnapshot({
    provider: "aviationweather",
    reports,
    errors,
    fetched_at: now,
  });
}
