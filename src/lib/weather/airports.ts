import type { WeatherAirportConfig } from "./types";

export const DEFAULT_WEATHER_AIRPORTS: WeatherAirportConfig[] = [
  {
    icao: "VVTS",
    iata: "SGN",
    name: "Tan Son Nhat International Airport",
    city: "Ho Chi Minh City",
    latitude: 10.8188,
    longitude: 106.6519,
  },
  {
    icao: "VVNB",
    iata: "HAN",
    name: "Noi Bai International Airport",
    city: "Hanoi",
    latitude: 21.2212,
    longitude: 105.8072,
  },
  {
    icao: "VVDN",
    iata: "DAD",
    name: "Da Nang International Airport",
    city: "Da Nang",
    latitude: 16.0439,
    longitude: 108.1994,
  },
];

const AIRPORT_BY_ICAO = new Map(
  DEFAULT_WEATHER_AIRPORTS.map((airport) => [airport.icao, airport]),
);

export function configuredWeatherAirports(
  env?: { WEATHER_AIRPORTS?: string },
): WeatherAirportConfig[] {
  const configured = (env?.WEATHER_AIRPORTS ?? process.env.WEATHER_AIRPORTS)
    ?.split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  if (!configured?.length) return DEFAULT_WEATHER_AIRPORTS;

  return configured.map((icao) => {
    const known = AIRPORT_BY_ICAO.get(icao);
    return (
      known ?? {
        icao,
        iata: icao,
        name: icao,
        city: icao,
        latitude: null,
        longitude: null,
      }
    );
  });
}

export function findWeatherAirport(icao: string): WeatherAirportConfig {
  return (
    AIRPORT_BY_ICAO.get(icao.toUpperCase()) ?? {
      icao: icao.toUpperCase(),
      iata: icao.toUpperCase(),
      name: icao.toUpperCase(),
      city: icao.toUpperCase(),
      latitude: null,
      longitude: null,
    }
  );
}
