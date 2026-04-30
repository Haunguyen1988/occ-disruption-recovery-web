import { getSimulation, listAuditLog, type AuditEntry } from "@/lib/supabase/queries";
import { formatUtcIso } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface SimulationDetailPageProps {
  params: Promise<{ uuid: string }>;
}

export default async function SimulationDetailPage({
  params,
}: SimulationDetailPageProps) {
  const { uuid } = await params;
  const [simulation, entries] = await Promise.all([
    getSimulation(uuid),
    listAuditLog(200),
  ]);

  if (!simulation) {
    notFound();
  }

  const relatedEntries = entries.filter((entry) => {
    const simulationUuid = getSimulationUuidFromEntry(entry);
    return simulationUuid === simulation.uuid;
  });
  const approvedOption =
    simulation.options.find((option) => option.approved) ?? null;

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="space-y-3">
        <Link
          href="/dashboard/audit"
          className="text-sm text-zinc-500 hover:text-foreground"
        >
          Back to Audit
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Simulation detail
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Saved recovery options and related audit activity for one simulation.
            Timestamps below are shown in UTC ISO 8601.
          </p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Simulation UUID" value={simulation.uuid} mono />
        <SummaryCard
          label="Created at (UTC)"
          value={formatUtcIso(simulation.created_at)}
          mono
        />
        <SummaryCard
          label="Primary event"
          value={`${simulation.result.event.event_type} ${simulation.result.event.event_id}`}
        />
        <SummaryCard
          label="Impacted / options"
          value={`${simulation.result.impacted_flights.length} / ${simulation.options.length}`}
        />
      </section>

      {approvedOption && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-semibold">Approved option</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 text-sm">
            <SummaryCard
              label="Option"
              value={`#${approvedOption.rank ?? "-"} ${approvedOption.option_id}`}
              mono
            />
            <SummaryCard label="Score" value={String(approvedOption.score)} mono />
            <SummaryCard
              label="Approved by"
              value={approvedOption.approved_by_email ?? "unknown"}
            />
            <SummaryCard
              label="Approved at (UTC)"
              value={
                approvedOption.approved_at
                  ? formatUtcIso(approvedOption.approved_at)
                  : "unknown"
              }
              mono
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Related audit activity</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Includes save and approval actions tied to this simulation UUID.
          </p>
        </div>
        {relatedEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-zinc-500 text-center">
            No related audit rows were found.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">When (UTC)</th>
                  <th className="p-2">Actor</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Entity</th>
                  <th className="p-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {relatedEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-border align-top">
                    <td className="p-2 whitespace-nowrap">
                      {formatUtcIso(entry.created_at)}
                    </td>
                    <td className="p-2">{entry.actor_email ?? "system"}</td>
                    <td className="p-2 uppercase">{entry.action}</td>
                    <td className="p-2">
                      {entry.entity_type}
                      {entry.entity_id ? ` ${entry.entity_id}` : ""}
                    </td>
                    <td className="p-2 text-zinc-500 break-all">
                      {entry.payload ? JSON.stringify(entry.payload) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Saved recovery options</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Inspect old options here without rerunning the simulation.
          </p>
        </div>
        {simulation.options.map((option) => (
          <article
            key={option.option_id}
            className="rounded-lg border border-border p-4 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">
                    Option #{option.rank ?? "-"} {option.option_type}
                  </h3>
                  <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono">
                    {option.option_id}
                  </span>
                  {option.approved && (
                    <span className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-mono text-white">
                      APPROVED
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {option.recommendation || "No recommendation text."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <Metric label="Score" value={String(option.score)} />
                <Metric label="Risk" value={option.risk_level} />
                <Metric
                  label="Total / max delay"
                  value={`${option.total_delay_minutes} / ${option.max_delay_minutes}`}
                />
                <Metric
                  label="Impact / swaps"
                  value={`${option.impacted_flight_count} / ${option.swap_count}`}
                />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Reason codes</h4>
              {option.reason_codes.length === 0 ? (
                <p className="text-sm text-zinc-500">No reason codes.</p>
              ) : (
                <ul className="list-disc list-inside space-y-1 text-sm text-zinc-700">
                  {option.reason_codes.map((reason, index) => (
                    <li key={`${option.option_id}-${index}`}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Score breakdown</h4>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5 text-xs">
                {Object.entries(option.score_breakdown).map(([key, value]) => (
                  <div
                    key={`${option.option_id}-${key}`}
                    className="rounded border border-border p-2"
                  >
                    <div className="text-zinc-500">{key.replace(/_/g, " ")}</div>
                    <div className="font-mono font-semibold">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">
                Flight changes ({option.flight_changes.length})
              </h4>
              {option.flight_changes.length === 0 ? (
                <p className="text-sm text-zinc-500">No flight changes.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="border-b border-border text-left text-zinc-500">
                      <tr>
                        <th className="py-1 pr-3">Flight</th>
                        <th className="py-1 pr-3">Route</th>
                        <th className="py-1 pr-3">Aircraft</th>
                        <th className="py-1 pr-3">Old STD (UTC)</th>
                        <th className="py-1 pr-3">New STD (UTC)</th>
                        <th className="py-1 pr-3">Old STA (UTC)</th>
                        <th className="py-1 pr-3">New STA (UTC)</th>
                        <th className="py-1 pr-3">Delay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {option.flight_changes.map((change) => (
                        <tr
                          key={`${option.option_id}-${change.flight_id}`}
                          className="border-b border-border/50 last:border-b-0"
                        >
                          <td className="py-1 pr-3">{change.flight_number}</td>
                          <td className="py-1 pr-3">
                            {change.origin}-{change.destination}
                          </td>
                          <td className="py-1 pr-3">
                            {change.original_aircraft}
                            {change.new_aircraft !== change.original_aircraft &&
                              ` -> ${change.new_aircraft}`}
                          </td>
                          <td className="py-1 pr-3">
                            {formatUtcIso(change.original_std)}
                          </td>
                          <td className="py-1 pr-3">
                            {formatUtcIso(change.new_std)}
                          </td>
                          <td className="py-1 pr-3">
                            {formatUtcIso(change.original_sta)}
                          </td>
                          <td className="py-1 pr-3">
                            {formatUtcIso(change.new_sta)}
                          </td>
                          <td className="py-1 pr-3">
                            {change.delay_minutes > 0 ? `+${change.delay_minutes}` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={mono ? "mt-1 text-sm font-mono break-all" : "mt-1 text-sm"}>
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function getSimulationUuidFromEntry(entry: AuditEntry): string | null {
  if (entry.entity_type === "simulation" && entry.entity_id) {
    return entry.entity_id;
  }
  const simulationUuid = entry.payload?.simulation_uuid;
  return typeof simulationUuid === "string" ? simulationUuid : null;
}
