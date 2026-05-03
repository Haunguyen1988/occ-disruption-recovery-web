import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeTailAssignmentMode } from "@/lib/engine/tail-assignment";
import { runSimulation } from "@/lib/engine";
import { tryParseAimsWorkbook } from "@/lib/parsers/aims";
import {
  parseAircraftRows,
  parseCsvOrXlsx,
  parseDisruptionRows,
  parseScheduleRows,
} from "@/lib/parsers/csv";
import { getDefaultRules } from "@/lib/parsers/rules";
import type { AimsParseResult } from "@/lib/parsers/aims";
import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  RecoveryOption,
} from "@/lib/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const RULES = getDefaultRules();

function fileFromPath(fullPath: string, type: string): File {
  const bytes = fs.readFileSync(fullPath);
  return new File([new Uint8Array(bytes)], path.basename(fullPath), { type });
}

function benchmarkPath(envName: string, defaultRelativePath: string): string {
  const configured = process.env[envName];
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(REPO_ROOT, configured);
  }
  return path.join(REPO_ROOT, defaultRelativePath);
}

async function loadAimsBenchmark(): Promise<AimsParseResult> {
  const parsed = await tryParseAimsWorkbook(
    fileFromPath(
      benchmarkPath(
        "OCC_TAIL_BENCHMARK_AIMS",
        path.join(
          "src",
          "lib",
          "parsers",
          "__tests__",
          "fixtures",
          "aims_dayrep_sample.xlsx",
        ),
      ),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  expect(parsed).not.toBeNull();
  return parsed!;
}

async function loadOperationalBenchmark(): Promise<{
  schedule: FlightLeg[];
  aircraft: Aircraft[];
}> {
  const schedulePath = process.env.OCC_TAIL_BENCHMARK_SCHEDULE;
  const aircraftPath = process.env.OCC_TAIL_BENCHMARK_AIRCRAFT;
  if (!schedulePath && !aircraftPath) {
    return loadAimsBenchmark();
  }
  expect(schedulePath, "OCC_TAIL_BENCHMARK_SCHEDULE is required").toBeTruthy();
  expect(aircraftPath, "OCC_TAIL_BENCHMARK_AIRCRAFT is required").toBeTruthy();

  const scheduleRows = await parseCsvOrXlsx(
    fileFromPath(benchmarkPath("OCC_TAIL_BENCHMARK_SCHEDULE", ""), "text/csv"),
  );
  const aircraftRows = await parseCsvOrXlsx(
    fileFromPath(benchmarkPath("OCC_TAIL_BENCHMARK_AIRCRAFT", ""), "text/csv"),
  );
  const schedule = parseScheduleRows(scheduleRows);
  const aircraft = parseAircraftRows(aircraftRows);
  expect(schedule.issues.filter((issue) => issue.level === "error")).toEqual([]);
  expect(aircraft.issues.filter((issue) => issue.level === "error")).toEqual([]);
  return { schedule: schedule.data, aircraft: aircraft.data };
}

async function loadDisruptionBenchmark(): Promise<DisruptionEvent> {
  const rows = await parseCsvOrXlsx(
    fileFromPath(
      benchmarkPath(
        "OCC_TAIL_BENCHMARK_DISRUPTION",
        path.join("public", "uat", "uat_scenario_aog.csv"),
      ),
      "text/csv",
    ),
  );
  const parsed = parseDisruptionRows(rows);
  expect(parsed.issues.filter((issue) => issue.level === "error")).toEqual([]);
  expect(parsed.data).toHaveLength(1);
  return parsed.data[0];
}

function bestNonTailOption(options: RecoveryOption[]): RecoveryOption | null {
  return (
    options.find((option) => option.option_type !== "TAIL_ASSIGNMENT_OPTIMIZED") ??
    null
  );
}

describe.runIf(process.env.OCC_TAIL_BENCHMARK === "1")(
  "tail assignment benchmark",
  () => {
    it("captures AIMS-scale runtime and optimizer diagnostics", async () => {
      const operationalData = await loadOperationalBenchmark();
      const disruption = await loadDisruptionBenchmark();
      const mode = normalizeTailAssignmentMode(
        process.env.OCC_TAIL_BENCHMARK_MODE,
      );

      const started = performance.now();
      const result = runSimulation({
        schedule: operationalData.schedule,
        aircraft: operationalData.aircraft,
        disruption,
        rules: RULES,
        tailAssignmentMode: mode,
      });
      const elapsedMs = performance.now() - started;

      const tail = result.ranked_options.find(
        (option) => option.option_type === "TAIL_ASSIGNMENT_OPTIMIZED",
      );
      const heuristic = bestNonTailOption(result.ranked_options);
      const diagnostics = result.feedback?.tail_assignment;

      expect(diagnostics).toBeDefined();
      expect(diagnostics!.attempted).toBe(true);

      console.table([
        {
          scenario: disruption.event_id,
          mode,
          schedule_flights: operationalData.schedule.length,
          aircraft: operationalData.aircraft.length,
          impacted_flights: result.impacted_flights.length,
          ranked_options: result.ranked_options.length,
          runtime_ms: Math.round(elapsedMs),
          tail_rank: tail?.rank ?? null,
          tail_score: tail ? Math.round(tail.score) : null,
          best_heuristic_rank: heuristic?.rank ?? null,
          best_heuristic_score: heuristic ? Math.round(heuristic.score) : null,
          score_delta_vs_best_heuristic:
            tail && heuristic ? Math.round(tail.score - heuristic.score) : null,
          horizon_flights: diagnostics?.horizon_flight_count ?? null,
          horizon_aircraft: diagnostics?.aircraft_count ?? null,
          original_arcs: diagnostics?.original_arc_count ?? null,
          reduced_arcs: diagnostics?.reduced_arc_count ?? null,
          arc_reduction_pct: diagnostics
            ? Number(diagnostics.arc_reduction_pct.toFixed(1))
            : null,
          initial_paths: diagnostics?.initial_path_count ?? null,
          final_paths: diagnostics?.final_path_count ?? null,
          initial_search_nodes: diagnostics?.initial_search_nodes ?? null,
          final_search_nodes: diagnostics?.final_search_nodes ?? null,
          fixed_connections: diagnostics?.fixed_connection_count ?? null,
          no_option_reason: diagnostics?.no_option_reason ?? null,
          best_covered_flights: diagnostics?.best_covered_flight_count ?? null,
          required_flights: diagnostics?.required_flight_count ?? null,
          top_blocker: diagnostics?.top_blocking_reasons[0]?.reason ?? null,
        },
      ]);
    });
  },
);
