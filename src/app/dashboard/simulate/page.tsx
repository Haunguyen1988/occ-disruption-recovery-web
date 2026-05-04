"use client";

import { useMemo, useState } from "react";
import { useData } from "@/components/data-context";
import { GanttSchedule } from "@/components/gantt-schedule";
import { ScheduleDateFilterSelect } from "@/components/schedule-date-selection";
import {
  analyzeMultiEventConflicts,
  applyRecoveryObjectiveProfile,
  getRecoveryObjectiveProfile,
  RECOVERY_OBJECTIVE_PROFILES,
  runSimulation,
  runMultiEventSimulation,
  type EventConflictLevel,
  type MultiEventConflictAnalysis,
  type RecoveryObjectiveProfile,
  type SimulationResult,
  type TailAssignmentMode,
} from "@/lib/engine";
import type {
  DisruptionEvent,
  DisruptionType,
  FlightChange,
  ImpactedFlight,
  OptionType,
  RecoveryOption,
  Severity,
  SimulationFeedback,
  TailAssignmentOptimizationFeedback,
} from "@/lib/types";
import {
  getOptionWatchouts,
  getTailRankingExplanations,
} from "@/lib/option-feedback";
import { cn, formatDateTime, formatOpsDateVn, vnLocalToUtc } from "@/lib/utils";
import { approveOption, logExport, persistSimulation } from "@/app/actions";

