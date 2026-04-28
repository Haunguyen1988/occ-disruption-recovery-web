import { listAuditLog, listSimulations } from "@/lib/supabase/queries";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
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
          run the migration in supabase/migrations/0001_init.sql, then sign in.
        </div>
      </div>
    );
  }

  const [entries, sims] = await Promise.all([
    listAuditLog(100),
    listSimulations(20),
  ]);

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Append-only record of imports, simulations, approvals, and exports.
          Use this for post-disruption review.
        </p>
      </div>

      <section>
        <h2 className="font-semibold mb-2">Saved simulations</h2>
        {sims.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-zinc-500 text-center">
            No saved simulations yet. Run a simulation and click <em>Save
            simulation</em>.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">UUID</th>
                  <th className="p-2">When</th>
                  <th className="p-2">Event</th>
                  <th className="p-2">Options</th>
                  <th className="p-2">Best score</th>
                  <th className="p-2">Approved</th>
                </tr>
              </thead>
              <tbody>
                {sims.map((s) => (
                  <tr key={s.uuid} className="border-t border-border">
                    <td className="p-2">{s.uuid.slice(0, 8)}…</td>
                    <td className="p-2">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="p-2">{s.event_label ?? "—"}</td>
                    <td className="p-2">{s.option_count}</td>
                    <td className="p-2">
                      {s.best_score !== null ? s.best_score : "—"}
                    </td>
                    <td className="p-2">
                      {s.approved ? (
                        <span className="text-emerald-700 font-bold">YES</span>
                      ) : (
                        "—"
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
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-zinc-500 text-center">
            No activity yet.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Actor</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Entity</th>
                  <th className="p-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="p-2">{e.actor_email ?? "system"}</td>
                    <td className="p-2 uppercase">{e.action}</td>
                    <td className="p-2">
                      {e.entity_type}
                      {e.entity_id ? ` ${e.entity_id}` : ""}
                    </td>
                    <td className="p-2 text-zinc-500 break-all">
                      {e.payload ? JSON.stringify(e.payload) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        Need a deeper view?{" "}
        <Link
          href="/dashboard/simulate"
          className="underline underline-offset-2"
        >
          Open the simulator
        </Link>
        .
      </p>
    </div>
  );
}
