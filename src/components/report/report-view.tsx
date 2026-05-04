import Link from "next/link";
import type { AuditEntry, SimulationDetail } from "@/lib/supabase/queries";
import type {
  RecoveryOption,
  TailAssignmentOptimizationFeedback,
} from "@/lib/types";
import { formatDateTime, formatUtcIso } from "@/lib/utils";
import {
  DelayPassengerChart,
  OptionScoreChart,
  ScoreBreakdownChart,
} from "./report-charts";
import { ReportPrintButton } from "./report-print-button";

export function SimulationReportView({
  simulation,
  auditEntries,
  autoPrint = false,
}: {
  simulation: SimulationDetail;
  auditEntries: AuditEntry[];
  autoPrint?: boolean;
}) {
  const approvedOptionId =
    simulation.options.find((option) => option.approved)?.option_id ?? null;
  const options = mergeApprovalState(
    simulation.result.ranked_options,
    simulation.options,
  );
  const bestOption = options[0] ?? null;
  const approvedOption =
    options.find((option) => option.option_id === approvedOptionId) ?? null;
  const featuredOption = approvedOption ?? bestOption;
  const totalAffectedPassengers = sumMetric(options, (option) =>
    option.passenger_impact?.estimated_affected_passengers ?? 0,
  );
  const tailFeedback = simulation.result.feedback?.tail_assignment ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 report-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            href={`/dashboard/audit/${simulation.uuid}`}
            className="no-print text-sm text-zinc-500 hover:text-foreground"
          >
            Back to simulation detail
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              OCC Recovery Report
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {simulation.result.event.event_type} {simulation.result.event.event_id}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500">
              {simulation.result.event.description || "No event description."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportPrintButton autoPrint={autoPrint} />
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Simulation UUID" value={simulation.uuid} mono />
        <MetricTile
          label="Created at (UTC)"
          value={formatUtcIso(simulation.created_at)}
          mono
        />
        <MetricTile
          label="Event window (VN)"
          value={`${formatDateTime(simulation.result.event.start_time)} - ${formatDateTime(
            simulation.result.event.end_time,
          )}`}
        />
        <MetricTile
          label="Impacted / options"
          value={`${simulation.result.impacted_flights.length} / ${options.length}`}
          mono
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-panel p-4 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Executive summary</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Best available operational outcome from the saved simulation.
              </p>
            </div>
            {featuredOption && (
              <RiskBadge risk={featuredOption.risk_level} label={featuredOption.option_type} />
            )}
          </div>
          {featuredOption ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label={approvedOption ? "Approved option" : "Best option"}
                value={`#${featuredOption.rank ?? "-"} ${featuredOption.option_id}`}
                mono
              />
              <MetricTile
                label="Score"
                value={featuredOption.score.toLocaleString()}
                mono
              />
              <MetricTile
                label="Total / max delay"
                value={`${featuredOption.total_delay_minutes} / ${featuredOption.max_delay_minutes} min`}
                mono
              />
              <MetricTile
                label="Affected pax"
                value={String(
                  featuredOption.passenger_impact?.estimated_affected_passengers ?? 0,
                )}
                mono
              />
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No recovery options were saved for this simulation.
            </p>
          )}
          {featuredOption?.recommendation && (
            <p className="mt-4 rounded border border-border bg-muted/40 p-3 text-sm">
              {featuredOption.recommendation}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-panel p-4">
          <h2 className="font-semibold">Network impact</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MetricTile
              label="Impacted flights"
              value={String(simulation.result.impacted_flights.length)}
              mono
            />
            <MetricTile
              label="Option set"
              value={String(options.length)}
              mono
            />
            <MetricTile
              label="Pax exposure"
              value={totalAffectedPassengers.toLocaleString()}
              mono
            />
            <MetricTile
              label="Approved"
              value={approvedOptionId ? "Yes" : "No"}
              mono
            />
          </div>
        </div>
      </section>

      {options.length > 0 && (
        <section className="grid gap-4 xl:grid-cols-2">
          <ReportPanel
            title="Option ranking"
            description="Lower score is better; approved option is highlighted."
          >
            <OptionScoreChart options={options} approvedOptionId={approvedOptionId} />
          </ReportPanel>
          <ReportPanel
            title="Delay and passenger impact"
            description="Operational delay and passenger exposure by option."
          >
            <DelayPassengerChart options={options} />
          </ReportPanel>
          <ReportPanel
            title="Score breakdown"
            description="Major score components behind each option."
            wide
          >
            <ScoreBreakdownChart options={options} />
          </ReportPanel>
        </section>
      )}

      {featuredOption && (
        <section className="rounded-lg border border-border bg-panel p-4 report-section">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Recommended recovery plan</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Flight impact plan for {approvedOption ? "the approved" : "the best-ranked"} option.
              </p>
            </div>
            <RiskBadge risk={featuredOption.risk_level} label={featuredOption.option_type} />
          </div>
          <FlightChangesTable option={featuredOption} />
        </section>
      )}

      {featuredOption?.passenger_impact && (
        <section className="rounded-lg border border-border bg-panel p-4 report-section">
          <h2 className="font-semibold">Passenger impact detail</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Affected pax"
              value={featuredOption.passenger_impact.estimated_affected_passengers.toLocaleString()}
              mono
            />
            <MetricTile
              label="Pax delay minutes"
              value={featuredOption.passenger_impact.passenger_delay_minutes.toLocaleString()}
              mono
            />
            <MetricTile
              label="Misconnect risk"
              value={featuredOption.passenger_impact.misconnect_risk_passengers.toLocaleString()}
              mono
            />
            <MetricTile
              label="Priority score"
              value={Math.round(
                featuredOption.passenger_impact.priority_passenger_score,
              ).toLocaleString()}
              mono
            />
          </div>
          <TopPassengerFlightsTable option={featuredOption} />
        </section>
      )}

      {tailFeedback && (
        <TailDiagnostics feedback={tailFeedback} />
      )}

      <section className="rounded-lg border border-border bg-panel p-4 report-section">
        <h2 className="font-semibold">Audit trail</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Save, approval, and export activity tied to this simulation.
        </p>
        <AuditTable entries={auditEntries} />
      </section>
    </div>
  );
}

function mergeApprovalState(
  resultOptions: RecoveryOption[],
  storedOptions: SimulationDetail["options"],
): RecoveryOption[] {
  const storedById = new Map(storedOptions.map((option) => [option.option_id, option]));
  return resultOptions.map((option) => {
    const stored = storedById.get(option.option_id);
    return {
      ...option,
      rank: stored?.rank ?? option.rank,
      score: stored?.score ?? option.score,
      risk_level: stored?.risk_level ?? option.risk_level,
    };
  });
}

function ReportPanel({
  title,
  description,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-panel p-4 report-section ${
        wide ? "xl:col-span-2" : ""
      }`}
    >
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-background/60 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={mono ? "mt-1 break-all font-mono text-sm font-semibold" : "mt-1 text-sm font-semibold"}>
        {value}
      </div>
    </div>
  );
}

function RiskBadge({ risk, label }: { risk: string; label: string }) {
  const riskClass =
    risk === "LOW"
      ? "bg-emerald-100 text-emerald-800"
      : risk === "HIGH"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex rounded px-2 py-1 text-[11px] font-mono font-semibold ${riskClass}`}>
      {label} / {risk}
    </span>
  );
}