function randomWhatIfEventId(): string {
  return `WHAT-IF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

const TAIL_ASSIGNMENT_MODES: {
  value: TailAssignmentMode;
  label: string;
}[] = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "deep", label: "Deep" },
];

export default function SimulatePage() {
  const {
    schedule,
    aircraft,
    disruption,
    rules,
    session,
    setDisruption,
    loadScheduleFile,
    loadAircraftFile,
    loadDisruptionFile,
    loadSampleData,
    validation,
    parseIssues,
    scheduleDateFilter,
    setScheduleOperatingDate,
    reset,
  } = useData();
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
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState<
    null | "aog" | "airport_close" | "weather" | "late_arrival"
  >(null);
  const [tailAssignmentMode, setTailAssignmentMode] =
    useState<TailAssignmentMode>("balanced");
  const [objectiveProfile, setObjectiveProfile] =
    useState<RecoveryObjectiveProfile>("balanced");
  const [resultObjectiveProfile, setResultObjectiveProfile] =
    useState<RecoveryObjectiveProfile>("balanced");

  const hasData = schedule.length > 0 && aircraft.length > 0;
  const parseErrors = [
    ...parseIssues.schedule,
    ...parseIssues.aircraft,
    ...parseIssues.disruption,
  ].filter((issue) => issue.level === "error");
  const validationErrors = validation.filter((issue) => issue.level === "error");
  const canRun = Boolean(
    hasData && disruption && parseErrors.length === 0 && validationErrors.length === 0,
  );
  const canWrite = session?.role === "controller" || session?.role === "admin";
  const objectiveRules = useMemo(
    () => applyRecoveryObjectiveProfile(rules, objectiveProfile),
    [rules, objectiveProfile],
  );
  const activeObjective = useMemo(
    () => getRecoveryObjectiveProfile(objectiveProfile),
    [objectiveProfile],
  );
  const resultObjective = useMemo(
    () => getRecoveryObjectiveProfile(resultObjectiveProfile),
    [resultObjectiveProfile],
  );
  const eventConflictAnalysis = useMemo(
    () =>
      analyzeMultiEventConflicts({
        events: disruption ? [disruption, ...extraEvents] : extraEvents,
        schedule,
        rules,
      }),
    [disruption, extraEvents, schedule, rules],
  );

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
        const r = runSimulation({
          schedule,
          aircraft,
          disruption,
          rules: objectiveRules,
          tailAssignmentMode,
        });
        setResult(r);
        setResultObjectiveProfile(objectiveProfile);
        setSelectedOption(r.ranked_options[0]?.option_id ?? null);
      } else {
        const multi = runMultiEventSimulation({
          schedule,
          aircraft,
          disruptions: allEvents,
          rules: objectiveRules,
          tailAssignmentMode,
        });
        // Wrap multi result into SimulationResult shape so existing UI keeps
        // working — `event` becomes the primary disruption, but impacted +
        // ranked_options reflect the union.
        setResult({
          event: disruption,
          impacted_flights: multi.impacted_flights,
          ranked_options: multi.ranked_options,
          feedback: multi.feedback,
        });
        setResultObjectiveProfile(objectiveProfile);
        setSelectedOption(multi.ranked_options[0]?.option_id ?? null);
      }
    } finally {
      setRunning(false);
    }
  };

  const addExtraEvent = () => {
    const ev = draftToEventSimple(eventDraft, opsDateStr);
    if (!ev) return;
    ev.event_id = randomWhatIfEventId();
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
      simulation_uuid: savedUuid ?? undefined,
      options: result.ranked_options.filter((o) => ids.includes(o.option_id)),
    };
    sessionStorage.setItem("occ:compare", JSON.stringify(payload));
    if (savedUuid) {
      const params = new URLSearchParams({
        simulation: savedUuid,
        a: ids[0],
        b: ids[1],
      });
      window.location.href = `/dashboard/compare?${params.toString()}`;
      return;
    }
    window.location.href = "/dashboard/compare";
  };

  /** Auto-detect the "ops date" from the loaded schedule (earliest STD). */
  const opsDate = schedule.length
    ? schedule.reduce(
        (d, f) => (f.std < d ? f.std : d),
        schedule[0].std,
      )
    : new Date();
  const opsDateStr = formatOpsDateVn(opsDate);

  /**
   * After simulation, compute which aircraft are relevant for the Gantt:
   * - Impacted aircraft (from disruption)
   * - Aircraft in the selected recovery option's flight changes
   * - The disrupted aircraft itself
   */
  const relevantAircraft = useMemo<Set<string> | null>(() => {
    if (!result) return null; // no filter before simulation
    const ids = new Set<string>();
    // Impacted aircraft
    for (const imp of result.impacted_flights) {
      ids.add(imp.flight.aircraft_id);
    }
    // Selected option's aircraft changes
    if (selectedOption) {
      const opt = result.ranked_options.find((o) => o.option_id === selectedOption);
      if (opt) {
        for (const fc of opt.flight_changes) {
          ids.add(fc.original_aircraft);
          if (fc.new_aircraft !== "UNCOVERED") ids.add(fc.new_aircraft);
        }
      }
    }
    // Disrupted aircraft
    if (disruption?.affected_aircraft) ids.add(disruption.affected_aircraft);
    return ids.size > 0 ? ids : null;
  }, [result, selectedOption, disruption]);

  /** Create a primary disruption event from the simplified form. */
  const handleCreatePrimary = () => {
    const ev = draftToEventSimple(eventDraft, opsDateStr);
    if (!ev) return;
    setDisruption(ev);
    setEventDraft(emptyDraft());
  };

  const handleUploadSchedule = async (f: File) => {
    setUploadErr(null);
    try {
      await loadScheduleFile(f);
      setResult(null);
      setSelectedOption(null);
    } catch (e) {
      setUploadErr(`Schedule: ${(e as Error).message}`);
    }
  };

  const handleUploadAircraft = async (f: File) => {
    setUploadErr(null);
    try {
      await loadAircraftFile(f);
      setResult(null);
      setSelectedOption(null);
    } catch (e) {
      setUploadErr(`Aircraft: ${(e as Error).message}`);
    }
  };

  const handleUploadDisruption = async (f: File) => {
    setUploadErr(null);
    try {
      await loadDisruptionFile(f);
      setResult(null);
      setSelectedOption(null);
      setExtraEvents([]);
    } catch (e) {
      setUploadErr(`Disruption: ${(e as Error).message}`);
    }
  };

  const handleScheduleDateChange = async (date: string | null) => {
    setUploadErr(null);
    try {
      await setScheduleOperatingDate(date);
      setResult(null);
      setSelectedOption(null);
    } catch (e) {
      setUploadErr(`Schedule date filter: ${(e as Error).message}`);
    }
  };

  const handleLoadSample = async (
    scenario: "aog" | "airport_close" | "weather" | "late_arrival",
  ) => {
    setUploadErr(null);
    setResult(null);
    setSelectedOption(null);
    setSavedUuid(null);
    setApprovedOptionId(null);
    setExtraEvents([]);
    setSampleLoading(scenario);
    try {
      await loadSampleData(scenario);
    } catch (e) {
      setUploadErr(`Sample data: ${(e as Error).message}`);
    } finally {
      setSampleLoading(null);
    }
  };

  const handleClearAll = () => {
    reset();
    setDisruption(null);
    setResult(null);
    setExtraEvents([]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Disruption simulation
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Upload your schedule & aircraft data, create a disruption event, then
          run the recovery engine.
        </p>
      </div>

      {/* ── Data upload section ────────────────────────────── */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Operational data</h2>
          {hasData && (
            <button
              onClick={handleClearAll}
              className="h-7 rounded-md border border-border px-3 text-xs hover:bg-muted"
            >
              Clear all
            </button>
          )}
        </div>

        {uploadErr && (
          <div className="rounded border border-[color:var(--danger)] bg-red-50 p-2 text-xs text-red-800">
            {uploadErr}
          </div>
        )}
        <ImportIssueSummary
          parseIssues={parseIssues}
          validationIssues={validation}
        />

        <div className="flex flex-wrap items-center gap-3">
          <input id="simulate-schedule-upload" type="file" accept=".csv,.xlsx,.xls" className="sr-only"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handleUploadSchedule(f); if (e.target) e.target.value = ""; }}
          />
          <input id="simulate-aircraft-upload" type="file" accept=".csv,.xlsx,.xls" className="sr-only"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handleUploadAircraft(f); if (e.target) e.target.value = ""; }}
          />
          <input id="simulate-disruption-upload" type="file" accept=".csv,.xlsx,.xls" className="sr-only"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handleUploadDisruption(f); if (e.target) e.target.value = ""; }}
          />
          <label
            htmlFor="simulate-schedule-upload"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            📋 Upload Schedule{" "}
            {schedule.length > 0 && `(${schedule.length})`}
          </label>
          <label
            htmlFor="simulate-aircraft-upload"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            ✈️ Upload Aircraft {aircraft.length > 0 && `(${aircraft.length})`}
          </label>
          <label
            htmlFor="simulate-disruption-upload"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Upload Disruption {disruption && "(1)"}
          </label>
          {hasData && (
            <span className="text-xs text-emerald-600 font-medium">
              ✅ {schedule.length} flights · {aircraft.length} aircraft ·
              Ops date: {opsDateStr}
            </span>
          )}
          {!hasData && (
            <span className="text-xs text-zinc-500">
              Upload CSV/XLSX files to begin. Download{" "}
              <a href="/sample_schedule.csv" download className="text-primary hover:underline">schedule template</a>{" "}
              or{" "}
              <a href="/sample_aircraft.csv" download className="text-primary hover:underline">aircraft template</a>.
            </span>
          )}
        </div>
        {!hasData && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-xs font-medium text-zinc-500">
              Quick sample
            </span>
            {[
              ["aog", "AOG"],
              ["airport_close", "Airport close"],
              ["weather", "Weather"],
              ["late_arrival", "Late arrival"],
            ].map(([scenario, label]) => (
              <button
                key={scenario}
                onClick={() =>
                  handleLoadSample(
                    scenario as
                      | "aog"
                      | "airport_close"
                      | "weather"
                      | "late_arrival",
                  )
                }
                disabled={sampleLoading !== null}
                className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {sampleLoading === scenario ? "Loading..." : label}
              </button>
            ))}
          </div>
        )}
        {scheduleDateFilter && (
          <ScheduleDateFilterSelect
            filter={scheduleDateFilter}
            onChange={handleScheduleDateChange}
          />
        )}
      </div>

      {/* ── Primary event creation (simplified form) ─────── */}
      {hasData && !disruption && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:bg-amber-900/20 p-4 space-y-3">
          <h2 className="font-semibold">Create disruption event</h2>
          <p className="text-xs text-zinc-500">
            Define the disruption. Times are HH:MM format on ops date{" "}
            <span className="font-mono font-semibold">{opsDateStr}</span> (Vietnam local).
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Type</label>
              <select
                value={eventDraft.event_type}
                onChange={(e) =>
                  setEventDraft({ ...eventDraft, event_type: e.target.value as DisruptionType })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
              >
                <option value="AOG">AOG</option>
                <option value="AIRPORT_CLOSE">AIRPORT CLOSE</option>
                <option value="WEATHER">WEATHER</option>
                <option value="LATE_ARRIVAL">LATE ARRIVAL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Severity</label>
              <select
                value={eventDraft.severity}
                onChange={(e) =>
                  setEventDraft({ ...eventDraft, severity: e.target.value as Severity })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Start (HH:MM)</label>
              <input
                type="time"
                value={eventDraft.start}
                onChange={(e) => setEventDraft({ ...eventDraft, start: e.target.value })}
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">End (HH:MM)</label>
              <input
                type="time"
                value={eventDraft.end}
                onChange={(e) => setEventDraft({ ...eventDraft, end: e.target.value })}
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Airport (IATA)</label>
              <input
                value={eventDraft.affected_airport}
                onChange={(e) => setEventDraft({ ...eventDraft, affected_airport: e.target.value.toUpperCase() })}
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                placeholder="SGN"
              />
            </div>
            {(eventDraft.event_type === "AOG") && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Aircraft</label>
                <input
                  value={eventDraft.affected_aircraft}
                  onChange={(e) => setEventDraft({ ...eventDraft, affected_aircraft: e.target.value })}
                  className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                  placeholder="VJ-A321"
                />
              </div>
            )}
            {(eventDraft.event_type === "LATE_ARRIVAL") && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Flight ID</label>
                <input
                  value={eventDraft.affected_flight_id}
                  onChange={(e) => setEventDraft({ ...eventDraft, affected_flight_id: e.target.value })}
                  className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                  placeholder="FL001"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreatePrimary}
              disabled={!eventDraft.start || !eventDraft.end}
              className="h-9 rounded-md bg-primary px-5 text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
            >
              Create event
            </button>
            <input
              value={eventDraft.description}
              onChange={(e) => setEventDraft({ ...eventDraft, description: e.target.value })}
              className="h-9 flex-1 rounded border border-border bg-background px-2 text-sm"
              placeholder="Description (optional)"
            />
          </div>
        </div>
      )}

      {/* ── Run button (when event exists) ────────────────── */}
      {disruption && (
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-mono font-semibold">{disruption.event_id}</span> —{" "}
              {disruption.event_type} — {disruption.description}
            </div>
            <button
              onClick={() => { setDisruption(null); setResult(null); setExtraEvents([]); }}
              className="text-xs rounded border border-border px-2 py-1 hover:bg-muted"
            >
              Change event
            </button>
            <div className="flex items-center gap-2" title={activeObjective.description}>
              <span className="text-xs font-medium text-zinc-500">
                Objective
              </span>
              <div className="flex flex-wrap items-center gap-1 rounded-md border border-border p-1">
                {RECOVERY_OBJECTIVE_PROFILES.map((profile) => (
                  <button
                    key={profile.value}
                    onClick={() => setObjectiveProfile(profile.value)}
                    className={cn(
                      "h-7 rounded px-2 text-xs font-medium",
                      objectiveProfile === profile.value
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                    title={profile.description}
                  >
                    {profile.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border p-1">
              {TAIL_ASSIGNMENT_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setTailAssignmentMode(mode.value)}
                  className={cn(
                    "h-7 rounded px-2 text-xs font-medium",
                    tailAssignmentMode === mode.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                  title={`Tail optimization: ${mode.label}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
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
      )}

      <MultiEventPanel
        primary={disruption}
        extras={extraEvents}
        showForm={showEventForm}
        draft={eventDraft}
        opsDateStr={opsDateStr}
        onShowForm={() => setShowEventForm(true)}
        onCancelForm={() => {
          setShowEventForm(false);
          setEventDraft(emptyDraft());
        }}
        onDraftChange={setEventDraft}
        onAdd={addExtraEvent}
        onRemove={removeExtraEvent}
        analysis={eventConflictAnalysis}
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
                filterAircraft={relevantAircraft}
              />
            </div>
            <ul className="mt-3 text-sm space-y-1">
              {result.impacted_flights.length === 0 && (
                <li className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  No flights matched this disruption window, aircraft, airport,
                  or current operating-date filter. Change the event time/date
                  or select the schedule date that contains the affected flight.
                </li>
              )}
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

          <SwapFeedbackPanel feedback={result.feedback} />
          <TailAssignmentFeedbackPanel
            feedback={result.feedback?.tail_assignment ?? null}
            options={result.ranked_options}
          />

          <div className="rounded-lg border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold">
                Ranked recovery options ({result.ranked_options.length})
              </h2>
              <span className="text-xs text-zinc-500 font-normal">
                Objective: {resultObjective.label} · Total impacted:{" "}
                {result.impacted_flights.length} flights ·{" "}
                {new Set(result.impacted_flights.map((f: ImpactedFlight) => f.flight.aircraft_id)).size} aircraft
              </span>
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
              {result.ranked_options.length === 0 && (
                <div className="p-4 text-sm text-zinc-600">
                  No recovery options were generated for this run.
                  {result.impacted_flights.length === 0
                    ? " The event did not impact any loaded flights."
                    : " The engine found impacted flights, but no feasible recovery plan passed the current constraints."}
                </div>
              )}
              {result.ranked_options.map((opt) => (
                <OptionRow
                  key={opt.option_id}
                  option={opt}
                  options={result.ranked_options}
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
              options={result.ranked_options}
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
  SWAP_CHAIN: "bg-teal-600",
  TAIL_ASSIGNMENT_OPTIMIZED: "bg-sky-700",
  CANCEL_OR_FERRY: "bg-zinc-700",
};

/** Parse SWAP_CHAIN option into primary swap + displaced coverage groups */
function parseSwapChainInfo(option: RecoveryOption) {
  if (option.option_type !== "SWAP_CHAIN") return null;
  const ac = option.aircraft_changes;
  const primaryAcId = Object.keys(ac)[0] ?? null;
  const swapAcId = primaryAcId ? ac[primaryAcId] : null;

  // Build chain nodes from aircraft_changes
  const chainNodes: string[] = [];
  if (primaryAcId) chainNodes.push(primaryAcId);
  if (swapAcId) chainNodes.push(swapAcId);
  // Find tertiary aircraft in displaced coverage
  const tertiaryIds = new Set<string>();
  for (const fc of option.flight_changes) {
    if (
      fc.original_aircraft === swapAcId &&
      fc.new_aircraft !== swapAcId &&
      fc.new_aircraft !== primaryAcId
    ) {
      tertiaryIds.add(fc.new_aircraft);
    }
  }
  for (const id of tertiaryIds) chainNodes.push(id);

  // Split flight_changes into groups
  const primarySwaps = option.flight_changes.filter(
    (fc) => fc.original_aircraft === primaryAcId && fc.new_aircraft === swapAcId,
  );
  const displacedCoverage = option.flight_changes.filter(
    (fc) => fc.original_aircraft === swapAcId,
  );
  const displacedWithCoverage = displacedCoverage.filter(
    (fc) => fc.new_aircraft !== fc.original_aircraft,
  );
  const displacedDelayed = displacedCoverage.filter(
    (fc) => fc.new_aircraft === fc.original_aircraft && fc.delay_minutes > 0,
  );
  const chainFlightIds = new Set(
    [...primarySwaps, ...displacedCoverage].map((fc) => fc.flight_id),
  );
  const otherAffectedFlights = option.flight_changes.filter(
    (fc) => !chainFlightIds.has(fc.flight_id),
  );
  const otherAffectedDelayed = otherAffectedFlights.filter(
    (fc) => fc.delay_minutes > 0,
  );
  const otherAffectedNoChange = otherAffectedFlights.filter(
    (fc) => fc.delay_minutes === 0 && fc.new_aircraft === fc.original_aircraft,
  );

  return {
    chainNodes,
    primaryAcId,
    swapAcId,
    primarySwaps,
    displacedCoverage,
    displacedWithCoverage,
    displacedDelayed,
    otherAffectedFlights,
    otherAffectedDelayed,
    otherAffectedNoChange,
  };
}

function OptionRow({
  option,
  options,
  active,
  inCompare,
  approved,
  onClick,
  onToggleCompare,
}: {
  option: RecoveryOption;
  options: RecoveryOption[];
  active: boolean;
  inCompare: boolean;
  approved: boolean;
  onClick: () => void;
  onToggleCompare: () => void;
}) {
  const watchouts = getOptionWatchouts(option);
  const rankingExplanations = getTailRankingExplanations(option, options);

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
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={cn(
                "inline-block max-w-full break-all px-2 py-0.5 rounded text-[11px] font-mono text-white",
                OPTION_COLORS[option.option_type],
              )}
            >
              {option.option_type}
            </span>
            {approved && (
              <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-600 text-white">
                APPROVED
              </span>
            )}
            {option.curfew_violations > 0 && (
              <span
                title={`${option.curfew_violations} movement(s) inside a configured curfew window`}
                className="inline-block px-2 py-0.5 rounded text-[11px] font-mono bg-red-100 text-red-800 border border-red-300"
              >
                CURFEW ×{option.curfew_violations}
              </span>
            )}
          </div>
          {/* Chain indicator for SWAP_CHAIN */}
          {(() => {
            const chain = parseSwapChainInfo(option);
            if (!chain) return null;
            return (
              <div className="mt-1.5 flex items-center gap-1 text-[11px] font-mono">
                {chain.chainNodes.map((node, i) => (
                  <span key={node} className="flex items-center gap-1">
                    {i > 0 && <span className="text-teal-500">→</span>}
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded border",
                        i === 0
                          ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                          : i === 1
                            ? "border-teal-300 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                            : "border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
                      )}
                    >
                      {node}
                    </span>
                  </span>
                ))}
              </div>
            );
          })()}
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
          <div className="text-xs text-zinc-500">Coverage / Swap</div>
          <div className="text-sm font-mono">
            {option.impacted_flight_count} flights · {option.swap_count} swap
          </div>
          {option.passenger_impact && (
            <div
              className={cn(
                "mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-mono",
                option.passenger_impact.high_impact
                  ? "bg-red-100 text-red-800"
                  : "bg-sky-100 text-sky-800",
              )}
              title={`${option.passenger_impact.passenger_delay_minutes} passenger-delay minutes`}
            >
              ~{option.passenger_impact.estimated_affected_passengers} pax
            </div>
          )}
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
          {watchouts.map((watchout, index) => (
            <div
              key={`${option.option_id}-watchout-${index}`}
              className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300"
            >
              {watchout}
            </div>
          ))}
          {rankingExplanations.slice(0, 1).map((explanation, index) => (
            <div
              key={`${option.option_id}-ranking-${index}`}
              className="mt-1 text-[11px] font-medium text-sky-700 dark:text-sky-300"
            >
              {explanation}
            </div>
          ))}
        </div>
      </button>
    </div>
  );
}

