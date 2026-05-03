import type { RecoveryOption } from "@/lib/types";

const SCORE_COMPONENT_LABELS: Record<string, string> = {
  total_delay_component: "total delay",
  max_delay_component: "max delay",
  impacted_flight_component: "changed-flight count",
  swap_component: "swap complexity",
  curfew_component: "curfew risk",
  risk_penalty: "operational risk",
  priority_protection_penalty: "priority protection",
  downstream_ripple_estimate: "downstream ripple",
};

function pickConstraintReason(option: RecoveryOption): string | null {
  return (
    option.reason_codes.find((reason) => reason.startsWith("Restriction note:")) ??
    option.reason_codes.find((reason) => reason.includes("curfew window")) ??
    option.reason_codes.find((reason) => reason.includes("maintenance")) ??
    null
  );
}

export function getOptionWatchouts(option: RecoveryOption): string[] {
  const watchouts: string[] = [];

  if (option.risk_level === "HIGH") {
    watchouts.push("High operational risk; review the constraint reasons before approval.");
  } else if (option.risk_level === "MEDIUM") {
    watchouts.push("Operational constraints are present; review the reason codes before approval.");
  }

  const curfewPenalty = option.score_breakdown.curfew_component ?? 0;
  if (curfewPenalty > 0) {
    watchouts.push(`Curfew penalty applied (${curfewPenalty}).`);
  }

  const riskPenalty = option.score_breakdown.risk_penalty ?? 0;
  if (riskPenalty > 0) {
    watchouts.push(`Risk penalty applied (${riskPenalty}).`);
  }

  const constraintReason = pickConstraintReason(option);
  if (constraintReason && !watchouts.includes(constraintReason)) {
    watchouts.push(constraintReason);
  }

  return watchouts.slice(0, 3);
}

function formatDelta(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function optionLabel(option: RecoveryOption): string {
  return `#${option.rank ?? "-"} ${option.option_type}`;
}

function rankedComponentDeltas(
  option: RecoveryOption,
  benchmark: RecoveryOption,
) {
  const keys = new Set([
    ...Object.keys(option.score_breakdown),
    ...Object.keys(benchmark.score_breakdown),
  ]);

  return [...keys]
    .map((key) => ({
      key,
      delta: (option.score_breakdown[key] ?? 0) - (benchmark.score_breakdown[key] ?? 0),
    }))
    .filter((item) => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function getTailRankingExplanations(
  option: RecoveryOption,
  options: RecoveryOption[],
): string[] {
  if (option.option_type !== "TAIL_ASSIGNMENT_OPTIMIZED") {
    return [];
  }

  const bestNonTail = options
    .filter((candidate) => candidate.option_type !== "TAIL_ASSIGNMENT_OPTIMIZED")
    .sort((a, b) => a.score - b.score)[0];

  if (!bestNonTail) {
    return ["Only generated feasible option; no delay/swap heuristic to compare."];
  }

  const scoreDelta = option.score - bestNonTail.score;
  const scoreText = Math.abs(Math.round(scoreDelta * 100) / 100);
  const summary =
    scoreDelta < 0
      ? `Wins vs best delay/swap heuristic ${optionLabel(bestNonTail)} by ${scoreText} score point(s).`
      : scoreDelta > 0
        ? `Loses vs best delay/swap heuristic ${optionLabel(bestNonTail)} by ${scoreText} score point(s).`
        : `Ties best delay/swap heuristic ${optionLabel(bestNonTail)} on score.`;

  const deltas = rankedComponentDeltas(option, bestNonTail);
  const advantages = deltas
    .filter((item) => item.delta < 0)
    .slice(0, 2)
    .map((item) => `${SCORE_COMPONENT_LABELS[item.key] ?? item.key}: ${formatDelta(item.delta)}`);
  const offsets = deltas
    .filter((item) => item.delta > 0)
    .slice(0, 2)
    .map((item) => `${SCORE_COMPONENT_LABELS[item.key] ?? item.key}: ${formatDelta(item.delta)}`);

  const details: string[] = [];
  if (advantages.length > 0) {
    details.push(`Lower-cost drivers: ${advantages.join(", ")}.`);
  }
  if (offsets.length > 0) {
    details.push(`Tradeoffs: ${offsets.join(", ")}.`);
  }

  return [summary, ...details].slice(0, 3);
}
