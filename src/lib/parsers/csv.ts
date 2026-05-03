import Papa from "papaparse";
import * as XLSX from "xlsx";
import type {
  Aircraft,
  DisruptionEvent,
  DisruptionType,
  FlightLeg,
  Severity,
} from "@/lib/types";
import { getAirportTimezone, localToUtc } from "@/lib/engine/time-utils";

// ---------------------------------------------------------------------------
// Issue model — per-row, per-column error reporting (Sprint 5 hardening)
// ---------------------------------------------------------------------------

export type IssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: IssueLevel;
  message: string;
  /** 1-based source row number including the header (header is row 1). */
  row?: number;
  column?: string;
  value?: string;
  /** Logical dataset the issue belongs to. */
  source?: "schedule" | "aircraft" | "disruption" | "dataset";
}

export interface ParseResult<T> {
  data: T[];
  issues: ValidationIssue[];
}

const DISRUPTION_TYPES: DisruptionType[] = [
  "AOG",
  "AIRPORT_CLOSE",
  "WEATHER",
  "LATE_ARRIVAL",
];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const AIRCRAFT_STATUSES = ["ACTIVE", "AOG", "MAINTENANCE", "STORED"] as const;

const SCHEDULE_REQUIRED = [
  "flight_id",
  "flight_number",
  "origin",
  "destination",
  "std",
  "sta",
  "aircraft_id",
] as const;

const AIRCRAFT_REQUIRED = [
  "aircraft_id",
  "aircraft_type",
  "current_station",
  "available_from",
] as const;

const DISRUPTION_REQUIRED = [
  "event_id",
  "event_type",
  "start_time",
  "end_time",
] as const;

const OPTIONAL_PASSENGER_FIELDS = [
  "seat_capacity",
  "booked_passengers",
  "connecting_passengers",
  "vip_passengers",
  "special_service_passengers",
] as const;

type OptionalPassengerField = (typeof OPTIONAL_PASSENGER_FIELDS)[number];

const OPTIONAL_CREW_FIELDS = ["captain", "first_officer"] as const;

type OptionalCrewField = (typeof OPTIONAL_CREW_FIELDS)[number];

export interface ScheduleQualityReport {
  flight_count: number;
  passenger_field_counts: Record<OptionalPassengerField, number>;
  flights_with_any_passenger_data: number;
  flights_missing_passenger_data: number;
  using_load_factor_fallback: number;
}

// ---------------------------------------------------------------------------
// Low-level parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date/time value. If the string has an explicit timezone (Z or +HH:MM),
 * it is respected. Otherwise the datetime is treated as UTC.
 * For schedule STD/STA which are local station times, use parseLocalDateTime()
 * + localToUtc() instead.
 */
function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date — naive conversion (days since 1899-12-30 UTC).
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + value * 86400000);
  }
  if (typeof value === "string" && value.trim()) {
    const v = value.trim();
    const isoNaive =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v);
    const d = new Date(isoNaive ? `${v}Z` : v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new Error(`Cannot parse date: ${String(value)}`);
}

/**
 * Extract calendar date + clock time components from a datetime string
 * WITHOUT any timezone assumption. Returns {year, month, day, hour, minute}
 * for use with localToUtc(). Supports:
 *   - "2026-04-28T07:00:00"   (ISO without tz)
 *   - "2026-04-28T07:00:00Z"  (Z is stripped — caller provides the real tz)
 *   - "2026-04-28T07:00"      (no seconds)
 *   - "2026-04-28 07:00:00"   (space separator)
 */
interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseLocalDateTime(value: unknown): LocalDateTime | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/Z$/i, ""); // strip Z — we use the airport tz
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
}

function parseDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["true", "1", "yes", "y"].includes(
    String(value).trim().toLowerCase(),
  );
}

function parseOptionalNonNegativeInteger(
  row: Record<string, unknown>,
  field: OptionalPassengerField,
  rowNum: number,
  issues: ValidationIssue[],
): number | undefined {
  const raw = row[field];
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    issues.push({
      level: "warning",
      message: `${field} is not a non-negative integer — ignoring value`,
      row: rowNum,
      column: field,
      value: String(raw),
      source: "schedule",
    });
    return undefined;
  }
  return n;
}

