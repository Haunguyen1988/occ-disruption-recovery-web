import type {
  Aircraft,
  CandidateAircraft,
  DisruptionEvent,
  FlightChange,
  FlightLeg,
  ImpactedFlight,
  OccRules,
  RecoveryOption,
  SimulationFeedback,
  SwapCandidateDiagnostic,
  TailAssignmentOptimizationFeedback,
} from "@/lib/types";
import { findCandidateAircraft, getProjectedStation } from "./candidate-finder";
import {
  simulateDeepDelay,
  simulateDelayOnly,
  simulateSpreadDelay,
} from "./delay-simulator";
import { addMinutes, minTurnaroundForType, overlaps } from "./time-utils";
import {
  getAircraftRotation,
  resolveScheduleIndex,
  type ScheduleIndex,
} from "./schedule-index";
import {
  optimizeTailAssignment,
  type AircraftRecoveryObjective,
  type TailAssignmentMode,
  type TailAssignmentOptimizationResult,
} from "./tail-assignment";
import { isOperatedFlight } from "./flight-status";

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

interface TimelineLeg {
  flight: FlightLeg;
  proposedSwap: boolean;
}

interface SingleSwapEvaluation {
  option: RecoveryOption | null;
  blockingReason: string | null;
}

export interface RecoveryGenerationResult {
  options: RecoveryOption[];
  feedback: SimulationFeedback | null;
}

export interface RecoveryGenerationOptions {
  tailAssignmentMode?: TailAssignmentMode;
}

const AIRCRAFT_RECOVERY_OBJECTIVES: AircraftRecoveryObjective[] = [
  "balanced",
  "min_delay",
  "min_swap",
  "risk_averse",
  "protect_priority",
];

function flightChangeSignature(option: RecoveryOption): string {
  return option.flight_changes
    .map((change) =>
      [
        change.flight_id,
        change.new_aircraft,
        change.new_std.toISOString(),
        change.new_sta.toISOString(),
      ].join(":"),
    )
    .sort()
    .join("|");
}

function uniqueOptimizedOptions(options: RecoveryOption[]): RecoveryOption[] {
  const seen = new Set<string>();
  const unique: RecoveryOption[] = [];
  for (const option of options) {
    const signature = flightChangeSignature(option);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(option);
  }
  return unique;
}

function tailAssignmentFeedback(
  result: TailAssignmentOptimizationResult,
  mode: TailAssignmentMode,
): TailAssignmentOptimizationFeedback {
  const arcReductionPct =
    result.network.originalArcCount > 0
      ? Math.round(
          (result.network.removedArcCount / result.network.originalArcCount) *
            100,
        )
      : 0;

  return {
    attempted: result.network.flights.length > 0 && result.network.aircraft.length > 0,
    mode,
    option_count: result.options.length,
    no_option_reason: result.diagnostics.noOptionReason,
    required_flight_count: result.diagnostics.requiredFlightCount,
    best_covered_flight_count: result.diagnostics.bestCoveredFlightCount,
    complete_solution_count: result.diagnostics.completeSolutionCount,
    top_blocking_reasons: result.diagnostics.topBlockingReasons,
    horizon_flight_count: result.network.flights.length,
    aircraft_count: result.network.aircraft.length,
    original_arc_count: result.network.originalArcCount,
    reduced_arc_count: result.network.reducedArcCount,
    removed_arc_count: result.network.removedArcCount,
    arc_reduction_pct: arcReductionPct,
    path_count: result.pathCount,
    search_nodes: result.searchNodes,
    connection_fixing_applied: result.connectionFixing.applied,
    fixed_connection_count: result.connectionFixing.fixedConnectionCount,
    initial_path_count: result.connectionFixing.initialPathCount,
    final_path_count: result.connectionFixing.finalPathCount,
    initial_search_nodes: result.connectionFixing.initialSearchNodes,
    final_search_nodes: result.connectionFixing.finalSearchNodes,
  };
}

/**
 * K4 behavior: single-swap re-rotates the impacted aircraft from the target
 * leg through the rest of that aircraft's downstream rotation.
 */
