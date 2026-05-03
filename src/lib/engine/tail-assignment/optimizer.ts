import type {
  FlightChange,
  RecoveryOption,
  RiskLevel,
} from "@/lib/types";
import { buildTailAssignmentNetwork, getTailAssignmentConfig } from "./network-builder";
import { generateTailAssignmentPaths } from "./labeling";
import { selectTailAssignmentSolutions } from "./master-selector";
import {
  applyTailConnectionFixes,
  selectStableTailConnections,
} from "./connection-fixing";
import type {
  AircraftRecoveryObjective,
  TailAssignmentConfig,
  TailAssignmentInput,
  TailAssignmentLeg,
  TailAssignmentNetwork,
  TailAssignmentSelectionResult,
  TailAssignmentOptimizationResult,
  TailAssignmentPath,
  TailAssignmentSolution,
} from "./types";

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function objectiveLabel(objective: AircraftRecoveryObjective = "balanced"): string {
  switch (objective) {
    case "min_delay":
      return "minimum delay";
    case "min_swap":
      return "fewest aircraft swaps";
    case "risk_averse":
      return "lowest operational risk";
    case "protect_priority":
      return "priority-flight protection";
    case "balanced":
    default:
      return "balanced aircraft recovery";
  }
}

function flightChangeFromLeg(leg: TailAssignmentLeg): FlightChange {
  return {
    flight_id: leg.flight.flight_id,
    flight_number: leg.flight.flight_number,
    origin: leg.flight.origin,
    destination: leg.flight.destination,
    original_aircraft: leg.flight.aircraft_id,
    new_aircraft: leg.aircraft_id,
    original_std: leg.flight.std,
    original_sta: leg.flight.sta,
    new_std: leg.new_std,
    new_sta: leg.new_sta,
    delay_minutes: leg.delay_minutes,
    reason:
      leg.aircraft_id === leg.flight.aircraft_id
        ? "Tail assignment optimization: retimed on original aircraft"
        : "Tail assignment optimization: reassigned to optimized aircraft path",
  };
}

function pathSummary(path: TailAssignmentPath): string {
  const flights = path.legs
    .map((leg) => leg.flight.flight_number)
    .slice(0, 6)
    .join(" -> ");
  const suffix = path.legs.length > 6 ? " -> ..." : "";
  return `${path.aircraft_id}: ${flights}${suffix}`;
}

function solutionRisk(changes: FlightChange[], solution: TailAssignmentSolution): RiskLevel {
  if (!solution.complete) return "HIGH";
  const changedAircraft = changes.filter(
    (change) => change.original_aircraft !== change.new_aircraft,
  ).length;
  const maxDelay = changes.length
    ? Math.max(...changes.map((change) => change.delay_minutes))
    : 0;
  if (maxDelay > 180 || changedAircraft > 6) return "HIGH";
  if (maxDelay > 0 || changedAircraft > 0) return "MEDIUM";
  return "LOW";
}

interface OptimizationPass {
  network: TailAssignmentNetwork;
  pathCount: number;
  searchNodes: number;
  solutions: TailAssignmentSolution[];
  selection: TailAssignmentSelectionResult;
  blockerCounts: Map<string, number>;
}

function increment(
  counts: Map<string, number>,
  reason: string,
  count = 1,
) {
  counts.set(reason, (counts.get(reason) ?? 0) + count);
}

function mergeCounts(...sources: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const source of sources) {
    for (const [reason, count] of source.entries()) {
      increment(merged, reason, count);
    }
  }
  return merged;
}

function topBlockingReasons(
  counts: Map<string, number>,
): { reason: string; count: number }[] {
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      const byCount = b.count - a.count;
      return byCount !== 0 ? byCount : a.reason.localeCompare(b.reason);
    })
    .slice(0, 5);
}

function runOptimizationPass(
  network: TailAssignmentNetwork,
  input: TailAssignmentInput,
  config: TailAssignmentConfig,
): OptimizationPass {
  const pathGeneration = generateTailAssignmentPaths(network, input, config);
  const selection = selectTailAssignmentSolutions(
    network,
    pathGeneration.pathsByAircraft,
    config,
  );
  const searchNodes = selection.searchNodes;

  return {
    network,
    pathCount: pathGeneration.pathCount,
    searchNodes,
    solutions: selection.solutions,
    selection,
    blockerCounts: mergeCounts(network.blockerCounts, pathGeneration.blockerCounts),
  };
}