function parseOptionalPassengerFields(
  row: Record<string, unknown>,
  rowNum: number,
  issues: ValidationIssue[],
): Partial<Pick<FlightLeg, OptionalPassengerField>> {
  const parsed: Partial<Pick<FlightLeg, OptionalPassengerField>> = {};
  for (const field of OPTIONAL_PASSENGER_FIELDS) {
    const value = parseOptionalNonNegativeInteger(row, field, rowNum, issues);
    if (value !== undefined) parsed[field] = value;
  }
  return parsed;
}

function parseOptionalCrewFields(
  row: Record<string, unknown>,
): Partial<Pick<FlightLeg, OptionalCrewField>> {
  const parsed: Partial<Pick<FlightLeg, OptionalCrewField>> = {};
  for (const field of OPTIONAL_CREW_FIELDS) {
    const raw = row[field];
    const value = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (value) parsed[field] = value;
  }
  return parsed;
}

function parseOptionalActualTimes(
  row: Record<string, unknown>,
): Pick<FlightLeg, "actual_departure_time" | "actual_arrival_time"> {
  return {
    actual_departure_time: parseDateOrNull(
      row.actual_departure_time ?? row.atd,
    ) ?? undefined,
    actual_arrival_time: parseDateOrNull(
      row.actual_arrival_time ?? row.ata,
    ) ?? undefined,
  };
}

const IATA_RE = /^[A-Z]{3}$/;

function pushAirportIssue(
  issues: ValidationIssue[],
  row: number,
  column: string,
  value: string,
  source: ValidationIssue["source"],
) {
  if (!value) return;
  if (!IATA_RE.test(value)) {
    issues.push({
      level: "warning",
      message: `'${value}' is not a 3-letter IATA airport code (uppercase A-Z)`,
      row,
      column,
      value,
      source,
    });
  }
}

