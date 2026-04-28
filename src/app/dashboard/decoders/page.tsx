"use client";

import { useMemo, useState } from "react";
import { decodeMetar, evaluateMetar } from "@/lib/decoders/metar";
import { decodeNotam, evaluateNotam } from "@/lib/decoders/notam";
import { cn } from "@/lib/utils";

const SAMPLE_METAR =
  "METAR VVTS 281030Z 18012G22KT 9999 SCT018 BKN025CB 30/24 Q1010 NOSIG=";
const SAMPLE_NOTAM = `A1234/24 NOTAMR A1100/24
Q) VVHM/QMRLC/IV/NBO/A/000/999/1049N10637E005
A) VVTS B) 2604281200 C) 2604281800
E) RWY 07L/25R CLOSED DUE TO MAINTENANCE`;

export default function DecodersPage() {
  const [metarRaw, setMetarRaw] = useState(SAMPLE_METAR);
  const [notamRaw, setNotamRaw] = useState(SAMPLE_NOTAM);

  const metar = useMemo(
    () => (metarRaw.trim() ? decodeMetar(metarRaw) : null),
    [metarRaw],
  );
  const metarAlerts = useMemo(
    () => (metar ? evaluateMetar(metar) : []),
    [metar],
  );

  const notam = useMemo(
    () => (notamRaw.trim() ? decodeNotam(notamRaw) : null),
    [notamRaw],
  );
  const notamAlerts = useMemo(
    () => (notam ? evaluateNotam(notam) : []),
    [notam],
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          MET / NOTAM decoder
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Paste a METAR/TAF or NOTAM message. The tool decodes the structured
          fields and surfaces alerts when conditions fall below the configured
          minima.
        </p>
      </div>

      <section className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-semibold">METAR / TAF</h2>
        <textarea
          value={metarRaw}
          onChange={(e) => setMetarRaw(e.target.value)}
          rows={3}
          className="w-full rounded border border-border bg-background p-2 text-sm font-mono"
        />
        {metar && (
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-border p-3 space-y-1">
              <Field k="Station" v={metar.station ?? "—"} />
              <Field k="Time" v={metar.observation_time_utc ?? "—"} />
              <Field
                k="Wind"
                v={
                  metar.wind
                    ? `${metar.wind.variable ? "VRB" : metar.wind.direction_deg + "°"} ${metar.wind.speed_kt}kt${
                        metar.wind.gust_kt ? ` G${metar.wind.gust_kt}kt` : ""
                      }`
                    : "—"
                }
              />
              <Field
                k="Visibility"
                v={metar.cavok ? "CAVOK" : `${metar.visibility_m ?? "—"}m`}
              />
              <Field
                k="Ceiling"
                v={metar.ceiling_ft ? `${metar.ceiling_ft}ft` : "—"}
              />
              <Field k="Weather" v={metar.weather.join(" ") || "—"} />
              <Field
                k="Clouds"
                v={
                  metar.clouds.length
                    ? metar.clouds
                        .map(
                          (c) =>
                            `${c.cover}${c.base_ft ? c.base_ft / 100 : ""}${c.cb ? "CB" : ""}`,
                        )
                        .join(" ")
                    : "—"
                }
              />
              <Field
                k="Temp / Dew"
                v={
                  metar.temperature_c !== null
                    ? `${metar.temperature_c}°C / ${metar.dewpoint_c}°C`
                    : "—"
                }
              />
              <Field k="QNH" v={metar.qnh_hpa ? `${metar.qnh_hpa} hPa` : "—"} />
            </div>
            <div className="rounded border border-border p-3 space-y-2">
              <h3 className="text-sm font-semibold">Alerts</h3>
              {metarAlerts.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  No threshold breach detected.
                </p>
              ) : (
                metarAlerts.map((a, i) => <AlertRow key={i} {...a} />)
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-semibold">NOTAM</h2>
        <textarea
          value={notamRaw}
          onChange={(e) => setNotamRaw(e.target.value)}
          rows={6}
          className="w-full rounded border border-border bg-background p-2 text-sm font-mono"
        />
        {notam && (
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-border p-3 space-y-1">
              <Field k="Series" v={notam.series_number ?? "—"} />
              <Field k="FIR" v={notam.fir ?? "—"} />
              <Field k="Q-code" v={notam.q_code ?? "—"} />
              <Field k="Category" v={notam.category} />
              <Field k="Airport" v={notam.airport ?? "—"} />
              <Field k="Start" v={notam.start_utc ?? "—"} />
              <Field
                k="End"
                v={
                  notam.is_permanent ? "PERM" : (notam.end_utc ?? "—")
                }
              />
              <Field
                k="Text"
                v={notam.text || "—"}
                multiline
              />
            </div>
            <div className="rounded border border-border p-3 space-y-2">
              <h3 className="text-sm font-semibold">Alerts</h3>
              {notamAlerts.map((a, i) => (
                <AlertRow key={i} {...a} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  k,
  v,
  multiline,
}: {
  k: string;
  v: string;
  multiline?: boolean;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 text-sm", multiline && "items-start")}>
      <div className="text-zinc-500 text-xs uppercase tracking-wide">{k}</div>
      <div className={cn("col-span-2 font-mono text-xs", multiline && "whitespace-pre-wrap")}>{v}</div>
    </div>
  );
}

function AlertRow({
  level,
  code,
  message,
}: {
  level: "info" | "warning" | "danger";
  code: string;
  message: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 items-start rounded p-2 text-xs",
        level === "info" && "bg-zinc-100 text-zinc-700",
        level === "warning" && "bg-amber-100 text-amber-800",
        level === "danger" && "bg-red-100 text-red-800",
      )}
    >
      <span className="font-mono font-bold uppercase">{code}</span>
      <span>{message}</span>
    </div>
  );
}