function downstreamRotation(
  target: FlightLeg,
  scheduleIndex: ScheduleIndex,
): FlightLeg[] {
  return getAircraftRotation(scheduleIndex, target.aircraft_id).filter(
    (f) => !isOperatedFlight(f) && f.std.getTime() >= target.std.getTime(),
  );
}

function legLabel(leg: FlightLeg): string {
  return `${leg.flight_number} (${leg.flight_id})`;
}

function normalizeCrewName(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.toUpperCase() : null;
}

function crewPairKey(flight: FlightLeg): string | null {
  const captain = normalizeCrewName(flight.captain);
  const firstOfficer = normalizeCrewName(flight.first_officer);
  if (!captain && !firstOfficer) return null;
  if (!captain || !firstOfficer) return "INCOMPLETE_CREW_PAIR";
  return `${captain}|${firstOfficer}`;
}

function sameCrewPairInCluster(flights: FlightLeg[]): string | null {
  const keyed = flights
    .map((flight) => ({ flight, key: crewPairKey(flight) }))
    .filter((item) => item.key !== null);

  if (keyed.length === 0) return null;

  const firstKey = keyed[0].key;
  if (
    firstKey === "INCOMPLETE_CREW_PAIR" ||
    keyed.length !== flights.length ||
    keyed.some((item) => item.key !== firstKey)
  ) {
    return `Crew continuity mismatch in swap cluster: CAPT and FO must match across ${flights.map(legLabel).join(", ")}`;
  }

  return null;
}

const POSITIVE_CANDIDATE_REASONS = [
  "Aircraft type compatible",
  "Availability satisfies turnaround requirement",
  "No overlapping schedule conflict detected",
];

function isPositiveCandidateReason(reason: string): boolean {
  return (
    POSITIVE_CANDIDATE_REASONS.includes(reason) ||
    reason.startsWith("Aircraft available at target origin ")
  );
}

function extractCandidateBlockingReason(reasonCodes: string[]): string | null {
  return reasonCodes.find((reason) => !isPositiveCandidateReason(reason)) ?? null;
}

function findSwapInfeasibility(
  target: FlightLeg,
  candidate: CandidateAircraft,
  downstream: FlightLeg[],
  scheduleIndex: ScheduleIndex,
  rules: OccRules,
): string | null {
  const aircraft = candidate.aircraft;
  const newAcId = aircraft.aircraft_id;
  const first = downstream[0];
  if (!first) return "No downstream rotation found for target flight";

  const crewMismatch = sameCrewPairInCluster(downstream);
  if (crewMismatch) return crewMismatch;

  const firstTurn = minTurnaroundForType(first.aircraft_type, rules);
  const requiredAvailable = addMinutes(first.std, -firstTurn);
  // Use projected station (from schedule rotation) instead of static CSV field
  const projectedStation = getProjectedStation(
    newAcId,
    first.std,
    scheduleIndex,
    aircraft.current_station,
  );
  if (projectedStation !== first.origin) {
    return `Candidate aircraft ${newAcId} projected at ${projectedStation}, target origin is ${first.origin}`;
  }
  if (aircraft.available_from > requiredAvailable) {
    return `Candidate aircraft ${newAcId} is available from ${aircraft.available_from.toISOString()}, required by ${requiredAvailable.toISOString()}`;
  }

  const candidateSchedule = getAircraftRotation(scheduleIndex, newAcId);

  for (const existing of candidateSchedule) {
    for (const proposed of downstream) {
      if (overlaps(existing.std, existing.sta, proposed.std, proposed.sta)) {
        return `Candidate aircraft ${newAcId} already operates ${legLabel(existing)} overlapping proposed ${legLabel(proposed)}`;
      }
    }
  }

  const timeline: TimelineLeg[] = [
    ...candidateSchedule.map((flight) => ({ flight, proposedSwap: false })),
    ...downstream.map((flight) => ({ flight, proposedSwap: true })),
  ].sort((a, b) => {
    const byTime = a.flight.std.getTime() - b.flight.std.getTime();
    if (byTime !== 0) return byTime;
    if (a.proposedSwap !== b.proposedSwap) return a.proposedSwap ? 1 : -1;
    return a.flight.flight_id.localeCompare(b.flight.flight_id);
  });

  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1].flight;
    const next = timeline[i].flight;
    if (prev.destination !== next.origin) {
      return `Candidate aircraft ${newAcId} would be at ${prev.destination} after ${legLabel(prev)}, but ${legLabel(next)} departs ${next.origin}`;
    }
    const minTurn = minTurnaroundForType(next.aircraft_type, rules);
    const readyAt = addMinutes(prev.sta, minTurn);
    if (readyAt > next.std) {
      return `Candidate aircraft ${newAcId} cannot turn from ${legLabel(prev)} to ${legLabel(next)} by ${next.std.toISOString()}`;
    }
  }

  // Keep the current K4 behavior: the chosen swap must cover every downstream
  // leg from the disrupted rotation. Partial swaps need a separate delay/ferry
  // model before they are safe to recommend.
  if (downstream[0].flight_id !== target.flight_id) {
    return `Downstream rotation does not start with target flight ${target.flight_id}`;
  }

  return null;
}

