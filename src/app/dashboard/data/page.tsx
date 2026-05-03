"use client";

import { useMemo, useRef, useState } from "react";
import { useData } from "@/components/data-context";
import { cn, formatAirportLocal, formatDateTime } from "@/lib/utils";
import {
  persistAircraft,
  persistDisruption,
  persistSchedule,
} from "@/app/actions";
import {
  TEMPLATE_AIRCRAFT_CSV,
  TEMPLATE_DISRUPTION_CSV,
  TEMPLATE_SCHEDULE_CSV,
  summarizeScheduleQuality,
  type ScheduleQualityReport,
  type ValidationIssue,
} from "@/lib/parsers/csv";

const PREVIEW_PAGE_SIZE = 100;

export default function DataPage() {
  const {
    schedule,
    aircraft,
    disruption,
    loadScheduleFile,
    loadAircraftFile,
    loadDisruptionFile,
    validation,
    parseIssues,
    detectedFormat,
    session,
  } = useData();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState<
    null | "schedule" | "aircraft" | "disruption"
  >(null);
  const [schedulePage, setSchedulePage] = useState(1);
  const [aircraftPage, setAircraftPage] = useState(1);

  const canWrite = session?.role === "controller" || session?.role === "admin";
  const allParseErrors = [
    ...parseIssues.schedule,
    ...parseIssues.aircraft,
    ...parseIssues.disruption,
  ].filter((i) => i.level === "error");
  const hasErrors =
    validation.some((v) => v.level === "error") || allParseErrors.length > 0;

  const schedulePageCount = Math.max(
    1,
    Math.ceil(schedule.length / PREVIEW_PAGE_SIZE),
  );
  const aircraftPageCount = Math.max(
    1,
    Math.ceil(aircraft.length / PREVIEW_PAGE_SIZE),
  );
  const safeSchedulePage = Math.min(schedulePage, schedulePageCount);
  const safeAircraftPage = Math.min(aircraftPage, aircraftPageCount);
  const scheduleStart = (safeSchedulePage - 1) * PREVIEW_PAGE_SIZE;
  const aircraftStart = (safeAircraftPage - 1) * PREVIEW_PAGE_SIZE;
  const visibleSchedule = useMemo(
    () => schedule.slice(scheduleStart, scheduleStart + PREVIEW_PAGE_SIZE),
    [schedule, scheduleStart],
  );
  const visibleAircraft = useMemo(
    () => aircraft.slice(aircraftStart, aircraftStart + PREVIEW_PAGE_SIZE),
    [aircraft, aircraftStart],
  );
  const scheduleQuality = useMemo(
    () => summarizeScheduleQuality(schedule),
    [schedule],
  );

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

  async function handlePasteSubmit(
    kind: "schedule" | "aircraft" | "disruption",
    text: string,
  ) {
    setError(null);
    setPasteOpen(null);
    try {
      // Convert TSV (Excel clipboard default) to CSV if needed.
      const looksTab = text.includes("\t");
      const csv = looksTab
        ? text
            .split(/\r?\n/)
            .map((line) =>
              line
                .split("\t")
                .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
                .join(","),
            )
            .join("\n")
        : text;
      const blob = new Blob([csv], { type: "text/csv" });
      const file = new File([blob], `pasted_${kind}.csv`, { type: "text/csv" });
      if (kind === "schedule") {
        await loadScheduleFile(file);
        setSchedulePage(1);
        setAircraftPage(1);
      } else if (kind === "aircraft") {
        await loadAircraftFile(file);
        setAircraftPage(1);
      } else {
        await loadDisruptionFile(file);
      }
    } catch (e) {
      setError(`${kind} paste error: ${(e as Error).message}`);
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
            Upload CSV/Excel or paste from clipboard. Required columns and
            datetime format are validated row-by-row before import.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={handleSaveAll}
            disabled={
              saving ||
              hasErrors ||
              (!schedule.length && !aircraft.length && !disruption)
            }
            className="h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 disabled:opacity-50 hover:opacity-90"
          >
            {saving ? "Saving…" : "Save to Supabase"}
          </button>
        )}
      </div>
      {detectedFormat === "aims_dayrep" && (
        <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          <span className="font-semibold">AIMS DayRepReport detected.</span>{" "}
          Loaded {schedule.length} flights and derived {aircraft.length}{" "}
          aircraft from REG column. STD/STA imported as local-station HH:MM and
          converted to UTC using the IANA timezone for the origin/destination
          airport.
        </div>
      )}

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
              setSchedulePage(1);
              setAircraftPage(1);
            } catch (e) {
              setError(`Schedule parse error: ${(e as Error).message}`);
            }
          }}
          onPaste={() => setPasteOpen("schedule")}
          sample="/sample_schedule.csv"
          template={TEMPLATE_SCHEDULE_CSV}
          templateName="template_schedule.csv"
        />
        <Uploader
          title="Aircraft"
          count={aircraft.length}
          accept=".csv,.xlsx,.xls"
          onFile={async (f) => {
            setError(null);
            try {
              await loadAircraftFile(f);
              setAircraftPage(1);
            } catch (e) {
              setError(`Aircraft parse error: ${(e as Error).message}`);
            }
          }}
          onPaste={() => setPasteOpen("aircraft")}
          sample="/sample_aircraft.csv"
          template={TEMPLATE_AIRCRAFT_CSV}
          templateName="template_aircraft.csv"
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
          onPaste={() => setPasteOpen("disruption")}
          sample="/sample_disruption_aog.csv"
          template={TEMPLATE_DISRUPTION_CSV}
          templateName="template_disruption.csv"
        />
      </div>

      {pasteOpen && (
        <PasteDialog
          kind={pasteOpen}
          onCancel={() => setPasteOpen(null)}
          onSubmit={(t) => handlePasteSubmit(pasteOpen, t)}
        />
      )}

      <IssuesPanel
        title="Schedule file"
        issues={parseIssues.schedule}
        emptyHint="No parser issues."
      />
      <IssuesPanel
        title="Aircraft file"
        issues={parseIssues.aircraft}
        emptyHint="No parser issues."
      />
      <IssuesPanel
        title="Disruption file"
        issues={parseIssues.disruption}
        emptyHint="No parser issues."
      />

      {schedule.length > 0 && <ImportQualityPanel report={scheduleQuality} />}

      {validation.length > 0 && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="font-semibold text-sm">Cross-dataset validation</h3>
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
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Schedule preview</h2>
          <PaginationControls
            page={safeSchedulePage}
            pageCount={schedulePageCount}
            pageSize={PREVIEW_PAGE_SIZE}
            total={schedule.length}
            onPageChange={setSchedulePage}
          />
        </div>
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">flight</th>
                <th className="p-2">route</th>
                <th className="p-2">STD (origin local)</th>
                <th className="p-2">STA (dest local)</th>
                <th className="p-2">aircraft</th>
                <th className="p-2">prio</th>
                <th className="p-2">LF</th>
                <th className="p-2">pax</th>
                <th className="p-2">conn</th>
                <th className="p-2">VIP/SSR</th>
              </tr>
            </thead>
            <tbody>
              {visibleSchedule.map((f, idx) => (
                <tr
                  key={`${scheduleStart + idx}-${f.flight_id}`}
                  className="border-t border-border"
                >
                  <td className="p-2">{f.flight_number}</td>
                  <td className="p-2">
                    {f.origin}→{f.destination}
                  </td>
                  <td className="p-2">
                    {formatAirportLocal(f.std, f.origin)}
                  </td>
                  <td className="p-2">
                    {formatAirportLocal(f.sta, f.destination)}
                  </td>
                  <td className="p-2">
                    {f.aircraft_id} ({f.aircraft_type})
                  </td>
                  <td className="p-2">{f.priority_level}</td>
                  <td className="p-2">{(f.load_factor * 100).toFixed(0)}%</td>
                  <td className="p-2">
                    {formatPassengerCount(f.booked_passengers)}
                    {typeof f.seat_capacity === "number" && (
                      <span className="text-zinc-500">/{f.seat_capacity}</span>
                    )}
                  </td>
                  <td className="p-2">
                    {formatPassengerCount(f.connecting_passengers)}
                  </td>
                  <td className="p-2">
                    {formatPassengerCount(f.vip_passengers)}/
                    {formatPassengerCount(f.special_service_passengers)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Aircraft preview</h2>
          <PaginationControls
            page={safeAircraftPage}
            pageCount={aircraftPageCount}
            pageSize={PREVIEW_PAGE_SIZE}
            total={aircraft.length}
            onPageChange={setAircraftPage}
          />
        </div>
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">id</th>
                <th className="p-2">type</th>
                <th className="p-2">station</th>
                <th className="p-2">available (station local)</th>
                <th className="p-2">status</th>
                <th className="p-2">next maint (UTC)</th>
                <th className="p-2">restriction</th>
              </tr>
            </thead>
            <tbody>
              {visibleAircraft.map((a, idx) => (
                <tr
                  key={`${aircraftStart + idx}-${a.aircraft_id}`}
                  className="border-t border-border"
                >
                  <td className="p-2">{a.aircraft_id}</td>
                  <td className="p-2">{a.aircraft_type}</td>
                  <td className="p-2">{a.current_station}</td>
                  <td className="p-2">
                    {formatAirportLocal(a.available_from, a.current_station)}
                  </td>
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

function formatPassengerCount(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "-";
}

function ImportQualityPanel({ report }: { report: ScheduleQualityReport }) {
  const passengerCoverage =
    report.flight_count === 0
      ? 0
      : Math.round(
          (report.flights_with_any_passenger_data / report.flight_count) * 100,
        );
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Import quality report</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Passenger impact uses booked passengers when available, otherwise
            falls back to seat capacity and load factor.
          </p>
        </div>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-xs",
            passengerCoverage === 100
              ? "bg-emerald-100 text-emerald-800"
              : passengerCoverage > 0
                ? "bg-amber-100 text-amber-800"
                : "bg-zinc-100 text-zinc-700",
          )}
        >
          {passengerCoverage}% passenger coverage
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <QualityStat label="Flights" value={String(report.flight_count)} />
        <QualityStat
          label="Passenger rows"
          value={String(report.flights_with_any_passenger_data)}
        />
        <QualityStat
          label="Fallback rows"
          value={String(report.using_load_factor_fallback)}
        />
        <QualityStat
          label="Missing pax data"
          value={String(report.flights_missing_passenger_data)}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600">
        <span>seat capacity: {report.passenger_field_counts.seat_capacity}</span>
        <span>booked: {report.passenger_field_counts.booked_passengers}</span>
        <span>
          connecting: {report.passenger_field_counts.connecting_passengers}
        </span>
        <span>VIP: {report.passenger_field_counts.vip_passengers}</span>
        <span>
          SSR: {report.passenger_field_counts.special_service_passengers}
        </span>
      </div>
    </div>
  );
}

function QualityStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3">
      <div className="text-[11px] uppercase text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span>
        Showing {start}-{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="h-7 rounded border border-border px-2 hover:bg-muted disabled:opacity-40"
        >
          Prev
        </button>
        <span className="font-mono">
          {page}/{pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="h-7 rounded border border-border px-2 hover:bg-muted disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function IssuesPanel({
  title,
  issues,
  emptyHint,
}: {
  title: string;
  issues: ValidationIssue[];
  emptyHint?: string;
}) {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{title}</h3>
        <div className="flex gap-2 text-xs">
          {errors > 0 && (
            <span className="rounded bg-red-100 text-red-800 px-2 py-0.5">
              {errors} error{errors === 1 ? "" : "s"}
            </span>
          )}
          {warnings > 0 && (
            <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5">
              {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      {issues.length === 0 && emptyHint && (
        <p className="text-xs text-zinc-500 mt-2">{emptyHint}</p>
      )}
      <ul className="mt-2 space-y-1 text-xs font-mono">
        {issues.map((v, i) => (
          <li
            key={i}
            className={cn(
              "flex flex-wrap gap-2",
              v.level === "error"
                ? "text-[color:var(--danger)]"
                : "text-[color:var(--warning)]",
            )}
          >
            <span className="uppercase">{v.level}</span>
            {v.row != null && <span>row {v.row}</span>}
            {v.column && <span>col {v.column}</span>}
            <span className="font-sans">{v.message}</span>
            {v.value && (
              <span className="text-zinc-500">value=&quot;{v.value}&quot;</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PasteDialog({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: "schedule" | "aircraft" | "disruption";
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-lg border border-border p-4 bg-muted/40">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">
          Paste {kind} from Excel/clipboard
        </h3>
        <button
          onClick={onCancel}
          className="text-xs text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-zinc-500 mb-2">
        Header row required. Tab-separated (Excel default) or comma-separated
        both accepted.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="w-full rounded border border-border bg-background p-2 text-xs font-mono"
        placeholder="paste here…"
      />
      <div className="mt-2 flex justify-end">
        <button
          disabled={!text.trim()}
          onClick={() => onSubmit(text)}
          className="h-8 rounded-md bg-primary text-primary-foreground text-xs font-medium px-3 disabled:opacity-50 hover:opacity-90"
        >
          Import
        </button>
      </div>
    </div>
  );
}

function Uploader({
  title,
  count,
  accept,
  onFile,
  onPaste,
  sample,
  template,
  templateName,
}: {
  title: string;
  count: number;
  accept: string;
  onFile: (f: File) => void | Promise<void>;
  onPaste: () => void;
  sample: string;
  template: string;
  templateName: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const templateHref =
    "data:text/csv;charset=utf-8," + encodeURIComponent(template);
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
          if (e.target) e.target.value = "";
        }}
      />
      <button
        onClick={() => ref.current?.click()}
        className="mt-3 w-full h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
      >
        Upload CSV/XLSX
      </button>
      <button
        onClick={onPaste}
        className="mt-2 w-full h-8 rounded-md border border-border text-xs font-medium hover:bg-muted"
      >
        Paste from Excel
      </button>
      <div className="mt-2 flex justify-between text-xs">
        <a
          href={templateHref}
          download={templateName}
          className="text-primary hover:underline"
        >
          Download template
        </a>
        <a
          href={sample}
          download
          className="text-zinc-500 hover:underline"
        >
          Demo sample
        </a>
      </div>
    </div>
  );
}