function emptyConnectionFixingMetrics() {
  return {
    applied: false,
    fixedConnectionCount: 0,
    initialPathCount: 0,
    finalPathCount: 0,
    initialSearchNodes: 0,
    finalSearchNodes: 0,
  };
}

function emptyDiagnostics(reason: string | null = null) {
  return {
    requiredFlightCount: 0,
    bestCoveredFlightCount: 0,
    completeSolutionCount: 0,
    noOptionReason: reason,
    topBlockingReasons: [] as { reason: string; count: number }[],
  };
}

function diagnosticsFromPass(
  pass: OptimizationPass,
  options: RecoveryOption[],
) {
  let noOptionReason: string | null = null;
  if (options.length === 0) {
    if (pass.solutions.length === 0) {
      noOptionReason =
        "No complete aircraft-path combination covered all recovery-horizon flights";
    } else {
      noOptionReason =
        "Complete tail-assignment solutions produced no flight retiming or aircraft reassignment";
    }
  }

  return {
    requiredFlightCount: pass.selection.requiredFlightCount,
    bestCoveredFlightCount: pass.selection.bestCoveredFlightCount,
    completeSolutionCount: pass.solutions.length,
    noOptionReason,
    topBlockingReasons: topBlockingReasons(pass.blockerCounts),
  };
}

function optionFromSolution(
  solution: TailAssignmentSolution,
  input: TailAssignmentInput,
  result: {
    originalArcCount: number;
    reducedArcCount: number;
    removedArcCount: number;
    pathCount: number;
    searchNodes: number;
    connectionFixingApplied: boolean;
    fixedConnectionCount: number;
    initialPathCount: number;
    initialSearchNodes: number;
  },
): RecoveryOption | null {
  const changes = solution.paths
    .flatMap((path) => path.legs)
    .filter(
      (leg) =>
        leg.delay_minutes > 0 || leg.aircraft_id !== leg.flight.aircraft_id,
    )
    .map(flightChangeFromLeg)
    .sort((a, b) => {
      const byTime = a.original_std.getTime() - b.original_std.getTime();
      return byTime !== 0 ? byTime : a.flight_id.localeCompare(b.flight_id);
    });

  if (changes.length === 0) return null;

  const aircraftChanges: Record<string, string> = {};
  const changedAircraftPairs = new Set<string>();
  for (const change of changes) {
    if (change.original_aircraft !== change.new_aircraft) {
      aircraftChanges[change.flight_id] = change.new_aircraft;
      changedAircraftPairs.add(`${change.original_aircraft}->${change.new_aircraft}`);
    }
  }

  const totalDelay = changes.reduce(
    (sum, change) => sum + Math.max(0, change.delay_minutes),
    0,
  );
  const maxDelay = changes.length
    ? Math.max(...changes.map((change) => Math.max(0, change.delay_minutes)))
    : 0;
  const impactedFlightIds = new Set(
    input.impacted.map((item) => item.flight.flight_id),
  );
  const changedImpactedCount = changes.filter((change) =>
    impactedFlightIds.has(change.flight_id),
  ).length;
  const arcReductionPct =
    result.originalArcCount > 0
      ? Math.round((result.removedArcCount / result.originalArcCount) * 100)
      : 0;

  return {
    option_id: randomId("OPT-TAIL"),
    option_type: "TAIL_ASSIGNMENT_OPTIMIZED",
    flight_changes: changes,
    aircraft_changes: aircraftChanges,
    total_delay_minutes: totalDelay,
    max_delay_minutes: maxDelay,
    impacted_flight_count: changes.length,
    swap_count: changedAircraftPairs.size,
    curfew_violations: 0,
    risk_level: solutionRisk(changes, solution),
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      `Aircraft recovery optimizer profile: ${objectiveLabel(input.objective)}`,
      `Tail assignment optimization selected ${solution.paths.length} aircraft path(s) covering ${solution.coveredFlightIds.size} recovery-horizon flight(s)`,
      `Changed ${changes.length} flight(s), including ${changedImpactedCount} directly impacted flight(s)`,
      `Arc reduction: ${result.originalArcCount} -> ${result.reducedArcCount} arcs (${arcReductionPct}% removed)`,
      `Path generation: ${result.pathCount} candidate path(s); master search visited ${result.searchNodes} node(s)`,
      ...(result.connectionFixingApplied
        ? [
            `Connection fixing: locked ${result.fixedConnectionCount} stable connection(s); paths ${result.initialPathCount} -> ${result.pathCount}; master search ${result.initialSearchNodes} -> ${result.searchNodes} node(s)`,
          ]
        : []),
      ...solution.paths.slice(0, 5).map(pathSummary),
    ],
    score_breakdown: {},
  };
}

