"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useData } from "@/components/data-context";
import { findImpactedFlights } from "@/lib/engine";
import { formatDateTime } from "@/lib/utils";

export default function DashboardOverview() {
  const { schedule, aircraft, disruption, rules, validation } = useData();

  const impacted = useMemo(() => {
    if (!disruption) return [];
    return findImpactedFlights(disruption, schedule, rules);
  }, [disruption, schedule, rules]);

  const errors = validation.filter((v) => v.level === "error");
  const warnings = validation.filter((v) => v.level === "warning");

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="text-sm text-zinc-500 mt-1">
        Quick snapshot of the loaded operation and current disruption.
      </p>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Flights" value={schedule.length} />
        <Stat label="Aircraft" value={aircraft.length} />
        <Stat
          label="Disruption"
          value={disruption ? disruption.event_type : "—"}
        />
        <Stat label="Impacted" value={impacted.length} accent />
      </div>

      {disruption && (
        <div className="mt-6 rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">
                Active disruption — {disruption.event_id}
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                {disruption.description}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <Row k="Type" v={disruption.event_type} />
                <Row k="Severity" v={disruption.severity} />
                <Row k="Aircraft" v={disruption.affected_aircraft ?? "—"} />
                <Row k="Airport" v={disruption.affected_airport ?? "—"} />
                <Row k="Start" v={formatDateTime(disruption.start_time)} />
                <Row k="End" v={formatDateTime(disruption.end_time)} />
              </dl>
            </div>
            <Link
              href="/dashboard/simulate"
              className="shrink-0 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              Run simulation →
            </Link>
          </div>
        </div>
      )}

      {errors.length + warnings.length > 0 && (
        <div className="mt-6 rounded-lg border border-border p-4">
          <h3 className="font-semibold text-sm">Data validation</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {errors.map((e, i) => (
              <li
                key={`e${i}`}
                className="flex gap-2 text-[color:var(--danger)]"
              >
                <span className="font-mono text-xs uppercase">error</span>
                <span>{e.message}</span>
              </li>
            ))}
            {warnings.map((w, i) => (
              <li
                key={`w${i}`}
                className="flex gap-2 text-[color:var(--warning)]"
              >
                <span className="font-mono text-xs uppercase">warning</span>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold ${accent ? "text-[color:var(--accent)]" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-zinc-500">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </>
  );
}
