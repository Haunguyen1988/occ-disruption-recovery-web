import { describe, expect, it } from "vitest";
import { getDefaultRules } from "@/lib/parsers/rules";
import type { DisruptionEvent, FlightLeg } from "@/lib/types";
import { analyzeMultiEventConflicts } from "../event-conflicts";

const rules = getDefaultRules();

const schedule: FlightLeg[] = [
  {
    flight_id: "F1",
    flight_number: "VJ101",
    origin: "SGN",
    destination: "HAN",
    std: new Date("2026-04-28T01:00:00Z"),
    sta: new Date("2026-04-28T03:00:00Z"),
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: 2,
    load_factor: 0.9,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "F2",
    flight_number: "VJ102",
    origin: "HAN",
    destination: "SGN",
    std: new Date("2026-04-28T04:00:00Z"),
    sta: new Date("2026-04-28T06:00:00Z"),
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: 1,
    load_factor: 0.7,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "F3",
    flight_number: "VJ201",
    origin: "DAD",
    destination: "CXR",
    std: new Date("2026-04-28T10:00:00Z"),
    sta: new Date("2026-04-28T11:00:00Z"),
    aircraft_id: "VJ-A322",
    aircraft_type: "A321",
    priority_level: 1,
    load_factor: 0.6,
    is_international: false,
    is_last_flight_of_day: false,
  },
];

const aog: DisruptionEvent = {
  event_id: "EVT-AOG",
  event_type: "AOG",
  start_time: new Date("2026-04-28T01:30:00Z"),
  end_time: new Date("2026-04-28T03:30:00Z"),
  severity: "HIGH",
  description: "AOG on VJ-A321",
  affected_aircraft: "VJ-A321",
  affected_airport: null,
  affected_flight_id: null,
};

describe("multi-event conflict analysis", () => {
  it("detects tightly coupled events on the same aircraft rotation", () => {
    const lateArrival: DisruptionEvent = {
      event_id: "EVT-LATE",
      event_type: "LATE_ARRIVAL",
      start_time: new Date("2026-04-28T02:00:00Z"),
      end_time: new Date("2026-04-28T04:00:00Z"),
      severity: "MEDIUM",
      description: "Late inbound",
      affected_aircraft: null,
      affected_airport: null,
      affected_flight_id: "F1",
    };

    const analysis = analyzeMultiEventConflicts({
      events: [aog, lateArrival],
      schedule,
      rules,
    });

    expect(analysis.conflicts).toHaveLength(1);
    expect(analysis.conflicts[0].shared_aircraft).toContain("VJ-A321");
    expect(analysis.conflicts[0].level).toMatch(/HIGH|CRITICAL/);
    expect(analysis.coupled_event_count).toBe(2);
  });

  it("keeps separated events out of coupled groups", () => {
    const dadClosure: DisruptionEvent = {
      event_id: "EVT-DAD",
      event_type: "AIRPORT_CLOSE",
      start_time: new Date("2026-04-28T12:00:00Z"),
      end_time: new Date("2026-04-28T13:00:00Z"),
      severity: "LOW",
      description: "DAD closure after bank",
      affected_aircraft: null,
      affected_airport: "DAD",
      affected_flight_id: null,
    };

    const analysis = analyzeMultiEventConflicts({
      events: [aog, dadClosure],
      schedule,
      rules,
    });

    expect(analysis.conflicts).toHaveLength(0);
    expect(analysis.groups).toHaveLength(0);
    expect(analysis.coupled_event_count).toBe(0);
  });

  it("summarizes airport window pressure", () => {
    const sgnWeather: DisruptionEvent = {
      event_id: "EVT-SGN",
      event_type: "WEATHER",
      start_time: new Date("2026-04-28T00:30:00Z"),
      end_time: new Date("2026-04-28T02:30:00Z"),
      severity: "HIGH",
      description: "SGN weather",
      affected_aircraft: null,
      affected_airport: "SGN",
      affected_flight_id: null,
    };

    const analysis = analyzeMultiEventConflicts({
      events: [sgnWeather],
      schedule,
      rules,
    });

    expect(analysis.event_summaries[0].airport_window_flight_count).toBe(1);
    expect(analysis.event_summaries[0].impacted_flight_count).toBe(1);
    expect(analysis.network_exposure_score).toBeGreaterThan(0);
  });
});