export function optimizeTailAssignment(
  input: TailAssignmentInput,
): TailAssignmentOptimizationResult {
  if (!input.impacted.length) {
    const network = buildTailAssignmentNetwork(input);
    return {
      options: [],
      network,
      pathCount: 0,
      searchNodes: 0,
      connectionFixing: emptyConnectionFixingMetrics(),
      diagnostics: emptyDiagnostics("No impacted flights were available for tail assignment"),
    };
  }

  const config = getTailAssignmentConfig(input.mode, input.config);
  const network = buildTailAssignmentNetwork({ ...input, config });
  if (network.flights.length === 0 || network.aircraft.length === 0) {
    return {
      options: [],
      network,
      pathCount: 0,
      searchNodes: 0,
      connectionFixing: emptyConnectionFixingMetrics(),
      diagnostics: emptyDiagnostics(
        "No recovery-horizon flights or eligible aircraft were available for tail assignment",
      ),
    };
  }

  const initialPass = runOptimizationPass(network, input, config);
  let selectedPass = initialPass;
  let fixedConnectionCount = 0;

  const stableConnections = selectStableTailConnections(
    initialPass.solutions,
    config,
  );
  if (stableConnections.length > 0 && initialPass.solutions[0]) {
    const fixedNetwork = applyTailConnectionFixes(network, stableConnections);
    const fixedPass = runOptimizationPass(fixedNetwork, input, config);
    const initialBestCost = initialPass.solutions[0].cost;
    const fixedBestCost = fixedPass.solutions[0]?.cost;
    const keepsBestKnownCost =
      fixedBestCost !== undefined && fixedBestCost <= initialBestCost;
    const reducesOrPreservesPathCount = fixedPass.pathCount <= initialPass.pathCount;

    if (
      fixedPass.solutions.length > 0 &&
      keepsBestKnownCost &&
      reducesOrPreservesPathCount
    ) {
      selectedPass = fixedPass;
      fixedConnectionCount = fixedNetwork.fixedConnections.size;
    }
  }

  const connectionFixing = {
    applied: fixedConnectionCount > 0,
    fixedConnectionCount,
    initialPathCount: initialPass.pathCount,
    finalPathCount: selectedPass.pathCount,
    initialSearchNodes: initialPass.searchNodes,
    finalSearchNodes: selectedPass.searchNodes,
  };

  const metrics = {
    originalArcCount: selectedPass.network.originalArcCount,
    reducedArcCount: selectedPass.network.reducedArcCount,
    removedArcCount: selectedPass.network.removedArcCount,
    pathCount: selectedPass.pathCount,
    searchNodes: selectedPass.searchNodes,
    connectionFixingApplied: connectionFixing.applied,
    fixedConnectionCount: connectionFixing.fixedConnectionCount,
    initialPathCount: connectionFixing.initialPathCount,
    initialSearchNodes: connectionFixing.initialSearchNodes,
  };
  const options = selectedPass.solutions
    .map((solution) => optionFromSolution(solution, input, metrics))
    .filter((option): option is RecoveryOption => Boolean(option));
  const diagnostics = diagnosticsFromPass(selectedPass, options);

  return {
    options,
    network: selectedPass.network,
    pathCount: selectedPass.pathCount,
    searchNodes: selectedPass.searchNodes,
    connectionFixing,
    diagnostics,
  };
}
