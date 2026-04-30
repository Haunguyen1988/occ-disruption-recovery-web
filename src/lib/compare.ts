import type { RecoveryOption } from "@/lib/types";

export interface ComparePayload {
  saved_at: string;
  options: RecoveryOption[];
  simulation_uuid?: string;
}

export function hydrateRecoveryOption(option: RecoveryOption): RecoveryOption {
  return {
    ...option,
    flight_changes: option.flight_changes.map((change) => ({
      ...change,
      original_std: new Date(change.original_std),
      original_sta: new Date(change.original_sta),
      new_std: new Date(change.new_std),
      new_sta: new Date(change.new_sta),
    })),
  };
}

export function hydrateComparePayload(payload: ComparePayload): ComparePayload {
  return {
    ...payload,
    options: payload.options.map(hydrateRecoveryOption),
  };
}

export function selectCompareOptions<T extends { option_id: string }>(
  options: T[],
  optionIds: string[],
): T[] | null {
  if (optionIds.length !== 2) return null;
  if (optionIds[0] === optionIds[1]) return null;

  const byId = new Map(options.map((option) => [option.option_id, option]));
  const selected = optionIds
    .map((id) => byId.get(id))
    .filter((option): option is T => Boolean(option));

  return selected.length === 2 ? selected : null;
}
