import { createSupabaseServerClient, isSupabaseConfigured } from "./server";
import type {
  Aircraft,
  DisruptionEvent,
  DisruptionType,
  FlightLeg,
  RecoveryOption,
  Severity,
} from "@/lib/types";
import type { SimulationResult } from "@/lib/engine";

export interface SessionInfo {
  user_id: string;
  email: string;
  role: "viewer" | "controller" | "admin";
}

export interface OperationalData {
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: DisruptionEvent | null;
}

type OperationalQuerySource = "flights" | "aircraft" | "disruption_events";

interface SupabaseQueryError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface OperationalLoadIssue {
  source: OperationalQuerySource;
  message: string;
  code?: string;
}

export interface OperationalLoadError {
  message: string;
  issues: OperationalLoadIssue[];
}

export interface OperationalDataResult {
  data: OperationalData | null;
  error: OperationalLoadError | null;
}

export async function getSession(): Promise<SessionInfo | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();
  return {
    user_id: user.id,
    email: profile?.email ?? user.email ?? "",
    role: (profile?.role ?? "viewer") as SessionInfo["role"],
  };
}

interface FlightRow {
  flight_id: string;
  flight_number: string;
  origin: string;
  destination: string;
  std: string;
  sta: string;
  aircraft_id: string;
  aircraft_type: string;
  priority_level: number;
  load_factor: number;
  is_international: boolean;
  is_last_flight_of_day: boolean;
  seat_capacity: number | null;
  booked_passengers: number | null;
  connecting_passengers: number | null;
  vip_passengers: number | null;
  special_service_passengers: number | null;
  captain: string | null;
  first_officer: string | null;
  actual_departure_time: string | null;
  actual_arrival_time: string | null;
}

interface AircraftRow {
  aircraft_id: string;
  aircraft_type: string;
  current_station: string;
  available_from: string;
  status: string;
  next_maintenance_time: string | null;
  restriction: string | null;
}

interface DisruptionRow {
  event_id: string;
  event_type: DisruptionType;
  affected_aircraft: string | null;
  affected_airport: string | null;
  affected_flight_id: string | null;
  start_time: string;
  end_time: string;
  severity: Severity;
  description: string | null;
}

function queryErrorMessage(error: SupabaseQueryError): string {
  const parts = [error.message, error.details, error.hint]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" ") : "Unknown Supabase query error";
}

export function collectOperationalLoadErrors(
  results: {
    source: OperationalQuerySource;
    error?: SupabaseQueryError | null;
  }[],
): OperationalLoadError | null {
  const issues = results
    .filter((r) => Boolean(r.error))
    .map((r) => ({
      source: r.source,
      message: queryErrorMessage(r.error!),
      code: r.error?.code,
    }));

  if (issues.length === 0) return null;
  return {
    message: `Failed to load operational data from Supabase (${issues
      .map((i) => i.source)
      .join(", ")}).`,
    issues,
  };
}

