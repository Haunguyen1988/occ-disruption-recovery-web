"use client";

import { useMemo, useState } from "react";
import type { FlightLeg, ImpactedFlight } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

interface Props {
  schedule: FlightLeg[];
  impacted?: ImpactedFlight[];
  highlightAircraft?: string | null;
}

export function GanttSchedule({
  schedule,
  impacted = [],
  highlightAircraft,
}: Props) {
  const impactedSet = useMemo(
    () => new Set(impacted.map((i) => i.flight.flight_id)),
    [impacted],
  );

  const { startMs, endMs, hours } = useMemo(() => {
    if (!schedule.length)
      return { startMs: 0, endMs: 0, hours: [] as number[] };
    const min = Math.min(...schedule.map((f) => f.std.getTime()));
    const max = Math.max(...schedule.map((f) => f.sta.getTime()));
    const startMs = Math.floor(min / 3600000) * 3600000;
    const endMs = Math.ceil(max / 3600000) * 3600000;
    const totalHours = (endMs - startMs) / 3600000;
    const hourList: number[] = [];
    for (let h = 0; h <= totalHours; h += 1) hourList.push(h);
    return { startMs, endMs, hours: hourList };
  }, [schedule]);

  const totalSpan = endMs - startMs;

  const rows = useMemo(() => {
    const map = new Map<string, FlightLeg[]>();
    for (const f of schedule) {
      const list = map.get(f.aircraft_id) ?? [];
      list.push(f);
      map.set(f.aircraft_id, list);
    }
    return [...map.entries()]
      .map(([id, legs]) => ({
        aircraft_id: id,
        legs: [...legs].sort((a, b) => a.std.getTime() - b.std.getTime()),
      }))
      .sort((a, b) => a.aircraft_id.localeCompare(b.aircraft_id));
  }, [schedule]);

  const [hover, setHover] = useState<FlightLeg | null>(null);

  if (!schedule.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-zinc-500">
        No schedule data loaded.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: "120px 1fr" }}>
        <div className="bg-muted border-b border-border p-2 text-xs font-semibold sticky left-0">
          Aircraft
        </div>
        <div
          className="bg-muted border-b border-border relative"
          style={{ minWidth: 800 }}
        >
          <div
            className="grid h-8 text-[10px] text-zinc-500"
            style={{
              gridTemplateColumns: `repeat(${hours.length - 1}, 1fr)`,
            }}
          >
            {hours.slice(0, -1).map((h) => {
              const t = new Date(startMs + h * 3600000);
              return (
                <div
                  key={h}
                  className="border-l border-border/50 px-1 py-1 font-mono"
                >
                  {formatTime(t)}
                </div>
              );
            })}
          </div>
        </div>

        {rows.map((row) => (
          <div className="contents" key={row.aircraft_id}>
            <div
              className={cn(
                "p-2 text-xs font-mono border-t border-border flex items-center sticky left-0 bg-background",
                highlightAircraft === row.aircraft_id &&
                  "bg-[color:var(--accent)]/10",
              )}
            >
              {row.aircraft_id}
            </div>
            <div className="relative h-12 border-t border-border bg-background">
              <div
                className="absolute inset-0 grid"
                style={{
                  gridTemplateColumns: `repeat(${hours.length - 1}, 1fr)`,
                }}
              >
                {hours.slice(0, -1).map((h) => (
                  <div
                    key={h}
                    className="border-l border-border/50 first:border-l-0"
                  />
                ))}
              </div>
              {row.legs.map((leg) => {
                const left =
                  ((leg.std.getTime() - startMs) / totalSpan) * 100;
                const width =
                  ((leg.sta.getTime() - leg.std.getTime()) / totalSpan) * 100;
                const isImpacted = impactedSet.has(leg.flight_id);
                return (
                  <button
                    key={leg.flight_id}
                    onMouseEnter={() => setHover(leg)}
                    onMouseLeave={() => setHover(null)}
                    className={cn(
                      "absolute top-1 bottom-1 rounded px-2 text-[11px] font-mono text-white whitespace-nowrap overflow-hidden text-ellipsis flex items-center text-left transition",
                      isImpacted
                        ? "bg-[color:var(--danger)] hover:opacity-90"
                        : leg.is_international
                          ? "bg-blue-700 hover:opacity-90"
                          : leg.is_last_flight_of_day
                            ? "bg-emerald-700 hover:opacity-90"
                            : "bg-zinc-700 hover:opacity-90",
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.5)}%`,
                    }}
                    title={`${leg.flight_number} ${leg.origin}-${leg.destination}`}
                  >
                    {leg.flight_number} {leg.origin}-{leg.destination}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hover && (
        <div className="border-t border-border bg-muted p-3 text-sm font-mono">
          <span className="font-bold">{hover.flight_number}</span> ·{" "}
          {hover.origin}→{hover.destination} ·{" "}
          {formatTime(hover.std)}/{formatTime(hover.sta)} · {hover.aircraft_id}{" "}
          ({hover.aircraft_type}) · prio {hover.priority_level} · LF{" "}
          {(hover.load_factor * 100).toFixed(0)}%
          {hover.is_international && " · INTL"}
          {hover.is_last_flight_of_day && " · LAST-OF-DAY"}
        </div>
      )}

      <div className="border-t border-border p-2 text-[11px] text-zinc-500 flex flex-wrap gap-4">
        <Legend color="bg-zinc-700" label="Domestic" />
        <Legend color="bg-blue-700" label="International" />
        <Legend color="bg-emerald-700" label="Last of day" />
        <Legend color="bg-[color:var(--danger)]" label="Impacted" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block h-2 w-3 rounded", color)} />
      {label}
    </span>
  );
}