function flightChangeForSwap(
  flight: FlightLeg,
  target: FlightLeg,
  newAcId: string,
): FlightChange {
  return {
    flight_id: flight.flight_id,
    flight_number: flight.flight_number,
    origin: flight.origin,
    destination: flight.destination,
    original_aircraft: flight.aircraft_id,
    new_aircraft: newAcId,
    original_std: flight.std,
    original_sta: flight.sta,
    new_std: flight.std,
    new_sta: flight.sta,
    delay_minutes: 0,
    reason:
      flight.flight_id === target.flight_id
        ? "Single aircraft swap (target leg)"
        : "Re-rotate downstream leg onto swap aircraft",
  };
}

/**
 * Bug fix K11: a single swap is only feasible when the candidate aircraft can
 * cover the complete downstream rotation without overlapping its own schedule,
 * breaking station continuity, or violating turnaround.
 */
function createSingleSwapOption(
  target: FlightLeg,
  candidate: CandidateAircraft,
  scheduleIndex: ScheduleIndex,
  rules: OccRules,
): RecoveryOption | null {
  const downstream = downstreamRotation(target, scheduleIndex);
  const infeasibleReason = findSwapInfeasibility(
    target,
    candidate,
    downstream,
    scheduleIndex,
    rules,
  );
  if (infeasibleReason) return null;

  const newAcId = candidate.aircraft.aircraft_id;
  const flightChanges = downstream.map((flight) =>
    flightChangeForSwap(flight, target, newAcId),
  );

  const option: RecoveryOption = {
    option_id: randomId("OPT-SWAP"),
    option_type: "SINGLE_SWAP",
    flight_changes: flightChanges,
    aircraft_changes: { [target.aircraft_id]: newAcId },
    total_delay_minutes: 0,
    max_delay_minutes: 0,
    impacted_flight_count: flightChanges.length,
    swap_count: 1,
    curfew_violations: 0,
    risk_level: candidate.risk_level,
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      `Swap target flight ${target.flight_number} (and downstream rotation) from ${target.aircraft_id} to ${newAcId}`,
      "Candidate aircraft can cover full downstream rotation without schedule overlap, station break, or turnaround violation",
      ...candidate.reason_codes,
    ],
    score_breakdown: {},
  };
  return option;
}

/**
 * CHAIN_SWAP: cascade swap that also handles displaced flights from the
 * swap aircraft.
 *
 * Example: VN-A537 AOG at SGN → swap to VN-A632.
 * But VN-A632 has its own flights that now conflict → find VN-A633 for those.
 *
 * Depth limited to 1 cascade level to keep options tractable.
 */
