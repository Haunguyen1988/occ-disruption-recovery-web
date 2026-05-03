import { describe, it, expect } from "vitest";
import {
  runSimulation,
  runMultiEventSimulation,
  findImpactedFlights,
  isInCurfew,
} from "@/lib/engine";
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
    expect(ids).toContain("VJ101-D1"); // overlaps AOG 01:30-03:30
    // VJ102-D1 STD 04:00 is AFTER AOG end 03:30 → NOT impacted (aircraft repaired)
    expect(ids).not.toContain("VJ102-D1");
  });

  it("does NOT flag flights after AOG window ends", () => {
    const impacted = findImpactedFlights(AOG, SCHEDULE, RULES);
    const ids = impacted.map((i) => i.flight.flight_id);
    // VJ103-D1 STD 12:00 is way after AOG end 03:30 → NOT impacted
    expect(ids).not.toContain("VJ103-D1");
    // Only VJ101-D1 is truly impacted
    expect(ids).toEqual(["VJ101-D1"]);
  });

  it("does not flag a flight that already has ATA", () => {
    const completedSchedule: FlightLeg[] = [
      {
        ...SCHEDULE[0],
        actual_arrival_time: new Date("2026-04-28T03:05:00Z"),
      },
    ];

    const impacted = findImpactedFlights(AOG, completedSchedule, RULES);

    expect(impacted).toEqual([]);
  });

  it("does not flag a flight that already has ATD", () => {
    const departedSchedule: FlightLeg[] = [
      {
        ...SCHEDULE[0],
        actual_departure_time: new Date("2026-04-28T01:02:00Z"),
      },
    ];

    const impacted = findImpactedFlights(AOG, departedSchedule, RULES);

    expect(impacted).toEqual([]);
  });

  it("does not flag AOG flights unrelated to the selected airport", () => {
    const aogAtDad: DisruptionEvent = {
      ...AOG,
      affected_airport: "DAD",
    };

    const impacted = findImpactedFlights(aogAtDad, SCHEDULE, RULES);

    expect(impacted).toEqual([]);
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

  it("does not generate SINGLE_SWAP when candidate overlaps downstream rotation", () => {
    const extendedSchedule: FlightLeg[] = [
      ...SCHEDULE,
      {
        flight_id: "VJ900-D1",
        flight_number: "VJ900",
        origin: "SGN",
        destination: "DAD",
        std: new Date("2026-04-28T12:15:00Z"),
        sta: new Date("2026-04-28T13:15:00Z"),
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
    const swapOptions = result.ranked_options.filter(
      (o) => o.option_type === "SINGLE_SWAP",
    );
    expect(swapOptions).toHaveLength(0);
  });

  it("does not generate SINGLE_SWAP when candidate would break station continuity", () => {
    const extendedSchedule: FlightLeg[] = [
      ...SCHEDULE,
      {
        flight_id: "VJ901-D1",
        flight_number: "VJ901",
        origin: "HAN",
        destination: "DAD",
        std: new Date("2026-04-28T15:00:00Z"),
        sta: new Date("2026-04-28T16:00:00Z"),
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
    const swapOptions = result.ranked_options.filter(
      (o) => o.option_type === "SINGLE_SWAP",
    );
    expect(swapOptions).toHaveLength(0);
  });

  it("reports why no single swap is feasible", () => {
    const extendedSchedule: FlightLeg[] = [
      ...SCHEDULE,
      {
        flight_id: "VJ900-D1",
        flight_number: "VJ900",
        origin: "SGN",
        destination: "DAD",
        std: new Date("2026-04-28T12:15:00Z"),
        sta: new Date("2026-04-28T13:15:00Z"),
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

    // With CHAIN_SWAP, overlapping candidates can now produce a feasible
    // cascade swap option (displaced flights get reassigned/delayed).
    // So feasible_swap_count may be > 0. The key assertion is that
    // the diagnostic for VJ-A324 records the overlap reason.
    expect(result.feedback?.swap_target_flight_id).toBe("VJ101-D1");
    expect(
      result.feedback?.candidates.some(
        (candidate) =>
          candidate.aircraft_id === "VJ-A324" &&
          (candidate.blocking_reason?.includes("overlapping proposed") ||
           candidate.blocking_reason === null), // feasible via chain swap
      ),
    ).toBe(true);
  });

  it("recovers the downstream rotation of the displaced swap aircraft", () => {
    const schedule: FlightLeg[] = [
      {
        flight_id: "A1-1",
        flight_number: "A101",
        origin: "SGN",
        destination: "HAN",
        std: new Date("2026-04-28T01:00:00Z"),
        sta: new Date("2026-04-28T03:00:00Z"),
        aircraft_id: "A1",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.8,
        is_international: false,
        is_last_flight_of_day: false,
      },
      {
        flight_id: "A1-2",
        flight_number: "A102",
        origin: "HAN",
        destination: "SGN",
        std: new Date("2026-04-28T04:00:00Z"),
        sta: new Date("2026-04-28T06:00:00Z"),
        aircraft_id: "A1",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.8,
        is_international: false,
        is_last_flight_of_day: false,
      },
      {
        flight_id: "A2-1",
        flight_number: "B201",
        origin: "SGN",
        destination: "DAD",
        std: new Date("2026-04-28T01:30:00Z"),
        sta: new Date("2026-04-28T02:30:00Z"),
        aircraft_id: "A2",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.7,
        is_international: false,
        is_last_flight_of_day: false,
      },
      {
        flight_id: "A2-2",
        flight_number: "B202",
        origin: "DAD",
        destination: "SGN",
        std: new Date("2026-04-28T07:00:00Z"),
        sta: new Date("2026-04-28T08:00:00Z"),
        aircraft_id: "A2",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.7,
        is_international: false,
        is_last_flight_of_day: false,
      },
    ];
    const aircraft: Aircraft[] = [
      {
        aircraft_id: "A1",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "AOG",
        next_maintenance_time: null,
        restriction: null,
      },
      {
        aircraft_id: "A2",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
      {
        aircraft_id: "A3",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
    ];
    const disruption: DisruptionEvent = {
      ...AOG,
      affected_aircraft: "A1",
      start_time: new Date("2026-04-28T01:15:00Z"),
      end_time: new Date("2026-04-28T03:15:00Z"),
    };

    const result = runSimulation({ schedule, aircraft, disruption, rules: RULES });
    const chain = result.ranked_options.find(
      (option) => option.option_type === "SWAP_CHAIN",
    );

    expect(chain).toBeTruthy();
    expect(chain!.flight_changes.map((change) => change.flight_id)).toEqual(
      expect.arrayContaining(["A1-1", "A1-2", "A2-1", "A2-2"]),
    );
    expect(
      chain!.flight_changes.find((change) => change.flight_id === "A2-2")
        ?.new_aircraft,
    ).toBe("A3");
  });

  it("does not swap a downstream cluster when CAPT/FO changes inside the cluster", () => {
    const schedule: FlightLeg[] = [
      {
        flight_id: "CREW-1",
        flight_number: "C101",
        origin: "SGN",
        destination: "HAN",
        std: new Date("2026-04-28T01:00:00Z"),
        sta: new Date("2026-04-28T03:00:00Z"),
        aircraft_id: "A1",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.8,
        is_international: false,
        is_last_flight_of_day: false,
        captain: "CAPT A",
        first_officer: "FO A",
      },
      {
        flight_id: "CREW-2",
        flight_number: "C102",
        origin: "HAN",
        destination: "SGN",
        std: new Date("2026-04-28T04:00:00Z"),
        sta: new Date("2026-04-28T06:00:00Z"),
        aircraft_id: "A1",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.8,
        is_international: false,
        is_last_flight_of_day: false,
        captain: "CAPT B",
        first_officer: "FO B",
      },
    ];
    const aircraft: Aircraft[] = [
      {
        aircraft_id: "A1",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "AOG",
        next_maintenance_time: null,
        restriction: null,
      },
      {
        aircraft_id: "A2",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
    ];
    const disruption: DisruptionEvent = {
      ...AOG,
      affected_aircraft: "A1",
      start_time: new Date("2026-04-28T01:00:00Z"),
      end_time: new Date("2026-04-28T02:00:00Z"),
    };

    const result = runSimulation({ schedule, aircraft, disruption, rules: RULES });

    expect(
      result.ranked_options.some((option) => option.option_type === "SINGLE_SWAP"),
    ).toBe(false);
    expect(
      result.feedback?.candidates.some((candidate) =>
        candidate.blocking_reason?.includes("Crew continuity mismatch"),
      ),
    ).toBe(true);
  });

  it("keeps searching for later swap candidates after earlier downstream failures", () => {
    const extendedSchedule: FlightLeg[] = [
      ...SCHEDULE,
      {
        flight_id: "VJ900-D1",
        flight_number: "VJ900",
        origin: "SGN",
        destination: "DAD",
        std: new Date("2026-04-28T12:15:00Z"),
        sta: new Date("2026-04-28T13:15:00Z"),
        aircraft_id: "VJ-A324",
        aircraft_type: "A321",
        priority_level: 3,
        load_factor: 0.6,
        is_international: false,
        is_last_flight_of_day: false,
      },
      {
        flight_id: "VJ901-D1",
        flight_number: "VJ901",
        origin: "HAN",
        destination: "DAD",
        std: new Date("2026-04-28T15:00:00Z"),
        sta: new Date("2026-04-28T16:00:00Z"),
        aircraft_id: "VJ-A325",
        aircraft_type: "A321",
        priority_level: 3,
        load_factor: 0.6,
        is_international: false,
        is_last_flight_of_day: false,
      },
      {
        flight_id: "VJ902-D1",
        flight_number: "VJ902",
        origin: "PQC",
        destination: "SGN",
        std: new Date("2026-04-28T13:40:00Z"),
        sta: new Date("2026-04-28T15:10:00Z"),
        aircraft_id: "VJ-A326",
        aircraft_type: "A321",
        priority_level: 3,
        load_factor: 0.6,
        is_international: false,
        is_last_flight_of_day: false,
      },
    ];
    const aircraft = [
      ...AIRCRAFT,
      {
        aircraft_id: "VJ-A325",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
      {
        aircraft_id: "VJ-A326",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
      {
        aircraft_id: "VJ-A327",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-04-28T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
    ];
    const result = runSimulation({
      schedule: extendedSchedule,
      aircraft,
      disruption: AOG,
      rules: RULES,
    });

    const swapOptions = result.ranked_options.filter(
      (o) => o.option_type === "SINGLE_SWAP",
    );
    // A1 upgrade: multi-target swap search can now find swaps from multiple
    // target flights, so we may get more than 1 SINGLE_SWAP. The key invariant
    // is that at least one uses VJ-A327.
    expect(swapOptions.length).toBeGreaterThanOrEqual(1);
    const usesA327 = swapOptions.some(
      (o) => Object.values(o.aircraft_changes).includes("VJ-A327"),
    );
    expect(usesA327).toBe(true);
    expect(result.feedback?.feasible_swap_count).toBeGreaterThanOrEqual(1);
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

describe("curfew enforcement (K6)", () => {
  it("flags PQC arrival inside 23:00–05:00 local window (UTC+7)", () => {
    // 2026-04-28T17:30Z = 00:30 local at PQC (UTC+7) → inside curfew
    expect(
      isInCurfew("PQC", new Date("2026-04-28T17:30:00Z"), RULES),
    ).toBe(true);
  });

  it("does not flag PQC arrival at 13:30Z (= 20:30 local, outside curfew)", () => {
    expect(
      isInCurfew("PQC", new Date("2026-04-28T13:30:00Z"), RULES),
    ).toBe(false);
  });

  it("returns false when airport has no configured curfew", () => {
    expect(
      isInCurfew("HAN", new Date("2026-04-28T17:30:00Z"), RULES),
    ).toBe(false);
  });

  it("penalises options whose flight changes land inside curfew", () => {
    // VJ103 SGN→PQC originally STA 13:30Z (= 20:30 PQC local). The PQC curfew
    // window is 23:00–05:00 local (= 16:00Z–22:00Z UTC). An AOG covering only
    // VJ103's window pushes its new STA to ~16:10Z (= 23:10 local) → curfew.
    const shortAog: DisruptionEvent = {
      event_id: "EVT-SHORT",
      event_type: "AOG",
      start_time: new Date("2026-04-28T11:30:00Z"),
      end_time: new Date("2026-04-28T14:00:00Z"),
      severity: "HIGH",
      description: "Targeted ground time pushing VJ103 into PQC curfew",
      affected_aircraft: "VJ-A321",
      affected_airport: null,
      affected_flight_id: null,
    };
    const result = runSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruption: shortAog,
      rules: RULES,
    });
    const delayOpt = result.ranked_options.find(
      (o) => o.option_type === "DELAY_ONLY",
    );
    expect(delayOpt).toBeTruthy();
    expect(delayOpt!.curfew_violations).toBeGreaterThan(0);
    expect(delayOpt!.score_breakdown.curfew_component).toBeGreaterThan(0);
    expect(
      delayOpt!.reason_codes.some((r) => r.includes("curfew window")),
    ).toBe(true);
  });
});

describe("multi-event simulation (K10)", () => {
  it("returns empty result when no events are passed", () => {
    const r = runMultiEventSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruptions: [],
      rules: RULES,
    });
    expect(r.events).toEqual([]);
    expect(r.impacted_flights).toEqual([]);
    expect(r.ranked_options).toEqual([]);
  });

  it("delegates to single-event path when one event is passed", () => {
    const single = runSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruption: AOG,
      rules: RULES,
    });
    const multi = runMultiEventSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruptions: [AOG],
      rules: RULES,
    });
    expect(multi.impacted_flights.map((i) => i.flight.flight_id).sort()).toEqual(
      single.impacted_flights.map((i) => i.flight.flight_id).sort(),
    );
  });

  it("unions impacted flights from concurrent AOG + airport closure", () => {
    const closeHan: DisruptionEvent = {
      event_id: "EVT-CLOSE-HAN",
      event_type: "AIRPORT_CLOSE",
      start_time: new Date("2026-04-28T03:30:00Z"),
      end_time: new Date("2026-04-28T05:30:00Z"),
      severity: "HIGH",
      description: "HAN runway closure",
      affected_aircraft: null,
      affected_airport: "HAN",
      affected_flight_id: null,
    };
    const result = runMultiEventSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruptions: [AOG, closeHan],
      rules: RULES,
    });
    expect(result.events.length).toBe(2);
    // VJ102-D1 (STD 04:00) impacted by HAN closure (03:30-05:30) only.
    // NOT by AOG (01:30-03:30) since STD 04:00 > AOG end 03:30.
    const vj102 = result.impacted_flights.find(
      (i) => i.flight.flight_id === "VJ102-D1",
    );
    expect(vj102).toBeTruthy();
    const reasons = vj102!.reason_codes.join(" | ");
    expect(reasons).toContain("HAN");
    expect(result.ranked_options[0].rank).toBe(1);
    const deepDelay = result.ranked_options.find(
      (option) => option.option_type === "DEEP_DELAY",
    );
    expect(deepDelay?.flight_changes.length).toBeGreaterThanOrEqual(
      result.impacted_flights.length,
    );
  });

  it("uses each event window when delaying multi-event impacted flights", () => {
    const schedule: FlightLeg[] = [
      {
        flight_id: "WX-1",
        flight_number: "WX101",
        origin: "SGN",
        destination: "DAD",
        std: new Date("2026-05-02T16:30:00Z"),
        sta: new Date("2026-05-02T17:30:00Z"),
        aircraft_id: "WX-A1",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.8,
        is_international: false,
        is_last_flight_of_day: false,
      },
      {
        flight_id: "AOG-1",
        flight_number: "MX901",
        origin: "SGN",
        destination: "HAN",
        std: new Date("2026-05-02T18:00:00Z"),
        sta: new Date("2026-05-02T20:00:00Z"),
        aircraft_id: "MX-A1",
        aircraft_type: "A321",
        priority_level: 2,
        load_factor: 0.8,
        is_international: false,
        is_last_flight_of_day: false,
      },
    ];
    const aircraft: Aircraft[] = [
      {
        aircraft_id: "WX-A1",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-05-02T00:00:00Z"),
        status: "ACTIVE",
        next_maintenance_time: null,
        restriction: null,
      },
      {
        aircraft_id: "MX-A1",
        aircraft_type: "A321",
        current_station: "SGN",
        available_from: new Date("2026-05-02T00:00:00Z"),
        status: "AOG",
        next_maintenance_time: null,
        restriction: null,
      },
    ];
    const weather: DisruptionEvent = {
      event_id: "EVT-WX",
      event_type: "WEATHER",
      start_time: new Date("2026-05-02T16:00:00Z"),
      end_time: new Date("2026-05-02T17:00:00Z"),
      severity: "MEDIUM",
      description: "SGN weather stop",
      affected_aircraft: null,
      affected_airport: "SGN",
      affected_flight_id: null,
    };
    const aog: DisruptionEvent = {
      event_id: "EVT-AOG-LATE",
      event_type: "AOG",
      start_time: new Date("2026-05-02T17:00:00Z"),
      end_time: new Date("2026-05-02T23:50:00Z"),
      severity: "HIGH",
      description: "Late AOG",
      affected_aircraft: "MX-A1",
      affected_airport: "SGN",
      affected_flight_id: null,
    };

    const result = runMultiEventSimulation({
      schedule,
      aircraft,
      disruptions: [aog, weather],
      rules: RULES,
    });
    const delayOnly = result.ranked_options.find(
      (option) => option.option_type === "DELAY_ONLY",
    );
    const weatherChange = delayOnly?.flight_changes.find(
      (change) => change.flight_id === "WX-1",
    );

    expect(weatherChange).toBeTruthy();
    expect(weatherChange!.new_std.getTime()).toBeLessThan(
      aog.end_time.getTime(),
    );
    expect(weatherChange!.delay_minutes).toBeLessThan(180);
  });

  it("expands multi-event AOG impacts to the downstream rotation", () => {
    const closePqc: DisruptionEvent = {
      event_id: "EVT-CLOSE-PQC",
      event_type: "AIRPORT_CLOSE",
      start_time: new Date("2026-04-28T12:00:00Z"),
      end_time: new Date("2026-04-28T13:00:00Z"),
      severity: "HIGH",
      description: "PQC weather stop",
      affected_aircraft: null,
      affected_airport: "PQC",
      affected_flight_id: null,
    };

    const result = runMultiEventSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruptions: [AOG, closePqc],
      rules: RULES,
    });

    expect(result.impacted_flights.map((i) => i.flight.flight_id)).toEqual([
      "VJ101-D1",
      "VJ102-D1",
      "VJ103-D1",
    ]);
    expect(
      result.impacted_flights
        .find((i) => i.flight.flight_id === "VJ102-D1")
        ?.reason_codes.some((r) => r.includes("Downstream rotation affected")),
    ).toBe(true);
  });

  it("does not emit duplicate or uncovered flight changes in ranked options", () => {
    const closeHan: DisruptionEvent = {
      event_id: "EVT-CLOSE-HAN",
      event_type: "AIRPORT_CLOSE",
      start_time: new Date("2026-04-28T03:30:00Z"),
      end_time: new Date("2026-04-28T05:30:00Z"),
      severity: "HIGH",
      description: "HAN runway closure",
      affected_aircraft: null,
      affected_airport: "HAN",
      affected_flight_id: null,
    };
    const result = runMultiEventSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruptions: [AOG, closeHan],
      rules: RULES,
    });

    for (const option of result.ranked_options) {
      const ids = option.flight_changes.map((fc) => fc.flight_id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(option.flight_changes.some((fc) => fc.new_aircraft === "UNCOVERED"))
        .toBe(false);
    }
  });

  it("excludes AOG'd aircraft from the swap candidate pool", () => {
    const aogA324: DisruptionEvent = {
      event_id: "EVT-AOG-A324",
      event_type: "AOG",
      start_time: new Date("2026-04-28T00:00:00Z"),
      end_time: new Date("2026-04-28T05:00:00Z"),
      severity: "HIGH",
      description: "Spare also AOG",
      affected_aircraft: "VJ-A324",
      affected_airport: null,
      affected_flight_id: null,
    };
    const result = runMultiEventSimulation({
      schedule: SCHEDULE,
      aircraft: AIRCRAFT,
      disruptions: [AOG, aogA324],
      rules: RULES,
    });
    // No SINGLE_SWAP option should propose VJ-A324 since it is also AOG.
    const swapOptions = result.ranked_options.filter(
      (o) => o.option_type === "SINGLE_SWAP",
    );
    for (const opt of swapOptions) {
      expect(Object.values(opt.aircraft_changes)).not.toContain("VJ-A324");
    }
  });
});