function FlightChangesTable({ option }: { option: RecoveryOption }) {
  if (option.flight_changes.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500">No flight changes.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs font-mono">
        <thead className="border-b border-border text-zinc-500">
          <tr>
            <th className="py-2 pr-3">Flight</th>
            <th className="py-2 pr-3">Route</th>
            <th className="py-2 pr-3">Aircraft</th>
            <th className="py-2 pr-3">Old STD</th>
            <th className="py-2 pr-3">New STD</th>
            <th className="py-2 pr-3">Old STA</th>
            <th className="py-2 pr-3">New STA</th>
            <th className="py-2 pr-3 text-right">Delay</th>
          </tr>
        </thead>
        <tbody>
          {option.flight_changes.slice(0, 40).map((change) => (
            <tr key={`${option.option_id}-${change.flight_id}`} className="border-b border-border/50">
              <td className="py-2 pr-3">{change.flight_number}</td>
              <td className="py-2 pr-3">
                {change.origin}-{change.destination}
              </td>
              <td className="py-2 pr-3">
                {change.original_aircraft}
                {change.new_aircraft !== change.original_aircraft &&
                  ` -> ${change.new_aircraft}`}
              </td>
              <td className="py-2 pr-3">{formatDateTime(change.original_std)}</td>
              <td className="py-2 pr-3">{formatDateTime(change.new_std)}</td>
              <td className="py-2 pr-3">{formatDateTime(change.original_sta)}</td>
              <td className="py-2 pr-3">{formatDateTime(change.new_sta)}</td>
              <td className="py-2 pr-3 text-right">
                {change.delay_minutes > 0 ? `+${change.delay_minutes}` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {option.flight_changes.length > 40 && (
        <p className="mt-2 text-xs text-zinc-500">
          Showing first 40 of {option.flight_changes.length} flight changes.
        </p>
      )}
    </div>
  );
}

function TopPassengerFlightsTable({ option }: { option: RecoveryOption }) {
  const flights = option.passenger_impact?.top_impacted_flights ?? [];
  if (flights.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500">No top passenger-impact flights available.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs font-mono">
        <thead className="border-b border-border text-zinc-500">
          <tr>
            <th className="py-2 pr-3">Flight</th>
            <th className="py-2 pr-3 text-right">Est pax</th>
            <th className="py-2 pr-3 text-right">Affected</th>
            <th className="py-2 pr-3 text-right">Pax delay</th>
            <th className="py-2 pr-3 text-right">Misconnect</th>
            <th className="py-2 pr-3 text-right">Priority</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <tr key={`${option.option_id}-${flight.flight_id}`} className="border-b border-border/50">
              <td className="py-2 pr-3">{flight.flight_number}</td>
              <td className="py-2 pr-3 text-right">{flight.estimated_passengers}</td>
              <td className="py-2 pr-3 text-right">{flight.affected_passengers}</td>
              <td className="py-2 pr-3 text-right">{flight.passenger_delay_minutes}</td>
              <td className="py-2 pr-3 text-right">{flight.misconnect_risk_passengers}</td>
              <td className="py-2 pr-3 text-right">
                {Math.round(flight.priority_passenger_score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TailDiagnostics({
  feedback,
}: {
  feedback: TailAssignmentOptimizationFeedback;
}) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4 report-section">
      <h2 className="font-semibold">Aircraft recovery optimization diagnostics</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Mode" value={feedback.mode} mono />
        <MetricTile
          label="Horizon / aircraft"
          value={`${feedback.horizon_flight_count} / ${feedback.aircraft_count}`}
          mono
        />
        <MetricTile
          label="Arc reduction"
          value={`${feedback.original_arc_count} -> ${feedback.reduced_arc_count} (${feedback.arc_reduction_pct.toFixed(1)}%)`}
          mono
        />
        <MetricTile
          label="Paths / search nodes"
          value={`${feedback.path_count} / ${feedback.search_nodes}`}
          mono
        />
        <MetricTile
          label="Complete solutions"
          value={String(feedback.complete_solution_count)}
          mono
        />
        <MetricTile
          label="Covered required"
          value={`${feedback.best_covered_flight_count} / ${feedback.required_flight_count}`}
          mono
        />
        <MetricTile
          label="Fixed connections"
          value={String(feedback.fixed_connection_count)}
          mono
        />
        <MetricTile
          label="Optimized options"
          value={String(feedback.option_count)}
          mono
        />
      </div>
      {feedback.no_option_reason && (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          No optimized option reason: {feedback.no_option_reason}
        </p>
      )}
      {feedback.top_blocking_reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {feedback.top_blocking_reasons.map((item) => (
            <span
              key={item.reason}
              className="rounded border border-border bg-background px-2 py-1 font-mono"
            >
              {item.reason}: {item.count}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="mt-3 text-sm text-zinc-500">No related audit rows were found.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs font-mono">
        <thead className="border-b border-border text-zinc-500">
          <tr>
            <th className="py-2 pr-3">When (UTC)</th>
            <th className="py-2 pr-3">Actor</th>
            <th className="py-2 pr-3">Action</th>
            <th className="py-2 pr-3">Entity</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border/50">
              <td className="py-2 pr-3">{formatUtcIso(entry.created_at)}</td>
              <td className="py-2 pr-3">{entry.actor_email ?? "system"}</td>
              <td className="py-2 pr-3 uppercase">{entry.action}</td>
              <td className="py-2 pr-3">
                {entry.entity_type}
                {entry.entity_id ? ` ${entry.entity_id}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sumMetric(
  options: RecoveryOption[],
  getValue: (option: RecoveryOption) => number,
): number {
  return options.reduce((sum, option) => sum + getValue(option), 0);
}