function createChainSwapOption(
  target: FlightLeg,
  candidate: CandidateAircraft,
  allAircraft: Aircraft[],
  schedule: FlightLeg[],
  scheduleIndex: ScheduleIndex,
  rules: OccRules,
): RecoveryOption | null {
  const downstream = downstreamRotation(target, scheduleIndex);
  if (!downstream.length) return null;
  const downstreamCrewMismatch = sameCrewPairInCluster(downstream);
  if (downstreamCrewMismatch) return null;

  const newAcId = candidate.aircraft.aircraft_id;
  const candidateRotation = getAircraftRotation(scheduleIndex, newAcId);

  // Find the candidate's first conflict, then protect the rest of that
  // candidate rotation. Chain swap must recover the displaced rotation, not
  // only the legs that directly overlap the primary swap window.
  let firstDisplacedStd: Date | null = null;
  for (const existing of candidateRotation) {
    for (const proposed of downstream) {
      if (overlaps(existing.std, existing.sta, proposed.std, proposed.sta)) {
        if (!firstDisplacedStd || existing.std < firstDisplacedStd) {
          firstDisplacedStd = existing.std;
        }
      }
    }
  }

  // If no displaced flights, this is just a regular SINGLE_SWAP
  if (!firstDisplacedStd) return null;
  const displacedFlights = candidateRotation.filter(
    (flight) => flight.std >= firstDisplacedStd,
  );
  const displacedCrewMismatch = sameCrewPairInCluster(displacedFlights);
  if (displacedCrewMismatch) return null;

  // For each displaced flight, try to find a tertiary aircraft
  const flightChanges: FlightChange[] = [];
  const aircraftChanges: Record<string, string> = { [target.aircraft_id]: newAcId };
  let totalDelay = 0;
  let maxDelay = 0;
  let swapCount = 1;
  const reasonCodes: string[] = [
    `Chain swap: ${target.aircraft_id} flights → ${newAcId}`,
    `${displacedFlights.length} displaced flight(s) from ${newAcId} need coverage`,
  ];

  // Primary swap: move target's downstream to candidate
  for (const flight of downstream) {
    flightChanges.push(flightChangeForSwap(flight, target, newAcId));
  }

  // Secondary: find coverage for each displaced flight.
  // KEY INSIGHT: displaced flights form a rotation. If VN-A632 covers
  // DAD→MFM, then MFM→DAD should also go to VN-A632 (rotation continuation).
  // Track which tertiary aircraft have been assigned and where they end up.
  const tertiaryAssignments = new Map<string, { lastDest: string; lastSta: Date }>();
  let swapAircraftStation = downstream[downstream.length - 1].destination;
  let swapAircraftAvailableAt = downstream[downstream.length - 1].sta;

  for (const displaced of displacedFlights) {
    // First, check if a previously-assigned tertiary aircraft is already
    // at the right airport (rotation continuation)
    let assignedTertiaryId: string | null = null;

    for (const [acId, info] of tertiaryAssignments) {
      if (info.lastDest === displaced.origin) {
        // This tertiary aircraft just arrived at the displaced flight's origin!
        // Check timing: tertiary must land + turnaround before displaced departs
        const turnaround = minTurnaroundForType(displaced.aircraft_type ?? "A321", rules);
        const available = addMinutes(info.lastSta, turnaround);
        const hasOverlap = getAircraftRotation(scheduleIndex, acId).some((existing) =>
          overlaps(existing.std, existing.sta, displaced.std, displaced.sta),
        );
        if (available <= displaced.std && !hasOverlap) {
          assignedTertiaryId = acId;
          break;
        }
      }
    }

    if (assignedTertiaryId) {
      // Rotation continuation: same tertiary covers the next leg
      flightChanges.push({
        flight_id: displaced.flight_id,
        flight_number: displaced.flight_number,
        origin: displaced.origin,
        destination: displaced.destination,
        original_aircraft: newAcId,
        new_aircraft: assignedTertiaryId,
        original_std: displaced.std,
        original_sta: displaced.sta,
        new_std: displaced.std,
        new_sta: displaced.sta,
        delay_minutes: 0,
        reason: `Displaced from ${newAcId}, rotation continued on ${assignedTertiaryId}`,
      });
      // Update tertiary tracking
      tertiaryAssignments.set(assignedTertiaryId, {
        lastDest: displaced.destination,
        lastSta: displaced.sta,
      });
      reasonCodes.push(
        `${displaced.flight_number}: rotation continued on ${assignedTertiaryId}`,
      );
    } else {
      // No rotation continuation — search for a new tertiary aircraft
      const tertiaryCandidates = findCandidateAircraft(
        displaced,
        allAircraft.filter(
          (a) => a.aircraft_id !== target.aircraft_id && a.aircraft_id !== newAcId,
        ),
        schedule,
        rules,
        scheduleIndex,
      );

      const feasible = tertiaryCandidates.find((c) => c.feasible);
      if (feasible) {
        // Found a new tertiary aircraft for the displaced flight
        const tertiaryAcId = feasible.aircraft.aircraft_id;
        flightChanges.push({
          flight_id: displaced.flight_id,
          flight_number: displaced.flight_number,
          origin: displaced.origin,
          destination: displaced.destination,
          original_aircraft: newAcId,
          new_aircraft: tertiaryAcId,
          original_std: displaced.std,
          original_sta: displaced.sta,
          new_std: displaced.std,
          new_sta: displaced.sta,
          delay_minutes: 0,
          reason: `Displaced from ${newAcId} (given to ${target.aircraft_id} recovery), reassigned to ${tertiaryAcId}`,
        });
        aircraftChanges[newAcId] = tertiaryAcId;
        swapCount += 1;
        // Track this tertiary for rotation continuation
        tertiaryAssignments.set(tertiaryAcId, {
          lastDest: displaced.destination,
          lastSta: displaced.sta,
        });
        reasonCodes.push(
          `${displaced.flight_number}: ${newAcId} → ${tertiaryAcId} (displaced coverage)`,
        );
      } else {
        // No tertiary found — check if the swap aircraft can still fly this
        if (swapAircraftStation !== displaced.origin) {
          return null;
        } else {
          const turnaround = minTurnaroundForType(displaced.aircraft_type ?? "A321", rules);
          const availableAfter = addMinutes(swapAircraftAvailableAt, turnaround);
          const delayMs = Math.max(0, availableAfter.getTime() - displaced.std.getTime());
          const delayMin = Math.ceil(delayMs / 60_000);
          const newStd = addMinutes(displaced.std, delayMin);
          const newSta = addMinutes(displaced.sta, delayMin);
          flightChanges.push({
            flight_id: displaced.flight_id,
            flight_number: displaced.flight_number,
            origin: displaced.origin,
            destination: displaced.destination,
            original_aircraft: newAcId,
            new_aircraft: newAcId,
            original_std: displaced.std,
            original_sta: displaced.sta,
            new_std: newStd,
            new_sta: newSta,
            delay_minutes: delayMin,
            reason: `Displaced from ${newAcId}, delayed ${delayMin}min until ${newAcId} returns to ${displaced.origin}`,
          });
          totalDelay += delayMin;
          maxDelay = Math.max(maxDelay, delayMin);
          swapAircraftStation = displaced.destination;
          swapAircraftAvailableAt = newSta;
          reasonCodes.push(
            `${displaced.flight_number}: delayed ${delayMin}min (${newAcId} returns to ${displaced.origin} after primary swap)`,
          );
        }
      }
    }
  }

  return {
    option_id: randomId("OPT-CHAIN"),
    option_type: "SWAP_CHAIN",
    flight_changes: flightChanges,
    aircraft_changes: aircraftChanges,
    total_delay_minutes: totalDelay,
    max_delay_minutes: maxDelay,
    impacted_flight_count: flightChanges.length,
    swap_count: swapCount,
    curfew_violations: 0,
    risk_level: totalDelay > 0 ? "MEDIUM" : candidate.risk_level,
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: reasonCodes,
    score_breakdown: {},
  };
}

