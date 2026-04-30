import {
  listAuditLog,
  listSimulations,
  type AuditEntry,
  type SimulationListItem,
} from "@/lib/supabase/queries";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { formatUtcIso } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface AuditPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const configured = isSupabaseConfigured();
  if (!configured) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-zinc-500">
          Supabase environment variables are not set. Audit log persistence is
          disabled in stub mode.
        </p>
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-zinc-500">
          Configure NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY,
          run the Supabase migrations in order through
          supabase/migrations/0003_approval_safety.sql, then sign in.
        </div>
      </div>
    );
  }

  const rawSearch = await searchParams;
  const queryValue = Array.isArray(rawSearch.q) ? rawSearch.q[0] : rawSearch.q;
  const query = queryValue?.trim() ?? "";
  const queryLower = query.toLowerCase();

  const [entries, sims] = await Promise.all([
    listAuditLog(200),
    listSimulations(50),
  ]);

  const filteredEntries = query
    ? entries.filter((entry) => auditEntryMatchesQuery(entry, queryLower))
    : entries;
  const filteredSims = query
    ? sims.filter((simulation) => simulationMatchesQuery(simulation, queryLower))
    : sims;

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Append-only record of imports, simulations, approvals, and exports.
            Timestamps below are shown in UTC ISO 8601.
          </p>
        </div>

        <form action="/dashboard/audit" className="flex flex-wrap gap-2">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Filter by UUID, action, actor, event, or option"
            className="h-9 min-w-[18rem] rounded-md border border-border bg-background px-3 text-sm"
          />
          <button
            type="submit"
            className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            Filter
          </button>
          {query && (
            <Link
              href="/dashboard/audit"
              className="h-9 rounded-md border border-border px-3 text-sm leading-9 hover:bg-muted"
            >
              Clear
            </Link>
          )}
        </form>

        <p className="text-xs text-zinc-500">
          Showing {filteredSims.length}/{sims.length} saved simulations and{" "}
          {filteredEntries.length}/{entries.length} activity rows.
        </p>
      </div>

      <section>
        <h2 className="font-semibold mb-2">Saved simulations</h2>
        {filteredSims.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-zinc-500 text-center">
            {query
              ? "No saved simulations match the current filter."
              : "No saved simulations yet. Run a simulation and click Save simulation."}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">UUID</th>
                  <th className="p-2">When (UTC)</th>
                  <th className="p-2">Event</th>
                  <th className="p-2">Options</th>
                  <th className="p-2">Best score</th>
                  <th className="p-2">Approved</th>
                </tr>
              </thead>
              <tbody>
                {filteredSims.map((simulation) => (
                  <tr
                    key={simulation.uuid}
                    className="border-t border-border align-top"
                  >
                    <td className="p-2">
                      <Link
                        href={`/dashboard/audit/${simulation.uuid}`}
                        className="underline underline-offset-2"
                      >
                        {shortUuid(simulation.uuid)}
                      </Link>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {formatUtcIso(simulation.created_at)}
                    </td>
                    <td className="p-2">{simulation.event_label ?? "-"}</td>
                    <td className="p-2">{simulation.option_count}</td>
                    <td className="p-2">
                      {simulation.best_score !== null ? simulation.best_score : "-"}
                    </td>
                    <td className="p-2">
                      {simulation.approved ? (
                        <span className="text-emerald-700 font-bold">YES</span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Activity feed</h2>
        {filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-zinc-500 text-center">
            {query ? "No activity rows match the current filter." : "No activity yet."}
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
                {filteredEntries.map((entry) => {
                  const simulationUuid = getSimulationUuidFromEntry(entry);
                  return (
                    <tr
                      key={entry.id}
                      className="border-t border-border align-top"
                    >
                      <td className="p-2 whitespace-nowrap">
                        {formatUtcIso(entry.created_at)}
                      </td>
                      <td className="p-2">{entry.actor_email ?? "system"}</td>
                      <td className="p-2 uppercase">{entry.action}</td>
                      <td className="p-2">
                        <div>
                          {entry.entity_type}
                          {entry.entity_id ? ` ${entry.entity_id}` : ""}
                        </div>
                        {simulationUuid && (
                          <Link
                            href={`/dashboard/audit/${simulationUuid}`}
                            className="mt-1 inline-block underline underline-offset-2"
                          >
                            simulation {shortUuid(simulationUuid)}
                          </Link>
                        )}
                      </td>
                      <td className="p-2 text-zinc-500 break-all">
                        {entry.payload ? JSON.stringify(entry.payload) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        Need a deeper view? Open a saved simulation UUID above to inspect its
        approved option, score, and flight changes.
      </p>
    </div>
  );
}

function shortUuid(uuid: string): string {
  return `${uuid.slice(0, 8)}...`;
}

function auditEntryMatchesQuery(entry: AuditEntry, query: string): boolean {
  const haystack = [
    entry.actor_email ?? "",
    entry.action,
    entry.entity_type,
    entry.entity_id ?? "",
    getSimulationUuidFromEntry(entry) ?? "",
    entry.created_at,
    entry.payload ? JSON.stringify(entry.payload) : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function simulationMatchesQuery(
  simulation: SimulationListItem,
  query: string,
): boolean {
  const haystack = [
    simulation.uuid,
    simulation.created_at,
    simulation.event_label ?? "",
    String(simulation.option_count),
    simulation.best_score ?? "",
    simulation.approved ? "approved" : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function getSimulationUuidFromEntry(entry: AuditEntry): string | null {
  if (entry.entity_type === "simulation" && entry.entity_id) {
    return entry.entity_id;
  }
  const simulationUuid = entry.payload?.simulation_uuid;
  return typeof simulationUuid === "string" ? simulationUuid : null;
}
