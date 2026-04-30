/**
 * Tests for getProjectedStation — the critical fix that derives aircraft
 * position from schedule rotation instead of static CSV current_station.
 */
import { describe, it, expect } from "vitest";
import { getProjectedStation } from "@/lib/engine/candidate-finder";
import { buildScheduleIndex } from "@/lib/engine/schedule-index";
import type { FlightLeg } from "@/lib/types";

function d(s: string): Date {
  return new Date(s);
}

const schedule: FlightLeg[] = [
  {
    flight_id: "FL001", flight_number: "VJ100", origin: "SGN", destination: "HAN",
    std: d("2026-04-28T00:00:00Z"), sta: d("2026-04-28T02:10:00Z"),
    aircraft_id: "VJ-A321", aircraft_type: "A321",
    priority_level: 1, load_factor: 0.91, is_international: false, is_last_flight_of_day: false,
  },
  {
    flight_id: "FL002", flight_number: "VJ101", origin: "HAN", destination: "DAD",
    std: d("2026-04-28T03:00:00Z"), sta: d("2026-04-28T04:20:00Z"),
    aircraft_id: "VJ-A321", aircraft_type: "A321",
    priority_level: 2, load_factor: 0.88, is_international: false, is_last_flight_of_day: false,
  },
  {
    flight_id: "FL003", flight_number: "VJ102", origin: "DAD", destination: "SGN",
    std: d("2026-04-28T05:30:00Z"), sta: d("2026-04-28T06:50:00Z"),
    aircraft_id: "VJ-A321", aircraft_type: "A321",
    priority_level: 2, load_factor: 0.80, is_international: false, is_last_flight_of_day: false,
  },
  // VJ-A324 reserve: SGN → HAN early morning, then sits at HAN
  {
    flight_id: "FL010", flight_number: "VJ500", origin: "SGN", destination: "HAN",
    std: d("2026-04-28T01:00:00Z"), sta: d("2026-04-28T03:10:00Z"),
    aircraft_id: "VJ-A324", aircraft_type: "A321",
    priority_level: 3, load_factor: 0.65, is_international: false, is_last_flight_of_day: false,
  },
];

const index = buildScheduleIndex(schedule);

describe("getProjectedStation", () => {
  it("should return CSV fallback when aircraft has no flights before atTime", () => {
    // Before VJ-A321's first flight departs
    const station = getProjectedStation(
      "VJ-A321",
      d("2026-04-27T23:00:00Z"),
      index,
      "SGN",
    );
    expect(station).toBe("SGN"); // fallback to CSV
  });

  it("should return destination of last landed flight", () => {
    // After VJ-A321 landed at HAN (STA 02:10), before next departure (03:00)
    const station = getProjectedStation(
      "VJ-A321",
      d("2026-04-28T02:30:00Z"),
      index,
      "SGN",
    );
    expect(station).toBe("HAN"); // landed at HAN
  });

  it("should return correct station after second leg", () => {
    // After VJ-A321 flew HAN→DAD (STA 04:20)
    const station = getProjectedStation(
      "VJ-A321",
      d("2026-04-28T04:30:00Z"),
      index,
      "SGN",
    );
    expect(station).toBe("DAD"); // landed at DAD
  });

  it("should return correct station after full rotation", () => {
    // After VJ-A321 flew DAD→SGN (STA 06:50)
    const station = getProjectedStation(
      "VJ-A321",
      d("2026-04-28T07:00:00Z"),
      index,
      "SGN",
    );
    expect(station).toBe("SGN"); // back at SGN
  });

  it("should track reserve aircraft that repositioned", () => {
    // VJ-A324 flew SGN→HAN, landed at 03:10. At 05:00 it should be at HAN.
    const station = getProjectedStation(
      "VJ-A324",
      d("2026-04-28T05:00:00Z"),
      index,
      "SGN",
    );
    expect(station).toBe("HAN"); // CSV says SGN, but schedule says HAN!
  });

  it("should use CSV fallback for aircraft not in schedule", () => {
    const station = getProjectedStation(
      "VJ-UNKNOWN",
      d("2026-04-28T05:00:00Z"),
      index,
      "PQC",
    );
    expect(station).toBe("PQC"); // no schedule → CSV fallback
  });
});
