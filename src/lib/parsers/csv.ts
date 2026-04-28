import Papa from "papaparse";
import * as XLSX from "xlsx";
import type {
  Aircraft,
  DisruptionEvent,
  DisruptionType,
  FlightLeg,
  Severity,
} from "@/lib/types";

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    // Excel serial date — naive conversion
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + value * 86400000);
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new Error(`Cannot parse date: ${String(value)}`);
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

export function rowsToSchedule(rows: ParsedRows): FlightLeg[] {
  return rows
    .filter((r) => r.flight_id)
    .map((r) => ({
      flight_id: String(r.flight_id),
      flight_number: String(r.flight_number ?? ""),
      origin: String(r.origin ?? ""),
      destination: String(r.destination ?? ""),
      std: parseDate(r.std),
      sta: parseDate(r.sta),
      aircraft_id: String(r.aircraft_id ?? ""),
      aircraft_type: String(r.aircraft_type ?? ""),
      priority_level: Number(r.priority_level ?? 3) || 3,
      load_factor: Number(r.load_factor ?? 0) || 0,
      is_international: parseBool(r.is_international),
      is_last_flight_of_day: parseBool(r.is_last_flight_of_day),
    }));
}

export function rowsToAircraft(rows: ParsedRows): Aircraft[] {
  return rows
    .filter((r) => r.aircraft_id)
    .map((r) => ({
      aircraft_id: String(r.aircraft_id),
      aircraft_type: String(r.aircraft_type ?? ""),
      current_station: String(r.current_station ?? ""),
      available_from: parseDate(r.available_from),
      status: String(r.status ?? "ACTIVE"),
      next_maintenance_time: parseDateOrNull(r.next_maintenance_time),
      restriction: r.restriction ? String(r.restriction) : null,
    }));
}

export function rowsToDisruption(rows: ParsedRows): DisruptionEvent {
  const r = rows.find((row) => row.event_id);
  if (!r) throw new Error("No disruption event row found");
  return {
    event_id: String(r.event_id),
    event_type: String(r.event_type) as DisruptionType,
    affected_aircraft: r.affected_aircraft ? String(r.affected_aircraft) : null,
    affected_airport: r.affected_airport ? String(r.affected_airport) : null,
    affected_flight_id: r.affected_flight_id
      ? String(r.affected_flight_id)
      : null,
    start_time: parseDate(r.start_time),
    end_time: parseDate(r.end_time),
    severity: String(r.severity ?? "MEDIUM") as Severity,
    description: String(r.description ?? ""),
  };
}

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

export function validateDataset(input: {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const aircraftIds = new Set(input.aircraft.map((a) => a.aircraft_id));
  for (const f of input.schedule) {
    if (!aircraftIds.has(f.aircraft_id)) {
      issues.push({
        level: "error",
        message: `Flight ${f.flight_number} (${f.flight_id}) references unknown aircraft ${f.aircraft_id}`,
      });
    }
    if (f.sta <= f.std) {
      issues.push({
        level: "error",
        message: `Flight ${f.flight_number}: STA (${f.sta.toISOString()}) <= STD (${f.std.toISOString()})`,
      });
    }
    if (f.load_factor < 0 || f.load_factor > 1) {
      issues.push({
        level: "warning",
        message: `Flight ${f.flight_number}: load_factor ${f.load_factor} outside [0,1]`,
      });
    }
  }
  return issues;
}
