import type { OccRules } from "@/lib/types";

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
// Curfew helpers (K6)
// =============================================================================

const VN_DEFAULT_UTC_OFFSET_HOURS = 7;

/**
 * UTC offset (hours) for known airports. VN airports default to UTC+7.
 * Extend this map as the schedule covers more regions; unknown IATA codes
 * fall back to VN_DEFAULT_UTC_OFFSET_HOURS so curfew checks degrade safely.
 */
const AIRPORT_UTC_OFFSETS: Record<string, number> = {
  HAN: 7,
  SGN: 7,
  DAD: 7,
  CXR: 7,
  PQC: 7,
  VCL: 7,
  VCS: 7,
  BMV: 7,
  HUI: 7,
  HPH: 7,
  VCA: 7,
  UIH: 7,
  VKG: 7,
  VDH: 7,
  DLI: 7,
  VDO: 7,
  THD: 7,
  DIN: 7,
  TBB: 7,
};

export function getAirportUtcOffsetHours(airport: string): number {
  return AIRPORT_UTC_OFFSETS[airport] ?? VN_DEFAULT_UTC_OFFSET_HOURS;
}

function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return hh * 60 + mm;
}

/** Minute-of-day (0..1439) of a UTC instant in the airport's local time. */
export function localTimeOfDayMinutes(utc: Date, airport: string): number {
  const offset = getAirportUtcOffsetHours(airport);
  const localMs = utc.getTime() + offset * 60 * 60 * 1000;
  const d = new Date(localMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
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
  const t = localTimeOfDayMinutes(utc, airport);
  if (start < end) return t >= start && t < end;
  // Wraps midnight (e.g. 23:00–05:00)
  return t >= start || t < end;
}
