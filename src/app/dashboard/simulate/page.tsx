"use client";

import { useState } from "react";
import { useData } from "@/components/data-context";
import { GanttSchedule } from "@/components/gantt-schedule";
import { runSimulation, type SimulationResult } from "@/lib/engine";
import type { OptionType, RecoveryOption } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

export default function SimulatePage() {
  const { schedule, aircraft, disruption, rules, loadSampleData } = useData();
  const [scenario, setScenario] = useState<
    "aog" | "airport_close" | "weather" | "late_arrival"
  >("aog");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  const canRun = Boolean(schedule.length && aircraft.length && disruption);

  const handleRun = () => {
    if (!disruption) return;
    setRunning(true);
    try {
      const r = runSimulation({ schedule, aircraft, disruption, rules });
      setResult(r);
      setSelectedOption(r.ranked_options[0]?.option_id ?? null);
    } finally {
      setRunning(false);
    }
  };

  const handleLoadScenario = async (
    s: "aog" | "airport_close" | "weather" | "late_arrival",
  ) => {
    setScenario(s);
    setResult(null);
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
            {running ? "Running…" : "Run simulation"}
          </button>
        </div>
      </div>

      {result && (
        <>
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
            <div className="p-4 border-b border-border">
              <h2 className="font-semibold">
                Ranked recovery options ({result.ranked_options.length})
              </h2>
            </div>
            <div className="divide-y divide-border">
              {result.ranked_options.map((opt) => (
                <OptionRow
                  key={opt.option_id}
                  option={opt}
                  active={selectedOption === opt.option_id}
                  onClick={() => setSelectedOption(opt.option_id)}
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
  onClick,
}: {
  option: RecoveryOption;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full p-4 text-left grid grid-cols-12 gap-3 items-center hover:bg-muted transition",
        active && "bg-muted",
      )}
    >
      <div className="col-span-1 text-xl font-bold">#{option.rank}</div>
      <div className="col-span-3">
        <span
          className={cn(
            "inline-block px-2 py-0.5 rounded text-[11px] font-mono text-white",
            OPTION_COLORS[option.option_type],
          )}
        >
          {option.option_type}
        </span>
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
  );
}

function OptionDetail({
  option,
  eventInfo,
}: {
  option: RecoveryOption;
  eventInfo: string;
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

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => exportOptionAsCsv(option)}
          className="h-9 rounded-md bg-primary px-4 text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Export CSV (AIMS upload)
        </button>
        <button
          onClick={() => exportOptionAsJson(option)}
          className="h-9 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Export audit JSON
        </button>
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
