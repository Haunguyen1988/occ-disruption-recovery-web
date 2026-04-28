"use client";

import { useState } from "react";
import { useData } from "@/components/data-context";
import { GanttSchedule } from "@/components/gantt-schedule";
import {
  runSimulation,
  runMultiEventSimulation,
  type SimulationResult,
} from "@/lib/engine";
import type {
  DisruptionEvent,
  DisruptionType,
  OptionType,
  RecoveryOption,
  Severity,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { approveOption, logExport, persistSimulation } from "@/app/actions";

export default function SimulatePage() {
  const { schedule, aircraft, disruption, rules, loadSampleData, session } =
    useData();
  const [scenario, setScenario] = useState<
    "aog" | "airport_close" | "weather" | "late_arrival"
  >("aog");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [extraEvents, setExtraEvents] = useState<DisruptionEvent[]>([]);
  const [eventDraft, setEventDraft] = useState<EventDraft>(emptyDraft());
  const [showEventForm, setShowEventForm] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [savedUuid, setSavedUuid] = useState<string | null>(null);
  const [savingSim, setSavingSim] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [approvedOptionId, setApprovedOptionId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const canRun = Boolean(schedule.length && aircraft.length && disruption);
  const canWrite = session?.role === "controller" || session?.role === "admin";

  const handleRun = () => {
    if (!disruption) return;
    setRunning(true);
    setSavedUuid(null);
    setApprovedOptionId(null);
    setActionMsg(null);
    setActionErr(null);
    setCompareIds(new Set());
    try {
      const allEvents = [disruption, ...extraEvents];
      if (allEvents.length === 1) {
        const r = runSimulation({ schedule, aircraft, disruption, rules });
        setResult(r);
        setSelectedOption(r.ranked_options[0]?.option_id ?? null);
      } else {
        const multi = runMultiEventSimulation({
          schedule,
          aircraft,
          disruptions: allEvents,
          rules,
        });
        // Wrap multi result into SimulationResult shape so existing UI keeps
        // working — `event` becomes the primary disruption, but impacted +
        // ranked_options reflect the union.
        setResult({
          event: disruption,
          impacted_flights: multi.impacted_flights,
          ranked_options: multi.ranked_options,
        });
        setSelectedOption(multi.ranked_options[0]?.option_id ?? null);
      }
    } finally {
      setRunning(false);
    }
  };

  const addExtraEvent = () => {
    const ev = draftToEvent(eventDraft);
    if (!ev) return;
    setExtraEvents((prev) => [...prev, ev]);
    setEventDraft(emptyDraft());
    setShowEventForm(false);
  };

  const removeExtraEvent = (eventId: string) => {
    setExtraEvents((prev) => prev.filter((e) => e.event_id !== eventId));
  };

  const handleSaveSimulation = async () => {
    if (!result) return;
    setSavingSim(true);
    setActionErr(null);
    try {
      const r = await persistSimulation(result);
      if (!r.ok) throw new Error(r.message);
      setSavedUuid(r.data?.uuid ?? null);
      setActionMsg(`Simulation saved (${r.data?.uuid ?? "?"}).`);
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setSavingSim(false);
    }
  };

  const handleApprove = async (optionId: string) => {
    if (!savedUuid) {
      setActionErr("Save the simulation first before approving.");
      return;
    }
    setActionErr(null);
    const r = await approveOption(savedUuid, optionId);
    if (!r.ok) {
      setActionErr(r.message ?? "Approve failed");
      return;
    }
    setApprovedOptionId(optionId);
    setActionMsg(`Option ${optionId} approved.`);
  };

  const toggleCompare = (optionId: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else if (next.size < 2) {
        next.add(optionId);
      }
      return next;
    });
  };

  const openCompare = () => {
    if (compareIds.size !== 2 || !result) return;
    const ids = Array.from(compareIds);
    const payload = {
      saved_at: new Date().toISOString(),
      options: result.ranked_options.filter((o) => ids.includes(o.option_id)),
    };
    sessionStorage.setItem("occ:compare", JSON.stringify(payload));
    window.location.href = "/dashboard/compare";
  };

  const handleLoadScenario = async (
    s: "aog" | "airport_close" | "weather" | "late_arrival",
  ) => {
    setScenario(s);
    setResult(null);
    setExtraEvents([]);
    await loadSampleData(s);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Disruption simulation
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Run the recovery engine on the active disruption and review ranked
          options.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Sample scenario
            </label>
            <select
              value={scenario}
              onChange={(e) =>
                void handleLoadScenario(
                  e.target.value as
                    | "aog"
                    | "airport_close"
                    | "weather"
                    | "late_arrival",
                )
              }
              className="h-9 rounded border border-border bg-background px-3 text-sm"
            >
              <option value="aog">AOG — VJ-A321</option>
              <option value="airport_close">Airport Close — HAN</option>
              <option value="weather">Weather — DAD</option>
              <option value="late_arrival">Late Arrival</option>
            </select>
          </div>
          {disruption && (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-mono">{disruption.event_id}</span> —{" "}
              {disruption.description}
            </div>
          )}
          <button
            onClick={handleRun}
            disabled={!canRun || running}
            className="ml-auto h-9 rounded-md bg-primary px-5 text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {running
              ? "Running…"
              : extraEvents.length > 0
                ? `Run multi-event (${extraEvents.length + 1})`
                : "Run simulation"}
          </button>
        </div>
      </div>

      <MultiEventPanel
        primary={disruption}
        extras={extraEvents}
        showForm={showEventForm}
        draft={eventDraft}
        onShowForm={() => setShowEventForm(true)}
        onCancelForm={() => {
          setShowEventForm(false);
          setEventDraft(emptyDraft());
        }}
        onDraftChange={setEventDraft}
        onAdd={addExtraEvent}
        onRemove={removeExtraEvent}
      />

      {result && (
        <>
          {(actionMsg || actionErr) && (
            <div
              className={cn(
                "rounded border p-3 text-sm",
                actionErr
                  ? "border-[color:var(--danger)] bg-red-50 text-red-800"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800",
              )}
            >
              {actionErr ?? actionMsg}
            </div>
          )}

          <div className="rounded-lg border border-border p-4">
            <h2 className="font-semibold">
              Impacted flights ({result.impacted_flights.length})
            </h2>
            <div className="mt-3">
              <GanttSchedule
                schedule={schedule}
                impacted={result.impacted_flights}
                highlightAircraft={disruption?.affected_aircraft ?? null}
              />
            </div>
            <ul className="mt-3 text-sm space-y-1">
              {result.impacted_flights.map((f) => (
                <li
                  key={f.flight.flight_id}
                  className="font-mono text-xs text-zinc-600 dark:text-zinc-400"
                >
                  {f.flight.flight_number} {f.flight.origin}-
                  {f.flight.destination} {f.flight.aircraft_id} —{" "}
                  {f.reason_codes[0]}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold">
                Ranked recovery options ({result.ranked_options.length})
              </h2>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-500">
                  Compare {compareIds.size}/2 selected
                </span>
                <button
                  onClick={openCompare}
                  disabled={compareIds.size !== 2}
                  className="h-8 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-40"
                >
                  Open compare →
                </button>
                {canWrite && (
                  <button
                    onClick={handleSaveSimulation}
                    disabled={savingSim || Boolean(savedUuid)}
                    className="h-8 rounded-md bg-primary px-3 text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
                  >
                    {savedUuid
                      ? "Saved ✓"
                      : savingSim
                        ? "Saving…"
                        : "Save simulation"}
                  </button>
                )}
              </div>
            </div>
            <div className="divide-y divide-border">
              {result.ranked_options.map((opt) => (
                <OptionRow
                  key={opt.option_id}
                  option={opt}
                  active={selectedOption === opt.option_id}
                  inCompare={compareIds.has(opt.option_id)}
                  approved={approvedOptionId === opt.option_id}
                  onClick={() => setSelectedOption(opt.option_id)}
                  onToggleCompare={() => toggleCompare(opt.option_id)}
                />
              ))}
            </div>
          </div>

          {selectedOption && (
            <OptionDetail
              option={
                result.ranked_options.find((o) => o.option_id === selectedOption)!
              }
              eventInfo={
                disruption ? formatDateTime(disruption.start_time) : ""
              }
              onApprove={
                canWrite
                  ? () => handleApprove(selectedOption)
                  : undefined
              }
              approved={approvedOptionId === selectedOption}
              canApprove={Boolean(savedUuid && canWrite)}
            />
          )}
        </>
      )}
    </div>
  );
}

const OPTION_COLORS: Record<OptionType, string> = {
  DELAY_ONLY: "bg-amber-600",
  SPREAD_DELAY: "bg-orange-600",
  DEEP_DELAY: "bg-red-700",
  SINGLE_SWAP: "bg-emerald-600",
  SWAP_CHAIN: "bg-emerald-800",
  CANCEL_OR_FERRY: "bg-zinc-700",
};

function OptionRow({
  option,
  active,
  inCompare,
  approved,
  onClick,
  onToggleCompare,
}: {
  option: RecoveryOption;
  active: boolean;
  inCompare: boolean;
  approved: boolean;
  onClick: () => void;
  onToggleCompare: () => void;
}) {
  return (
    <div
      className={cn(
        "w-full p-4 grid grid-cols-12 gap-3 items-center transition",
        active && "bg-muted",
      )}
    >
      <div className="col-span-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={inCompare}
          onChange={onToggleCompare}
          aria-label="Add to compare"
          className="h-4 w-4 accent-[color:var(--accent)]"
        />
        <span className="text-xl font-bold">#{option.rank}</span>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="col-span-11 grid grid-cols-11 gap-3 items-center text-left hover:bg-muted/40 -mx-2 px-2 py-1 rounded"
      >
        <div className="col-span-3">
          <span
            className={cn(
              "inline-block px-2 py-0.5 rounded text-[11px] font-mono text-white",
              OPTION_COLORS[option.option_type],
            )}
          >
            {option.option_type}
          </span>
          {approved && (
            <span className="ml-2 inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-600 text-white">
              APPROVED
            </span>
          )}
          {option.curfew_violations > 0 && (
            <span
              title={`${option.curfew_violations} movement(s) inside a configured curfew window`}
              className="ml-2 inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-red-100 text-red-800 border border-red-300"
            >
              CURFEW ×{option.curfew_violations}
            </span>
          )}
          <div className="mt-1 text-[11px] font-mono text-zinc-500">
            {option.option_id}
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-zinc-500">Score</div>
          <div className="text-lg font-semibold">{option.score}</div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-zinc-500">Total / Max delay</div>
          <div className="text-sm font-mono">
            {option.total_delay_minutes}′ / {option.max_delay_minutes}′
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-zinc-500">Impact / Swap</div>
          <div className="text-sm font-mono">
            {option.impacted_flight_count} / {option.swap_count}
          </div>
        </div>
        <div className="col-span-2">
          <span
            className={cn(
              "inline-block px-2 py-0.5 rounded text-[11px] font-mono",
              option.risk_level === "LOW" && "bg-emerald-100 text-emerald-800",
              option.risk_level === "MEDIUM" && "bg-amber-100 text-amber-800",
              option.risk_level === "HIGH" && "bg-red-100 text-red-800",
            )}
          >
            {option.risk_level}
          </span>
          <div className="mt-1 text-[11px] text-zinc-500">
            {option.recommendation}
          </div>
        </div>
      </button>
    </div>
  );
}

function OptionDetail({
  option,
  eventInfo,
  onApprove,
  approved,
  canApprove,
}: {
  option: RecoveryOption;
  eventInfo: string;
  onApprove?: () => void;
  approved: boolean;
  canApprove: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <h2 className="font-semibold">
          Option detail — #{option.rank} {option.option_type}
        </h2>
        <div className="text-xs text-zinc-500 mt-0.5 font-mono">
          {option.option_id} · disruption@{eventInfo}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Reason codes</h3>
        <ul className="text-sm space-y-1 list-disc list-inside text-zinc-700 dark:text-zinc-300">
          {option.reason_codes.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Score breakdown</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          {Object.entries(option.score_breakdown).map(([k, v]) => (
            <div key={k} className="rounded border border-border p-2">
              <div className="text-zinc-500">{k.replace(/_/g, " ")}</div>
              <div className="font-mono font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>

      {option.flight_changes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">
            Flight changes ({option.flight_changes.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-left text-zinc-500 border-b border-border">
                <tr>
                  <th className="py-1 pr-3">Flight</th>
                  <th className="py-1 pr-3">From → To</th>
                  <th className="py-1 pr-3">Old aircraft</th>
                  <th className="py-1 pr-3">New aircraft</th>
                  <th className="py-1 pr-3">Old STD/STA</th>
                  <th className="py-1 pr-3">New STD/STA</th>
                  <th className="py-1 pr-3">Delay</th>
                </tr>
              </thead>
              <tbody>
                {option.flight_changes.map((c) => (
                  <tr
                    key={c.flight_id}
                    className="border-b border-border/50 last:border-b-0"
                  >
                    <td className="py-1 pr-3">{c.flight_number}</td>
                    <td className="py-1 pr-3">{c.flight_id}</td>
                    <td className="py-1 pr-3">{c.original_aircraft}</td>
                    <td className="py-1 pr-3">
                      {c.new_aircraft !== c.original_aircraft ? (
                        <span className="text-emerald-700 font-bold">
                          {c.new_aircraft}
                        </span>
                      ) : (
                        c.new_aircraft
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      {formatDateTime(c.original_std)}
                    </td>
                    <td className="py-1 pr-3">{formatDateTime(c.new_std)}</td>
                    <td className="py-1 pr-3">
                      {c.delay_minutes > 0 ? (
                        <span className="text-amber-700 font-bold">
                          +{c.delay_minutes}′
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2 flex-wrap">
        <button
          onClick={() => {
            exportOptionAsCsv(option);
            void logExport(option.option_id, "csv");
          }}
          className="h-9 rounded-md bg-primary px-4 text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Export CSV (AIMS upload)
        </button>
        <button
          onClick={() => {
            exportOptionAsJson(option);
            void logExport(option.option_id, "json");
          }}
          className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Export audit JSON
        </button>
        {onApprove && (
          <button
            onClick={onApprove}
            disabled={!canApprove || approved}
            className="h-9 rounded-md bg-emerald-600 px-4 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40"
            title={
              !canApprove
                ? "Save the simulation first"
                : approved
                  ? "Already approved"
                  : "Approve this option"
            }
          >
            {approved ? "Approved ✓" : "Approve option"}
          </button>
        )}
      </div>
    </div>
  );
}

function exportOptionAsCsv(option: RecoveryOption) {
  const header = [
    "flight_id",
    "flight_number",
    "original_aircraft",
    "new_aircraft",
    "original_std",
    "new_std",
    "original_sta",
    "new_sta",
    "delay_minutes",
    "change_reason",
  ];
  const rows = option.flight_changes.map((c) => [
    c.flight_id,
    c.flight_number,
    c.original_aircraft,
    c.new_aircraft,
    c.original_std.toISOString(),
    c.new_std.toISOString(),
    c.original_sta.toISOString(),
    c.new_sta.toISOString(),
    String(c.delay_minutes),
    c.reason,
  ]);
  const csv = [header, ...rows]
    .map((r) =>
      r
        .map((v) => (v.includes(",") ? `"${v.replace(/"/g, '""')}"` : v))
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `aims_upload_${option.option_id}.csv`);
}

function exportOptionAsJson(option: RecoveryOption) {
  const payload = {
    approved_by: "OCC_USER",
    approved_time: new Date().toISOString(),
    option,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, `audit_${option.option_id}.json`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =============================================================================
// Multi-event (K10) — what-if extra events
// =============================================================================

interface EventDraft {
  event_type: DisruptionType;
  affected_aircraft: string;
  affected_airport: string;
  affected_flight_id: string;
  start: string;
  end: string;
  severity: Severity;
  description: string;
}

function emptyDraft(): EventDraft {
  return {
    event_type: "AOG",
    affected_aircraft: "",
    affected_airport: "",
    affected_flight_id: "",
    start: "",
    end: "",
    severity: "HIGH",
    description: "",
  };
}

function draftToEvent(d: EventDraft): DisruptionEvent | null {
  if (!d.start || !d.end) return null;
  const start = new Date(d.start);
  const end = new Date(d.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
  return {
    event_id: `WHAT-IF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    event_type: d.event_type,
    start_time: start,
    end_time: end,
    severity: d.severity,
    description: d.description || `What-if ${d.event_type}`,
    affected_aircraft: d.event_type === "AOG" ? d.affected_aircraft || null : null,
    affected_airport:
      d.event_type === "AIRPORT_CLOSE" || d.event_type === "WEATHER"
        ? d.affected_airport || null
        : null,
    affected_flight_id:
      d.event_type === "LATE_ARRIVAL" ? d.affected_flight_id || null : null,
  };
}

function MultiEventPanel({
  primary,
  extras,
  showForm,
  draft,
  onShowForm,
  onCancelForm,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  primary: DisruptionEvent | null;
  extras: DisruptionEvent[];
  showForm: boolean;
  draft: EventDraft;
  onShowForm: () => void;
  onCancelForm: () => void;
  onDraftChange: (d: EventDraft) => void;
  onAdd: () => void;
  onRemove: (eventId: string) => void;
}) {
  const totalEvents = (primary ? 1 : 0) + extras.length;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Active disruption events ({totalEvents})</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Add what-if events to run a multi-event recovery (K10). Useful for
            cascading IROPS — e.g. AOG + weather at the same time.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={onShowForm}
            className="h-8 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            + Add what-if event
          </button>
        )}
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {primary && (
          <li className="rounded border border-border p-2 bg-muted/40">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="font-mono text-xs">
                <span className="font-semibold">PRIMARY · {primary.event_id}</span>{" "}
                — {primary.event_type} — {primary.description}
              </div>
              <div className="text-[11px] font-mono text-zinc-500">
                {primary.start_time.toISOString()} →{" "}
                {primary.end_time.toISOString()}
              </div>
            </div>
          </li>
        )}
        {extras.map((e) => (
          <li
            key={e.event_id}
            className="rounded border border-amber-300 p-2 bg-amber-50/60 dark:bg-amber-900/20"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="font-mono text-xs">
                <span className="font-semibold">WHAT-IF · {e.event_id}</span> —{" "}
                {e.event_type} — {e.description}
                {e.affected_aircraft && ` (a/c ${e.affected_aircraft})`}
                {e.affected_airport && ` (apt ${e.affected_airport})`}
                {e.affected_flight_id && ` (flt ${e.affected_flight_id})`}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-zinc-500">
                  {e.start_time.toISOString()} → {e.end_time.toISOString()}
                </span>
                <button
                  onClick={() => onRemove(e.event_id)}
                  className="text-[11px] rounded border border-border px-2 py-0.5 hover:bg-muted"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {showForm && (
        <div className="mt-3 rounded border border-border p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Event type
            </label>
            <select
              value={draft.event_type}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  event_type: e.target.value as DisruptionType,
                })
              }
              className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="AOG">AOG</option>
              <option value="AIRPORT_CLOSE">AIRPORT_CLOSE</option>
              <option value="WEATHER">WEATHER</option>
              <option value="LATE_ARRIVAL">LATE_ARRIVAL</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Severity
            </label>
            <select
              value={draft.severity}
              onChange={(e) =>
                onDraftChange({
                  ...draft,
                  severity: e.target.value as Severity,
                })
              }
              className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
          {draft.event_type === "AOG" && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Affected aircraft (e.g. VJ-A322)
              </label>
              <input
                value={draft.affected_aircraft}
                onChange={(e) =>
                  onDraftChange({ ...draft, affected_aircraft: e.target.value })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                placeholder="VJ-A322"
              />
            </div>
          )}
          {(draft.event_type === "AIRPORT_CLOSE" ||
            draft.event_type === "WEATHER") && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Affected airport (IATA)
              </label>
              <input
                value={draft.affected_airport}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    affected_airport: e.target.value.toUpperCase(),
                  })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                placeholder="HAN"
              />
            </div>
          )}
          {draft.event_type === "LATE_ARRIVAL" && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                Affected flight id
              </label>
              <input
                value={draft.affected_flight_id}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    affected_flight_id: e.target.value,
                  })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                placeholder="VJ102-D1"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Start (UTC)
            </label>
            <input
              type="datetime-local"
              value={draft.start}
              onChange={(e) =>
                onDraftChange({ ...draft, start: e.target.value })
              }
              className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              End (UTC)
            </label>
            <input
              type="datetime-local"
              value={draft.end}
              onChange={(e) =>
                onDraftChange({ ...draft, end: e.target.value })
              }
              className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-zinc-500 mb-1">
              Description (optional)
            </label>
            <input
              value={draft.description}
              onChange={(e) =>
                onDraftChange({ ...draft, description: e.target.value })
              }
              className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
              placeholder="e.g. Thunderstorm cell over HAN"
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              onClick={onAdd}
              disabled={!draft.start || !draft.end}
              className="h-8 rounded-md bg-primary px-3 text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
            >
              Add event
            </button>
            <button
              onClick={onCancelForm}
              className="h-8 rounded-md border border-border px-3 text-sm hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
