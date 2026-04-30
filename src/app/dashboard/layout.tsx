import { DataProvider } from "@/components/data-context";
import { Sidebar } from "@/components/sidebar";
import { redirect } from "next/navigation";
import {
  getSession,
  loadOperationalData,
  type OperationalLoadError,
} from "@/lib/supabase/queries";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = isSupabaseConfigured();
  const session = configured ? await getSession() : null;
  if (configured && !session) {
    redirect("/login");
  }
  const initial = session ? await loadOperationalData() : null;
  const initialData = initial?.data ?? null;
  const operationalLoadError = initial?.error ?? null;
  return (
    <DataProvider
      initialSession={session}
      initialSchedule={initialData?.schedule ?? null}
      initialAircraft={initialData?.aircraft ?? null}
      initialDisruption={initialData?.disruption ?? null}
      initialOperationalLoadError={operationalLoadError}
    >
      <div className="flex flex-1 min-h-0">
        <Sidebar role={session?.role ?? null} email={session?.email ?? null} />
        <main className="flex-1 overflow-auto p-6">
          {operationalLoadError && (
            <OperationalLoadErrorBanner error={operationalLoadError} />
          )}
          {children}
        </main>
      </div>
    </DataProvider>
  );
}

function OperationalLoadErrorBanner({
  error,
}: {
  error: OperationalLoadError;
}) {
  return (
    <div className="mb-6 rounded border border-[color:var(--danger)] bg-red-50 p-4 text-sm text-red-900">
      <div className="font-semibold">Operational data could not be loaded.</div>
      <p className="mt-1">{error.message}</p>
      <ul className="mt-2 space-y-1 font-mono text-xs">
        {error.issues.map((issue) => (
          <li key={`${issue.source}-${issue.message}`}>
            {issue.source}
            {issue.code ? ` [${issue.code}]` : ""}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
