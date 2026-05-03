import type {
  TailAssignmentConfig,
  TailAssignmentNetwork,
  TailAssignmentPath,
  TailAssignmentSelectionResult,
  TailAssignmentSolution,
} from "./types";

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function unionFlightIds(a: Set<string>, b: Set<string>): Set<string> {
  const next = new Set(a);
  for (const value of b) next.add(value);
  return next;
}

function pathSortValue(path: TailAssignmentPath): number {
  return path.coveredFlightIds.size * 10_000 - path.cost;
}

export function selectTailAssignmentSolutions(
  network: TailAssignmentNetwork,
  pathsByAircraft: Map<string, TailAssignmentPath[]>,
  config: TailAssignmentConfig,
): TailAssignmentSelectionResult {
  const requiredFlights = new Set(network.flights.map((flight) => flight.flight_id));
  const aircraftIds = network.aircraft.map((aircraft) => aircraft.aircraft_id);
  const orderedPaths = new Map<string, TailAssignmentPath[]>();

  for (const aircraftId of aircraftIds) {
    const paths = pathsByAircraft.get(aircraftId) ?? [];
    orderedPaths.set(
      aircraftId,
      [...paths].sort((a, b) => {
        const byValue = pathSortValue(b) - pathSortValue(a);
        return byValue !== 0 ? byValue : a.cost - b.cost;
      }),
    );
  }

  const suffixCoverage: Set<string>[] = Array.from(
    { length: aircraftIds.length + 1 },
    () => new Set<string>(),
  );
  for (let idx = aircraftIds.length - 1; idx >= 0; idx -= 1) {
    const coverage = new Set(suffixCoverage[idx + 1]);
    for (const path of orderedPaths.get(aircraftIds[idx]) ?? []) {
      for (const flightId of path.coveredFlightIds) coverage.add(flightId);
    }
    suffixCoverage[idx] = coverage;
  }

  const solutions: TailAssignmentSolution[] = [];
  let searchNodes = 0;
  let bestCoveredFlightCount = Math.min(
    requiredFlights.size,
    suffixCoverage[0].size,
  );

  function worstAcceptedCost(): number {
    if (solutions.length < config.max_solutions) return Number.POSITIVE_INFINITY;
    return Math.max(...solutions.map((solution) => solution.cost));
  }

  function pushSolution(paths: TailAssignmentPath[], covered: Set<string>, cost: number) {
    const complete = covered.size === requiredFlights.size;
    if (!complete) return;
    solutions.push({
      paths: paths.filter((path) => path.legs.length > 0),
      coveredFlightIds: new Set(covered),
      cost,
      searchNodes,
      complete,
    });
    solutions.sort((a, b) => a.cost - b.cost);
    solutions.splice(config.max_solutions);
  }

  function canStillCoverAll(idx: number, covered: Set<string>): boolean {
    const possible = unionFlightIds(covered, suffixCoverage[idx]);
    for (const flightId of requiredFlights) {
      if (!possible.has(flightId)) return false;
    }
    return true;
  }

  function dfs(
    idx: number,
    selected: TailAssignmentPath[],
    covered: Set<string>,
    cost: number,
  ) {
    if (searchNodes >= config.max_master_search_nodes) return;
    searchNodes += 1;
    bestCoveredFlightCount = Math.max(bestCoveredFlightCount, covered.size);

    if (cost >= worstAcceptedCost()) return;
    if (!canStillCoverAll(idx, covered)) return;

    if (idx >= aircraftIds.length) {
      pushSolution(selected, covered, cost);
      return;
    }

    const aircraftId = aircraftIds[idx];
    const paths = orderedPaths.get(aircraftId) ?? [];
    for (const path of paths) {
      if (intersects(path.coveredFlightIds, covered)) continue;
      dfs(
        idx + 1,
        [...selected, path],
        unionFlightIds(covered, path.coveredFlightIds),
        cost + path.cost,
      );
    }
  }

  dfs(0, [], new Set<string>(), 0);

  return {
    solutions: solutions.map((solution) => ({
      ...solution,
      searchNodes,
    })),
    searchNodes,
    requiredFlightCount: requiredFlights.size,
    bestCoveredFlightCount,
  };
}