export async function loadOperationalData(): Promise<OperationalDataResult | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();

  try {
    const [flightResult, aircraftResult, eventResult] = await Promise.all([
      supabase
        .from("flights")
        .select(
          "flight_id, flight_number, origin, destination, std, sta, aircraft_id, aircraft_type, priority_level, load_factor, is_international, is_last_flight_of_day, seat_capacity, booked_passengers, connecting_passengers, vip_passengers, special_service_passengers, captain, first_officer, actual_departure_time, actual_arrival_time",
        )
        .order("std", { ascending: true }),
      supabase
        .from("aircraft")
        .select(
          "aircraft_id, aircraft_type, current_station, available_from, status, next_maintenance_time, restriction",
        ),
      supabase
        .from("disruption_events")
        .select(
          "event_id, event_type, affected_aircraft, affected_airport, affected_flight_id, start_time, end_time, severity, description",
        )
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    const loadError = collectOperationalLoadErrors([
      { source: "flights", error: flightResult.error },
      { source: "aircraft", error: aircraftResult.error },
      { source: "disruption_events", error: eventResult.error },
    ]);
    if (loadError) return { data: null, error: loadError };

    const flights = flightResult.data;
    const planes = aircraftResult.data;
    const events = eventResult.data;

    const schedule: FlightLeg[] = (flights ?? []).map((row: FlightRow) => ({
      flight_id: row.flight_id,
      flight_number: row.flight_number,
      origin: row.origin,
      destination: row.destination,
      std: new Date(row.std),
      sta: new Date(row.sta),
      aircraft_id: row.aircraft_id,
      aircraft_type: row.aircraft_type,
      priority_level: row.priority_level,
      load_factor: Number(row.load_factor),
      is_international: row.is_international,
      is_last_flight_of_day: row.is_last_flight_of_day,
      seat_capacity: row.seat_capacity ?? undefined,
      booked_passengers: row.booked_passengers ?? undefined,
      connecting_passengers: row.connecting_passengers ?? undefined,
      vip_passengers: row.vip_passengers ?? undefined,
      special_service_passengers: row.special_service_passengers ?? undefined,
      captain: row.captain ?? undefined,
      first_officer: row.first_officer ?? undefined,
      actual_departure_time: row.actual_departure_time
        ? new Date(row.actual_departure_time)
        : undefined,
      actual_arrival_time: row.actual_arrival_time
        ? new Date(row.actual_arrival_time)
        : undefined,
    }));

    const aircraft: Aircraft[] = (planes ?? []).map((row: AircraftRow) => ({
      aircraft_id: row.aircraft_id,
      aircraft_type: row.aircraft_type,
      current_station: row.current_station,
      available_from: new Date(row.available_from),
      status: row.status,
      next_maintenance_time: row.next_maintenance_time
        ? new Date(row.next_maintenance_time)
        : null,
      restriction: row.restriction,
    }));

    const ev = events?.[0] as DisruptionRow | undefined;
    const disruption: DisruptionEvent | null = ev
      ? {
          event_id: ev.event_id,
          event_type: ev.event_type,
          affected_aircraft: ev.affected_aircraft,
          affected_airport: ev.affected_airport,
          affected_flight_id: ev.affected_flight_id,
          start_time: new Date(ev.start_time),
          end_time: new Date(ev.end_time),
          severity: ev.severity,
          description: ev.description ?? "",
        }
      : null;

    return { data: { schedule, aircraft, disruption }, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      data: null,
      error: {
        message: "Failed to load operational data from Supabase.",
        issues: [{ source: "flights", message }],
      },
    };
  }
}

export interface SimulationListItem {
  uuid: string;
  created_at: string;
  disruption_event_id: number | null;
  event_label: string | null;
  option_count: number;
  best_score: number | null;
  approved: boolean;
}

export async function listSimulations(limit = 20): Promise<SimulationListItem[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("simulations")
    .select(
      "uuid, created_at, disruption_event_id, result_json, recovery_options(option_id, score, approved)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row: {
    uuid: string;
    created_at: string;
    disruption_event_id: number | null;
    result_json: { event?: { event_id?: string; event_type?: string } } | null;
    recovery_options: { option_id: string; score: number | null; approved: boolean }[];
  }) => {
    const opts = row.recovery_options ?? [];
    const ev = row.result_json?.event;
    return {
      uuid: row.uuid,
      created_at: row.created_at,
      disruption_event_id: row.disruption_event_id,
      event_label: ev ? `${ev.event_type ?? ""} ${ev.event_id ?? ""}`.trim() : null,
      option_count: opts.length,
      best_score:
        opts.length > 0
          ? Math.min(
              ...opts
                .map((o) => o.score)
                .filter((s): s is number => typeof s === "number"),
            )
          : null,
      approved: opts.some((o) => o.approved),
    };
  });
}

export interface SimulationDetail {
  uuid: string;
  created_at: string;
  result: SimulationResult;
  options: (RecoveryOption & {
    approved: boolean;
    approved_at: string | null;
    approved_by_email: string | null;
  })[];
}

