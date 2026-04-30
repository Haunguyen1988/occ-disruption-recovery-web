import Link from "next/link";
import type { RecoveryOption } from "@/lib/types";
import { cn, formatDateTime, formatUtcIso } from "@/lib/utils";

interface CompareOptionsViewProps {
  options: [RecoveryOption, RecoveryOption];
  backHref: string;
  backLabel: string;
  savedAt?: string;
  simulationUuid?: string;
}

export function CompareOptionsView({
  options,
  backHref,
  backLabel,
  savedAt,
  simulationUuid,
}: CompareOptionsViewProps) {
  const [a, b] = options;
  const winner = pickWinner(a, b);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Compare 2 recovery options
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Side-by-side diff. Lower score is better.
          </p>
          {(savedAt || simulationUuid) && (
            <p className="text-xs text-zinc-500 mt-2">
              {simulationUuid ? `Saved simulation ${simulationUuid}. ` : ""}
              {savedAt ? `Loaded from ${formatUtcIso(savedAt)}.` : ""}
            </p>
          )}
        </div>
        <Link href={backHref} className="text-sm text-zinc-500 hover:text-foreground">
          {backLabel}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <OptionCard option={a} highlight={winner === "a"} />
        <OptionCard option={b} highlight={winner === "b"} />
      </div>

      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-2 w-1/3">Metric</th>
              <th className="p-2">Option A - {a.option_id}</th>
              <th className="p-2">Option B - {b.option_id}</th>
              <th className="p-2 w-32">Delta (B - A)</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Type" a={a.option_type} b={b.option_type} />
            <Row label="Score (lower = better)" a={a.score} b={b.score} delta />
            <Row label="Risk" a={a.risk_level} b={b.risk_level} />
            <Row
              label="Total delay (min)"
              a={a.total_delay_minutes}
              b={b.total_delay_minutes}
              delta
            />
            <Row
              label="Max single delay (min)"
              a={a.max_delay_minutes}
              b={b.max_delay_minutes}
              delta
            />
            <Row
              label="Impacted flights"
              a={a.impacted_flight_count}
              b={b.impacted_flight_count}
              delta
            />
            <Row label="Swaps" a={a.swap_count} b={b.swap_count} delta />
            <Row
              label="Curfew violations"
              a={a.curfew_violations}
              b={b.curfew_violations}
              delta
            />
            <Row
              label="Flight changes"
              a={a.flight_changes.length}
              b={b.flight_changes.length}
              delta
            />
            <Row label="Recommendation" a={a.recommendation} b={b.recommendation} />
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FlightChangesPanel option={a} label="Option A" />
        <FlightChangesPanel option={b} label="Option B" />
      </div>
    </div>
  );
}

function pickWinner(a: RecoveryOption, b: RecoveryOption): "a" | "b" | "tie" {
  if (a.score < b.score) return "a";
  if (b.score < a.score) return "b";
  return "tie";
}

function OptionCard({
  option,
  highlight,
}: {
  option: RecoveryOption;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        highlight ? "border-emerald-500 bg-emerald-50/40" : "border-border",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs">{option.option_id}</span>
        {highlight && (
          <span className="text-[10px] font-mono uppercase text-emerald-700">
            Lower score
          </span>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold">{option.option_type}</div>
      <div className="text-3xl font-bold mt-2">{option.score}</div>
      <div className="text-xs text-zinc-500">{option.recommendation}</div>
      <ul className="mt-3 text-xs space-y-1 list-disc list-inside text-zinc-700">
        {option.reason_codes.slice(0, 5).map((reason, index) => (
          <li key={`${option.option_id}-${index}`}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  label,
  a,
  b,
  delta,
}: {
  label: string;
  a: string | number;
  b: string | number;
  delta?: boolean;
}) {
  let deltaCell = "";
  if (delta && typeof a === "number" && typeof b === "number") {
    const diff = b - a;
    deltaCell = (diff > 0 ? "+" : "") + String(diff);
  }
  return (
    <tr className="border-t border-border">
      <td className="p-2 text-zinc-500">{label}</td>
      <td className="p-2 font-mono">{a}</td>
      <td className="p-2 font-mono">{b}</td>
      <td className="p-2 font-mono text-xs">{delta ? deltaCell : "-"}</td>
    </tr>
  );
}

function FlightChangesPanel({
  option,
  label,
}: {
  option: RecoveryOption;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="p-3 border-b border-border">
        <h3 className="font-semibold text-sm">
          {label} - flight changes ({option.flight_changes.length})
        </h3>
      </div>
      {option.flight_changes.length === 0 ? (
        <div className="p-3 text-sm text-zinc-500">No flight changes.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-left text-zinc-500 border-b border-border">
              <tr>
                <th className="p-2">Flight</th>
                <th className="p-2">A/C</th>
                <th className="p-2">New STD</th>
                <th className="p-2">Delta min</th>
              </tr>
            </thead>
            <tbody>
              {option.flight_changes.map((change) => (
                <tr
                  key={change.flight_id}
                  className="border-b border-border/50 last:border-b-0"
                >
                  <td className="p-2">{change.flight_number}</td>
                  <td className="p-2">
                    {change.original_aircraft}
                    {change.new_aircraft !== change.original_aircraft &&
                      ` -> ${change.new_aircraft}`}
                  </td>
                  <td className="p-2">{formatDateTime(change.new_std)}</td>
                  <td
                    className={cn(
                      "p-2",
                      change.delay_minutes > 0 && "text-amber-700 font-bold",
                    )}
                  >
                    {change.delay_minutes > 0 ? `+${change.delay_minutes}` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
