import type { TailAssignmentConfig, TailAssignmentMode } from "./types";
import { DEFAULT_TAIL_ASSIGNMENT_CONFIG } from "./types";

export const TAIL_ASSIGNMENT_MODE_CONFIGS: Record<
  TailAssignmentMode,
  TailAssignmentConfig
> = {
  fast: {
    ...DEFAULT_TAIL_ASSIGNMENT_CONFIG,
    horizon_hours: 12,
    max_paths_per_aircraft: 40,
    max_labels_per_aircraft: 250,
    max_master_search_nodes: 10_000,
  },
  balanced: DEFAULT_TAIL_ASSIGNMENT_CONFIG,
  deep: {
    ...DEFAULT_TAIL_ASSIGNMENT_CONFIG,
    horizon_hours: 24,
    max_paths_per_aircraft: 120,
    max_labels_per_aircraft: 1_000,
    max_master_search_nodes: 100_000,
  },
};

export function normalizeTailAssignmentMode(
  value: string | null | undefined,
): TailAssignmentMode {
  return value === "fast" || value === "deep" ? value : "balanced";
}

export function configForTailAssignmentMode(
  mode: TailAssignmentMode,
  overrides?: Partial<TailAssignmentConfig>,
): TailAssignmentConfig {
  return { ...TAIL_ASSIGNMENT_MODE_CONFIGS[mode], ...overrides };
}
