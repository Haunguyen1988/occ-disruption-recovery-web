import type { RecoveryOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPTION_COLORS: Record<string, string> = {
  DELAY_ONLY: "#2563eb",
  SPREAD_DELAY: "#0f766e",
  DEEP_DELAY: "#7c3aed",
  SINGLE_SWAP: "#ca8a04",
  SWAP_CHAIN: "#ea580c",
  TAIL_ASSIGNMENT_OPTIMIZED: "#059669",
  CANCEL_OR_FERRY: "#dc2626",
};

const BREAKDOWN_COLORS = [
  "#2563eb",
  "#0f766e",
  "#ca8a04",
  "#7c3aed",
  "#dc2626",
  "#475569",
  "#0891b2",
  "#be123c",
];

export function OptionScoreChart({
  options,
  approvedOptionId,
}: {
  options: RecoveryOption[];
  approvedOptionId: string | null;
}) {
  const maxScore = Math.max(...options.map((option) => option.score), 1);

  return (
    <div className="space-y-3">
      {options.map((option) => {
        const width = Math.max((option.score / maxScore) * 100, 2);
        const isApproved = option.option_id === approvedOptionId;
        return (
          <div key={option.option_id} className="grid grid-cols-[8.5rem_1fr_5rem] items-center gap-3 text-xs">
            <div className="min-w-0">
              <div className="truncate font-mono font-semibold">
                #{option.rank ?? "-"} {option.option_id}
              </div>
              <div className="truncate text-zinc-500">{option.option_type}</div>
            </div>
            <div className="h-8 rounded border border-border bg-muted">
              <div
                className={cn(
                  "flex h-full items-center justify-end rounded-sm px-2 font-mono text-[11px] text-white",
                  isApproved && "ring-2 ring-emerald-500 ring-offset-2",
                )}
                style={{
                  width: `${width}%`,
                  backgroundColor: OPTION_COLORS[option.option_type] ?? "#334155",
                }}
              >
                {isApproved ? "APPROVED" : ""}
              </div>
            </div>
            <div className="text-right font-mono font-semibold">
              {formatNumber(option.score)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DelayPassengerChart({ options }: { options: RecoveryOption[] }) {
  const rows = options.map((option) => ({
    option,
    totalDelay: option.total_delay_minutes,
    maxDelay: option.max_delay_minutes,
    passengers: option.passenger_impact?.estimated_affected_passengers ?? 0,
    misconnect: option.passenger_impact?.misconnect_risk_passengers ?? 0,
  }));
  const maxValue = Math.max(
    ...rows.flatMap((row) => [
      row.totalDelay,
      row.maxDelay,
      row.passengers,
      row.misconnect,
    ]),
    1,
  );

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.option.option_id} className="grid grid-cols-[8.5rem_1fr] gap-3 text-xs">
          <div className="min-w-0 pt-1">
            <div className="truncate font-mono font-semibold">
              #{row.option.rank ?? "-"} {row.option.option_id}
            </div>
            <div className="truncate text-zinc-500">{row.option.risk_level} risk</div>
          </div>
          <div className="space-y-1">
            <MetricBar label="Delay" value={row.totalDelay} maxValue={maxValue} color="#2563eb" suffix="m" />
            <MetricBar label="Max" value={row.maxDelay} maxValue={maxValue} color="#ca8a04" suffix="m" />
            <MetricBar label="Pax" value={row.passengers} maxValue={maxValue} color="#0f766e" />
            <MetricBar label="Misconn" value={row.misconnect} maxValue={maxValue} color="#dc2626" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScoreBreakdownChart({ options }: { options: RecoveryOption[] }) {
  const keys = Array.from(
    new Set(options.flatMap((option) => Object.keys(option.score_breakdown))),
  );

  return (
    <div className="space-y-3">
      {options.map((option) => {
        const entries = keys
          .map((key) => ({ key, value: Math.max(option.score_breakdown[key] ?? 0, 0) }))
          .filter((entry) => entry.value > 0);
        const total = entries.reduce((sum, entry) => sum + entry.value, 0) || 1;
        return (
          <div key={option.option_id} className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono font-semibold">
                #{option.rank ?? "-"} {option.option_id}
              </span>
              <span className="font-mono text-zinc-500">{formatNumber(option.score)}</span>
            </div>
            <div className="flex h-7 overflow-hidden rounded border border-border bg-muted">
              {entries.length === 0 ? (
                <div className="flex w-full items-center px-2 text-zinc-500">
                  No positive score components
                </div>
              ) : (
                entries.map((entry, index) => (
                  <div
                    key={`${option.option_id}-${entry.key}`}
                    title={`${entry.key}: ${entry.value}`}
                    className="h-full"
                    style={{
                      width: `${(entry.value / total) * 100}%`,
                      backgroundColor: BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length],
                    }}
                  />
                ))
              )}
            </div>
            {entries.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                {entries.slice(0, 8).map((entry, index) => (
                  <span key={`${option.option_id}-${entry.key}-legend`} className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{
                        backgroundColor:
                          BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length],
                      }}
                    />
                    {entry.key.replace(/_/g, " ")} {formatNumber(entry.value)}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MetricBar({
  label,
  value,
  maxValue,
  color,
  suffix = "",
}: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
  suffix?: string;
}) {
  const width = value > 0 ? Math.max((value / maxValue) * 100, 2) : 0;
  return (
    <div className="grid grid-cols-[4.2rem_1fr_4.5rem] items-center gap-2">
      <div className="text-zinc-500">{label}</div>
      <div className="h-4 rounded bg-muted">
        <div
          className="h-full rounded-sm"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-right font-mono">
        {formatNumber(value)}
        {suffix}
      </div>
    </div>
  );
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString();
}
