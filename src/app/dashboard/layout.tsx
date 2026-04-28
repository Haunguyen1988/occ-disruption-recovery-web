import { DataProvider } from "@/components/data-context";
import { Sidebar } from "@/components/sidebar";
import { getSession, loadOperationalData } from "@/lib/supabase/queries";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = isSupabaseConfigured() ? await getSession() : null;
  const initial = session ? await loadOperationalData() : null;
  return (
    <DataProvider
      initialSession={session}
      initialSchedule={initial?.schedule ?? null}
      initialAircraft={initial?.aircraft ?? null}
      initialDisruption={initial?.disruption ?? null}
    >
      <div className="flex flex-1 min-h-0">
        <Sidebar role={session?.role ?? null} email={session?.email ?? null} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </DataProvider>
  );
}