export async function getSimulation(uuid: string): Promise<SimulationDetail | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("simulations")
    .select(
      "uuid, created_at, result_json, recovery_options(*)",
    )
    .eq("uuid", uuid)
    .maybeSingle();
  if (!data) return null;
  const result = reviveResult(data.result_json as SimulationResult);
  type StoredOption = {
    option_id: string;
    option_type: string;
    rank: number | null;
    score: number | null;
    risk_level: string | null;
    total_delay_minutes: number | null;
    max_delay_minutes: number | null;
    impacted_flight_count: number | null;
    swap_count: number | null;
    curfew_violations: number | null;
    recommendation: string | null;
    reason_codes: string[] | null;
    score_breakdown: Record<string, number> | null;
    flight_changes: RecoveryOption["flight_changes"] | null;
    aircraft_changes: Record<string, string> | null;
    approved: boolean;
    approved_at: string | null;
    approved_by: string | null;
  };
  const approverIds = Array.from(
    new Set(
      (data.recovery_options ?? [])
        .map((o) => (o as StoredOption).approved_by)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  let approverEmailMap = new Map<string, string>();
  if (approverIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", approverIds);
    approverEmailMap = new Map(
      (profiles ?? []).map((p) => [p.id as string, p.email as string]),
    );
  }
  const options: SimulationDetail["options"] = (data.recovery_options ?? []).map(
    (o: StoredOption) => ({
      option_id: o.option_id,
      option_type: o.option_type as RecoveryOption["option_type"],
      rank: o.rank,
      score: o.score ?? 0,
      risk_level: (o.risk_level ?? "MEDIUM") as RecoveryOption["risk_level"],
      total_delay_minutes: o.total_delay_minutes ?? 0,
      max_delay_minutes: o.max_delay_minutes ?? 0,
      impacted_flight_count: o.impacted_flight_count ?? 0,
      swap_count: o.swap_count ?? 0,
      curfew_violations: o.curfew_violations ?? 0,
      recommendation: o.recommendation ?? "",
      reason_codes: o.reason_codes ?? [],
      score_breakdown: o.score_breakdown ?? {},
      flight_changes: (o.flight_changes ?? []).map((c) => ({
        ...c,
        original_std: new Date(c.original_std),
        original_sta: new Date(c.original_sta),
        new_std: new Date(c.new_std),
        new_sta: new Date(c.new_sta),
      })),
      aircraft_changes: o.aircraft_changes ?? {},
      approved: o.approved ?? false,
      approved_at: o.approved_at ?? null,
      approved_by_email: o.approved_by
        ? approverEmailMap.get(o.approved_by) ?? null
        : null,
    }),
  );
  return { uuid: data.uuid, created_at: data.created_at, result, options };
}

function reviveResult(raw: SimulationResult): SimulationResult {
  return {
    ...raw,
    feedback: raw.feedback ?? null,
    event: {
      ...raw.event,
      start_time: new Date(raw.event.start_time),
      end_time: new Date(raw.event.end_time),
    },
    impacted_flights: raw.impacted_flights.map((i) => ({
      ...i,
      flight: {
        ...i.flight,
        std: new Date(i.flight.std),
        sta: new Date(i.flight.sta),
      },
    })),
    ranked_options: raw.ranked_options.map((o) => ({
      ...o,
      flight_changes: o.flight_changes.map((c) => ({
        ...c,
        original_std: new Date(c.original_std),
        original_sta: new Date(c.original_sta),
        new_std: new Date(c.new_std),
        new_sta: new Date(c.new_sta),
      })),
    })),
  };
}

export interface AuditEntry {
  id: number;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, actor, action, entity_type, entity_id, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data) return [];

  const actorIds = Array.from(
    new Set(data.map((r) => r.actor).filter((a): a is string => Boolean(a))),
  );
  let emailMap = new Map<string, string>();
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", actorIds);
    emailMap = new Map((profiles ?? []).map((p) => [p.id as string, p.email as string]));
  }

  return data.map((r) => ({
    id: r.id as number,
    actor_email: r.actor ? emailMap.get(r.actor) ?? null : null,
    action: r.action as string,
    entity_type: r.entity_type as string,
    entity_id: r.entity_id as string | null,
    payload: r.payload as Record<string, unknown> | null,
    created_at: r.created_at as string,
  }));
}
