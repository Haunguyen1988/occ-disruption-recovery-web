"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudSun, RefreshCw, Wind } from "lucide-react";
import type { SerializedWeatherSnapshot } from "@/lib/weather/serialize";
import type { WeatherAlertSeverity } from "@/lib/weather/types";
import { cn } from "@/lib/utils";

interface WeatherWatchProps {
  compact?: boolean;
}

export function WeatherWatch({ compact = false }: WeatherWatchProps) {
  const [snapshot, setSnapshot] = useState<SerializedWeatherSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(refresh ? "/api/weather/refresh" : "/api/weather", {
        method: refresh ? "POST" : "GET",
      });
      if (!res.ok) throw new Error(`Weather API ${res.status}`);
      const data = (await res.json()) as SerializedWeatherSnapshot;
      setSnapshot(data);
      if (data.errors.length > 0) setError(data.errors[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="surface rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CloudSun className="h-4 w-4 text-zinc-500" />
          <div>
            <h2 className="text-sm font-semibold">Weather watch</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Live METAR/TAF feed for VVTS, VVNB, and VVDN.
            </p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-panel px-2 text-xs font-medium shadow-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {error}
        </div>
      )}

      <div
        className={cn(
          "mt-4 grid gap-3",
          compact ? "md:grid-cols-3" : "lg:grid-cols-3",
        )}
      >
        {(snapshot?.airports ?? []).map((airport) => (
          <AirportWeatherCard
            key={airport.airport.icao}
            airport={airport}
            compact={compact}
          />
        ))}
        {!snapshot &&
          [0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-36 rounded-md border border-border bg-panel-subtle"
            />
          ))}
      </div>
    </section>
  );
}

function AirportWeatherCard({
  airport,
  compact,
}: {
  airport: SerializedWeatherSnapshot["airports"][number];
  compact: boolean;
}) {
  const metar = airport.metar;
  const taf = airport.taf;
  const topAlerts = airport.alerts.slice(0, compact ? 1 : 3);

  return (
    <div className="rounded-lg border border-border bg-panel-subtle p-3 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-semibold">
            {airport.airport.iata}/{airport.airport.icao}
          </div>
          <div className="text-xs text-zinc-500">{airport.airport.city}</div>
        </div>
        <StatusBadge status={airport.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <WeatherMetric
          label="Category"
          value={metar?.flight_category ?? "UNKNOWN"}
        />
        <WeatherMetric
          label="Visibility"
          value={
            metar?.visibility_m !== null && metar?.visibility_m !== undefined
              ? `${metar.visibility_m.toLocaleString()}m`
              : "-"
          }
        />
        <WeatherMetric
          label="Ceiling"
          value={
            metar?.ceiling_ft !== null && metar?.ceiling_ft !== undefined
              ? `${metar.ceiling_ft.toLocaleString()}ft`
              : "-"
          }
        />
        <WeatherMetric
          label="Wind"
          value={
            metar?.wind_speed_kt !== null && metar?.wind_speed_kt !== undefined
              ? `${metar.wind_dir_deg ?? "VRB"}/${metar.wind_speed_kt}${
                  metar.wind_gust_kt ? `G${metar.wind_gust_kt}` : ""
                }kt`
              : "-"
          }
        />
      </div>

      {metar?.raw_text ? (
        <WeatherRawBlock
          label="METAR"
          detail={metar.observed_at ? `Obs ${formatWeatherTime(metar.observed_at)}` : null}
          rawText={metar.raw_text}
          compact={compact}
        />
      ) : (
        <MissingWeatherBlock label="METAR" />
      )}

      {taf?.raw_text ? (
        <WeatherRawBlock
          label="TAF"
          detail={taf.valid_from || taf.valid_to ? tafWindow(taf.valid_from, taf.valid_to) : null}
          rawText={taf.raw_text}
          compact={compact}
        />
      ) : (
        <MissingWeatherBlock label="TAF" />
      )}

      {topAlerts.length > 0 ? (
        <div className="mt-3 space-y-1">
          {topAlerts.map((alert) => (
            <div
              key={`${alert.source_report_hash}-${alert.alert_type}-${alert.message}`}
              className="flex items-start gap-1 rounded-md border border-border bg-panel px-2 py-1 text-[11px]"
            >
              <Wind className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          No active weather alert detected.
        </p>
      )}
    </div>
  );
}

function WeatherRawBlock({
  label,
  detail,
  rawText,
  compact,
}: {
  label: "METAR" | "TAF";
  detail: string | null;
  rawText: string;
  compact: boolean;
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-panel px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-bold text-zinc-700">
          {label}
        </span>
        {detail && <span className="text-[10px] text-zinc-500">{detail}</span>}
      </div>
      <div
        className={cn(
          "font-mono text-[11px] leading-relaxed text-zinc-600",
          compact ? "line-clamp-3" : "line-clamp-5",
        )}
        title={rawText}
      >
        {rawText}
      </div>
    </div>
  );
}

function MissingWeatherBlock({ label }: { label: "METAR" | "TAF" }) {
  return (
    <div className="mt-3 rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-zinc-500">
      {label} not available from current feed.
    </div>
  );
}

function WeatherMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-panel px-2 py-1.5">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-0.5 break-words font-mono font-semibold">{value}</div>
    </div>
  );
}

function formatWeatherTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + "Z";
}

function tafWindow(from: string | null, to: string | null): string {
  if (from && to) return `${formatWeatherTime(from)} -> ${formatWeatherTime(to)}`;
  if (from) return `From ${formatWeatherTime(from)}`;
  if (to) return `To ${formatWeatherTime(to)}`;
  return "";
}

function StatusBadge({ status }: { status: WeatherAlertSeverity }) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[11px] font-mono font-semibold",
        status === "INFO" && "bg-emerald-100 text-emerald-800",
        status === "WATCH" && "bg-amber-100 text-amber-800",
        status === "WARNING" && "bg-orange-100 text-orange-800",
        status === "CRITICAL" && "bg-red-100 text-red-800",
      )}
    >
      {status}
    </span>
  );
}
