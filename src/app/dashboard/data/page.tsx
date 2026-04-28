"use client";

import { useRef, useState } from "react";
import { useData } from "@/components/data-context";
import { cn, formatDateTime } from "@/lib/utils";
import {
  persistAircraft,
  persistDisruption,
  persistSchedule,
} from "@/app/actions";

export default function DataPage() {
  const {
    schedule,
    aircraft,
    disruption,
    loadScheduleFile,
    loadAircraftFile,
    loadDisruptionFile,
    validation,
    session,
  } = useData();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const canWrite = session?.role === "controller" || session?.role === "admin";
  const hasErrors = validation.some((v) => v.level === "error");

  async function handleSaveAll() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const results: string[] = [];
      if (schedule.length) {
        const r = await persistSchedule(schedule);
        if (!r.ok) throw new Error(`schedule: ${r.message}`);
        results.push(`${r.data?.count ?? 0} flights`);
      }
      if (aircraft.length) {
        const r = await persistAircraft(aircraft);
        if (!r.ok) throw new Error(`aircraft: ${r.message}`);
        results.push(`${r.data?.count ?? 0} aircraft`);
      }
      if (disruption) {
        const r = await persistDisruption(disruption);
        if (!r.ok) throw new Error(`disruption: ${r.message}`);
        results.push("1 disruption");
      }
      setSaveMsg(`Saved to Supabase: ${results.join(", ")}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Data import
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Upload CSV or Excel files for schedule, aircraft, and disruption
            events. Sample files are pre-loaded for demo.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={handleSaveAll}
            disabled={saving || hasErrors || (!schedule.length && !aircraft.length && !disruption)}
            className="h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 disabled:opacity-50 hover:opacity-90"
          >
            {saving ? "Saving…" : "Save to Supabase"}
          </button>
        )}
      </div>
      {saveMsg && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          {saveMsg}
        </div>
      )}

      {error && (
        <div className="rounded border border-[color:var(--danger)] bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Uploader
          title="Schedule"
          count={schedule.length}
          accept=".csv,.xlsx,.xls"
          onFile={async (f) => {
            setError(null);
            try {
              await loadScheduleFile(f);
            } catch (e) {
              setError(`Schedule parse error: ${(e as Error).message}`);
            }
          }}
          sample="/sample_schedule.csv"
        />
        <Uploader
          title="Aircraft"
          count={aircraft.length}
          accept=".csv,.xlsx,.xls"
          onFile={async (f) => {
            setError(null);
            try {
              await loadAircraftFile(f);
            } catch (e) {
              setError(`Aircraft parse error: ${(e as Error).message}`);
            }
          }}
          sample="/sample_aircraft.csv"
        />
        <Uploader
          title="Disruption"
          count={disruption ? 1 : 0}
          accept=".csv,.xlsx,.xls"
          onFile={async (f) => {
            setError(null);
            try {
              await loadDisruptionFile(f);
            } catch (e) {
              setError(`Disruption parse error: ${(e as Error).message}`);
            }
          }}
          sample="/sample_disruption_aog.csv"
        />
      </div>

      {validation.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="font-semibold text-sm">Validation</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {validation.map((v, i) => (
              <li
                key={i}
                className={cn(
                  "flex gap-2",
                  v.level === "error"
                    ? "text-[color:var(--danger)]"
                    : "text-[color:var(--warning)]",
                )}
              >
                <span className="font-mono uppercase">{v.level}</span>
                <span>{v.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <h2 className="font-semibold mb-2">Schedule preview</h2>
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">flight</th>
                <th className="p-2">route</th>
                <th className="p-2">STD</th>
                <th className="p-2">STA</th>
                <th className="p-2">aircraft</th>
                <th className="p-2">prio</th>
                <th className="p-2">LF</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((f) => (
                <tr key={f.flight_id} className="border-t border-border">
                  <td className="p-2">{f.flight_number}</td>
                  <td className="p-2">
                    {f.origin}→{f.destination}
                  </td>
                  <td className="p-2">{formatDateTime(f.std)}</td>
                  <td className="p-2">{formatDateTime(f.sta)}</td>
                  <td className="p-2">
                    {f.aircraft_id} ({f.aircraft_type})
                  </td>
                  <td className="p-2">{f.priority_level}</td>
                  <td className="p-2">{(f.load_factor * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Aircraft preview</h2>
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">id</th>
                <th className="p-2">type</th>
                <th className="p-2">station</th>
                <th className="p-2">available</th>
                <th className="p-2">status</th>
                <th className="p-2">next maint</th>
                <th className="p-2">restriction</th>
              </tr>
            </thead>
            <tbody>
              {aircraft.map((a) => (
                <tr key={a.aircraft_id} className="border-t border-border">
                  <td className="p-2">{a.aircraft_id}</td>
                  <td className="p-2">{a.aircraft_type}</td>
                  <td className="p-2">{a.current_station}</td>
                  <td className="p-2">{formatDateTime(a.available_from)}</td>
                  <td className="p-2">{a.status}</td>
                  <td className="p-2">
                    {a.next_maintenance_time
                      ? formatDateTime(a.next_maintenance_time)
                      : "—"}
                  </td>
                  <td className="p-2">{a.restriction ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Uploader({
  title,
  count,
  accept,
  onFile,
  sample,
}: {
  title: string;
  count: number;
  accept: string;
  onFile: (f: File) => void | Promise<void>;
  sample: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs text-zinc-500">{count} rows</span>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) await onFile(f);
        }}
      />
      <button
        onClick={() => ref.current?.click()}
        className="mt-3 w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
      >
        Upload
      </button>
      <a
        href={sample}
        download
        className="mt-2 block text-center text-xs text-zinc-500 hover:underline"
      >
        Download sample
      </a>
    </div>
  );
}
