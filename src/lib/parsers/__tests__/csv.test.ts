import { describe, it, expect } from "vitest";
import {
  parseAircraftRows,
  parseDisruptionRows,
  parseScheduleRows,
  rowsToDisruption,
  validateDataset,
} from "@/lib/parsers/csv";

describe("parseScheduleRows", () => {
  const goodRow = {
    flight_id: "FL001",
    flight_number: "VJ100",
    origin: "SGN",
    destination: "HAN",
    std: "2026-04-28T07:00:00Z",
    sta: "2026-04-28T09:10:00Z",
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: "1",
    load_factor: "0.91",
    is_international: "false",
    is_last_flight_of_day: "false",
  };

  it("parses a clean row with no issues", () => {
    const r = parseScheduleRows([goodRow]);
    expect(r.data).toHaveLength(1);
    expect(r.issues).toHaveLength(0);
  });

  it("flags missing required headers as a single error on row 1", () => {
    const incomplete = { flight_id: "FL001", flight_number: "VJ100" };
    const r = parseScheduleRows([incomplete]);
    expect(r.data).toHaveLength(0);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].level).toBe("error");
    expect(r.issues[0].row).toBe(1);
    expect(r.issues[0].message).toMatch(/Missing required column/);
  });

  it("collects per-row date parse errors with row + column + value", () => {
    const r = parseScheduleRows([goodRow, { ...goodRow, flight_id: "FL002", std: "not-a-date" }]);
    expect(r.data).toHaveLength(1); // FL002 dropped
    const err = r.issues.find((i) => i.column === "std");
    expect(err).toBeDefined();
    expect(err?.level).toBe("error");
    expect(err?.row).toBe(3); // header is 1, FL001 is 2, FL002 is 3
    expect(err?.value).toBe("not-a-date");
  });

  it("rejects lowercase / 4-letter airport codes (IATA check) and drops the row", () => {
    const r = parseScheduleRows([
      goodRow,
      { ...goodRow, flight_id: "FL002", origin: "sgn" },
      { ...goodRow, flight_id: "FL003", destination: "ABCD" },
    ]);
    expect(r.data.map((d) => d.flight_id)).toEqual(["FL001"]);
    const errors = r.issues.filter((i) => i.level === "error");
    expect(errors.some((e) => e.column === "origin" && e.value === "sgn")).toBe(true);
    expect(errors.some((e) => e.column === "destination" && e.value === "ABCD")).toBe(true);
  });

  it("rejects sta <= std at row level and drops the row", () => {
    const r = parseScheduleRows([
      goodRow,
      {
        ...goodRow,
        flight_id: "FL002",
        std: "2026-04-28T09:00:00Z",
        sta: "2026-04-28T08:00:00Z",
      },
    ]);
    expect(r.data.map((d) => d.flight_id)).toEqual(["FL001"]);
    const err = r.issues.find((i) => i.column === "sta" && i.row === 3);
    expect(err?.level).toBe("error");
    expect(err?.message).toMatch(/must be after STD/);
  });

  it("rejects non-numeric priority_level and drops the row", () => {
    const r = parseScheduleRows([
      goodRow,
      { ...goodRow, flight_id: "FL002", priority_level: "not-a-number" },
    ]);
    expect(r.data.map((d) => d.flight_id)).toEqual(["FL001"]);
    const err = r.issues.find((i) => i.column === "priority_level");
    expect(err?.level).toBe("error");
    expect(err?.value).toBe("not-a-number");
  });

  it("does not block the whole file on one bad row", () => {
    const r = parseScheduleRows([
      goodRow,
      { ...goodRow, flight_id: "FL002", std: "" },
      { ...goodRow, flight_id: "FL003" },
    ]);
    expect(r.data.map((d) => d.flight_id)).toEqual(["FL001", "FL003"]);
  });

  it("matches the UAT broken-schedule fixture: 4 BAD rows dropped, 2 OK rows kept", () => {
    // Mirror of public/uat/uat_scenario_broken_schedule.csv — anchors the
    // smoke-test expectation that preview = save set (no \"imported with
    // warnings\" middle state).
    const rows = [
      { ...goodRow, flight_id: "UAT-OK-001", flight_number: "VJ900" },
      { ...goodRow, flight_id: "UAT-BAD-001", flight_number: "VJ901", origin: "sgn" },
      { ...goodRow, flight_id: "UAT-BAD-002", flight_number: "VJ902", std: "not-a-date" },
      {
        ...goodRow,
        flight_id: "UAT-BAD-003",
        flight_number: "VJ903",
        std: "2026-04-28T09:00:00Z",
        sta: "2026-04-28T08:00:00Z",
      },
      {
        ...goodRow,
        flight_id: "UAT-BAD-004",
        flight_number: "VJ904",
        priority_level: "not-a-number",
      },
      { ...goodRow, flight_id: "UAT-OK-002", flight_number: "VJ905" },
    ];
    const r = parseScheduleRows(rows);
    expect(r.data.map((d) => d.flight_id)).toEqual(["UAT-OK-001", "UAT-OK-002"]);
    const errors = r.issues.filter((i) => i.level === "error");
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("parseAircraftRows", () => {
  const goodRow = {
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    current_station: "SGN",
    available_from: "2026-04-28T06:00:00Z",
    status: "ACTIVE",
    next_maintenance_time: "",
    restriction: "",
  };

  it("flags duplicate aircraft_id", () => {
    const r = parseAircraftRows([goodRow, { ...goodRow }]);
    expect(r.data).toHaveLength(1);
    const dup = r.issues.find((i) => i.message.includes("Duplicate"));
    expect(dup?.level).toBe("error");
    expect(dup?.row).toBe(3);
  });

  it("warns on unknown status", () => {
    const r = parseAircraftRows([{ ...goodRow, status: "RETIRED" }]);
    expect(r.data).toHaveLength(1);
    const warn = r.issues.find((i) => i.column === "status");
    expect(warn?.level).toBe("warning");
    expect(warn?.value).toBe("RETIRED");
  });

  it("skips rows missing aircraft_id silently when nothing else set", () => {
    const r = parseAircraftRows([goodRow, { aircraft_id: "", aircraft_type: "", current_station: "", available_from: "" }]);
    expect(r.data).toHaveLength(1);
    expect(r.issues).toHaveLength(0);
  });
});

describe("parseDisruptionRows", () => {
  const goodRow = {
    event_id: "EVT-001",
    event_type: "AOG",
    affected_aircraft: "VJ-A321",
    affected_airport: "",
    affected_flight_id: "FL003",
    start_time: "2026-04-28T12:10:00Z",
    end_time: "2026-04-28T16:00:00Z",
    severity: "HIGH",
    description: "test",
  };

  it("rejects unknown event_type", () => {
    const r = parseDisruptionRows([{ ...goodRow, event_type: "BIRD_STRIKE" }]);
    expect(r.data).toHaveLength(0);
    const err = r.issues.find((i) => i.column === "event_type");
    expect(err?.level).toBe("error");
    expect(err?.value).toBe("BIRD_STRIKE");
  });

  it("rejects end_time <= start_time", () => {
    const r = parseDisruptionRows([
      { ...goodRow, start_time: "2026-04-28T16:00:00Z", end_time: "2026-04-28T12:00:00Z" },
    ]);
    expect(r.data).toHaveLength(0);
    expect(r.issues.some((i) => i.message.match(/end_time/))).toBe(true);
  });

  it("defaults unknown severity to MEDIUM with warning", () => {
    const r = parseDisruptionRows([{ ...goodRow, severity: "EXTREME" }]);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].severity).toBe("MEDIUM");
    expect(r.issues.find((i) => i.column === "severity")?.level).toBe("warning");
  });
});

