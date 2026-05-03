import type {
  TailAssignmentConfig,
  TailAssignmentConnectionFix,
  TailAssignmentNetwork,
  TailAssignmentSolution,
} from "./types";

function connectionKey(fromFlightId: string, toFlightId: string): string {
  return `${fromFlightId}->${toFlightId}`;
}

function cloneArcs(arcs: Map<string, string[]>): Map<string, string[]> {
  return new Map([...arcs.entries()].map(([key, values]) => [key, [...values]]));
}

function countArcs(arcs: Map<string, string[]>): number {
  return [...arcs.values()].reduce((sum, values) => sum + values.length, 0);
}

export function selectStableTailConnections(
  solutions: TailAssignmentSolution[],
  config: TailAssignmentConfig,
): TailAssignmentConnectionFix[] {
  if (!config.enable_connection_fixing) return [];

  const completeSolutions = solutions.filter((solution) => solution.complete);
  if (
    completeSolutions.length < config.connection_fixing_min_solution_count
  ) {
    return [];
  }

  const supportByKey = new Map<string, TailAssignmentConnectionFix>();
  for (const solution of completeSolutions) {
    const seenInSolution = new Set<string>();
    for (const path of solution.paths) {
      for (let idx = 0; idx < path.legs.length - 1; idx += 1) {
        const fromFlightId = path.legs[idx].flight.flight_id;
        const toFlightId = path.legs[idx + 1].flight.flight_id;
        if (fromFlightId === toFlightId) continue;
        seenInSolution.add(connectionKey(fromFlightId, toFlightId));
      }
    }

    for (const key of seenInSolution) {
      const [fromFlightId, toFlightId] = key.split("->");
      const current = supportByKey.get(key);
      if (current) {
        current.support_count += 1;
      } else {
        supportByKey.set(key, {
          from_flight_id: fromFlightId,
          to_flight_id: toFlightId,
          support_count: 1,
        });
      }
    }
  }

  const stableConnections = [...supportByKey.values()]
    .filter(
      (connection) =>
        connection.support_count === completeSolutions.length,
    )
    .sort((a, b) => {
      const byFrom = a.from_flight_id.localeCompare(b.from_flight_id);
      return byFrom !== 0 ? byFrom : a.to_flight_id.localeCompare(b.to_flight_id);
    });

  const selected: TailAssignmentConnectionFix[] = [];
  const usedFrom = new Set<string>();
  const usedTo = new Set<string>();
  for (const connection of stableConnections) {
    if (usedFrom.has(connection.from_flight_id)) continue;
    if (usedTo.has(connection.to_flight_id)) continue;

    selected.push(connection);
    usedFrom.add(connection.from_flight_id);
    usedTo.add(connection.to_flight_id);
    if (selected.length >= config.connection_fixing_max_connections) break;
  }

  return selected;
}

export function applyTailConnectionFixes(
  network: TailAssignmentNetwork,
  connections: TailAssignmentConnectionFix[],
): TailAssignmentNetwork {
  const validConnections = connections.filter((connection) =>
    (network.flightArcs.get(connection.from_flight_id) ?? []).includes(
      connection.to_flight_id,
    ),
  );
  if (validConnections.length === 0) {
    return {
      ...network,
      startArcs: cloneArcs(network.startArcs),
      flightArcs: cloneArcs(network.flightArcs),
      fixedConnections: new Map(network.fixedConnections),
      blockerCounts: new Map(network.blockerCounts),
    };
  }

  const startArcs = cloneArcs(network.startArcs);
  const flightArcs = cloneArcs(network.flightArcs);
  const fixedConnections = new Map(network.fixedConnections);
  const fixedToFlightIds = new Set<string>();

  for (const connection of validConnections) {
    fixedConnections.set(connection.from_flight_id, connection.to_flight_id);
    fixedToFlightIds.add(connection.to_flight_id);
  }

  for (const [aircraftId, outgoing] of startArcs.entries()) {
    startArcs.set(
      aircraftId,
      outgoing.filter((flightId) => !fixedToFlightIds.has(flightId)),
    );
  }

  for (const [fromFlightId, outgoing] of flightArcs.entries()) {
    const forcedToFlightId = fixedConnections.get(fromFlightId);
    if (forcedToFlightId) {
      flightArcs.set(
        fromFlightId,
        outgoing.includes(forcedToFlightId) ? [forcedToFlightId] : [],
      );
      continue;
    }

    flightArcs.set(
      fromFlightId,
      outgoing.filter((flightId) => !fixedToFlightIds.has(flightId)),
    );
  }

  const reducedArcCount = countArcs(startArcs) + countArcs(flightArcs);

  return {
    ...network,
    startArcs,
    flightArcs,
    reducedArcCount,
    removedArcCount: network.originalArcCount - reducedArcCount,
    fixedConnections,
    blockerCounts: new Map(network.blockerCounts),
  };
}
