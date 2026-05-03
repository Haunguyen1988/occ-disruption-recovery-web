export type WeatherProvider = "aviationweather" | "open-meteo" | "checkwx";

export type WeatherProduct = "METAR" | "TAF" | "MODEL_FORECAST";

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN";

export type WeatherAlertSeverity = "INFO" | "WATCH" | "WARNING" | "CRITICAL";

export type WeatherAlertType =
  | "LOW_VIS"
  | "LOW_CEILING"
  | "THUNDERSTORM"
  | "CB"
  | "FOG"
  | "HEAVY_RAIN"
  | "WIND"
  | "IFR"
  | "STALE_DATA";

export interface WeatherAirportConfig {
  icao: string;
  iata: string;
  name: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
}

export interface WeatherReport {
  id?: number;
  airport_icao: string;
  airport_iata: string;
  provider: WeatherProvider;
  product: WeatherProduct;
  raw_text: string;
  issued_at: Date | null;
  observed_at: Date | null;
  valid_from: Date | null;
  valid_to: Date | null;
  flight_category: FlightCategory;
  visibility_m: number | null;
  ceiling_ft: number | null;
  wind_dir_deg: number | null;
  wind_speed_kt: number | null;
  wind_gust_kt: number | null;
  qnh_hpa: number | null;
  weather_codes: string[];
  parsed_json: Record<string, unknown>;
  source_url: string;
  fetched_at: Date;
  stale_after: Date;
  report_hash: string;
}

export interface WeatherAlert {
  id?: number;
  airport_icao: string;
  airport_iata: string;
  severity: WeatherAlertSeverity;
  alert_type: WeatherAlertType;
  message: string;
  window_start: Date;
  window_end: Date | null;
  source_report_hash: string;
  source_report_id?: number | null;
  created_at?: Date;
}

export interface AirportWeatherSnapshot {
  airport: WeatherAirportConfig;
  metar: WeatherReport | null;
  taf: WeatherReport | null;
  alerts: WeatherAlert[];
  status: WeatherAlertSeverity;
  updated_at: Date | null;
}

export interface WeatherSnapshot {
  provider: WeatherProvider;
  airports: AirportWeatherSnapshot[];
  fetched_at: Date;
  errors: string[];
}

export interface WeatherThresholds {
  min_visibility_m: number;
  min_ceiling_ft: number;
  wind_warning_kt: number;
  gust_warning_kt: number;
  metar_stale_minutes: number;
  taf_stale_minutes: number;
}
