export default function AuditPage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-sm text-zinc-500">
        When Supabase is connected, every approved recovery option will appear
        here with timestamp, actor, and reason codes for post-disruption
        review. (Stub — wired in Sprint 3.)
      </p>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-zinc-500">
        No audit entries yet.
      </div>
    </div>
  );
}