describe("rowsToDisruption (legacy throw API)", () => {
  it("throws with row + column when payload is invalid", () => {
    expect(() =>
      rowsToDisruption([
        {
          event_id: "EVT-1",
          event_type: "BIRD_STRIKE",
          start_time: "2026-04-28T12:10:00Z",
          end_time: "2026-04-28T16:00:00Z",
        },
      ]),
    ).toThrowError(/event_type/);
  });
});

describe("validateDataset", () => {
  const ac = {
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    current_station: "SGN",
    available_from: new Date("2026-04-28T06:00:00Z"),
    status: "ACTIVE",
    next_maintenance_time: null,
    restriction: null,
  };
  const flight = {
    flight_id: "FL001",
    flight_number: "VJ100",
    origin: "SGN",
    destination: "HAN",
    std: new Date("2026-04-28T07:00:00Z"),
    sta: new Date("2026-04-28T09:10:00Z"),
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: 1,
    load_factor: 0.9,
    is_international: false,
    is_last_flight_of_day: false,
  };

  it("flags FK violation", () => {
    const issues = validateDataset({
      schedule: [{ ...flight, aircraft_id: "VJ-UNKNOWN" }],
      aircraft: [ac],
    });
    expect(issues.some((i) => i.message.includes("unknown aircraft"))).toBe(true);
  });

  it("flags STA <= STD", () => {
    const issues = validateDataset({
      schedule: [{ ...flight, sta: flight.std }],
      aircraft: [ac],
    });
    expect(issues.some((i) => i.message.includes("after STD"))).toBe(true);
  });

  it("flags duplicate flight_id", () => {
    const issues = validateDataset({
      schedule: [flight, flight],
      aircraft: [ac],
    });
    expect(issues.some((i) => i.message.includes("Duplicate"))).toBe(true);
  });
});