function evaluateSingleSwapCandidate(
  target: FlightLeg,
  candidate: CandidateAircraft,
  scheduleIndex: ScheduleIndex,
  rules: OccRules,
): SingleSwapEvaluation {
  if (!candidate.feasible) {
    return {
      option: null,
      blockingReason: extractCandidateBlockingReason(candidate.reason_codes),
    };
  }

  const downstream = downstreamRotation(target, scheduleIndex);
  const blockingReason = findSwapInfeasibility(
    target,
    candidate,
    downstream,
    scheduleIndex,
    rules,
  );

  if (blockingReason) {
    return { option: null, blockingReason };
  }

  return {
    option: createSingleSwapOption(target, candidate, scheduleIndex, rules),
    blockingReason: null,
  };
}

function toSwapCandidateDiagnostic(
  candidate: CandidateAircraft,
  evaluation: SingleSwapEvaluation,
): SwapCandidateDiagnostic {
  return {
    aircraft_id: candidate.aircraft.aircraft_id,
    aircraft_type: candidate.aircraft.aircraft_type,
    feasible: Boolean(evaluation.option),
    risk_level: candidate.risk_level,
    blocking_reason: evaluation.blockingReason,
    reason_codes: candidate.reason_codes,
  };
}

/**
 * A1 upgrade: multi-target swap search.
 *
 * Instead of only searching swaps for the earliest impacted flight, this
 * iterates over ALL impacted flights and evaluates candidate aircraft for each.
 * Swap options are deduplicated by (swap_aircraft_id) so the output remains
 * manageable even with large impacted sets.
 */
