import * as XLSX from "xlsx";
import type { Aircraft, FlightLeg } from "@/lib/types";
import type { ValidationIssue } from "@/lib/parsers/csv";
import { getAirportTimezone, localToUtc } from "@/lib/engine/time-utils";

// ---------------------------------------------------------------------------
// AIMS DayRepReport ingestion
// ---------------------------------------------------------------------------
//
// The AIMS "Daily Flight Schedule Report" XLSX is the canonical Vietjet/VN
// operational schedule export. Layout (as of Apr 2026):
//
//   row 0..4 : title block ("Daily Flight Schedule Report (DD/MM/YYYY-...)")
//   row 5    : header row — DATE | FLT | REG | (blank) | AC | DEP | ARR |
//              STD | STA | ETD | ETA | TKof | TDwn | ATD | ATA | Crew # | Crew
//   row 6..N : data rows
//   trailer  : "Total Record(s): N", "Generated on ..."
//
// STD is local time at origin (DEP); STA is local time at destination (ARR).
// We resolve both to true UTC via the airport→IANA-tz map in `time-utils`,
// so engine math (turnaround, curfew check) is correct even on cross-tz legs
// (e.g. HAN→ICN, where origin is UTC+7 and destination is UTC+9).

const AIMS_HEADER_SIGNATURE = [
  "DATE",
  "FLT",
  "REG",
  "",
  "AC",
  "DEP",
  "ARR",
  "STD",
  "STA",
];
const HEADER_ROW_INDEX = 5;

export interface AimsParseResult {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  issues: ValidationIssue[];
  /** Tracking flag the UI uses to badge "Detected AIMS DayRep". */
  detectedFormat: "aims_dayrep" | null;
}

/**
 * True when the workbook's first sheet looks like an AIMS DayRepReport (matches
 * the canonical header at row index 5).
 */
