import type { Aircraft, FlightLeg } from "@/lib/types";
import { getProjectedStation } from "../candidate-finder";
import {
  addMinutes,
  isInCurfew,
  minTurnaroundForType,
  minutesBetween,
} from "../time-utils";
import type {
  AircraftRecoveryObjective,
  TailAssignmentConfig,
  TailAssignmentInput,
  TailAssignmentLeg,
  TailAssignmentNetwork,
  TailAssignmentPath,
  TailAssignmentPathGenerationResult,
} from "./types";

interface Label {
  aircraft: Aircraft;
  currentNode: string;
  station: string;
  readyAt: Date;
  legs: TailAssignmentLeg[];
  coveredFlightIds: Set<string>;
  totalDelay: number;
  maxDelay: number;
  cost: number;
}

function flightDurationMinutes(flight: FlightLeg): number {
  return minutesBetween(flight.std, flight.sta);
}

function impactedFlightIds(input: TailAssignmentInput): Set<string> {
  return new Set(input.impacted.map((item) => item.flight.flight_id));
}

function blockingEndByFlightId(input: TailAssignmentInput): Map<string, Date | null> {
  return new Map(
    input.impacted.map((item) => [
      item.flight.flight_id,
      item.blocking_end_time === undefined
        ? input.disruption.end_time
        : item.blocking_end_time,
    ]),
  );
}

function flightNotBefore(
  flight: FlightLeg,
  input: TailAssignmentInput,
  impactedIds: Set<string>,
  blockEndByFlightId: Map<string, Date | null>,
  assignedAircraftId: string,
): Date {
  if (!impactedIds.has(flight.flight_id)) return flight.std;
  if (
    input.disruption.event_type === "AOG" &&
    input.disruption.affected_aircraft &&
    assignedAircraftId !== input.disruption.affected_aircraft
  ) {
    return flight.std;
  }
  const flightBlockEnd = blockEndByFlightId.get(flight.flight_id);
  if (!flightBlockEnd) return flight.std;
  const turn = minTurnaroundForType(flight.aircraft_type, input.rules);
  return addMinutes(flightBlockEnd, turn);
}

function violatesMaintenance(
  aircraft: Aircraft,
  newSta: Date,
  input: TailAssignmentInput,
): boolean {
  if (!input.rules.maintenance_rules?.prohibit_swap_if_next_check_risk) {
    return false;
  }
  if (!aircraft.next_maintenance_time) return false;
  const buffer = input.rules.maintenance_rules.next_check_buffer_minutes ?? 0;
  return newSta > addMinutes(aircraft.next_maintenance_time, -buffer);
}

function priorityPenalty(flight: FlightLeg, input: TailAssignmentInput): number {
  const rules = input.rules.priority_rules;
  const bonus = input.rules.score_weights?.priority_protection_bonus ?? 40;
  let penalty = 0;
  if (rules?.protect_international_flight && flight.is_international) {
    penalty += bonus;
  }
  if (rules?.protect_last_flight_of_day && flight.is_last_flight_of_day) {
    penalty += bonus;
  }
  if (
    rules?.protect_high_load_factor &&
    flight.load_factor >= (rules.high_load_factor_threshold ?? 0.85)
  ) {
    penalty += Math.round(bonus * 0.5);
  }
  return penalty;
}

function objectiveCostProfile(objective: AircraftRecoveryObjective = "balanced") {
  switch (objective) {
    case "min_delay":
      return {
        delayMultiplier: 3,
        swapMultiplier: 0.5,
        curfewMultiplier: 1,
        priorityMultiplier: 0.5,
        maxDelayPenalty: 6,
      };
    case "min_swap":
      return {
        delayMultiplier: 0.8,
        swapMultiplier: 5,
        curfewMultiplier: 1,
        priorityMultiplier: 0.5,
        maxDelayPenalty: 1,
      };
    case "risk_averse":
      return {
        delayMultiplier: 1.4,
        swapMultiplier: 2,
        curfewMultiplier: 3,
        priorityMultiplier: 1.5,
        maxDelayPenalty: 5,
      };
    case "protect_priority":
      return {
        delayMultiplier: 1,
        swapMultiplier: 1,
        curfewMultiplier: 1.5,
        priorityMultiplier: 4,
        maxDelayPenalty: 2,
      };
    case "balanced":
    default:
      return {
        delayMultiplier: 1,
        swapMultiplier: 1,
        curfewMultiplier: 1,
        priorityMultiplier: 1,
        maxDelayPenalty: 2,
      };
  }
}

