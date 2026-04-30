import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runMultiEventSimulation, runSimulation } from "@/lib/engine";
import { tryParseAimsWorkbook } from "@/lib/parsers/aims";
import {
  parseCsvOrXlsx,
  parseDisruptionRows,
  parseScheduleRows,
} from "@/lib/parsers/csv";
import { getDefaultRules } from "@/lib/parsers/rules";
import type { AimsParseResult } from "@/lib/parsers/aims";
import type { DisruptionEvent } from "@/lib/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const RULES = getDefaultRules();

function fileFromRepo(relativePath: string, type: string): File {
  const fullPath = path.join(REPO_ROOT, relativePath);
  const bytes = fs.readFileSync(fullPath);
  return new File([new Uint8Array(bytes)], path.basename(fullPath), { type });
}

async function loadAimsFixture(): Promise<AimsParseResult> {
  const parsed = await tryParseAimsWorkbook(
    fileFromRepo(
      path.join(
        "src",
        "lib",
        "parsers",
        "__tests__",
        "fixtures",
        "aims_dayrep_sample.xlsx",
      ),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  expect(parsed).not.toBeNull();
  return parsed!;
}

async function loadUatDisruption(fileName: string): Promise<DisruptionEvent> {
  const rows = await parseCsvOrXlsx(
    fileFromRepo(path.join("public", "uat", fileName), "text/csv"),
  );
  const parsed = parseDisruptionRows(rows);
  expect(parsed.issues.filter((issue) => issue.level === "error")).toEqual([]);
  expect(parsed.data).toHaveLength(1);
  return parsed.data[0];
}

describe("UAT smoke scenarios", () => {
  it("keeps the checked-in broken schedule fixture aligned with parser behavior", async () => {
    const rows = await parseCsvOrXlsx(
      fileFromRepo(
        path.join("public", "uat", "uat_scenario_broken_schedule.csv"),
        "text/csv",
      ),
    );
    const parsed = parseScheduleRows(rows);

    expect(parsed.data.map((flight) => flight.flight_id)).toEqual([
      "UAT-OK-001",
      "UAT-OK-002",
    ]);
    expect(parsed.issues.filter((issue) => issue.level === "error")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: "origin" }),
        expect.objectContaining({ row: 4, column: "std" }),
        expect.objectContaining({ row: 5, column: "sta" }),
        expect.objectContaining({ row: 6, column: "priority_level" }),
      ]),
    );
  });

  it("runs the AOG UAT scenario on the AIMS sample without duplicate flight IDs", async () => {
    const aims = await loadAimsFixture();
    const aog = await loadUatDisruption("uat_scenario_aog.csv");

    const ids = aims.schedule.map((flight) => flight.flight_id);
    expect(new Set(ids).size).toBe(ids.length);

    const roundTrip5068 = aims.schedule.filter(
      (flight) =>
        flight.aircraft_id === "VN-A537" && flight.flight_number === "5068",
    );
    expect(roundTrip5068).toHaveLength(2);
    expect(new Set(roundTrip5068.map((flight) => flight.flight_id)).size).toBe(
      2,
    );

    const result = runSimulation({
      schedule: aims.schedule,
      aircraft: aims.aircraft,
      disruption: aog,
      rules: RULES,
    });

    expect(result.impacted_flights.length).toBeGreaterThan(0);
    expect(
      result.impacted_flights.every(
        (impacted) => impacted.flight.aircraft_id === "VN-A537",
      ),
    ).toBe(true);
    expect(result.ranked_options.map((option) => option.option_type)).toEqual(
      expect.arrayContaining(["DELAY_ONLY", "SPREAD_DELAY", "DEEP_DELAY"]),
    );
  });

  it("runs the combined AOG + HAN closure UAT scenario and preserves both event reasons", async () => {
    const aims = await loadAimsFixture();
    const aog = await loadUatDisruption("uat_scenario_aog.csv");
    const weather = await loadUatDisruption("uat_scenario_weather.csv");

    const weatherOnly = runSimulation({
      schedule: aims.schedule,
      aircraft: aims.aircraft,
      disruption: weather,
      rules: RULES,
    });
    expect(weatherOnly.impacted_flights.length).toBeGreaterThan(0);

    const combined = runMultiEventSimulation({
      schedule: aims.schedule,
      aircraft: aims.aircraft,
      disruptions: [aog, weather],
      rules: RULES,
    });

    expect(combined.events.map((event) => event.event_id)).toEqual([
      "UAT-AOG-001",
      "UAT-WX-001",
    ]);
    expect(combined.impacted_flights.length).toBeGreaterThan(
      weatherOnly.impacted_flights.length,
    );
    expect(combined.ranked_options.length).toBeGreaterThan(0);
    expect(
      combined.impacted_flights.some((impacted) =>
        impacted.reason_codes.some((reason) => reason.includes("HAN")),
      ),
    ).toBe(true);
    expect(
      combined.impacted_flights.some((impacted) =>
        impacted.reason_codes.some((reason) => reason.includes("AOG aircraft")),
      ),
    ).toBe(true);
  });
});