function checkRequiredHeaders(
  rows: ParsedRows,
  required: readonly string[],
  source: ValidationIssue["source"],
): ValidationIssue[] {
  if (rows.length === 0) return [];
  const headers = new Set(Object.keys(rows[0] ?? {}).map((h) => h.trim()));
  const missing = required.filter((c) => !headers.has(c));
  if (missing.length === 0) return [];
  return [
    {
      level: "error",
      message: `Missing required column(s): ${missing.join(", ")}`,
      row: 1,
      source,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API: file parsing
// ---------------------------------------------------------------------------

export type ParsedRows = Record<string, unknown>[];

export async function parseCsvOrXlsx(file: File | Blob): Promise<ParsedRows> {
  const name = "name" in file ? (file as File).name.toLowerCase() : "";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  }
  const text = await file.text();
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return result.data as ParsedRows;
}

// ---------------------------------------------------------------------------
// Per-dataset parsers — collect issues, never throw on bad rows
// ---------------------------------------------------------------------------

export function parseScheduleRows(rows: ParsedRows): ParseResult<FlightLeg> {
  const issues = checkRequiredHeaders(rows, SCHEDULE_REQUIRED, "schedule");
  if (issues.some((i) => i.level === "error")) {
    return { data: [], issues };
  }
  const data: FlightLeg[] = [];
  rows.forEach((r, idx) => {
    const row = idx + 2; // header is row 1
    if (!r.flight_id) {
      // Silent skip for blank rows; flag if any other required field is set.
      const hasOther =
        r.flight_number || r.origin || r.destination || r.std || r.sta;
      if (hasOther) {
        issues.push({
          level: "error",
          message: "Row missing flight_id",
          row,
          column: "flight_id",
          source: "schedule",
        });
      }
      return;
    }

    // Row-level rejection: rows that fail any of these checks are dropped.
    let rowBad = false;

    const origin = String(r.origin ?? "").trim();
    const destination = String(r.destination ?? "").trim();
    if (origin && !IATA_RE.test(origin)) {
      issues.push({
        level: "error",
        message: `'${origin}' is not a 3-letter IATA airport code (uppercase A-Z)`,
        row,
        column: "origin",
        value: origin,
        source: "schedule",
      });
      rowBad = true;
    }
    if (destination && !IATA_RE.test(destination)) {
      issues.push({
        level: "error",
        message: `'${destination}' is not a 3-letter IATA airport code (uppercase A-Z)`,
        row,
        column: "destination",
        value: destination,
        source: "schedule",
      });
      rowBad = true;
    }
    if (rowBad) return;

    // -----------------------------------------------------------------------
    // STD/STA are LOCAL station times:
    //   - STD is local at ORIGIN
    //   - STA is local at DESTINATION
    // We convert both to true UTC using the airport's IANA timezone.
    // If the value already has an explicit Z or +offset, parseLocalDateTime
    // strips it — the airport timezone is authoritative for schedule files.
    // -----------------------------------------------------------------------
    const stdLocal = parseLocalDateTime(r.std);
    if (!stdLocal) {
      issues.push({
        level: "error",
        message: `Cannot parse std — expected format: 2026-04-28T07:00:00 (local time at origin)`,
        row,
        column: "std",
        value: String(r.std ?? ""),
        source: "schedule",
      });
      return;
    }
    const staLocal = parseLocalDateTime(r.sta);
    if (!staLocal) {
      issues.push({
        level: "error",
        message: `Cannot parse sta — expected format: 2026-04-28T09:10:00 (local time at destination)`,
        row,
        column: "sta",
        value: String(r.sta ?? ""),
        source: "schedule",
      });
      return;
    }

    const originTz = getAirportTimezone(origin);
    const destTz = getAirportTimezone(destination);

    const std = localToUtc(
      stdLocal.year, stdLocal.month, stdLocal.day,
      stdLocal.hour, stdLocal.minute, originTz,
    );

    // Overnight flights: if STA clock time < STD clock time AND dates are
    // the same, the arrival is the next day at the destination.
    let sta: Date;
    const stdMinOfDay = stdLocal.hour * 60 + stdLocal.minute;
    const staMinOfDay = staLocal.hour * 60 + staLocal.minute;
    const sameDate = stdLocal.year === staLocal.year &&
      stdLocal.month === staLocal.month && stdLocal.day === staLocal.day;

    if (sameDate && staMinOfDay < stdMinOfDay) {
      // Overnight: advance STA date by 1 day
      const next = new Date(Date.UTC(staLocal.year, staLocal.month - 1, staLocal.day + 1));
      sta = localToUtc(
        next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(),
        staLocal.hour, staLocal.minute, destTz,
      );
    } else {
      sta = localToUtc(
        staLocal.year, staLocal.month, staLocal.day,
        staLocal.hour, staLocal.minute, destTz,
      );
    }

    if (sta <= std) {
      issues.push({
        level: "error",
        message: `STA (${sta.toISOString()}) must be after STD (${std.toISOString()}) after local→UTC conversion`,
        row,
        column: "sta",
        value: String(r.sta ?? ""),
        source: "schedule",
      });
      return;
    }

    const priorityRaw = r.priority_level ?? 3;
    const priority = Number(priorityRaw);
    if (Number.isNaN(priority)) {
      issues.push({
        level: "error",
        message: "priority_level is not numeric",
        row,
        column: "priority_level",
        value: String(priorityRaw),
        source: "schedule",
      });
      return;
    }

    const loadFactor = Number(r.load_factor ?? 0);
    if (Number.isNaN(loadFactor)) {
      issues.push({
        level: "warning",
        message: "load_factor is not numeric — defaulting to 0",
        row,
        column: "load_factor",
        value: String(r.load_factor ?? ""),
        source: "schedule",
      });
    }

    const passengerFields = parseOptionalPassengerFields(r, row, issues);
    const crewFields = parseOptionalCrewFields(r);
    const actualTimes = parseOptionalActualTimes(r);

    data.push({
      flight_id: String(r.flight_id),
      flight_number: String(r.flight_number ?? ""),
      origin,
      destination,
      std,
      sta,
      aircraft_id: String(r.aircraft_id ?? ""),
      aircraft_type: String(r.aircraft_type ?? ""),
      priority_level: Number.isFinite(priority) ? priority : 3,
      load_factor: Number.isFinite(loadFactor) ? loadFactor : 0,
      is_international: parseBool(r.is_international),
      is_last_flight_of_day: parseBool(r.is_last_flight_of_day),
      ...passengerFields,
      ...crewFields,
      ...actualTimes,
    });
  });
  return { data, issues };
}

export function parseAircraftRows(rows: ParsedRows): ParseResult<Aircraft> {
  const issues = checkRequiredHeaders(rows, AIRCRAFT_REQUIRED, "aircraft");
  if (issues.some((i) => i.level === "error")) {
    return { data: [], issues };
  }
  const data: Aircraft[] = [];
  const seen = new Set<string>();
  rows.forEach((r, idx) => {
    const row = idx + 2;
    if (!r.aircraft_id) {
      const hasOther = r.aircraft_type || r.current_station || r.available_from;
      if (hasOther) {
        issues.push({
          level: "error",
          message: "Row missing aircraft_id",
          row,
          column: "aircraft_id",
          source: "aircraft",
        });
      }
      return;
    }

    const id = String(r.aircraft_id);
    if (seen.has(id)) {
      issues.push({
        level: "error",
        message: `Duplicate aircraft_id '${id}'`,
        row,
        column: "aircraft_id",
        value: id,
        source: "aircraft",
      });
      return;
    }
    seen.add(id);

    let availableFrom: Date;
    try {
      availableFrom = parseDate(r.available_from);
    } catch {
      issues.push({
        level: "error",
        message: "Cannot parse available_from (use ISO 8601)",
        row,
        column: "available_from",
        value: String(r.available_from ?? ""),
        source: "aircraft",
      });
      return;
    }

    const station = String(r.current_station ?? "").trim();
    pushAirportIssue(issues, row, "current_station", station, "aircraft");

    const status = String(r.status ?? "ACTIVE").trim().toUpperCase();
    if (!(AIRCRAFT_STATUSES as readonly string[]).includes(status)) {
      issues.push({
        level: "warning",
        message: `Unknown status '${status}' (expected one of ${AIRCRAFT_STATUSES.join(", ")})`,
        row,
        column: "status",
        value: status,
        source: "aircraft",
      });
    }

    data.push({
      aircraft_id: id,
      aircraft_type: String(r.aircraft_type ?? ""),
      current_station: station,
      available_from: availableFrom,
      status,
      next_maintenance_time: parseDateOrNull(r.next_maintenance_time),
      restriction: r.restriction ? String(r.restriction) : null,
    });
  });
  return { data, issues };
}

export function parseDisruptionRows(
  rows: ParsedRows,
): ParseResult<DisruptionEvent> {
  const issues = checkRequiredHeaders(rows, DISRUPTION_REQUIRED, "disruption");
  if (issues.some((i) => i.level === "error")) {
    return { data: [], issues };
  }
  const data: DisruptionEvent[] = [];
  rows.forEach((r, idx) => {
    const row = idx + 2;
    if (!r.event_id) {
      const hasOther = r.event_type || r.start_time || r.end_time;
      if (hasOther) {
        issues.push({
          level: "error",
          message: "Row missing event_id",
          row,
          column: "event_id",
          source: "disruption",
        });
      }
      return;
    }

    const eventType = String(r.event_type ?? "").trim().toUpperCase();
    if (!(DISRUPTION_TYPES as readonly string[]).includes(eventType)) {
      issues.push({
        level: "error",
        message: `Unknown event_type '${eventType}' (expected ${DISRUPTION_TYPES.join(", ")})`,
        row,
        column: "event_type",
        value: eventType,
        source: "disruption",
      });
      return;
    }

    let startTime: Date;
    let endTime: Date;
    try {
      startTime = parseDate(r.start_time);
    } catch {
      issues.push({
        level: "error",
        message: "Cannot parse start_time (use ISO 8601)",
        row,
        column: "start_time",
        value: String(r.start_time ?? ""),
        source: "disruption",
      });
      return;
    }
    try {
      endTime = parseDate(r.end_time);
    } catch {
      issues.push({
        level: "error",
        message: "Cannot parse end_time (use ISO 8601)",
        row,
        column: "end_time",
        value: String(r.end_time ?? ""),
        source: "disruption",
      });
      return;
    }
    if (endTime <= startTime) {
      issues.push({
        level: "error",
        message: "end_time must be strictly after start_time",
        row,
        column: "end_time",
        value: String(r.end_time ?? ""),
        source: "disruption",
      });
      return;
    }

    const severityRaw = String(r.severity ?? "MEDIUM").trim().toUpperCase();
    const severity: Severity = (SEVERITIES as readonly string[]).includes(
      severityRaw,
    )
      ? (severityRaw as Severity)
      : "MEDIUM";
    if (severity !== severityRaw) {
      issues.push({
        level: "warning",
        message: `Unknown severity '${severityRaw}' — defaulting to MEDIUM`,
        row,
        column: "severity",
        value: severityRaw,
        source: "disruption",
      });
    }

    const airport = r.affected_airport ? String(r.affected_airport).trim() : "";
    if (airport) pushAirportIssue(issues, row, "affected_airport", airport, "disruption");

    data.push({
      event_id: String(r.event_id),
      event_type: eventType as DisruptionType,
      affected_aircraft: r.affected_aircraft
        ? String(r.affected_aircraft)
        : null,
      affected_airport: airport || null,
      affected_flight_id: r.affected_flight_id
        ? String(r.affected_flight_id)
        : null,
      start_time: startTime,
      end_time: endTime,
      severity,
      description: String(r.description ?? ""),
    });
  });
  return { data, issues };
}

// ---------------------------------------------------------------------------
// Backwards-compatible thin wrappers (existing callers still work)
// ---------------------------------------------------------------------------

export function rowsToSchedule(rows: ParsedRows): FlightLeg[] {
  return parseScheduleRows(rows).data;
}

export function rowsToAircraft(rows: ParsedRows): Aircraft[] {
  return parseAircraftRows(rows).data;
}

export function rowsToDisruption(rows: ParsedRows): DisruptionEvent {
  const { data, issues } = parseDisruptionRows(rows);
  if (data[0]) return data[0];
  const firstError = issues.find((i) => i.level === "error");
  throw new Error(
    firstError
      ? `${firstError.message}${firstError.row ? ` (row ${firstError.row}${firstError.column ? `, column ${firstError.column}` : ""})` : ""}`
      : "No disruption event row found",
  );
}

// ---------------------------------------------------------------------------
// Cross-dataset validation (FK + timing + load factor sanity)
// ---------------------------------------------------------------------------

export function validateDataset(input: {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const aircraftIds = new Set(input.aircraft.map((a) => a.aircraft_id));
  const flightIds = new Set<string>();
  for (const f of input.schedule) {
    if (flightIds.has(f.flight_id)) {
      issues.push({
        level: "error",
        message: `Duplicate flight_id '${f.flight_id}'`,
        column: "flight_id",
        value: f.flight_id,
        source: "schedule",
      });
    }
    flightIds.add(f.flight_id);

    if (!aircraftIds.has(f.aircraft_id)) {
      issues.push({
        level: "error",
        message: `Flight ${f.flight_number} (${f.flight_id}) references unknown aircraft '${f.aircraft_id}'`,
        column: "aircraft_id",
        value: f.aircraft_id,
        source: "dataset",
      });
    }
    // Note: row-level sta<=std check now lives in parseScheduleRows so the
    // bad row is dropped from the imported set; this defensive guard keeps
    // the cross-dataset path consistent if FlightLeg objects come from
    // somewhere other than parseScheduleRows.
    if (f.sta <= f.std) {
      issues.push({
        level: "error",
        message: `Flight ${f.flight_number}: STA (${f.sta.toISOString()}) must be after STD (${f.std.toISOString()})`,
        column: "sta",
        source: "dataset",
      });
    }
    if (f.load_factor < 0 || f.load_factor > 1) {
      issues.push({
        level: "warning",
        message: `Flight ${f.flight_number}: load_factor ${f.load_factor} outside [0,1]`,
        column: "load_factor",
        value: String(f.load_factor),
        source: "dataset",
      });
    }
    if (
      typeof f.seat_capacity === "number" &&
      typeof f.booked_passengers === "number" &&
      f.booked_passengers > f.seat_capacity
    ) {
      issues.push({
        level: "warning",
        message: `Flight ${f.flight_number}: booked_passengers ${f.booked_passengers} exceeds seat_capacity ${f.seat_capacity}`,
        column: "booked_passengers",
        value: String(f.booked_passengers),
        source: "dataset",
      });
    }
    if (
      typeof f.seat_capacity === "number" &&
      f.seat_capacity > 0 &&
      typeof f.booked_passengers === "number" &&
      f.load_factor >= 0 &&
      f.load_factor <= 1
    ) {
      const inferredLoadFactor = f.booked_passengers / f.seat_capacity;
      if (Math.abs(inferredLoadFactor - f.load_factor) > 0.15) {
        issues.push({
          level: "warning",
          message: `Flight ${f.flight_number}: booked_passengers/seat_capacity implies ${(inferredLoadFactor * 100).toFixed(0)}% load factor, but load_factor is ${(f.load_factor * 100).toFixed(0)}%`,
          column: "load_factor",
          value: String(f.load_factor),
          source: "dataset",
        });
      }
    }
    for (const [column, value] of [
      ["connecting_passengers", f.connecting_passengers],
      ["vip_passengers", f.vip_passengers],
      ["special_service_passengers", f.special_service_passengers],
    ] as const) {
      if (
        typeof value === "number" &&
        typeof f.booked_passengers === "number" &&
        value > f.booked_passengers
      ) {
        issues.push({
          level: "warning",
          message: `Flight ${f.flight_number}: ${column} ${value} exceeds booked_passengers ${f.booked_passengers}`,
          column,
          value: String(value),
          source: "dataset",
        });
      }
    }
  }
  return issues;
}

export function summarizeScheduleQuality(
  schedule: FlightLeg[],
): ScheduleQualityReport {
  const passenger_field_counts: Record<OptionalPassengerField, number> = {
    seat_capacity: 0,
    booked_passengers: 0,
    connecting_passengers: 0,
    vip_passengers: 0,
    special_service_passengers: 0,
  };
  let flightsWithAnyPassengerData = 0;

  for (const f of schedule) {
    let hasAnyPassengerData = false;
    for (const field of OPTIONAL_PASSENGER_FIELDS) {
      if (typeof f[field] === "number") {
        passenger_field_counts[field] += 1;
        hasAnyPassengerData = true;
      }
    }
    if (hasAnyPassengerData) flightsWithAnyPassengerData += 1;
  }

  return {
    flight_count: schedule.length,
    passenger_field_counts,
    flights_with_any_passenger_data: flightsWithAnyPassengerData,
    flights_missing_passenger_data: schedule.length - flightsWithAnyPassengerData,
    using_load_factor_fallback:
      schedule.length - passenger_field_counts.booked_passengers,
  };
}

// ---------------------------------------------------------------------------
// Templates — used by /dashboard/data "Download template" buttons
// ---------------------------------------------------------------------------

export const TEMPLATE_SCHEDULE_CSV =
  "flight_id,flight_number,origin,destination,std,sta,aircraft_id,aircraft_type,priority_level,load_factor,is_international,is_last_flight_of_day,seat_capacity,booked_passengers,connecting_passengers,vip_passengers,special_service_passengers,captain,first_officer,actual_departure_time,actual_arrival_time\n" +
  "FL001,VJ100,SGN,HAN,2026-04-28T07:00:00Z,2026-04-28T09:10:00Z,VJ-A321,A321,1,0.91,false,false,230,209,24,2,3,CAPT A,FO A,,\n";

export const TEMPLATE_AIRCRAFT_CSV =
  "aircraft_id,aircraft_type,current_station,available_from,status,next_maintenance_time,restriction\n" +
  "VJ-A321,A321,SGN,2026-04-28T06:00:00Z,ACTIVE,2026-04-29T04:00:00Z,\n";

export const TEMPLATE_DISRUPTION_CSV =
  "event_id,event_type,affected_aircraft,affected_airport,affected_flight_id,start_time,end_time,severity,description\n" +
  "EVT-AOG-001,AOG,VJ-A321,,FL003,2026-04-28T12:10:00Z,2026-04-28T16:00:00Z,HIGH,AOG VJ-A321 estimated release 16:00Z\n";
