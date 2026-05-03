import type { Aircraft, FlightLeg } from "@/lib/types";
import { getProjectedStation } from "../candidate-finder";
import { isOperatedFlight } from "../flight-status";
import { addMinutes, minTurnaroundForType } from "../time-utils";
import type {
  TailAssignmentConfig,
  TailAssignmentInput,
  TailAssignmentMode,
  TailAssignmentNetwork,
} from "./types";
import { configForTailAssignmentMode } from "./config";

function mergeConfig(
  mode: TailAssignmentMode = "balanced",
  config?: Partial<TailAssignmentConfig>,
): TailAssignmentConfig {
  return configForTailAssignmentMode(mode, config);
}

function isEligibleAircraft(aircraft: Aircraft, input: TailAssignmentInput): boolean {
  return (
    aircraft.status.toUpperCase() === "ACTIVE" ||
    aircraft.aircraft_id === input.disruption.affected_aircraft
  );
}

function increment(counts: Map<string, number>, reason: string) {
  counts.set(reason, (counts.get(reason) ?? 0) + 1);
}

function shouldSummarizeBlocker(reason: string): boolean {
  return ![
    "Connection arc blocked: same flight",
    "Connection arc blocked: non-forward time sequence",
  ].includes(reason);
}

function isTypeCompatible(
  flight: FlightLeg,
  aircraft: Aircraft,
  input: TailAssignmentInput,
): boolean {
  const compat = input.rules.aircraft_rules?.compatible_types ?? {};
  const allowed = compat[flight.aircraft_type] ?? [flight.aircraft_type];
  return allowed.includes(aircraft.aircraft_type);
}

function aircraftReadyAt(
  aircraft: Aircraft,
  input: TailAssignmentInput,
  horizonStart: Date,
): Date {
  let readyAt = aircraft.available_from > horizonStart
    ? aircraft.available_from
    : horizonStart;
  if (
    input.disruption.event_type === "AOG" &&
    input.disruption.affected_aircraft === aircraft.aircraft_id &&
    input.disruption.end_time > readyAt
  ) {
    readyAt = input.disruption.end_time;
  }
  return readyAt;
}

function startFlightBlocker(
  aircraft: Aircraft,
  flight: FlightLeg,
  input: TailAssignmentInput,
  config: TailAssignmentConfig,
  horizonStart: Date,
): string | null {
  if (!isTypeCompatible(flight, aircraft, input)) {
    return "Start arc blocked: aircraft type incompatible";
  }
  const projectedStation = getProjectedStation(
    aircraft.aircraft_id,
    horizonStart,
    input.scheduleIndex,
    aircraft.current_station,
  );
  if (projectedStation !== flight.origin) {
    return "Start arc blocked: aircraft not positioned at flight origin";
  }

  const minTurn = minTurnaroundForType(flight.aircraft_type, input.rules);
  const readyToDepart = addMinutes(
    aircraftReadyAt(aircraft, input, horizonStart),
    minTurn,
  );
  const latestAllowed = addMinutes(flight.std, config.max_leg_delay_minutes);
  if (readyToDepart > latestAllowed) {
    return "Start arc blocked: aircraft cannot be ready within max delay";
  }
  return null;
}

function connectionBlocker(
  from: FlightLeg,
  to: FlightLeg,
  input: TailAssignmentInput,
  config: TailAssignmentConfig,
): string | null {
  if (from.flight_id === to.flight_id) {
    return "Connection arc blocked: same flight";
  }
  if (from.std >= to.std) {
    return "Connection arc blocked: non-forward time sequence";
  }
  if (from.destination !== to.origin) {
    return "Connection arc blocked: station continuity mismatch";
  }

  const minTurn = minTurnaroundForType(to.aircraft_type, input.rules);
  const readyToDepart = addMinutes(from.sta, minTurn);
  const latestAllowed = addMinutes(to.std, config.max_leg_delay_minutes);
  if (readyToDepart > latestAllowed) {
    return "Connection arc blocked: turnaround exceeds max delay";
  }
  return null;
}

