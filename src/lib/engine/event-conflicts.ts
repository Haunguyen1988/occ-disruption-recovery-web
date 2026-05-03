import type {
  DisruptionEvent,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  Severity,
} from "@/lib/types";
import { findImpactedFlights } from "./impact-detector";
import { buildScheduleIndex, getAircraftRotation } from "./schedule-index";
import { isOperatedFlight } from "./flight-status";

export type EventConflictLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface EventImpactSummary {
  event_id: string;
  event_type: DisruptionEvent["event_type"];
  severity: Severity;
  impacted_flight_count: number;
  impacted_aircraft_count: number;
  priority_impacted_count: number;
  airport_window_flight_count: number;
  downstream_exposure_count: number;
  exposure_score: number;
  exposure_level: EventConflictLevel;
}

export interface EventConflict {
  event_ids: [string, string];
  level: EventConflictLevel;
  score: number;
  overlap_minutes: number;
  reasons: string[];
  shared_aircraft: string[];
  shared_airports: string[];
  shared_flights: string[];
}

export interface EventConflictGroup {
  event_ids: string[];
  level: EventConflictLevel;
}

export interface MultiEventConflictAnalysis {
  event_count: number;
  network_exposure_score: number;
  network_risk_level: EventConflictLevel;
  max_conflict_level: EventConflictLevel;
  coupled_event_count: number;
  event_summaries: EventImpactSummary[];
  conflicts: EventConflict[];
  groups: EventConflictGroup[];
  recommendations: string[];
}

interface EventAnalysisContext {
  event: DisruptionEvent;
  impacted: ImpactedFlight[];
  impactedFlightIds: Set<string>;
  impactedAircraft: Set<string>;
  impactedAirports: Set<string>;
}

const LEVEL_VALUE: Record<EventConflictLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function severityScore(severity: Severity): number {
  switch (severity) {
    case "CRITICAL":
      return 65;
    case "HIGH":
      return 45;
    case "MEDIUM":
      return 25;
    case "LOW":
    default:
      return 10;
  }
}

