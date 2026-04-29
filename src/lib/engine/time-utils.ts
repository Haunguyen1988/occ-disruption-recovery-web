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
// Timezone-aware helpers (Sprint 8)
// =============================================================================
//
// We use IANA time-zone identifiers + `Intl.DateTimeFormat` so DST transitions
// (notably AU stations during their summer) are handled correctly without us
// hand-rolling a DST table. The static-offset map below is retained as a
// best-effort fallback for `getAirportUtcOffsetHours` (used by older callers
// and a handful of unit tests); for any *new* code, prefer
// `getAirportTimezone` + `localToUtc` / `utcToLocalMinuteOfDay`.

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";

/** IANA timezone for each station that appears in the AIMS DayRep + samples. */
const AIRPORT_TIMEZONES: Record<string, string> = {
  // Vietnam (UTC+7, no DST)
  HAN: "Asia/Ho_Chi_Minh",
  SGN: "Asia/Ho_Chi_Minh",
  DAD: "Asia/Ho_Chi_Minh",
  CXR: "Asia/Ho_Chi_Minh",
  PQC: "Asia/Ho_Chi_Minh",
  VCL: "Asia/Ho_Chi_Minh",
  VCS: "Asia/Ho_Chi_Minh",
  BMV: "Asia/Ho_Chi_Minh",
  HUI: "Asia/Ho_Chi_Minh",
  HPH: "Asia/Ho_Chi_Minh",
  VCA: "Asia/Ho_Chi_Minh",
  UIH: "Asia/Ho_Chi_Minh",
  VKG: "Asia/Ho_Chi_Minh",
  VDH: "Asia/Ho_Chi_Minh",
  DLI: "Asia/Ho_Chi_Minh",
  VDO: "Asia/Ho_Chi_Minh",
  THD: "Asia/Ho_Chi_Minh",
  DIN: "Asia/Ho_Chi_Minh",
  TBB: "Asia/Ho_Chi_Minh",
  PXU: "Asia/Ho_Chi_Minh",
  VII: "Asia/Ho_Chi_Minh",
  // Thailand
  BKK: "Asia/Bangkok",
  HKT: "Asia/Bangkok",
  // Indonesia
  CGK: "Asia/Jakarta",
  DPS: "Asia/Makassar",
  // Laos
  VTE: "Asia/Vientiane",
  // Singapore / Malaysia
  SIN: "Asia/Singapore",
  KUL: "Asia/Kuala_Lumpur",
  // China / HK / Macau / Taiwan / Philippines
  HKG: "Asia/Hong_Kong",
  MFM: "Asia/Macau",
  MNL: "Asia/Manila",
  CEB: "Asia/Manila",
  TPE: "Asia/Taipei",
  RMQ: "Asia/Taipei",
  KHH: "Asia/Taipei",
  CAN: "Asia/Shanghai",
  PVG: "Asia/Shanghai",
  PKX: "Asia/Shanghai",
  HGH: "Asia/Shanghai",
  KWL: "Asia/Shanghai",
  ENH: "Asia/Shanghai",
  TXN: "Asia/Shanghai",
  // Korea
  ICN: "Asia/Seoul",
  PUS: "Asia/Seoul",
  // Japan
  NRT: "Asia/Tokyo",
  HND: "Asia/Tokyo",
  KIX: "Asia/Tokyo",
  NGO: "Asia/Tokyo",
  FSZ: "Asia/Tokyo",
  FUK: "Asia/Tokyo",
  HIJ: "Asia/Tokyo",
  // Russia (Asia)
  OVB: "Asia/Novosibirsk",
  KJA: "Asia/Krasnoyarsk",
  NOZ: "Asia/Krasnoyarsk",
  KHV: "Asia/Vladivostok",
  // Australia (DST applies)
  SYD: "Australia/Sydney",
  MEL: "Australia/Melbourne",
  // India
  BOM: "Asia/Kolkata",
  DEL: "Asia/Kolkata",
  AMD: "Asia/Kolkata",
};

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
 * instant. Two-pass refinement handles DST transitions: the first pass uses
 * the offset at the naive UTC guess; the second pass uses the offset at the
 * refined UTC. For non-DST zones (most of Asia) one pass would suffice.
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

// ---------------------------------------------------------------------------
// Static-offset fallback (kept for back-compat with existing callers/tests).
// ---------------------------------------------------------------------------

const VN_DEFAULT_UTC_OFFSET_HOURS = 7;

const AIRPORT_UTC_OFFSETS: Record<string, number> = {
  HAN: 7, SGN: 7, DAD: 7, CXR: 7, PQC: 7, VCL: 7, VCS: 7, BMV: 7, HUI: 7,
  HPH: 7, VCA: 7, UIH: 7, VKG: 7, VDH: 7, DLI: 7, VDO: 7, THD: 7, DIN: 7,
  TBB: 7, PXU: 7, VII: 7,
  BKK: 7, HKT: 7,
  CGK: 7, DPS: 8,
  VTE: 7,
  OVB: 7, KJA: 7, NOZ: 7, KHV: 10,
  SIN: 8, KUL: 8, HKG: 8, MFM: 8, MNL: 8, CEB: 8,
  TPE: 8, RMQ: 8, KHH: 8,
  CAN: 8, PVG: 8, PKX: 8, HGH: 8, KWL: 8, ENH: 8, TXN: 8,
  ICN: 9, PUS: 9, NRT: 9, HND: 9, KIX: 9, NGO: 9, FSZ: 9, FUK: 9, HIJ: 9,
  SYD: 10, MEL: 10,
  BOM: 5.5, DEL: 5.5, AMD: 5.5,
};

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