function maxDelayCost(delay: number, objective: AircraftRecoveryObjective | undefined): number {
  const profile = objectiveCostProfile(objective);
  if (delay <= 60) return 0;
  const excess = delay - 60;
  const severe = Math.max(0, delay - 180);
  return Math.round((excess + severe * 2) * profile.maxDelayPenalty);
}

function compatibleTypes(
  flight: FlightLeg,
  aircraft: Aircraft,
  input: TailAssignmentInput,
): boolean {
  const compat = input.rules.aircraft_rules?.compatible_types ?? {};
  const allowed = compat[flight.aircraft_type] ?? [flight.aircraft_type];
  return allowed.includes(aircraft.aircraft_type);
}

function assignFlight(
  label: Label,
  flight: FlightLeg,
  input: TailAssignmentInput,
  config: TailAssignmentConfig,
  impactedIds: Set<string>,
  blockEndByFlightId: Map<string, Date | null>,
): TailAssignmentLeg | null {
  if (label.coveredFlightIds.has(flight.flight_id)) return null;
  if (!compatibleTypes(flight, label.aircraft, input)) return null;
  if (label.station !== flight.origin) return null;

  const minTurn = minTurnaroundForType(flight.aircraft_type, input.rules);
  const earliestByTurn = label.legs.length
    ? addMinutes(label.readyAt, minTurn)
    : addMinutes(label.readyAt, minTurn);
  const notBefore = flightNotBefore(
    flight,
    input,
    impactedIds,
    blockEndByFlightId,
    label.aircraft.aircraft_id,
  );
  const newStd = new Date(
    Math.max(
      flight.std.getTime(),
      earliestByTurn.getTime(),
      notBefore.getTime(),
    ),
  );
  const delay = Math.max(0, minutesBetween(flight.std, newStd));
  if (delay > config.max_leg_delay_minutes) return null;

  const newSta = addMinutes(newStd, flightDurationMinutes(flight));
  if (violatesMaintenance(label.aircraft, newSta, input)) return null;

  const weights = input.rules.score_weights ?? {};
  const profile = objectiveCostProfile(input.objective);
  const totalDelayWeight = weights.total_delay_weight ?? 1;
  const swapPenalty = weights.swap_penalty ?? 25;
  const curfewPenalty = weights.curfew_risk_penalty ?? 120;
  const changedAircraft = label.aircraft.aircraft_id !== flight.aircraft_id;
  const disrupted = changedAircraft || delay > 0;
  const curfewCost =
    (isInCurfew(flight.origin, newStd, input.rules) ? curfewPenalty : 0) +
    (isInCurfew(flight.destination, newSta, input.rules) ? curfewPenalty : 0);

  return {
    flight,
    aircraft_id: label.aircraft.aircraft_id,
    new_std: newStd,
    new_sta: newSta,
    delay_minutes: delay,
    assignment_cost:
      delay * totalDelayWeight * profile.delayMultiplier +
      maxDelayCost(delay, input.objective) +
      (changedAircraft ? swapPenalty * profile.swapMultiplier : 0) +
      (disrupted ? priorityPenalty(flight, input) * profile.priorityMultiplier : 0) +
      curfewCost * profile.curfewMultiplier,
  };
}

function labelToPath(label: Label, sequence: number): TailAssignmentPath {
  return {
    path_id: `${label.aircraft.aircraft_id}-PATH-${sequence}`,
    aircraft_id: label.aircraft.aircraft_id,
    legs: label.legs,
    coveredFlightIds: new Set(label.coveredFlightIds),
    total_delay_minutes: label.totalDelay,
    max_delay_minutes: label.maxDelay,
    cost: label.cost,
  };
}

function pathValue(path: TailAssignmentPath): number {
  return path.coveredFlightIds.size * 10_000 - path.cost;
}

function uniquePathKey(path: TailAssignmentPath): string {
  return [...path.coveredFlightIds].sort().join("|");
}