function scoreLevel(score: number): EventConflictLevel {
  if (score >= 95) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

function maxLevel(...levels: EventConflictLevel[]): EventConflictLevel {
  return levels.reduce(
    (best, level) =>
      LEVEL_VALUE[level] > LEVEL_VALUE[best] ? level : best,
    "LOW",
  );
}

function overlapMinutes(a: DisruptionEvent, b: DisruptionEvent): number {
  const start = Math.max(a.start_time.getTime(), b.start_time.getTime());
  const end = Math.min(a.end_time.getTime(), b.end_time.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

function intersects<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((item) => b.has(item));
}

function impactedAirportSet(impacted: ImpactedFlight[]): Set<string> {
  const airports = new Set<string>();
  for (const item of impacted) {
    airports.add(item.flight.origin);
    airports.add(item.flight.destination);
  }
  return airports;
}

function eventAirportSet(event: DisruptionEvent): Set<string> {
  const airports = new Set<string>();
  if (event.affected_airport) airports.add(event.affected_airport);
  return airports;
}

function isPriorityFlight(flight: FlightLeg): boolean {
  return (
    flight.priority_level >= 2 ||
    flight.is_international ||
    flight.is_last_flight_of_day ||
    flight.load_factor >= 0.85
  );
}

function countAirportWindowFlights(
  event: DisruptionEvent,
  schedule: FlightLeg[],
): number {
  if (!event.affected_airport) return 0;
  return schedule.filter((flight) => {
    if (isOperatedFlight(flight)) return false;
    const airportMatch =
      flight.origin === event.affected_airport ||
      flight.destination === event.affected_airport;
    return (
      airportMatch &&
      flight.std < event.end_time &&
      event.start_time < flight.sta
    );
  }).length;
}

function countDownstreamExposure(
  impacted: ImpactedFlight[],
  scheduleIndex: ReturnType<typeof buildScheduleIndex>,
): number {
  const firstImpactedByAircraft = new Map<string, number>();
  const impactedIds = new Set(impacted.map((item) => item.flight.flight_id));

  for (const item of impacted) {
    const aircraftId = item.flight.aircraft_id;
    const first = firstImpactedByAircraft.get(aircraftId);
    const time = item.flight.std.getTime();
    if (first === undefined || time < first) {
      firstImpactedByAircraft.set(aircraftId, time);
    }
  }

  let count = 0;
  for (const [aircraftId, firstTime] of firstImpactedByAircraft.entries()) {
    for (const flight of getAircraftRotation(scheduleIndex, aircraftId)) {
      if (isOperatedFlight(flight)) continue;
      if (
        flight.std.getTime() > firstTime &&
        !impactedIds.has(flight.flight_id)
      ) {
        count++;
      }
    }
  }
  return count;
}

function summarizeEvent(
  context: EventAnalysisContext,
  schedule: FlightLeg[],
  scheduleIndex: ReturnType<typeof buildScheduleIndex>,
): EventImpactSummary {
  const priorityImpacted = context.impacted.filter((item) =>
    isPriorityFlight(item.flight),
  ).length;
  const airportWindowFlights = countAirportWindowFlights(
    context.event,
    schedule,
  );
  const downstreamExposure = countDownstreamExposure(
    context.impacted,
    scheduleIndex,
  );
  const exposureScore =
    severityScore(context.event.severity) +
    context.impacted.length * 8 +
    context.impactedAircraft.size * 15 +
    priorityImpacted * 10 +
    airportWindowFlights * 3 +
    downstreamExposure * 4;

  return {
    event_id: context.event.event_id,
    event_type: context.event.event_type,
    severity: context.event.severity,
    impacted_flight_count: context.impacted.length,
    impacted_aircraft_count: context.impactedAircraft.size,
    priority_impacted_count: priorityImpacted,
    airport_window_flight_count: airportWindowFlights,
    downstream_exposure_count: downstreamExposure,
    exposure_score: exposureScore,
    exposure_level: scoreLevel(exposureScore),
  };
}

function buildConflict(
  left: EventAnalysisContext,
  right: EventAnalysisContext,
): EventConflict | null {
  const reasons: string[] = [];
  let score = 0;

  const minutes = overlapMinutes(left.event, right.event);
  if (minutes > 0) {
    score += Math.min(25, 8 + Math.round(minutes / 30) * 3);
    reasons.push(`Time windows overlap by ${minutes} minute(s)`);
  }

  const directAircraft = new Set<string>();
  if (
    left.event.affected_aircraft &&
    left.event.affected_aircraft === right.event.affected_aircraft
  ) {
    directAircraft.add(left.event.affected_aircraft);
    score += 40;
    reasons.push("Both events reference the same aircraft");
  }

  const sharedAircraft = new Set([
    ...directAircraft,
    ...intersects(left.impactedAircraft, right.impactedAircraft),
  ]);
  if (sharedAircraft.size > directAircraft.size) {
    score += 30;
    reasons.push("Events impact at least one shared aircraft rotation");
  }

  const directAirports = intersects(
    eventAirportSet(left.event),
    eventAirportSet(right.event),
  );
  const sharedAirportSet = new Set([
    ...directAirports,
    ...intersects(left.impactedAirports, right.impactedAirports),
  ]);
  if (directAirports.length > 0) {
    score += 30;
    reasons.push("Both events reference the same airport");
  } else if (sharedAirportSet.size > 0) {
    score += 15;
    reasons.push("Events touch at least one shared airport flow");
  }

  const sharedFlights = intersects(
    left.impactedFlightIds,
    right.impactedFlightIds,
  );
  if (sharedFlights.length > 0) {
    score += 35;
    reasons.push("Events impact the same flight(s)");
  }

  if (
    left.event.affected_flight_id &&
    left.event.affected_flight_id === right.event.affected_flight_id
  ) {
    score += 35;
    reasons.push("Both events reference the same flight");
  }

  if (score === 0) return null;

  return {
    event_ids: [left.event.event_id, right.event.event_id],
    level: scoreLevel(score),
    score,
    overlap_minutes: minutes,
    reasons,
    shared_aircraft: [...sharedAircraft].sort(),
    shared_airports: [...sharedAirportSet].sort(),
    shared_flights: sharedFlights.sort(),
  };
}

function buildGroups(
  events: DisruptionEvent[],
  conflicts: EventConflict[],
): EventConflictGroup[] {
  const parent = new Map(events.map((event) => [event.event_id, event.event_id]));

  function find(id: string): string {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  }

  function union(a: string, b: string): void {
    parent.set(find(b), find(a));
  }

  for (const conflict of conflicts) {
    if (LEVEL_VALUE[conflict.level] >= LEVEL_VALUE.MEDIUM) {
      union(conflict.event_ids[0], conflict.event_ids[1]);
    }
  }

  const groups = new Map<string, string[]>();
  for (const event of events) {
    const root = find(event.event_id);
    groups.set(root, [...(groups.get(root) ?? []), event.event_id]);
  }

  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => {
      const groupConflicts = conflicts.filter(
        (conflict) =>
          ids.includes(conflict.event_ids[0]) &&
          ids.includes(conflict.event_ids[1]),
      );
      return {
        event_ids: ids,
        level: maxLevel(...groupConflicts.map((conflict) => conflict.level)),
      };
    });
}

function recommendationsFor(
  events: DisruptionEvent[],
  summaries: EventImpactSummary[],
  conflicts: EventConflict[],
  groups: EventConflictGroup[],
): string[] {
  if (events.length === 0) return [];
  if (events.length === 1) {
    return ["Single active event: run standard recovery, then monitor downstream exposure."];
  }

  const recommendations: string[] = [];
  const highConflicts = conflicts.filter(
    (conflict) => LEVEL_VALUE[conflict.level] >= LEVEL_VALUE.HIGH,
  );
  const maxSummary = summaries.reduce<EventImpactSummary | null>(
    (best, item) =>
      !best || item.exposure_score > best.exposure_score ? item : best,
    null,
  );

  if (highConflicts.length > 0) {
    recommendations.push(
      "Run these as one multi-event recovery; at least one event pair is tightly coupled.",
    );
  } else if (groups.length > 0) {
    recommendations.push(
      "Keep coupled event groups together, but review independent groups separately to reduce search noise.",
    );
  } else {
    recommendations.push(
      "Events appear operationally separable; compare independent recovery plans before combining.",
    );
  }

  if (conflicts.some((conflict) => conflict.shared_aircraft.length > 0)) {
    recommendations.push(
      "Prioritize aircraft rotation continuity; shared tails are the likely cascade path.",
    );
  }

  if (conflicts.some((conflict) => conflict.shared_airports.length > 0)) {
    recommendations.push(
      "Watch airport bank pressure and curfew buffers on shared airport flows.",
    );
  }

  if (maxSummary && maxSummary.downstream_exposure_count > 0) {
    recommendations.push(
      `Start with ${maxSummary.event_id}; it has the highest exposure score and ${maxSummary.downstream_exposure_count} downstream leg(s) at risk.`,
    );
  }

  return recommendations;
}

export function analyzeMultiEventConflicts(input: {
  events: DisruptionEvent[];
  schedule: FlightLeg[];
  rules?: OccRules;
}): MultiEventConflictAnalysis {
  const events = input.events.filter(Boolean);
  const scheduleIndex = buildScheduleIndex(input.schedule);

  const contexts = events.map<EventAnalysisContext>((event) => {
    const impacted = findImpactedFlights(
      event,
      input.schedule,
      input.rules,
      scheduleIndex,
    );
    return {
      event,
      impacted,
      impactedFlightIds: new Set(
        impacted.map((item) => item.flight.flight_id),
      ),
      impactedAircraft: new Set(
        impacted.map((item) => item.flight.aircraft_id),
      ),
      impactedAirports: impactedAirportSet(impacted),
    };
  });

  const eventSummaries = contexts.map((context) =>
    summarizeEvent(context, input.schedule, scheduleIndex),
  );

  const conflicts: EventConflict[] = [];
  for (let i = 0; i < contexts.length; i += 1) {
    for (let j = i + 1; j < contexts.length; j += 1) {
      const conflict = buildConflict(contexts[i], contexts[j]);
      if (conflict) conflicts.push(conflict);
    }
  }

  conflicts.sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    return a.event_ids.join(":").localeCompare(b.event_ids.join(":"));
  });

  const groups = buildGroups(events, conflicts);
  const maxConflictLevel = conflicts.length
    ? maxLevel(...conflicts.map((conflict) => conflict.level))
    : "LOW";
  const maxExposureLevel = eventSummaries.length
    ? maxLevel(...eventSummaries.map((summary) => summary.exposure_level))
    : "LOW";
  const networkExposureScore = eventSummaries.reduce(
    (sum, summary) => sum + summary.exposure_score,
    0,
  );

  return {
    event_count: events.length,
    network_exposure_score: networkExposureScore,
    network_risk_level: maxLevel(maxConflictLevel, maxExposureLevel),
    max_conflict_level: maxConflictLevel,
    coupled_event_count: new Set(groups.flatMap((group) => group.event_ids))
      .size,
    event_summaries: eventSummaries,
    conflicts,
    groups,
    recommendations: recommendationsFor(
      events,
      eventSummaries,
      conflicts,
      groups,
    ),
  };
}