function SwapFeedbackPanel({
  feedback,
}: {
  feedback: SimulationFeedback | null;
}) {
  if (!feedback) {
    return null;
  }

  const blockedCandidates = feedback.candidates.filter(
    (candidate) => !candidate.feasible && candidate.blocking_reason,
  );
  const hasFeasibleSwap = feedback.feasible_swap_count > 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        hasFeasibleSwap
          ? "border-amber-300 bg-amber-50/70"
          : "border-red-300 bg-red-50/80",
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Single-swap feasibility</h2>
          <p className="mt-1 text-sm text-zinc-700">
            Target flight{" "}
            <span className="font-mono">
              {feedback.swap_target_flight_number ?? feedback.swap_target_flight_id}
            </span>{" "}
            on{" "}
            <span className="font-mono">
              {feedback.swap_target_aircraft_id ?? "unknown aircraft"}
            </span>
            . Checked {feedback.candidate_count} candidate aircraft.
          </p>
        </div>
        <div className="text-sm font-medium">
          {feedback.candidate_count === 0
            ? "No swap candidates available"
            : hasFeasibleSwap
            ? `${feedback.feasible_swap_count} full-rotation swap candidate(s) available`
            : "No feasible full-rotation swap found"}
        </div>
      </div>

      {feedback.candidate_count === 0 && (
        <p className="mt-3 text-sm text-zinc-700">
          No spare aircraft passed the basic same-origin and availability checks
          for this target flight.
        </p>
      )}

      {blockedCandidates.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {blockedCandidates.map((candidate) => (
            <li
              key={candidate.aircraft_id}
              className="rounded border border-border bg-background/70 p-3"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-mono text-xs">
                  {candidate.aircraft_id} ({candidate.aircraft_type})
                </div>
                <span
                  className={cn(
                    "inline-block rounded px-2 py-0.5 text-[11px] font-mono",
                    candidate.risk_level === "LOW" &&
                      "bg-emerald-100 text-emerald-800",
                    candidate.risk_level === "MEDIUM" &&
                      "bg-amber-100 text-amber-800",
                    candidate.risk_level === "HIGH" &&
                      "bg-red-100 text-red-800",
                  )}
                >
                  {candidate.risk_level}
                </span>
              </div>
              <div className="mt-2 text-zinc-700">
                {candidate.blocking_reason}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TailAssignmentFeedbackPanel({
  feedback,
  options,
}: {
  feedback: TailAssignmentOptimizationFeedback | null;
  options: RecoveryOption[];
}) {
  if (!feedback?.attempted) {
    return null;
  }

  const bestTailOption = options.find(
    (option) => option.option_type === "TAIL_ASSIGNMENT_OPTIMIZED",
  );
  const pathText = feedback.connection_fixing_applied
    ? `${feedback.initial_path_count.toLocaleString()} -> ${feedback.final_path_count.toLocaleString()}`
    : feedback.path_count.toLocaleString();
  const searchText = feedback.connection_fixing_applied
    ? `${feedback.initial_search_nodes.toLocaleString()} -> ${feedback.final_search_nodes.toLocaleString()}`
    : feedback.search_nodes.toLocaleString();

  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50/70 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Aircraft recovery optimization</h2>
          <p className="mt-1 text-sm text-zinc-700">
            Recovery horizon has{" "}
            <span className="font-mono">
              {feedback.horizon_flight_count.toLocaleString()}
            </span>{" "}
            flight(s) across{" "}
            <span className="font-mono">
              {feedback.aircraft_count.toLocaleString()}
            </span>{" "}
            aircraft.
          </p>
        </div>
        <div className="text-sm font-medium">
          <div>
            {bestTailOption
              ? `Best optimized option #${bestTailOption.rank ?? "-"}`
              : "No optimized option generated"}
          </div>
          <div className="mt-1 text-right text-xs font-mono uppercase text-zinc-500">
            {feedback.mode}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <OptimizerMetric
          label="Arc reduction"
          value={`${feedback.original_arc_count.toLocaleString()} -> ${feedback.reduced_arc_count.toLocaleString()}`}
          detail={`${feedback.removed_arc_count.toLocaleString()} removed (${feedback.arc_reduction_pct}%)`}
        />
        <OptimizerMetric
          label="Candidate paths"
          value={pathText}
          detail={
            feedback.connection_fixing_applied
              ? "after connection fixing"
              : "before master selection"
          }
        />
        <OptimizerMetric
          label="Master search"
          value={searchText}
          detail="visited node(s)"
        />
        <OptimizerMetric
          label="Connection fixing"
          value={
            feedback.connection_fixing_applied
              ? `${feedback.fixed_connection_count.toLocaleString()} locked`
              : "Not applied"
          }
          detail={`${feedback.option_count.toLocaleString()} optimized option(s)`}
        />
      </div>

      {!bestTailOption && feedback.no_option_reason && (
        <div className="mt-3 rounded border border-sky-200 bg-background/80 p-3 text-sm">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {feedback.no_option_reason}
          </div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            Candidate paths can cover up to{" "}
            <span className="font-mono">
              {feedback.best_covered_flight_count.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="font-mono">
              {feedback.required_flight_count.toLocaleString()}
            </span>{" "}
            required horizon flight(s); complete solutions found:{" "}
            <span className="font-mono">
              {feedback.complete_solution_count.toLocaleString()}
            </span>
            .
          </div>
          {feedback.top_blocking_reasons.length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs text-zinc-700 dark:text-zinc-200 sm:grid-cols-2">
              {feedback.top_blocking_reasons.map((item) => (
                <li
                  key={item.reason}
                  className="flex items-start justify-between gap-3 rounded border border-border/70 px-2 py-1"
                >
                  <span>{item.reason}</span>
                  <span className="font-mono text-zinc-500">
                    {item.count.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function OptimizerMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded border border-sky-200 bg-background/70 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 break-words font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
        {detail}
      </div>
    </div>
  );
}

function OptionDetail({
  option,
  options,
  eventInfo,
  onApprove,
  approved,
  canApprove,
}: {
  option: RecoveryOption;
  options: RecoveryOption[];
  eventInfo: string;
  onApprove?: () => void;
  approved: boolean;
  canApprove: boolean;
}) {
  const watchouts = getOptionWatchouts(option);
  const rankingExplanations = getTailRankingExplanations(option, options);

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
        {rankingExplanations.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2">
              Ranking explanation
            </h3>
            <ul className="text-sm space-y-1 list-disc list-inside text-sky-800 dark:text-sky-200">
              {rankingExplanations.map((explanation, index) => (
                <li key={`${option.option_id}-ranking-detail-${index}`}>
                  {explanation}
                </li>
              ))}
            </ul>
          </div>
        )}
        {watchouts.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2">Watchouts</h3>
            <ul className="text-sm space-y-1 list-disc list-inside text-zinc-700 dark:text-zinc-300">
              {watchouts.map((watchout, index) => (
                <li key={`${option.option_id}-detail-watchout-${index}`}>
                  {watchout}
                </li>
              ))}
            </ul>
          </div>
        )}
        <h3 className="text-sm font-semibold mb-2">Reason codes</h3>
        <ul className="text-sm space-y-1 list-disc list-inside text-zinc-700 dark:text-zinc-300">
          {option.reason_codes.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

      {option.passenger_impact && <PassengerImpactPanel option={option} />}

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
            Flight impact plan ({option.flight_changes.length})
          </h3>

          {/* SWAP_CHAIN: chain flow diagram + grouped tables */}
          {(() => {
            const chain = parseSwapChainInfo(option);
            if (!chain) return <FlightChangesTable changes={option.flight_changes} />;

            return (
              <div className="space-y-4">
                {/* Chain Flow Diagram */}
                <div className="rounded-lg border border-teal-200 bg-gradient-to-r from-teal-50/50 to-transparent dark:from-teal-900/20 dark:border-teal-800 p-4">
                  <div className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-3">
                    Swap chain flow
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {chain.chainNodes.map((node, i) => (
                      <div key={node} className="flex items-center gap-2">
                        {i > 0 && (
                          <div className="flex flex-col items-center">
                            <span className="text-teal-400 text-lg">→</span>
                            <span className="text-[10px] text-zinc-500">
                              {i === 1 ? "covers" : "covers displaced"}
                            </span>
                          </div>
                        )}
                        <div
                          className={cn(
                            "rounded-lg border-2 px-3 py-2 text-center min-w-[90px]",
                            i === 0
                              ? "border-red-300 bg-red-50 dark:bg-red-900/30"
                              : i === 1
                                ? "border-teal-300 bg-teal-50 dark:bg-teal-900/30"
                                : "border-violet-300 bg-violet-50 dark:bg-violet-900/30",
                          )}
                        >
                          <div
                            className={cn(
                              "font-mono font-bold text-sm",
                              i === 0 ? "text-red-700 dark:text-red-300"
                                : i === 1 ? "text-teal-700 dark:text-teal-300"
                                : "text-violet-700 dark:text-violet-300",
                            )}
                          >
                            {node}
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            {i === 0
                              ? "disrupted"
                              : i === 1
                                ? `${chain.primarySwaps.length} leg(s) absorbed`
                                : "tertiary cover"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Summary badges */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-teal-300 bg-teal-50 dark:bg-teal-900/30 px-2 py-0.5 text-teal-700 dark:text-teal-300 font-medium">
                      ✈ {option.swap_count} swap(s)
                    </span>
                    {chain.displacedWithCoverage.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 text-violet-700 dark:text-violet-300 font-medium">
                        ✓ {chain.displacedWithCoverage.length} displaced covered
                      </span>
                    )}
                    {chain.displacedDelayed.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-amber-700 dark:text-amber-300 font-medium">
                        ⏱ {chain.displacedDelayed.length} displaced delayed
                      </span>
                    )}
                    {chain.otherAffectedFlights.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-sky-700 dark:text-sky-300 font-medium">
                        {chain.otherAffectedFlights.length} other affected
                      </span>
                    )}
                  </div>
                </div>

                {/* Group 1: Primary Swap */}
                <div>
                  <h4 className="text-xs font-semibold mb-1.5 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-teal-500" />
                    Primary swap ({chain.primarySwaps.length} flights)
                    <span className="font-normal text-zinc-500">
                      {chain.primaryAcId} → {chain.swapAcId}
                    </span>
                  </h4>
                  <FlightChangesTable changes={chain.primarySwaps} />
                </div>

                {/* Group 2: Displaced Coverage */}
                {chain.displacedCoverage.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold mb-1.5 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
                      Displaced coverage ({chain.displacedCoverage.length} flights)
                      <span className="font-normal text-zinc-500">
                        flights displaced from {chain.swapAcId}
                      </span>
                    </h4>
                    <FlightChangesTable changes={chain.displacedCoverage} highlightDisplaced />
                  </div>
                )}

                {/* Group 3: Other impacted flights covered by this plan */}
                {chain.otherAffectedFlights.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold mb-1.5 flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
                      Other affected flights ({chain.otherAffectedFlights.length} flights)
                      <span className="font-normal text-zinc-500">
                        {chain.otherAffectedDelayed.length} delayed,{" "}
                        {chain.otherAffectedNoChange.length} no aircraft/time change
                      </span>
                    </h4>
                    <FlightChangesTable
                      changes={chain.otherAffectedFlights}
                      highlightAffected
                    />
                  </div>
                )}
              </div>
            );
          })()}
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


function FlightChangesTable({
  changes,
  highlightDisplaced,
  highlightAffected,
}: {
  changes: FlightChange[];
  highlightDisplaced?: boolean;
  highlightAffected?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead className="text-left text-zinc-500 border-b border-border">
          <tr>
            <th className="py-1 pr-3">Flight</th>
            <th className="py-1 pr-3">Route</th>
            <th className="py-1 pr-3">Old aircraft</th>
            <th className="py-1 pr-3">New aircraft</th>
            <th className="py-1 pr-3">Old STD</th>
            <th className="py-1 pr-3">New STD</th>
            <th className="py-1 pr-3">Delay</th>
            <th className="py-1 pr-3">Reason</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => {
            const isSwapped = c.new_aircraft !== c.original_aircraft;
            const isDelayed = c.delay_minutes > 0;
            return (
              <tr
                key={c.flight_id}
                className={cn(
                  "border-b border-border/50 last:border-b-0",
                  highlightDisplaced && isSwapped && "bg-violet-50/50 dark:bg-violet-900/10",
                  highlightDisplaced && isDelayed && !isSwapped && "bg-amber-50/50 dark:bg-amber-900/10",
                  highlightAffected && isDelayed && "bg-amber-50/50 dark:bg-amber-900/10",
                  highlightAffected && !isDelayed && !isSwapped && "bg-sky-50/40 dark:bg-sky-900/10",
                )}
              >
                <td className="py-1.5 pr-3">{c.flight_number}</td>
                <td className="py-1.5 pr-3">{c.origin}→{c.destination}</td>
                <td className="py-1.5 pr-3">{c.original_aircraft}</td>
                <td className="py-1.5 pr-3">
                  {isSwapped ? (
                    <span className={cn(
                      "font-bold",
                      highlightDisplaced ? "text-violet-700 dark:text-violet-300" : "text-emerald-700 dark:text-emerald-300",
                    )}>
                      {c.new_aircraft}
                    </span>
                  ) : (
                    c.new_aircraft
                  )}
                </td>
                <td className="py-1.5 pr-3">{formatDateTime(c.original_std)}</td>
                <td className="py-1.5 pr-3">{formatDateTime(c.new_std)}</td>
                <td className="py-1.5 pr-3">
                  {isDelayed ? (
                    <span className="text-amber-700 dark:text-amber-300 font-bold">
                      +{c.delay_minutes}′
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1.5 pr-3 text-zinc-500 max-w-[200px] truncate" title={c.reason}>
                  {c.reason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PassengerImpactPanel({ option }: { option: RecoveryOption }) {
  const impact = option.passenger_impact;
  if (!impact) return null;

  return (
    <div className="rounded border border-sky-200 bg-sky-50 p-4 dark:bg-sky-950/30 dark:border-sky-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">
            Passenger impact
          </h3>
          <p className="mt-1 text-xs text-sky-800 dark:text-sky-200">
            Estimated from booked passengers when available, otherwise seat
            capacity and load factor.
          </p>
        </div>
        {impact.high_impact && (
          <span className="rounded bg-red-100 px-2 py-1 text-[11px] font-mono text-red-800">
            HIGH IMPACT
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <PassengerMetric
          label="Affected pax"
          value={`~${impact.estimated_affected_passengers}`}
        />
        <PassengerMetric
          label="Pax-delay min"
          value={String(impact.passenger_delay_minutes)}
        />
        <PassengerMetric
          label="Misconnect risk"
          value={`~${impact.misconnect_risk_passengers}`}
        />
        <PassengerMetric
          label="Priority score"
          value={String(impact.priority_passenger_score)}
        />
      </div>

      {impact.top_impacted_flights.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-sky-900 dark:text-sky-100">
            Top passenger-impact flights
          </div>
          <div className="mt-2 divide-y divide-sky-200 rounded border border-sky-200 bg-background/70 dark:divide-sky-800 dark:border-sky-800">
            {impact.top_impacted_flights.map((flight) => (
              <div
                key={flight.flight_id}
                className="grid gap-2 p-2 text-xs sm:grid-cols-4"
              >
                <div className="font-mono font-semibold">
                  {flight.flight_number}
                </div>
                <div>~{flight.affected_passengers} pax</div>
                <div>{flight.passenger_delay_minutes} pax-min</div>
                <div className="text-zinc-600 dark:text-zinc-300">
                  {flight.reason_codes.slice(0, 2).join("; ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PassengerMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-sky-200 bg-background/80 p-2 dark:border-sky-800">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-1 font-mono font-semibold">{value}</div>
    </div>
  );
}

function ImportIssueSummary({
  parseIssues,
  validationIssues,
}: {
  parseIssues: ReturnType<typeof useData>["parseIssues"];
  validationIssues: ReturnType<typeof useData>["validation"];
}) {
  const grouped = [
    ["Schedule", parseIssues.schedule],
    ["Aircraft", parseIssues.aircraft],
    ["Disruption", parseIssues.disruption],
    ["Dataset", validationIssues],
  ] as const;
  const visibleGroups = grouped
    .map(([label, issues]) => ({
      label,
      errors: issues.filter((issue) => issue.level === "error"),
      warnings: issues.filter((issue) => issue.level === "warning"),
    }))
    .filter((group) => group.errors.length > 0 || group.warnings.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <div className="font-semibold">
        Import checks found issues. Errors must be fixed before simulation.
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div key={group.label} className="rounded border border-amber-200 bg-background/70 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{group.label}</span>
              <span className="font-mono text-[11px]">
                {group.errors.length} error / {group.warnings.length} warn
              </span>
            </div>
            <ul className="mt-1 space-y-1 font-mono text-[11px]">
              {[...group.errors, ...group.warnings].slice(0, 4).map((issue, index) => (
                <li key={`${group.label}-${index}`} className="flex flex-wrap gap-1">
                  <span className="uppercase">{issue.level}</span>
                  {issue.row != null && <span>row {issue.row}</span>}
                  {issue.column && <span>col {issue.column}</span>}
                  <span className="font-sans">{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
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




/**
 * Simplified version of draftToEvent that accepts HH:MM strings and combines
 * them with the ops date to produce full ISO datetimes.
 * If end < start, assumes end is next day (overnight disruption).
 */
function draftToEventSimple(
  d: EventDraft,
  opsDateStr: string,
): DisruptionEvent | null {
  if (!d.start || !d.end) return null;
  // Duty Manager enters times in Vietnam local — convert to UTC for engine
  const start = vnLocalToUtc(opsDateStr, d.start);
  let end = vnLocalToUtc(opsDateStr, d.end);
  if (!start || !end) return null;
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return {
    event_id: `EVT-${d.event_type.slice(0, 3)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    event_type: d.event_type,
    start_time: start,
    end_time: end,
    severity: d.severity,
    description: d.description || `${d.event_type} event`,
    affected_aircraft: d.event_type === "AOG" ? d.affected_aircraft || null : null,
    affected_airport:
      d.event_type === "AIRPORT_CLOSE" || d.event_type === "WEATHER"
        ? d.affected_airport || null
        : null,
    affected_flight_id:
      d.event_type === "LATE_ARRIVAL" ? d.affected_flight_id || null : null,
  };
}

function EventConflictIntelligence({
  analysis,
}: {
  analysis: MultiEventConflictAnalysis;
}) {
  if (analysis.event_count === 0) return null;

  const totalImpacted = analysis.event_summaries.reduce(
    (sum, item) => sum + item.impacted_flight_count,
    0,
  );
  const topConflicts = analysis.conflicts.slice(0, 3);

  return (
    <div className="mt-3 rounded border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Event coupling intelligence</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Conflict graph across time windows, aircraft rotations, airports,
            and impacted flights.
          </p>
        </div>
        <ConflictBadge level={analysis.network_risk_level} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <ConflictMetric
          label="Network score"
          value={analysis.network_exposure_score.toLocaleString()}
        />
        <ConflictMetric
          label="Impacted flights"
          value={totalImpacted.toLocaleString()}
        />
        <ConflictMetric
          label="Coupled events"
          value={`${analysis.coupled_event_count}/${analysis.event_count}`}
        />
        <ConflictMetric
          label="Conflict pairs"
          value={analysis.conflicts.length.toLocaleString()}
        />
      </div>

      <div className="mt-3 overflow-hidden rounded border border-border bg-background/70">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted text-zinc-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Event</th>
              <th className="px-2 py-1.5 font-medium">Impact</th>
              <th className="px-2 py-1.5 font-medium">Aircraft</th>
              <th className="px-2 py-1.5 font-medium">Downstream</th>
              <th className="px-2 py-1.5 font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {analysis.event_summaries.map((summary) => (
              <tr key={summary.event_id} className="border-t border-border">
                <td className="px-2 py-1.5">
                  <div className="font-mono font-semibold">{summary.event_id}</div>
                  <div className="text-zinc-500">{summary.event_type}</div>
                </td>
                <td className="px-2 py-1.5">
                  {summary.impacted_flight_count} flight(s)
                  <div className="text-zinc-500">
                    {summary.priority_impacted_count} priority
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {summary.impacted_aircraft_count}
                </td>
                <td className="px-2 py-1.5">
                  {summary.downstream_exposure_count}
                </td>
                <td className="px-2 py-1.5">
                  <ConflictBadge level={summary.exposure_level} compact />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {topConflicts.length > 0 && (
        <div className="mt-3 space-y-2">
          {topConflicts.map((conflict) => (
            <div
              key={conflict.event_ids.join(":")}
              className="rounded border border-border bg-background/70 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">
                  {conflict.event_ids.join(" + ")}
                </span>
                <ConflictBadge level={conflict.level} compact />
              </div>
              <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                {conflict.reasons.slice(0, 2).join("; ")}
              </div>
              {(conflict.shared_aircraft.length > 0 ||
                conflict.shared_airports.length > 0 ||
                conflict.shared_flights.length > 0) && (
                <div className="mt-1 font-mono text-[11px] text-zinc-500">
                  {conflict.shared_aircraft.length > 0 &&
                    `A/C ${conflict.shared_aircraft.join(", ")}`}
                  {conflict.shared_aircraft.length > 0 &&
                    conflict.shared_airports.length > 0 &&
                    " · "}
                  {conflict.shared_airports.length > 0 &&
                    `APT ${conflict.shared_airports.join(", ")}`}
                  {(conflict.shared_aircraft.length > 0 ||
                    conflict.shared_airports.length > 0) &&
                    conflict.shared_flights.length > 0 &&
                    " · "}
                  {conflict.shared_flights.length > 0 &&
                    `FLT ${conflict.shared_flights.join(", ")}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {analysis.recommendations.length > 0 && (
        <ul className="mt-3 grid gap-1 text-xs text-zinc-700 dark:text-zinc-200 md:grid-cols-2">
          {analysis.recommendations.map((item) => (
            <li key={item} className="rounded border border-border/70 px-2 py-1">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConflictMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-border bg-background/70 p-2">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function ConflictBadge({
  level,
  compact = false,
}: {
  level: EventConflictLevel;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 font-mono font-semibold",
        compact ? "text-[10px]" : "text-[11px]",
        level === "LOW" && "bg-emerald-100 text-emerald-800",
        level === "MEDIUM" && "bg-amber-100 text-amber-800",
        level === "HIGH" && "bg-orange-100 text-orange-800",
        level === "CRITICAL" && "bg-red-100 text-red-800",
      )}
    >
      {level}
    </span>
  );
}

function MultiEventPanel({
  primary,
  extras,
  showForm,
  draft,
  opsDateStr,
  onShowForm,
  onCancelForm,
  onDraftChange,
  onAdd,
  onRemove,
  analysis,
}: {
  primary: DisruptionEvent | null;
  extras: DisruptionEvent[];
  showForm: boolean;
  draft: EventDraft;
  opsDateStr: string;
  onShowForm: () => void;
  onCancelForm: () => void;
  onDraftChange: (d: EventDraft) => void;
  onAdd: () => void;
  onRemove: (eventId: string) => void;
  analysis: MultiEventConflictAnalysis;
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
                {formatDateTime(primary.start_time)} →{" "}
                {formatDateTime(primary.end_time)}
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
                  {formatDateTime(e.start_time)} → {formatDateTime(e.end_time)}
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

      <EventConflictIntelligence analysis={analysis} />

      {showForm && (
        <div className="mt-3 rounded border border-border p-3 space-y-3 text-sm">
          <p className="text-xs text-zinc-500">
            Times are HH:MM format on ops date{" "}
            <span className="font-mono font-semibold">{opsDateStr}</span> (Vietnam local).
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Type</label>
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
                <option value="AIRPORT_CLOSE">AIRPORT CLOSE</option>
                <option value="WEATHER">WEATHER</option>
                <option value="LATE_ARRIVAL">LATE ARRIVAL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Severity</label>
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
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Start (HH:MM)</label>
              <input
                type="time"
                value={draft.start}
                onChange={(e) =>
                  onDraftChange({ ...draft, start: e.target.value })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">End (HH:MM)</label>
              <input
                type="time"
                value={draft.end}
                onChange={(e) =>
                  onDraftChange({ ...draft, end: e.target.value })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Airport (IATA)</label>
              <input
                value={draft.affected_airport}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    affected_airport: e.target.value.toUpperCase(),
                  })
                }
                className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                placeholder="SGN"
              />
            </div>
            {draft.event_type === "AOG" && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Aircraft</label>
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
            {draft.event_type === "LATE_ARRIVAL" && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Flight ID</label>
                <input
                  value={draft.affected_flight_id}
                  onChange={(e) =>
                    onDraftChange({
                      ...draft,
                      affected_flight_id: e.target.value,
                    })
                  }
                  className="h-9 w-full rounded border border-border bg-background px-2 text-sm font-mono"
                  placeholder="FL001"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onAdd}
              disabled={!draft.start || !draft.end}
              className="h-8 rounded-md bg-primary px-3 text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
            >
              Add event
            </button>
            <input
              value={draft.description}
              onChange={(e) =>
                onDraftChange({ ...draft, description: e.target.value })
              }
              className="h-9 flex-1 rounded border border-border bg-background px-2 text-sm"
              placeholder="Description (optional)"
            />
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
