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

/**
 * K4 behavior: single-swap re-rotates the impacted aircraft from the target
 * leg through the rest of that aircraft's downstream rotation.
 */
function downstreamRotation(
  target: FlightLeg,
  scheduleIndex: ScheduleIndex,
): FlightLeg[] {
  return getAircraftRotation(scheduleIndex, target.aircraft_id).filter(
    (f) => f.std.getTime() >= target.std.getTime(),
  );
}

function legLabel(leg: FlightLeg): string {
  return `${leg.flight_number} (${leg.flight_id})`;
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

  const newAcId = candidate.aircraft.aircraft_id;
  const candidateRotation = getAircraftRotation(scheduleIndex, newAcId);

  // Find which of the candidate's flights overlap with the proposed swap
  const displacedFlights: FlightLeg[] = [];
  for (const existing of candidateRotation) {
    for (const proposed of downstream) {
      if (overlaps(existing.std, existing.sta, proposed.std, proposed.sta)) {
        displacedFlights.push(existing);
        break; // only add each displaced flight once
      }
    }
  }

  // If no displaced flights, this is just a regular SINGLE_SWAP
  if (displacedFlights.length === 0) return null;

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
        if (available <= displaced.std) {
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
        const lastDownstream = downstream[downstream.length - 1];
        const swapAcFinalStation = lastDownstream.destination;
        const swapAcFinalTime = lastDownstream.sta;

        if (swapAcFinalStation !== displaced.origin) {
          flightChanges.push({
            flight_id: displaced.flight_id,
            flight_number: displaced.flight_number,
            origin: displaced.origin,
            destination: displaced.destination,
            original_aircraft: newAcId,
            new_aircraft: "UNCOVERED",
            original_std: displaced.std,
            original_sta: displaced.sta,
            new_std: displaced.std,
            new_sta: displaced.sta,
            delay_minutes: 0,
            reason: `Displaced from ${newAcId} — no aircraft available and ${newAcId} ends at ${swapAcFinalStation} (not ${displaced.origin})`,
          });
          totalDelay += 999;
          maxDelay = Math.max(maxDelay, 999);
          reasonCodes.push(
            `${displaced.flight_number}: UNCOVERED — ${newAcId} at ${swapAcFinalStation}, needs ${displaced.origin}`,
          );
        } else {
          const turnaround = minTurnaroundForType(displaced.aircraft_type ?? "A321", rules);
          const availableAfter = addMinutes(swapAcFinalTime, turnaround);
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
 *
 * A2 upgrade: when a full-rotation swap is infeasible but the candidate can
 * cover a partial subset of downstream legs, a hybrid option
 * (partial swap + delay for remaining legs) is generated.
 */
export function generateRecoveryOptions(
  impacted: ImpactedFlight[],
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  aircraftList: Aircraft[],
  rules: OccRules,
  scheduleIndex?: ScheduleIndex,
): RecoveryGenerationResult {
  if (!impacted.length) return { options: [], feedback: null };
  const index = resolveScheduleIndex(schedule, scheduleIndex);
  const options: RecoveryOption[] = [];
  options.push(simulateDelayOnly(impacted, disruption, schedule, rules, index));
  options.push(simulateSpreadDelay(impacted, disruption, schedule, rules, index));
  options.push(simulateDeepDelay(impacted, disruption, schedule, rules));

  // A1: sort impacted flights by STD and try swaps for EACH target
  const sortedTargets = [...impacted]
    .map((i) => i.flight)
    .sort((a, b) => a.std.getTime() - b.std.getTime());

  // Track which swap aircraft have already generated an option (dedup)
  const usedSwapAircraft = new Set<string>();
  let totalFeasibleSwaps = 0;
  const allDiagnostics: SwapCandidateDiagnostic[] = [];

  // Primary target for feedback display
  const primaryTarget = sortedTargets[0];

  for (const target of sortedTargets) {
    const candidates = findCandidateAircraft(
      target,
      aircraftList,
      schedule,
      rules,
      index,
    );

    for (const candidate of candidates) {
      const acId = candidate.aircraft.aircraft_id;

      // Only diagnose each candidate once (for the primary target)
      if (target === primaryTarget) {
        const evaluation = evaluateSingleSwapCandidate(target, candidate, index, rules);
        allDiagnostics.push(toSwapCandidateDiagnostic(candidate, evaluation));
      }

      // Skip if we already have a swap option using this aircraft
      if (usedSwapAircraft.has(acId)) continue;

      // Try full swap first
      const evaluation = evaluateSingleSwapCandidate(target, candidate, index, rules);
      if (evaluation.option) {
        totalFeasibleSwaps += 1;
        if (totalFeasibleSwaps <= 5) {
          options.push(evaluation.option);
        }
        usedSwapAircraft.add(acId);
        continue;
      }

      // Try CHAIN_SWAP: cascade swap that also handles displaced flights
      const isTypeAndStatusOk =
        candidate.aircraft.status.toUpperCase() === "ACTIVE" &&
        !candidate.reason_codes.some((r) => r.includes("not compatible"));
      if (isTypeAndStatusOk && totalFeasibleSwaps + options.length < 8) {
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
          options.push(chain);
          usedSwapAircraft.add(acId);
          continue;
        }
      }

      // A2: try partial swap + delay hybrid as last resort
      if (isTypeAndStatusOk && totalFeasibleSwaps + options.length < 8) {
        const hybrid = createPartialSwapHybrid(
          target,
          candidate,
          disruption,
          schedule,
          index,
          rules,
        );
        if (hybrid) {
          options.push(hybrid);
          usedSwapAircraft.add(acId);
        }
      }
    }
  }

  const feedback: SimulationFeedback = {
    swap_target_flight_id: primaryTarget.flight_id,
    swap_target_flight_number: primaryTarget.flight_number,
    swap_target_aircraft_id: primaryTarget.aircraft_id,
    feasible_swap_count: totalFeasibleSwaps,
    candidate_count: allDiagnostics.length,
    candidates: allDiagnostics.slice(0, 8),
  };

  return { options, feedback };
}

/**
 * A2: partial swap + delay hybrid.
 *
 * When a candidate aircraft cannot cover the full downstream rotation
 * (e.g. it has a conflicting assignment midway), this function:
 * 1. Finds the longest prefix of downstream legs the candidate CAN cover.
 * 2. Swaps those legs onto the candidate.
 * 3. Applies delay-only propagation for remaining legs on the original aircraft.
 */
function createPartialSwapHybrid(
  target: FlightLeg,
  candidate: CandidateAircraft,
  disruption: DisruptionEvent,
  schedule: FlightLeg[],
  scheduleIndex: ScheduleIndex,
  rules: OccRules,
): RecoveryOption | null {
  const downstream = downstreamRotation(target, scheduleIndex);
  if (downstream.length < 2) return null;

  const newAcId = candidate.aircraft.aircraft_id;
  const candidateSchedule = getAircraftRotation(scheduleIndex, newAcId);

  // Find the longest feasible prefix
  let coverableCount = 0;
  const timeline: FlightLeg[] = [...candidateSchedule];

  for (const leg of downstream) {
    // Check overlap with candidate's existing schedule
    const hasOverlap = timeline.some((existing) =>
      overlaps(existing.std, existing.sta, leg.std, leg.sta),
    );
    if (hasOverlap) break;

    // Check station continuity
    if (coverableCount > 0) {
      const prevLeg = downstream[coverableCount - 1];
      if (prevLeg.destination !== leg.origin) break;
    } else {
      if (candidate.aircraft.current_station !== leg.origin) break;
    }

    // Check turnaround
    if (coverableCount > 0) {
      const prevLeg = downstream[coverableCount - 1];
      const minTurn = minTurnaroundForType(leg.aircraft_type, rules);
      const readyAt = addMinutes(prevLeg.sta, minTurn);
      if (readyAt > leg.std) break;
    } else {
      const minTurn = minTurnaroundForType(leg.aircraft_type, rules);
      const requiredAvail = addMinutes(leg.std, -minTurn);
      if (candidate.aircraft.available_from > requiredAvail) break;
    }

    coverableCount += 1;
    timeline.push(leg);
  }

  // Need at least 1 leg swapped and at least 1 remaining for this to be a hybrid
  if (coverableCount < 1 || coverableCount >= downstream.length) return null;

  const swappedLegs = downstream.slice(0, coverableCount);
  const remainingLegs = downstream.slice(coverableCount);

  const flightChanges: FlightChange[] = [];

  // Swap changes (no delay)
  for (const leg of swappedLegs) {
    flightChanges.push(flightChangeForSwap(leg, target, newAcId));
  }

  // Delay changes for remaining legs (keep original aircraft)
  const minTurn = minTurnaroundForType(target.aircraft_type, rules);
  const blockEnd = addMinutes(disruption.end_time, minTurn);
  let prevSta: Date | null = null;

  for (const leg of remainingLegs) {
    let requiredStd = leg.std;
    if (blockEnd > requiredStd) requiredStd = blockEnd;
    if (prevSta) {
      const turnEnd = addMinutes(prevSta, minTurn);
      if (turnEnd > requiredStd) requiredStd = turnEnd;
    }
    const delayMin = Math.max(0, Math.floor((requiredStd.getTime() - leg.std.getTime()) / 60000));
    flightChanges.push({
      flight_id: leg.flight_id,
      flight_number: leg.flight_number,
      origin: leg.origin,
      destination: leg.destination,
      original_aircraft: leg.aircraft_id,
      new_aircraft: leg.aircraft_id,
      original_std: leg.std,
      original_sta: leg.sta,
      new_std: addMinutes(leg.std, delayMin),
      new_sta: addMinutes(leg.sta, delayMin),
      delay_minutes: delayMin,
      reason: "Hybrid: delay on remaining legs after partial swap",
    });
    prevSta = addMinutes(leg.sta, delayMin);
  }

  const totalDelay = flightChanges.reduce((s, c) => s + Math.max(0, c.delay_minutes), 0);
  const maxDelay = flightChanges.length
    ? Math.max(...flightChanges.map((c) => Math.max(0, c.delay_minutes)))
    : 0;

  return {
    option_id: randomId("OPT-HYBRID"),
    option_type: "SINGLE_SWAP",
    flight_changes: flightChanges,
    aircraft_changes: { [target.aircraft_id]: newAcId },
    total_delay_minutes: totalDelay,
    max_delay_minutes: maxDelay,
    impacted_flight_count: flightChanges.filter(
      (c) => c.delay_minutes > 0 || c.original_aircraft !== c.new_aircraft,
    ).length,
    swap_count: 1,
    curfew_violations: 0,
    risk_level: candidate.risk_level === "LOW" ? "MEDIUM" : candidate.risk_level,
    score: 0,
    rank: null,
    recommendation: "",
    reason_codes: [
      `Partial swap: ${swappedLegs.length} leg(s) swapped to ${newAcId}, ${remainingLegs.length} leg(s) delayed on original aircraft`,
      `Hybrid recovery — combines swap coverage with delay propagation`,
      ...candidate.reason_codes,
    ],
    score_breakdown: {},
  };
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