function increment(counts: Map<string, number>, reason: string) {
  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

export function generateTailAssignmentPaths(
  network: TailAssignmentNetwork,
  input: TailAssignmentInput,
  config: TailAssignmentConfig,
): TailAssignmentPathGenerationResult {
  const flightsById = new Map(network.flights.map((flight) => [flight.flight_id, flight]));
  const impactedIds = impactedFlightIds(input);
  const blockEndByFlightId = blockingEndByFlightId(input);
  const pathsByAircraft = new Map<string, TailAssignmentPath[]>();
  const blockerCounts = new Map<string, number>();

  for (const aircraft of network.aircraft) {
    const initial: Label = {
      aircraft,
      currentNode: `START:${aircraft.aircraft_id}`,
      station: getProjectedStation(
        aircraft.aircraft_id,
        network.horizonStart,
        input.scheduleIndex,
        aircraft.current_station,
      ),
      readyAt: aircraft.available_from > network.horizonStart
        ? aircraft.available_from
        : network.horizonStart,
      legs: [],
      coveredFlightIds: new Set<string>(),
      totalDelay: 0,
      maxDelay: 0,
      cost: 0,
    };

    if (
      input.disruption.event_type === "AOG" &&
      input.disruption.affected_aircraft === aircraft.aircraft_id &&
      input.disruption.end_time > initial.readyAt
    ) {
      initial.readyAt = input.disruption.end_time;
    }

    const queue: Label[] = [initial];
    const labels: Label[] = [];
    const paths: TailAssignmentPath[] = [
      {
        path_id: `${aircraft.aircraft_id}-EMPTY`,
        aircraft_id: aircraft.aircraft_id,
        legs: [],
        coveredFlightIds: new Set(),
        total_delay_minutes: 0,
        max_delay_minutes: 0,
        cost: 0,
      },
    ];
    let pathSequence = 1;

    while (queue.length > 0 && labels.length < config.max_labels_per_aircraft) {
      const label = queue.shift() as Label;
      labels.push(label);

      const outgoingIds = label.legs.length
        ? network.flightArcs.get(label.currentNode) ?? []
        : network.startArcs.get(aircraft.aircraft_id) ?? [];
      const outgoing = outgoingIds
        .map((id) => flightsById.get(id))
        .filter((flight): flight is FlightLeg => Boolean(flight))
        .sort((a, b) => {
          const byTime = a.std.getTime() - b.std.getTime();
          return byTime !== 0 ? byTime : a.flight_id.localeCompare(b.flight_id);
        });

      for (const flight of outgoing) {
        const leg = assignFlight(
          label,
          flight,
          input,
          config,
          impactedIds,
          blockEndByFlightId,
        );
        if (!leg) {
          increment(
            blockerCounts,
            "Path extension blocked: assignment constraints failed",
          );
          continue;
        }
        const nextCovered = new Set(label.coveredFlightIds);
        nextCovered.add(flight.flight_id);
        const nextLabel: Label = {
          aircraft,
          currentNode: flight.flight_id,
          station: flight.destination,
          readyAt: leg.new_sta,
          legs: [...label.legs, leg],
          coveredFlightIds: nextCovered,
          totalDelay: label.totalDelay + leg.delay_minutes,
          maxDelay: Math.max(label.maxDelay, leg.delay_minutes),
          cost: label.cost + leg.assignment_cost,
        };
        queue.push(nextLabel);
        paths.push(labelToPath(nextLabel, pathSequence));
        pathSequence += 1;
      }

      queue.sort((a, b) => {
        const byCoverage = b.coveredFlightIds.size - a.coveredFlightIds.size;
        return byCoverage !== 0 ? byCoverage : a.cost - b.cost;
      });
    }

    const bestByKey = new Map<string, TailAssignmentPath>();
    for (const path of paths) {
      const key = uniquePathKey(path);
      const existing = bestByKey.get(key);
      if (!existing || path.cost < existing.cost) {
        bestByKey.set(key, path);
      }
    }

    const sortedPaths = [...bestByKey.values()]
      .sort((a, b) => {
        const byValue = pathValue(b) - pathValue(a);
        return byValue !== 0 ? byValue : a.path_id.localeCompare(b.path_id);
      });
    const selectedPaths = sortedPaths.slice(0, config.max_paths_per_aircraft);
    const emptyPath = sortedPaths.find((path) => path.legs.length === 0);
    if (emptyPath && !selectedPaths.some((path) => path.path_id === emptyPath.path_id)) {
      selectedPaths.push(emptyPath);
    }

    pathsByAircraft.set(aircraft.aircraft_id, selectedPaths);
  }

  const pathCount = [...pathsByAircraft.values()].reduce(
    (sum, paths) => sum + paths.length,
    0,
  );

  return { pathsByAircraft, pathCount, blockerCounts };
}
