import type { OccRules, RecoveryOption } from "@/lib/types";

export function calculateRecoveryScore(
  option: RecoveryOption,
  rules: OccRules,
): RecoveryOption {
  const w = rules.score_weights ?? ({} as OccRules["score_weights"]);
  const totalDelayWeight = w.total_delay_weight ?? 1.0;
  const maxDelayWeight = w.max_delay_weight ?? 1.5;
  const impactedWeight = w.impacted_flight_weight ?? 10;
  const swapPenalty = w.swap_penalty ?? 25;

  let baseScore =
    option.total_delay_minutes * totalDelayWeight +
    option.max_delay_minutes * maxDelayWeight +
    option.impacted_flight_count * impactedWeight +
    option.swap_count * swapPenalty;

  let riskPenalty = 0;
  if (option.risk_level === "MEDIUM") riskPenalty = 30;
  else if (option.risk_level === "HIGH") riskPenalty = 100;

  if (option.option_type === "SPREAD_DELAY") baseScore *= 0.95;

  option.score = Math.round((baseScore + riskPenalty) * 100) / 100;
  option.score_breakdown = {
    total_delay_component: option.total_delay_minutes * totalDelayWeight,
    max_delay_component: option.max_delay_minutes * maxDelayWeight,
    impacted_flight_component: option.impacted_flight_count * impactedWeight,
    swap_component: option.swap_count * swapPenalty,
    risk_penalty: riskPenalty,
  };
  return option;
}

export function rankRecoveryOptions(
  options: RecoveryOption[],
  rules: OccRules,
): RecoveryOption[] {
  const scored = options.map((o) => calculateRecoveryScore(o, rules));
  const ranked = [...scored].sort((a, b) => a.score - b.score);
  ranked.forEach((option, idx) => {
    option.rank = idx + 1;
    option.recommendation = idx === 0 ? "Recommended" : "Alternative";
    if (idx === 0) {
      option.reason_codes.push("Lowest score among generated feasible options");
    }
  });
  return ranked;
}
