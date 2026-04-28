import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-3xl w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
            OCC
          </div>
          <span className="text-sm uppercase tracking-widest text-zinc-500">
            Disruption Recovery — MVP
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-semibold leading-tight tracking-tight">
          Decision support for airline OCC during irregular operations.
        </h1>
        <p className="mt-6 text-lg text-zinc-600 dark:text-zinc-400">
          Detect impacted flights, simulate delay-only / spread / deep-delay /
          single-swap recovery options, decode METAR / NOTAM alerts, and export
          an audit-ready plan for manual AIMS update.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            Open dashboard →
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-md border border-border px-6 text-sm font-medium hover:bg-muted transition"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-16 grid sm:grid-cols-2 gap-4 text-sm">
          <Feature
            title="Schedule overview"
            body="Gantt-style rotation timeline with disruption highlights and downstream impact propagation."
          />
          <Feature
            title="Recovery options"
            body="Ranked DELAY_ONLY / SPREAD / DEEP / SINGLE_SWAP with explainable reason codes and score breakdown."
          />
          <Feature
            title="MET / NOTAM decoder"
            body="Paste METAR/TAF/NOTAM messages → structured alerts when conditions fall below configured minima."
          />
          <Feature
            title="Audit export"
            body="CSV / Excel of approved option for manual AIMS upload + JSON audit log."
          />
        </div>
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
    </div>
  );
}