export function generateRecoveryOptions(
  impacted: ImpactedFlight[],
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  aircraftList: Aircraft[],
  rules: OccRules,
  scheduleIndex?: ScheduleIndex,
  optionsInput: RecoveryGenerationOptions = {},
): RecoveryGenerationResult {
  if (!impacted.length) return { options: [], feedback: null };
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  const options: RecoveryOption[] = [];
  options.push(simulateDelayOnly(impacted, disruption, schedule, rules, index));
  options.push(simulateSpreadDelay(impacted, disruption, schedule, rules, index));
  options.push(simulateDeepDelay(impacted, disruption, schedule, rules, index));
  const tailAssignmentResults = AIRCRAFT_RECOVERY_OBJECTIVES.map((objective) =>
    optimizeTailAssignment({
      impacted,
      disruption,
      schedule,
      aircraft: aircraftList,
      rules,
      scheduleIndex: index,
      mode: optionsInput.tailAssignmentMode ?? "balanced",
      objective,
      config: {
        max_solutions: objective === "balanced" ? 3 : 2,
      },
    }),
  );
  const tailAssignment = tailAssignmentResults[0];
  const optimizedAircraftOptions = uniqueOptimizedOptions(
    tailAssignmentResults.flatMap((result) => result.options),
  ).slice(0, 8);
  tailAssignment.options = optimizedAircraftOptions;
  options.push(...optimizedAircraftOptions);

  // ─── COMPREHENSIVE OPTION BUILDER ───────────────────────────────
  // Each option must cover ALL impacted flights (not just 1 rotation).
  // Strategy: find the best swap/chain for each impacted aircraft group,
  // then combine with delay propagation for the remaining flights.

  const sortedTargets = [...impacted]
    .map((i) => i.flight)
    .sort((a, b) => a.std.getTime() - b.std.getTime());

  // Group impacted flights by aircraft_id
  const impactedByAircraft = new Map<string, FlightLeg[]>();
  for (const target of sortedTargets) {
    const group = impactedByAircraft.get(target.aircraft_id) ?? [];
    group.push(target);
    impactedByAircraft.set(target.aircraft_id, group);
  }

  // For each impacted aircraft, find candidate swaps (up to 3 best per aircraft)
  const swapOptionsPerAircraft = new Map<
    string,
    Array<{ swap: RecoveryOption; candidate: CandidateAircraft }>
  >();

  const allDiagnostics: SwapCandidateDiagnostic[] = [];
  const primaryTarget = sortedTargets[0];
  let totalFeasibleSwaps = 0;

  for (const [acId, flights] of impactedByAircraft) {
    const target = flights[0]; // earliest flight for this aircraft
    const candidates = findCandidateAircraft(
      target,
      aircraftList,
      schedule,
      rules,
      index,
    );

    // Collect diagnostics for primary target only
    if (target === primaryTarget) {
      for (const candidate of candidates) {
        const evaluation = evaluateSingleSwapCandidate(target, candidate, index, rules);
        allDiagnostics.push(toSwapCandidateDiagnostic(candidate, evaluation));
      }
    }

    const swapResults: Array<{ swap: RecoveryOption; candidate: CandidateAircraft }> = [];

    for (const candidate of candidates) {
      if (swapResults.length >= 3) break; // max 3 alternatives per aircraft

      // Try SINGLE_SWAP
      const evaluation = evaluateSingleSwapCandidate(target, candidate, index, rules);
      if (evaluation.option) {
        totalFeasibleSwaps += 1;
        swapResults.push({ swap: evaluation.option, candidate });
        continue;
      }

      // Try CHAIN_SWAP
      const isTypeAndStatusOk =
        candidate.aircraft.status.toUpperCase() === "ACTIVE" &&
        !candidate.reason_codes.some((r) => r.includes("not compatible"));
      if (isTypeAndStatusOk) {
        const chain = createChainSwapOption(
          target,
          candidate,
          aircraftList,
          schedule,
          index,
          rules,
        );
        if (chain) {
          totalFeasibleSwaps += 1;
          swapResults.push({ swap: chain, candidate });
          continue;
        }
      }
    }

    if (swapResults.length > 0) {
      swapOptionsPerAircraft.set(acId, swapResults);
    }
  }

  // Build comprehensive options by combining swaps + delay for all flights.
  // We generate a few variants:
  //  - For each swap alternative of the primary AOG aircraft, create a composite option
  //  - Each composite covers ALL impacted flights

  const totalImpactedCount = impacted.length;
  const impactedAircraftIds = [...impactedByAircraft.keys()];

  // Find the "primary" aircraft to swap (the one with AOG or earliest impact)
  // Try multiple swap variants for this primary aircraft
  const primaryAircraftId = sortedTargets[0]?.aircraft_id;
  const primarySwaps = swapOptionsPerAircraft.get(primaryAircraftId ?? "") ?? [];

  // Also find secondary aircraft that have swaps available
  const secondarySwapAircraftIds = impactedAircraftIds.filter(
    (id) => id !== primaryAircraftId && swapOptionsPerAircraft.has(id),
  );

  // Generate delay baseline for all impacted flights
  const delayBaseline = simulateDelayOnly(impacted, disruption, schedule, rules, index);

  // Helper: create a composite option from a set of swaps + delay for the rest
  function createCompositeOption(
    swapSet: Array<{ acId: string; swap: RecoveryOption }>,
  ): RecoveryOption {
    const changesByFlightId = new Map<string, FlightChange>();
    const allAircraftChanges: Record<string, string> = {};
    const coveredFlightIds = new Set<string>();
    let totalSwapCount = 0;
    const reasonCodes: string[] = [];
    const addChange = (change: FlightChange) => {
      if (!changesByFlightId.has(change.flight_id)) {
        changesByFlightId.set(change.flight_id, change);
      }
      coveredFlightIds.add(change.flight_id);
    };

    // 1) Add all swap changes
    for (const { acId, swap } of swapSet) {
      for (const fc of swap.flight_changes) {
        addChange(fc);
      }
      for (const [k, v] of Object.entries(swap.aircraft_changes)) {
        allAircraftChanges[k] = v;
      }
      totalSwapCount += swap.swap_count;
      reasonCodes.push(
        `${acId}: ${swap.option_type} → ${Object.values(swap.aircraft_changes).join(", ") || "delay"}`,
      );
    }

    // 2) Add delay propagation for all remaining impacted flights
    let delayedCount = 0;
    for (const fc of delayBaseline.flight_changes) {
      if (!coveredFlightIds.has(fc.flight_id)) {
        addChange(fc);
        if (fc.delay_minutes > 0) delayedCount += 1;
      }
    }

    // 3) Also ensure ALL impacted flights are in the changes list, even if no change
    for (const imp of impacted) {
      if (!coveredFlightIds.has(imp.flight.flight_id)) {
        addChange({
          flight_id: imp.flight.flight_id,
          flight_number: imp.flight.flight_number,
          origin: imp.flight.origin,
          destination: imp.flight.destination,
          original_aircraft: imp.flight.aircraft_id,
          new_aircraft: imp.flight.aircraft_id,
          original_std: imp.flight.std,
          original_sta: imp.flight.sta,
          new_std: imp.flight.std,
          new_sta: imp.flight.sta,
          delay_minutes: 0,
          reason: "Covered by disruption window — no change required",
        });
      }
    }

    // Sort by STD
    const allChanges = [...changesByFlightId.values()].sort(
      (a, b) => a.original_std.getTime() - b.original_std.getTime(),
    );

    const totalDelay = allChanges.reduce((s, c) => s + Math.max(0, c.delay_minutes), 0);
    const maxDelay = allChanges.length
      ? Math.max(...allChanges.map((c) => Math.max(0, c.delay_minutes)))
      : 0;

    const hasSwap = swapSet.length > 0;
    const optionType = hasSwap
      ? (swapSet.some((s) => s.swap.option_type === "SWAP_CHAIN") ? "SWAP_CHAIN" : "SINGLE_SWAP")
      : "DELAY_ONLY";

    if (delayedCount > 0) {
      reasonCodes.push(
        `${delayedCount} remaining flight(s) covered via delay propagation`,
      );
    }
    reasonCodes.push(
      `Comprehensive plan: ${coveredFlightIds.size}/${totalImpactedCount} impacted flights covered`,
    );

    return {
      option_id: randomId(hasSwap ? "OPT-COMP" : "OPT-DELAY"),
      option_type: optionType,
      flight_changes: allChanges,
      aircraft_changes: allAircraftChanges,
      total_delay_minutes: totalDelay,
      max_delay_minutes: maxDelay,
      impacted_flight_count: coveredFlightIds.size,
      swap_count: totalSwapCount,
      curfew_violations: 0,
      risk_level: totalSwapCount > 3 ? "HIGH" : totalSwapCount > 0 ? "MEDIUM" : "LOW",
      score: 0,
      rank: null,
      recommendation: "",
      reason_codes: reasonCodes,
      score_breakdown: {},
    };
  }

  // Variant 1-3: primary aircraft swap + delay for rest
  for (let i = 0; i < Math.min(primarySwaps.length, 3); i++) {
    const swapSet = [{ acId: primaryAircraftId!, swap: primarySwaps[i].swap }];
    options.push(createCompositeOption(swapSet));
  }

  // Variant 4+: primary swap + secondary swaps (if available)
  if (primarySwaps.length > 0 && secondarySwapAircraftIds.length > 0) {
    const swapSet: Array<{ acId: string; swap: RecoveryOption }> = [
      { acId: primaryAircraftId!, swap: primarySwaps[0].swap },
    ];
    const usedFlightIds = new Set(
      primarySwaps[0].swap.flight_changes.map((fc) => fc.flight_id),
    );
    for (const secAcId of secondarySwapAircraftIds.slice(0, 3)) {
      const secSwaps = swapOptionsPerAircraft.get(secAcId)!;
      const compatible = secSwaps.find((swapCandidate) =>
        swapCandidate.swap.flight_changes.every(
          (fc) => !usedFlightIds.has(fc.flight_id),
        ),
      );
      if (!compatible) continue;
      swapSet.push({ acId: secAcId, swap: compatible.swap });
      for (const fc of compatible.swap.flight_changes) {
        usedFlightIds.add(fc.flight_id);
      }
    }
    if (swapSet.length > 1) {
      options.push(createCompositeOption(swapSet));
    }
  }

  const feedback: SimulationFeedback = {
    swap_target_flight_id: primaryTarget.flight_id,
    swap_target_flight_number: primaryTarget.flight_number,
    swap_target_aircraft_id: primaryTarget.aircraft_id,
    feasible_swap_count: totalFeasibleSwaps,
    candidate_count: allDiagnostics.length,
    candidates: allDiagnostics.slice(0, 8),
    tail_assignment: tailAssignmentFeedback(
      tailAssignment,
      optionsInput.tailAssignmentMode ?? "balanced",
    ),
  };

  return { options, feedback };
}

export function summarizeSwapGap(feedback: SimulationFeedback | null): string | null {
  if (!feedback || feedback.candidate_count === 0) {
    return null;
  }
  if (feedback.feasible_swap_count > 0) {
    return `${feedback.feasible_swap_count} candidate aircraft can cover the full downstream rotation.`;
  }

  const topBlocker = feedback.candidates.find((candidate) => candidate.blocking_reason);
  if (!topBlocker?.blocking_reason) {
    return "No candidate aircraft can cover the full downstream rotation.";
  }

  return `No feasible single swap for ${feedback.swap_target_flight_number ?? "the target flight"}; first blocker: ${topBlocker.blocking_reason}.`;
}
