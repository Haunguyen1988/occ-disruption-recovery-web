"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  GitCompare,
  Plane,
  PlaneTakeoff,
  Radar,
  Route,
  ShieldAlert,
  Users,
  Wrench,
} from "lucide-react";
import { useData } from "@/components/data-context";
import { WeatherWatch } from "@/components/weather-watch";
import { findImpactedFlights, runSimulation } from "@/lib/engine";
import type {
  Aircraft,
  FlightLeg,
  ImpactedFlight,
  RecoveryOption,
  SimulationFeedback,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "accent";

interface FleetPressureRow {
  aircraftId: string;
  aircraftType: string;
  station: string;
  status: string;
  flightCount: number;
  impactedCount: number;
  changedCount: number;
  delayMinutes: number;
  pressureScore: number;
  firstFlight: FlightLeg | null;
}

interface ObjectiveLeader {
  label: string;
  option: RecoveryOption | null;
  metric: string;
  tone: Tone;
}

interface DashboardModel {
  impacted: ImpactedFlight[];
  directAircraftCount: number;
  priorityImpactedCount: number;
  airportWindowFlights: FlightLeg[];
  downstreamExposureCount: number;
  optionCount: number;
  bestOption: RecoveryOption | null;
  objectiveLeaders: ObjectiveLeader[];
  fleetPressure: FleetPressureRow[];
  blockers: string[];
  readinessItems: {
    label: string;
    value: string;
    tone: Tone;
  }[];
}

const numberFmt = new Intl.NumberFormat("en-US");

export default function DashboardOverview() {
  const { schedule, aircraft, disruption, rules, validation } = useData();

  const model = useMemo<DashboardModel>(() => {
    const impacted = disruption
      ? findImpactedFlights(disruption, schedule, rules)
      : [];
    const simulation =
      disruption && schedule.length > 0 && aircraft.length > 0
        ? runSimulation({
            schedule,
            aircraft,
            disruption,
            rules,
            tailAssignmentMode: "balanced",
          })
        : null;

    return buildDashboardModel({
      schedule,
      aircraft,
      disruption,
      impacted,
      options: simulation?.ranked_options ?? [],
      feedback: simulation?.feedback ?? null,
    });
  }, [schedule, aircraft, disruption, rules]);

  const errors = validation.filter((v) => v.level === "error");
  const warnings = validation.filter((v) => v.level === "warning");
  const best = model.bestOption;
  const passengerImpact = best?.passenger_impact;
  const hasOperation = schedule.length > 0 || aircraft.length > 0 || disruption;

  return (
    <div className="max-w-7xl space-y-6">
      <div className="surface-soft overflow-hidden rounded-lg p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded border border-border bg-background/70 px-2.5 py-1 text-xs font-medium text-zinc-600">
            <Radar className="h-3.5 w-3.5" />
            OCC Command Center
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Network recovery overview
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Live operating snapshot, disruption exposure, recovery quality, and
            aircraft pressure from the loaded schedule.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/simulate"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
          >
            <PlaneTakeoff className="h-4 w-4" />
            Run simulation
          </Link>
          <Link
            href="/dashboard/compare"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-panel px-4 text-sm font-medium shadow-sm hover:bg-muted"
          >
            <GitCompare className="h-4 w-4" />
            Compare
          </Link>
        </div>
        </div>
      </div>

      {!hasOperation && <EmptyState />}

      {(errors.length > 0 || warnings.length > 0) && (
        <DataQualityBanner errors={errors.length} warnings={warnings.length} />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <MetricCard label="Flights" value={schedule.length} icon={Route} />
        <MetricCard label="Aircraft" value={aircraft.length} icon={Plane} />
        <MetricCard
          label="Impacted"
          value={model.impacted.length}
          tone={model.impacted.length > 0 ? "warning" : "success"}
          icon={AlertTriangle}
        />
        <MetricCard
          label="Recovery options"
          value={model.optionCount}
          tone={model.optionCount > 0 ? "success" : "neutral"}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Total delay"
          value={best ? `${numberFmt.format(best.total_delay_minutes)}m` : "-"}
          tone={best && best.total_delay_minutes > 0 ? "warning" : "neutral"}
          icon={Clock3}
        />
        <MetricCard
          label="Pax affected"
          value={
            passengerImpact
              ? numberFmt.format(passengerImpact.estimated_affected_passengers)
              : "-"
          }
          tone={passengerImpact?.high_impact ? "danger" : "neutral"}
          icon={Users}
        />
      </div>

      <WeatherWatch compact />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <ActiveEventPanel
          disruption={disruption}
          impactedCount={model.impacted.length}
          directAircraftCount={model.directAircraftCount}
          priorityImpactedCount={model.priorityImpactedCount}
          airportWindowFlights={model.airportWindowFlights.length}
          downstreamExposureCount={model.downstreamExposureCount}
        />
        <RecoveryPanel best={best} blockers={model.blockers} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1fr_1.1fr]">
        <ReadinessPanel items={model.readinessItems} />
        <ObjectivePanel leaders={model.objectiveLeaders} />
        <FleetPressurePanel rows={model.fleetPressure} />
      </div>
    </div>
  );
}

function buildDashboardModel(input: {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: ReturnType<typeof useData>["disruption"];
  impacted: ImpactedFlight[];
  options: RecoveryOption[];
  feedback: SimulationFeedback | null;
}): DashboardModel {
  const { schedule, aircraft, disruption, impacted, options, feedback } = input;
  const bestOption = options[0] ?? null;
  const impactedIds = new Set(impacted.map((item) => item.flight.flight_id));
  const impactedAircraft = new Set(
    impacted.map((item) => item.flight.aircraft_id),
  );

  const priorityImpactedCount = impacted.filter(
    (item) =>
      item.flight.priority_level >= 2 ||
      item.flight.is_international ||
      item.flight.is_last_flight_of_day ||
      item.flight.load_factor >= 0.85,
  ).length;

  const airportWindowFlights =
    disruption?.affected_airport
      ? schedule.filter(
          (flight) =>
            (flight.origin === disruption.affected_airport ||
              flight.destination === disruption.affected_airport) &&
            overlapsWindow(
              flight.std,
              flight.sta,
              disruption.start_time,
              disruption.end_time,
            ),
        )
      : [];

  const firstImpactedByAircraft = new Map<string, number>();
  for (const item of impacted) {
    const current = firstImpactedByAircraft.get(item.flight.aircraft_id);
    const time = item.flight.std.getTime();
    if (current === undefined || time < current) {
      firstImpactedByAircraft.set(item.flight.aircraft_id, time);
    }
  }

  const downstreamExposureCount = schedule.filter((flight) => {
    const firstImpacted = firstImpactedByAircraft.get(flight.aircraft_id);
    return (
      firstImpacted !== undefined &&
      flight.std.getTime() > firstImpacted &&
      !impactedIds.has(flight.flight_id)
    );
  }).length;

  const objectiveLeaders = buildObjectiveLeaders(options);
  const fleetPressure = buildFleetPressure({
    aircraft,
    schedule,
    impactedIds,
    bestOption,
  });
  const blockers = buildBlockers(feedback);
  const tailFeedback = feedback?.tail_assignment ?? null;

  const readinessItems = [
    {
      label: "Aircraft directly exposed",
      value: numberFmt.format(impactedAircraft.size),
      tone: impactedAircraft.size > 0 ? "warning" : "success",
    },
    {
      label: "Airport window conflicts",
      value: numberFmt.format(airportWindowFlights.length),
      tone: airportWindowFlights.length > 0 ? "warning" : "neutral",
    },
    {
      label: "Downstream legs at risk",
      value: numberFmt.format(downstreamExposureCount),
      tone: downstreamExposureCount > 0 ? "warning" : "success",
    },
    {
      label: "Feasible swap candidates",
      value: numberFmt.format(feedback?.feasible_swap_count ?? 0),
      tone:
        (feedback?.feasible_swap_count ?? 0) > 0
          ? "success"
          : impacted.length > 0
            ? "danger"
            : "neutral",
    },
    {
      label: "Tail-assignment paths",
      value: numberFmt.format(tailFeedback?.path_count ?? 0),
      tone:
        (tailFeedback?.option_count ?? 0) > 0
          ? "success"
          : tailFeedback?.attempted
            ? "warning"
            : "neutral",
    },
  ] satisfies DashboardModel["readinessItems"];

  return {
    impacted,
    directAircraftCount: impactedAircraft.size,
    priorityImpactedCount,
    airportWindowFlights,
    downstreamExposureCount,
    optionCount: options.length,
    bestOption,
    objectiveLeaders,
    fleetPressure,
    blockers,
    readinessItems,
  };
}

function buildObjectiveLeaders(options: RecoveryOption[]): ObjectiveLeader[] {
  const minDelay = minBy(options, (option) => option.total_delay_minutes);
  const protectPax = minBy(
    options,
    (option) =>
      option.passenger_impact?.passenger_delay_minutes ??
      option.total_delay_minutes * 180,
  );
  const lowRisk = minBy(
    options,
    (option) => riskValue(option.risk_level) * 10000 + option.score,
  );
  const minSwap = minBy(
    options,
    (option) => option.swap_count * 10000 + option.total_delay_minutes,
  );

  return [
    {
      label: "Min delay",
      option: minDelay,
      metric: minDelay ? `${numberFmt.format(minDelay.total_delay_minutes)}m` : "-",
      tone: "accent",
    },
    {
      label: "Protect pax",
      option: protectPax,
      metric: protectPax?.passenger_impact
        ? `${numberFmt.format(
            Math.round(protectPax.passenger_impact.passenger_delay_minutes / 60),
          )} pax-h`
        : "-",
      tone: "warning",
    },
    {
      label: "Low risk",
      option: lowRisk,
      metric: lowRisk ? lowRisk.risk_level : "-",
      tone: lowRisk?.risk_level === "LOW" ? "success" : "neutral",
    },
    {
      label: "Fewest swaps",
      option: minSwap,
      metric: minSwap ? numberFmt.format(minSwap.swap_count) : "-",
      tone: "success",
    },
  ];
}

function buildFleetPressure(input: {
  aircraft: Aircraft[];
  schedule: FlightLeg[];
  impactedIds: Set<string>;
  bestOption: RecoveryOption | null;
}): FleetPressureRow[] {
  const { aircraft, schedule, impactedIds, bestOption } = input;
  const flightsByAircraft = new Map<string, FlightLeg[]>();
  for (const flight of schedule) {
    const flights = flightsByAircraft.get(flight.aircraft_id) ?? [];
    flights.push(flight);
    flightsByAircraft.set(flight.aircraft_id, flights);
  }

  const changes = bestOption?.flight_changes ?? [];
  const rows = aircraft.map((item) => {
    const flights = (flightsByAircraft.get(item.aircraft_id) ?? []).sort(
      (a, b) => a.std.getTime() - b.std.getTime(),
    );
    const impactedCount = flights.filter((flight) =>
      impactedIds.has(flight.flight_id),
    ).length;
    const relatedChanges = changes.filter(
      (change) =>
        change.original_aircraft === item.aircraft_id ||
        change.new_aircraft === item.aircraft_id,
    );
    const delayMinutes = relatedChanges.reduce(
      (sum, change) => sum + Math.max(0, change.delay_minutes),
      0,
    );
    const statusPenalty = item.status.toUpperCase() === "AOG" ? 100 : 0;
    const pressureScore =
      impactedCount * 50 +
      relatedChanges.length * 20 +
      delayMinutes / 10 +
      statusPenalty;

    return {
      aircraftId: item.aircraft_id,
      aircraftType: item.aircraft_type,
      station: item.current_station,
      status: item.status,
      flightCount: flights.length,
      impactedCount,
      changedCount: relatedChanges.length,
      delayMinutes,
      pressureScore,
      firstFlight: flights[0] ?? null,
    };
  });

  return rows
    .sort((a, b) => {
      const byPressure = b.pressureScore - a.pressureScore;
      if (byPressure !== 0) return byPressure;
      return b.flightCount - a.flightCount;
    })
    .slice(0, 6);
}

function buildBlockers(feedback: SimulationFeedback | null): string[] {
  if (!feedback) return [];
  const blockers: string[] = [];
  const tail = feedback.tail_assignment;
  if (tail?.no_option_reason) blockers.push(tail.no_option_reason);
  for (const item of tail?.top_blocking_reasons ?? []) {
    blockers.push(`${item.reason} (${item.count})`);
  }
  for (const candidate of feedback.candidates) {
    if (candidate.blocking_reason) blockers.push(candidate.blocking_reason);
  }
  return [...new Set(blockers)].slice(0, 4);
}

function EmptyState() {
  return (
    <div className="surface rounded-lg border-dashed p-5">
      <h2 className="text-sm font-semibold">No operational data loaded</h2>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        Import schedule and aircraft data, or open simulation to load a sample
        disruption scenario.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/dashboard/data"
          className="inline-flex h-9 items-center rounded-md border border-border bg-panel px-3 text-sm font-medium shadow-sm hover:bg-muted"
        >
          Import data
        </Link>
        <Link
          href="/dashboard/simulate"
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
        >
          Open simulate
        </Link>
      </div>
    </div>
  );
}

function DataQualityBanner({
  errors,
  warnings,
}: {
  errors: number;
  warnings: number;
}) {
  return (
    <div className="surface flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold">Data quality attention</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {errors} error(s) and {warnings} warning(s) are present in the loaded
          operation.
        </p>
      </div>
      <Link
        href="/dashboard/data"
        className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-panel px-3 text-sm font-medium shadow-sm hover:bg-muted"
      >
        Review data
      </Link>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  icon: typeof Route;
  tone?: Tone;
}) {
  return (
    <div className="surface-soft rounded-lg p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <span className="rounded-md bg-background/80 p-1.5">
          <Icon className={cn("h-4 w-4", toneClass(tone, "icon"))} />
        </span>
      </div>
      <div className={cn("mt-2 text-2xl font-semibold", toneClass(tone))}>
        {value}
      </div>
    </div>
  );
}

function ActiveEventPanel({
  disruption,
  impactedCount,
  directAircraftCount,
  priorityImpactedCount,
  airportWindowFlights,
  downstreamExposureCount,
}: {
  disruption: ReturnType<typeof useData>["disruption"];
  impactedCount: number;
  directAircraftCount: number;
  priorityImpactedCount: number;
  airportWindowFlights: number;
  downstreamExposureCount: number;
}) {
  if (!disruption) {
    return (
      <section className="surface rounded-lg p-4">
        <PanelHeader
          icon={ShieldAlert}
          title="Active disruption"
          actionHref="/dashboard/simulate"
          actionLabel="Create event"
        />
        <p className="mt-4 text-sm text-zinc-500">
          No active disruption is selected.
        </p>
      </section>
    );
  }

  return (
    <section className="surface rounded-lg p-4">
      <PanelHeader
        icon={ShieldAlert}
        title="Active disruption"
        actionHref="/dashboard/simulate"
        actionLabel="Adjust"
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-2 py-1 text-xs font-medium">
              {disruption.event_type}
            </span>
            <span className={cn("rounded px-2 py-1 text-xs font-medium", severityClass(disruption.severity))}>
              {disruption.severity}
            </span>
            <span className="text-xs text-zinc-500">{disruption.event_id}</span>
          </div>
          <h2 className="mt-3 text-base font-semibold">
            {disruption.description}
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
            <InfoRow label="Aircraft" value={disruption.affected_aircraft ?? "-"} />
            <InfoRow label="Airport" value={disruption.affected_airport ?? "-"} />
            <InfoRow label="Start" value={formatDateTime(disruption.start_time)} />
            <InfoRow label="End" value={formatDateTime(disruption.end_time)} />
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniMetric label="Impacted flights" value={impactedCount} tone="warning" />
          <MiniMetric label="Aircraft exposed" value={directAircraftCount} tone="warning" />
          <MiniMetric label="Priority flights" value={priorityImpactedCount} tone="danger" />
          <MiniMetric label="Airport conflicts" value={airportWindowFlights} tone="warning" />
          <div className="col-span-2">
            <MiniMetric
              label="Downstream exposure"
              value={downstreamExposureCount}
              tone={downstreamExposureCount > 0 ? "warning" : "success"}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function RecoveryPanel({
  best,
  blockers,
}: {
  best: RecoveryOption | null;
  blockers: string[];
}) {
  return (
    <section className="surface rounded-lg p-4">
      <PanelHeader
        icon={Wrench}
        title="Recovery intelligence"
        actionHref="/dashboard/simulate"
        actionLabel="Open"
      />
      {best ? (
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-2 py-1 text-xs font-medium">
                Rank {best.rank ?? "-"}
              </span>
              <span className={cn("rounded px-2 py-1 text-xs font-medium", riskClass(best.risk_level))}>
                {best.risk_level} risk
              </span>
              <span className="text-xs text-zinc-500">{best.option_type}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold">
              {best.recommendation || "Best generated option"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Score {numberFmt.format(best.score)} with{" "}
              {numberFmt.format(best.flight_changes.length)} changed flight(s).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="Total delay" value={`${numberFmt.format(best.total_delay_minutes)}m`} />
            <MiniMetric label="Max delay" value={`${numberFmt.format(best.max_delay_minutes)}m`} />
            <MiniMetric label="Swaps" value={best.swap_count} />
            <MiniMetric
              label="Curfew flags"
              value={best.curfew_violations}
              tone={best.curfew_violations > 0 ? "danger" : "success"}
            />
          </div>
          {blockers.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Top blockers
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {blockers.map((item) => (
                  <li key={item} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--warning)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          Run a disruption simulation to generate ranked recovery options.
        </p>
      )}
    </section>
  );
}

function ReadinessPanel({
  items,
}: {
  items: DashboardModel["readinessItems"];
}) {
  return (
    <section className="surface rounded-lg p-4">
      <PanelHeader icon={Radar} title="Multi-event readiness" />
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-panel-subtle px-3 py-2"
          >
            <span className="text-sm text-zinc-600">{item.label}</span>
            <span className={cn("text-sm font-semibold", toneClass(item.tone))}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ObjectivePanel({ leaders }: { leaders: ObjectiveLeader[] }) {
  return (
    <section className="surface rounded-lg p-4">
      <PanelHeader icon={GitCompare} title="Objective leaders" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {leaders.map((leader) => (
          <div key={leader.label} className="rounded-md border border-border bg-panel-subtle p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {leader.label}
            </div>
            <div className={cn("mt-1 text-lg font-semibold", toneClass(leader.tone))}>
              {leader.metric}
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">
              {leader.option?.option_type ?? "No option"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FleetPressurePanel({ rows }: { rows: FleetPressureRow[] }) {
  return (
    <section className="surface rounded-lg p-4">
      <PanelHeader icon={Plane} title="Fleet pressure" actionHref="/dashboard/schedule" actionLabel="Timeline" />
      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-panel-subtle text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Tail</th>
                <th className="px-3 py-2 font-medium">Station</th>
                <th className="px-3 py-2 font-medium">Impact</th>
                <th className="px-3 py-2 font-medium">Next</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.aircraftId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.aircraftId}</div>
                    <div className="text-xs text-zinc-500">{row.aircraftType}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{row.station}</div>
                    <div className="text-xs text-zinc-500">{row.status}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{row.impactedCount} imp / {row.changedCount} chg</div>
                    <div className="text-xs text-zinc-500">
                      {numberFmt.format(Math.round(row.delayMinutes))}m delay
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.firstFlight ? (
                      <>
                        <div>{row.firstFlight.flight_number}</div>
                        <div className="text-xs text-zinc-500">
                          {row.firstFlight.origin}-{row.firstFlight.destination}
                        </div>
                      </>
                    ) : (
                      <span className="text-zinc-500">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">No aircraft data loaded.</p>
      )}
    </section>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  actionHref,
  actionLabel,
}: {
  icon: typeof Route;
  title: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-zinc-500" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-foreground"
        >
          {actionLabel}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-md border border-border bg-panel-subtle px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", toneClass(tone))}>
        {value}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </>
  );
}

function minBy<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const itemScore = score(item);
    if (itemScore < bestScore) {
      best = item;
      bestScore = itemScore;
    }
  }
  return best;
}

function overlapsWindow(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && startB < endA;
}

function riskValue(risk: RecoveryOption["risk_level"]): number {
  if (risk === "LOW") return 0;
  if (risk === "MEDIUM") return 1;
  return 2;
}

function toneClass(tone: Tone, target: "text" | "icon" = "text"): string {
  const base = target === "icon" ? "" : "";
  switch (tone) {
    case "success":
      return `${base} text-[color:var(--success)]`;
    case "warning":
      return `${base} text-[color:var(--warning)]`;
    case "danger":
      return `${base} text-[color:var(--danger)]`;
    case "accent":
      return `${base} text-[color:var(--accent)]`;
    case "neutral":
    default:
      return `${base} text-foreground`;
  }
}

function severityClass(severity: string): string {
  if (severity === "CRITICAL") return "bg-red-50 text-red-700";
  if (severity === "HIGH") return "bg-orange-50 text-orange-700";
  if (severity === "MEDIUM") return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function riskClass(risk: RecoveryOption["risk_level"]): string {
  if (risk === "HIGH") return "bg-red-50 text-red-700";
  if (risk === "MEDIUM") return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}
