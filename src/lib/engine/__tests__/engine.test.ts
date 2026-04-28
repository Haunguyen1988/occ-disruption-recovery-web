import { describe, it, expect } from "vitest";
import { runSimulation, findImpactedFlights } from "@/lib/engine";
import { decodeMetar, evaluateMetar } from "@/lib/decoders/metar";
import { decodeNotam } from "@/lib/decoders/notam";
import { getDefaultRules } from "@/lib/parsers/rules";
import type { Aircraft, DisruptionEvent, FlightLeg } from "@/lib/types";

const RULES = getDefaultRules();

const SCHEDULE: FlightLeg[] = [
  {
    flight_id: "VJ101-D1",
    flight_number: "VJ101",
    origin: "SGN",
    destination: "HAN",
    std: new Date("2026-04-28T01:00:00Z"),
    sta: new Date("2026-04-28T03:00:00Z"),
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: 2,
    load_factor: 0.85,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "VJ102-D1",
    flight_number: "VJ102",
    origin: "HAN",
    destination: "SGN",
    std: new Date("2026-04-28T04:00:00Z"),
    sta: new Date("2026-04-28T06:00:00Z"),
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: 2,
    load_factor: 0.78,
    is_international: false,
    is_last_flight_of_day: false,
  },
  {
    flight_id: "VJ103-D1",
    flight_number: "VJ103",
    origin: "SGN",
    destination: "PQC",
    std: new Date("2026-04-28T12:00:00Z"),
    sta: new Date("2026-04-28T13:30:00Z"),
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    priority_level: 3,
    load_factor: 0.6,
    is_international: false,
    is_last_flight_of_day: true,
  },
];

const AIRCRAFT: Aircraft[] = [
  {
    aircraft_id: "VJ-A321",
    aircraft_type: "A321",
    current_station: "SGN",
    available_from: new Date("2026-04-28T00:00:00Z"),
    status: "AOG",
    next_maintenance_time: null,
    restriction: null,
  },
  {
    aircraft_id: "VJ-A324",
    aircraft_type: "A321",
    current_station: "SGN",
    available_from: new Date("2026-04-28T00:00:00Z"),
    status: "ACTIVE",
    next_maintenance_time: null,
    restriction: null,
  },
];

const AOG: DisruptionEvent = {
  event_id: "EVT-AOG",
  event_type: "AOG",
  start_time: new Date("2026-04-28T01:30:00Z"),
  end_time: new Date("2026-04-28T03:30:00Z"),
  severity: "HIGH",
  description: "Hydraulic system failure",
  affected_aircraft: "VJ-A321",
  affected_airport: null,
  affected_flight_id: null,
};

describe("impact detector (K1 fix)", () => {
  it("flags flight overlapping AOG window", () => {
    const impacted = findImpactedFlights(AOG, SCHEDULE, RULES);
    const ids = impacted.map((i) => i.flight.flight_id);
    expect(ids).toContain("VJ101-D1"); // overlaps
    expect(ids).toContain("VJ102-D1"); // downstream
  });

  it("flags later flights as downstream impacted", () => {
    const impacted = findImpactedFlights(AOG, SCHEDULE, RULES);
    const ids = impacted.map((i) => i.flight.flight_id);
    expect(ids).toContain("VJ103-D1"); // also same rotation
  });
});

describe("simulation pipeline", () => {
  it("produces ranked options including SINGLE_SWAP candidate", () => {
    const result = runSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruption: AOG,
      rules: RULES,
    });
    expect(result.ranked_options.length).toBeGreaterThan(0);
    expect(result.ranked_options[0].rank).toBe(1);
    const types = result.ranked_options.map((o) => o.option_type);
    expect(types).toContain("DELAY_ONLY");
    expect(types).toContain("SINGLE_SWAP");
  });

  it("DELAY_ONLY only propagates to impacted aircraft (K2 fix)", () => {
    // Add a second-aircraft rotation that shouldn't be touched
    const extendedSchedule: FlightLeg[] = [
      ...SCHEDULE,
      {
        flight_id: "VJ900-D1",
        flight_number: "VJ900",
        origin: "DAD",
        destination: "SGN",
        std: new Date("2026-04-28T01:30:00Z"),
        sta: new Date("2026-04-28T03:00:00Z"),
        aircraft_id: "VJ-A324",
        aircraft_type: "A321",
        priority_level: 3,
        load_factor: 0.6,
        is_international: false,
        is_last_flight_of_day: false,
      },
    ];
    const result = runSimulation({
      schedule: extendedSchedule,
      aircraft: AIRCRAFT,
      disruption: AOG,
      rules: RULES,
    });
    const delayOpt = result.ranked_options.find(
      (o) => o.option_type === "DELAY_ONLY",
    );
    expect(delayOpt).toBeTruthy();
    const touchedAircraft = new Set(
      delayOpt!.flight_changes.map((c) => c.original_aircraft),
    );
    expect(touchedAircraft.has("VJ-A321")).toBe(true);
    expect(touchedAircraft.has("VJ-A324")).toBe(false);
  });
});

describe("METAR decoder", () => {
  it("flags low visibility", () => {
    const m = decodeMetar(
      "METAR VVTS 281030Z 18012KT 0500 FG SCT002 OVC005 24/24 Q1009",
    );
    expect(m.visibility_m).toBe(500);
    const alerts = evaluateMetar(m);
    expect(alerts.some((a) => a.code === "LOW_VIS")).toBe(true);
    expect(alerts.some((a) => a.code === "FG")).toBe(true);
  });

  it("recognises CAVOK", () => {
    const m = decodeMetar("METAR VVNB 281100Z 09005KT CAVOK 28/22 Q1012");
    expect(m.cavok).toBe(true);
    expect(m.visibility_m).toBe(10000);
  });
});

describe("NOTAM decoder", () => {
  it("classifies runway closure", () => {
    const n = decodeNotam(
      "A1234/24\nQ) VVHM/QMRLC/IV/NBO/A/000/999/1049N10637E005\nA) VVTS B) 2604281200 C) 2604281800\nE) RWY 07L/25R CLOSED",
    );
    expect(n.q_code).toBe("QMRLC");
    expect(n.airport).toBe("VVTS");
    expect(n.category).toBe("RUNWAY_CLOSED");
  });
});
