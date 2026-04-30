import type { RecoveryOption } from "@/lib/types";

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