function resolveHorizon(input: TailAssignmentInput, config: TailAssignmentConfig) {
  const impactedTimes = input.impacted.map((i) => i.flight.std.getTime());
  const horizonStart = new Date(
    impactedTimes.length
      ? Math.min(...impactedTimes, input.disruption.start_time.getTime())
      : input.disruption.start_time.getTime(),
  );
  const maxEndByConfig = addMinutes(horizonStart, config.horizon_hours * 60);
  const impactedAircraftIds = new Set(
    input.impacted.map((i) => i.flight.aircraft_id),
  );
  const latestDownstreamSta = input.schedule
    .filter(
      (flight) =>
        !isOperatedFlight(flight) &&
        impactedAircraftIds.has(flight.aircraft_id) &&
        flight.std >= horizonStart &&
        flight.std <= maxEndByConfig,
    )
    .reduce(
      (latest, flight) =>
        flight.sta > latest ? flight.sta : latest,
      input.disruption.end_time,
    );
  const horizonEnd = latestDownstreamSta > maxEndByConfig
    ? latestDownstreamSta
    : maxEndByConfig;
  return { horizonStart, horizonEnd };
}

export function buildTailAssignmentNetwork(
  input: TailAssignmentInput,
): TailAssignmentNetwork {
  const config = mergeConfig(input.mode, input.config);
  const { horizonStart, horizonEnd } = resolveHorizon(input, config);
  const flights = input.schedule
    .filter(
      (flight) =>
        !isOperatedFlight(flight) &&
        flight.std >= horizonStart &&
        flight.std <= horizonEnd,
    )
    .sort((a, b) => {
      const byTime = a.std.getTime() - b.std.getTime();
      return byTime !== 0 ? byTime : a.flight_id.localeCompare(b.flight_id);
    });
  const scheduledAircraftIds = new Set(flights.map((flight) => flight.aircraft_id));
  const aircraft = input.aircraft
    .filter(
      (item) =>
        isEligibleAircraft(item, input) ||
        (scheduledAircraftIds.has(item.aircraft_id) &&
          item.status.toUpperCase() === "ACTIVE"),
    )
    .sort((a, b) => a.aircraft_id.localeCompare(b.aircraft_id));

  const startArcs = new Map<string, string[]>();
  const flightArcs = new Map<string, string[]>();
  const blockerCounts = new Map<string, number>();
  let originalArcCount = aircraft.length * flights.length;
  let reducedArcCount = 0;

  for (const item of aircraft) {
    const outgoing: string[] = [];
    for (const flight of flights) {
      const blocker = startFlightBlocker(item, flight, input, config, horizonStart);
      if (blocker && shouldSummarizeBlocker(blocker)) {
        increment(blockerCounts, blocker);
      } else {
        if (!blocker) outgoing.push(flight.flight_id);
      }
    }
    startArcs.set(item.aircraft_id, outgoing);
    reducedArcCount += outgoing.length;
  }

  originalArcCount += flights.length * Math.max(0, flights.length - 1);
  for (const from of flights) {
    const outgoing: string[] = [];
    for (const to of flights) {
      const blocker = connectionBlocker(from, to, input, config);
      if (blocker && shouldSummarizeBlocker(blocker)) {
        increment(blockerCounts, blocker);
      } else {
        if (!blocker) outgoing.push(to.flight_id);
      }
    }
    flightArcs.set(from.flight_id, outgoing);
    reducedArcCount += outgoing.length;
  }

  return {
    flights,
    aircraft,
    horizonStart,
    horizonEnd,
    startArcs,
    flightArcs,
    originalArcCount,
    reducedArcCount,
    removedArcCount: originalArcCount - reducedArcCount,
    fixedConnections: new Map<string, string>(),
    blockerCounts,
  };
}

export function getTailAssignmentConfig(
  mode: TailAssignmentMode = "balanced",
  config?: Partial<TailAssignmentConfig>,
): TailAssignmentConfig {
  return mergeConfig(mode, config);
}
