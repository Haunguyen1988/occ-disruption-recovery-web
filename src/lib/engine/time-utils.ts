import type { OccRules } from "@/lib/types";
import {
  AIRPORT_TIMEZONES as GENERATED_TIMEZONES,
  AIRPORT_UTC_OFFSETS as GENERATED_OFFSETS,
} from "@/../data/airport-timezones";

export function overlaps(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && startB < endA;
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60000);
}

export function maxDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

export function minTurnaroundForType(
  aircraftType: string,
  rules: OccRules,
): number {
  const turn = rules.turnaround_rules ?? {
    default_minutes: 40,
    by_aircraft_type: {},
  };
  return turn.by_aircraft_type?.[aircraftType] ?? turn.default_minutes ?? 40;
}

// =============================================================================
// Timezone-aware helpers (Sprint 8)
// =============================================================================
//
// Airport timezone and UTC offset data is auto-generated from
// AirportUTCReport.csv (259 airports). To regenerate, run:
//   node scripts/parse-airport-utc.cjs
//
// We use IANA time-zone identifiers + `Intl.DateTimeFormat` so DST transitions
// (notably AU stations during their summer) are handled correctly without us
// hand-rolling a DST table.

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const VN_DEFAULT_UTC_OFFSET_HOURS = 7;

// Use generated maps (259 airports from AirportUTCReport.csv)
const AIRPORT_TIMEZONES: Record<string, string> = GENERATED_TIMEZONES;
const AIRPORT_UTC_OFFSETS: Record<string, number> = GENERATED_OFFSETS;

/** Returns the IANA timezone for an airport, defaulting to Asia/Ho_Chi_Minh. */
export function getAirportTimezone(airport: string): string {
  return AIRPORT_TIMEZONES[airport] ?? DEFAULT_TIMEZONE;
}

/**
 * Minutes the IANA timezone is offset from UTC at the given UTC instant.
 * Returns positive minutes for east-of-UTC zones (e.g. +540 for Asia/Tokyo).
 */
function tzOffsetMinutesAt(utcMs: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const localAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((localAsUtcMs - utcMs) / 60000);
}

/**
 * Convert a calendar date + clock time in the given timezone to a true UTC
 * instant. Two-pass refinement handles DST transitions.
 */
export function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = naiveUtc - tzOffsetMinutesAt(naiveUtc, tz) * 60000;
  const refinedOffset = tzOffsetMinutesAt(guess, tz);
  return new Date(naiveUtc - refinedOffset * 60000);
}

/** Minute-of-day (0..1439) for a UTC instant rendered in the airport's local time. */
export function utcToLocalMinuteOfDay(utc: Date, airport: string): number {
  const tz = getAirportTimezone(airport);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(utc);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** @deprecated Use `getAirportTimezone` + `utcToLocalMinuteOfDay` for DST safety. */
export function localTimeOfDayMinutes(utc: Date, airport: string): number {
  return utcToLocalMinuteOfDay(utc, airport);
}

/**
 * @deprecated Returns the *standard-time* (non-DST) offset only. Use
 * `getAirportTimezone` + `localToUtc` / `utcToLocalMinuteOfDay` for
 * DST-aware computations.
 */
export function getAirportUtcOffsetHours(airport: string): number {
  return AIRPORT_UTC_OFFSETS[airport] ?? VN_DEFAULT_UTC_OFFSET_HOURS;
}

// =============================================================================
// Curfew helpers (K6)
// =============================================================================

function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return hh * 60 + mm;
}

/**
 * Returns true when the given UTC instant lies inside the configured curfew
 * window for the airport (interpreted in the airport's local time). Supports
 * windows that wrap midnight (e.g. 23:00–06:00).
 *
 * Returns false when curfew enforcement is disabled or the airport has no
 * configured window.
 */
export function isInCurfew(
  airport: string,
  utc: Date,
  rules: OccRules,
): boolean {
  if (!rules.airport_rules?.enforce_curfew) return false;
  const window = rules.airport_rules.curfews?.[airport];
  if (!window) return false;
  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  if (start === end) return false;
  const t = utcToLocalMinuteOfDay(utc, airport);
  if (start < end) return t >= start && t < end;
  // Wraps midnight (e.g. 23:00–05:00)
  return t >= start || t < end;
}