export function looksLikeAimsDayRep(matrix: unknown[][]): boolean {
  const header = matrix[HEADER_ROW_INDEX];
  if (!Array.isArray(header)) return false;
  return AIMS_HEADER_SIGNATURE.every(
    (cell, i) => String(header[i] ?? "").trim() === cell,
  );
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

interface ParsedAimsDate {
  iso: string;
  year: number;
  month: number;
  day: number;
}

function parseAimsDate(value: string): ParsedAimsDate | null {
  // "DD/MM/YY" → "20YY-MM-DD"
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = 2000 + Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  return { iso, year, month, day };
}

/** Advance a Y-M-D triple by `days` days, returning the new triple. */
function addDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function parseHHMM(value: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

function aircraftTypeFromCode(code: string): string {
  const t = code.trim();
  if (!t) return "";
  // AIMS reports "320", "321", "330" — promote to "A320" / "A321" / "A330".
  if (/^\d{3}$/.test(t)) return `A${t}`;
  return t;
}

function isInternationalRoute(origin: string, destination: string): boolean {
  // Heuristic: VN domestic IATA codes start with V/H/D/S/B/U/T (HAN, SGN, DAD,
  // VCA, VCS, etc). Non-VN airports in this report (NRT, ICN, HKG, KWL, RMQ,
  // KHH, HGH, OVB, PUS, VTE) are caught by exclusion of the known VN set.
  const VN = new Set([
    "HAN", "SGN", "DAD", "CXR", "PQC", "VCL", "VCS", "BMV", "HUI", "HPH",
    "VCA", "UIH", "VKG", "VDH", "DLI", "VDO", "THD", "DIN", "TBB", "PXU",
    "VII",
  ]);
  return !VN.has(origin) || !VN.has(destination);
}

interface RowOut {
  flight: FlightLeg;
  reg: string;
  acType: string;
}

function buildRow(
  raw: unknown[],
  rowNum: number,
  issues: ValidationIssue[],
): RowOut | null {
  const date = String(raw[0] ?? "").trim();
  const flt = String(raw[1] ?? "").trim();
  const reg = String(raw[2] ?? "").trim();
  const ac = String(raw[4] ?? "").trim();
  const dep = String(raw[5] ?? "").trim();
  const arr = String(raw[6] ?? "").trim();
  const std = String(raw[7] ?? "").trim();
  const sta = String(raw[8] ?? "").trim();

  // Trailer rows ("Total Record(s): 325", "Generated on ..."): skip silently.
  if (!flt || !reg) return null;

  const d = parseAimsDate(date);
  if (!d) {
    issues.push({
      level: "error",
      message: "Cannot parse DATE (expected DD/MM/YY)",
      row: rowNum,
      column: "DATE",
      value: date,
      source: "schedule",
    });
    return null;
  }
  const stdT = parseHHMM(std);
  const staT = parseHHMM(sta);
  if (!stdT) {
    issues.push({
      level: "error",
      message: "Cannot parse STD (expected HH:MM)",
      row: rowNum,
      column: "STD",
      value: std,
      source: "schedule",
    });
    return null;
  }
  if (!staT) {
    issues.push({
      level: "error",
      message: "Cannot parse STA (expected HH:MM)",
      row: rowNum,
      column: "STA",
      value: sta,
      source: "schedule",
    });
    return null;
  }

  // STD is local at origin; STA is local at destination. Resolve both to true
  // UTC via the airport→IANA-tz map so engine math works on cross-tz legs.
  const originTz = getAirportTimezone(dep);
  const destTz = getAirportTimezone(arr);
  const stdDate = localToUtc(d.year, d.month, d.day, stdT.h, stdT.m, originTz);

  // Overnight flights: when STA's displayed clock at the destination is
  // earlier than STD's displayed clock at the origin, AIMS prints the arrival
  // on the next destination-local day.
  const stdMin = stdT.h * 60 + stdT.m;
  const staMin = staT.h * 60 + staT.m;
  const staDate =
    staMin < stdMin
      ? (() => {
          const n = addDays(d.year, d.month, d.day, 1);
          return localToUtc(n.year, n.month, n.day, staT.h, staT.m, destTz);
        })()
      : localToUtc(d.year, d.month, d.day, staT.h, staT.m, destTz);

  const acType = aircraftTypeFromCode(ac);
  // Include origin so round-trip pairings that reuse the same flight number
  // on the same aircraft on the same day (e.g. flight 5068 HAN→CXR + 5068
  // CXR→HAN) get distinct flight_ids. Pure ${date}-${flt}-${reg} collides.
  const flightId = `${d.iso}-${flt}-${reg}-${dep}`;

  return {
    reg,
    acType,
    flight: {
      flight_id: flightId,
      flight_number: flt,
      origin: dep,
      destination: arr,
      std: stdDate,
      sta: staDate,
      aircraft_id: reg,
      aircraft_type: acType,
      priority_level: 3,
      load_factor: 0,
      is_international: isInternationalRoute(dep, arr),
      is_last_flight_of_day: false,
    },
  };
}

/**
 * Parse an AIMS DayRepReport matrix into schedule + derived aircraft inventory.
 * Aircraft inventory is reconstructed from unique REGs: `current_station` =
 * first DEP of the day, `available_from` = earliest STD on the day. Status is
 * defaulted to ACTIVE — the AIMS DayRep does not carry AOG/maintenance state.
 */
export function parseAimsDayRep(matrix: unknown[][]): AimsParseResult {
  const issues: ValidationIssue[] = [];
  const schedule: FlightLeg[] = [];
  if (!looksLikeAimsDayRep(matrix)) {
    return { schedule: [], aircraft: [], issues, detectedFormat: null };
  }
  for (let i = HEADER_ROW_INDEX + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    const out = buildRow(row, i + 1, issues);
    if (out) schedule.push(out.flight);
  }

  // Mark last flight of the day per aircraft (used by priority_rules).
  const byAircraft = new Map<string, FlightLeg[]>();
  for (const f of schedule) {
    if (!byAircraft.has(f.aircraft_id)) byAircraft.set(f.aircraft_id, []);
    byAircraft.get(f.aircraft_id)!.push(f);
  }
  for (const legs of byAircraft.values()) {
    legs.sort((a, b) => a.std.getTime() - b.std.getTime());
    if (legs.length > 0) legs[legs.length - 1].is_last_flight_of_day = true;
  }

  // Derive aircraft inventory.
  const aircraft: Aircraft[] = [];
  for (const [reg, legs] of byAircraft.entries()) {
    if (legs.length === 0) continue;
    const first = legs[0];
    aircraft.push({
      aircraft_id: reg,
      aircraft_type: first.aircraft_type,
      current_station: first.origin,
      available_from: first.std,
      status: "ACTIVE",
      next_maintenance_time: null,
      restriction: null,
    });
  }
  aircraft.sort((a, b) => a.aircraft_id.localeCompare(b.aircraft_id));

  return { schedule, aircraft, issues, detectedFormat: "aims_dayrep" };
}

/**
 * Loads an AIMS DayRepReport workbook and returns canonical schedule +
 * derived aircraft inventory. Returns `null` when the workbook does not match
 * the AIMS layout (so the caller can fall back to generic CSV/XLSX parsing).
 */
export async function tryParseAimsWorkbook(
  file: File | Blob,
): Promise<AimsParseResult | null> {
  const name = "name" in file ? (file as File).name.toLowerCase() : "";
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) return null;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  if (wb.SheetNames.length === 0) return null;
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    defval: "",
    header: 1,
    raw: false,
  });
  if (!looksLikeAimsDayRep(matrix)) return null;
  return parseAimsDayRep(matrix);
}
