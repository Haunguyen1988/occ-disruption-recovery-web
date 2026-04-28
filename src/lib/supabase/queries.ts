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

export async function loadOperationalData(): Promise<{
  schedule: FlightLeg[];
  aircraft: Aircraft[];
  disruption: DisruptionEvent | null;
} | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();

  const [{ data: flights }, { data: planes }, { data: events }] = await Promise.all([
    supabase
      .from("flights")
      .select(
        "flight_id, flight_number, origin, destination, std, sta, aircraft_id, aircraft_type, priority_level, load_factor, is_international, is_last_flight_of_day",
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

  return { schedule, aircraft, disruption };
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
  options: (RecoveryOption & { approved: boolean })[];
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
  };
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
    }),
  );
  return { uuid: data.uuid, created_at: data.created_at, result, options };
}

function reviveResult(raw: SimulationResult): SimulationResult {
  return {
    ...raw,
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
