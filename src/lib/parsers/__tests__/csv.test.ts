import { describe, it, expect } from "vitest";
import {
  parseAircraftRows,
  parseDisruptionRows,
  parseScheduleRows,
  rowsToDisruption,
  summarizeScheduleQuality,
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

  it("parses optional passenger fields when present", () => {
    const r = parseScheduleRows([
      {
        ...goodRow,
        seat_capacity: "230",
        booked_passengers: "209",
        connecting_passengers: "24",
        vip_passengers: "2",
        special_service_passengers: "3",
      },
    ]);
    expect(r.issues).toHaveLength(0);
    expect(r.data[0]).toMatchObject({
      seat_capacity: 230,
      booked_passengers: 209,
      connecting_passengers: 24,
      vip_passengers: 2,
      special_service_passengers: 3,
    });
  });

  it("parses optional crew pairing fields when present", () => {
    const r = parseScheduleRows([
      {
        ...goodRow,
        captain: " CAPT A ",
        first_officer: " FO A ",
      },
    ]);

    expect(r.issues).toHaveLength(0);
    expect(r.data[0]).toMatchObject({
      captain: "CAPT A",
      first_officer: "FO A",
    });
  });

  it("parses optional actual movement times when present", () => {
    const r = parseScheduleRows([
      {
        ...goodRow,
        atd: "2026-04-28T07:05:00Z",
        ata: "2026-04-28T09:08:00Z",
      },
    ]);

    expect(r.issues).toHaveLength(0);
    expect(r.data[0].actual_departure_time?.toISOString()).toBe(
      "2026-04-28T07:05:00.000Z",
    );
    expect(r.data[0].actual_arrival_time?.toISOString()).toBe(
      "2026-04-28T09:08:00.000Z",
    );
  });

  it("warns and ignores invalid optional passenger fields", () => {
    const r = parseScheduleRows([
      {
        ...goodRow,
        seat_capacity: "230.5",
        booked_passengers: "-1",
      },
    ]);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].seat_capacity).toBeUndefined();
    expect(r.data[0].booked_passengers).toBeUndefined();
    expect(r.issues.filter((i) => i.level === "warning")).toHaveLength(2);
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
        origin: "SGN",
        destination: "HAN",
        std: "2026-04-28T14:00:00",
        sta: "2026-04-28T14:00:00",
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
    const rows = [
      { ...goodRow, flight_id: "UAT-OK-001", flight_number: "VJ900" },
      { ...goodRow, flight_id: "UAT-BAD-001", flight_number: "VJ901", origin: "sgn" },
      { ...goodRow, flight_id: "UAT-BAD-002", flight_number: "VJ902", std: "not-a-date" },
      {
        ...goodRow,
        flight_id: "UAT-BAD-003",
        flight_number: "VJ903",
        origin: "SGN",
        destination: "HAN",
        std: "2026-04-28T14:00:00",
        sta: "2026-04-28T14:00:00",
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

  it("warns when passenger counts conflict with capacity or booked passengers", () => {
    const issues = validateDataset({
      schedule: [
        {
          ...flight,
          seat_capacity: 180,
          booked_passengers: 190,
          connecting_passengers: 200,
          vip_passengers: 191,
          special_service_passengers: 192,
        },
      ],
      aircraft: [ac],
    });
    expect(
      issues.some((i) => i.message.includes("exceeds seat_capacity")),
    ).toBe(true);
    expect(
      issues.filter((i) => i.message.includes("exceeds booked_passengers")),
    ).toHaveLength(3);
  });

  it("warns when passenger counts imply a very different load factor", () => {
    const issues = validateDataset({
      schedule: [
        {
          ...flight,
          seat_capacity: 200,
          booked_passengers: 80,
          load_factor: 0.9,
        },
      ],
      aircraft: [ac],
    });
    expect(
      issues.some((i) => i.message.includes("implies 40% load factor")),
    ).toBe(true);
  });

  it("summarizes passenger coverage for import quality", () => {
    const report = summarizeScheduleQuality([
      {
        ...flight,
        seat_capacity: 200,
        booked_passengers: 180,
        connecting_passengers: 20,
      },
      { ...flight, flight_id: "FL002", flight_number: "VJ101" },
    ]);
    expect(report.flight_count).toBe(2);
    expect(report.flights_with_any_passenger_data).toBe(1);
    expect(report.flights_missing_passenger_data).toBe(1);
    expect(report.using_load_factor_fallback).toBe(1);
    expect(report.passenger_field_counts.booked_passengers).toBe(1);
  });
});
