"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/queries";
import type {
  Aircraft,
  DisruptionEvent,
  FlightLeg,
  RecoveryOption,
} from "@/lib/types";
import type { SimulationResult } from "@/lib/engine";
import { approveRecoveryOptionAtomic } from "@/lib/supabase/approval";

export interface ActionResult<T = unknown> {
  ok: boolean;
  message?: string;
  data?: T;
}

async function requireWriteRole(): Promise<{
  ok: boolean;
  user_id?: string;
  email?: string;
  message?: string;
}> {
  if (!isSupabaseConfigured()) return { ok: false, message: "Supabase not configured" };
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in" };
  if (session.role !== "controller" && session.role !== "admin") {
    return { ok: false, message: "Controller role required" };
  }
  return { ok: true, user_id: session.user_id, email: session.email };
}

async function logAuditServer(opts: {
  user_id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  payload?: Record<string, unknown>;
}) {
  const supabase = await createSupabaseServerClient();
  await supabase.from("audit_log").insert({
    actor: opts.user_id,
    action: opts.action,
    entity_type: opts.entity_type,
    entity_id: opts.entity_id ?? null,
    payload: opts.payload ?? null,
  });
}

export async function persistSchedule(
  schedule: FlightLeg[],
): Promise<ActionResult<{ count: number }>> {
  const auth = await requireWriteRole();
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const rows = schedule.map((f) => ({
    flight_id: f.flight_id,
    flight_number: f.flight_number,
    origin: f.origin,
    destination: f.destination,
    std: f.std.toISOString(),
    sta: f.sta.toISOString(),
    aircraft_id: f.aircraft_id,
    aircraft_type: f.aircraft_type,
    priority_level: f.priority_level,
    load_factor: f.load_factor,
    is_international: f.is_international,
    is_last_flight_of_day: f.is_last_flight_of_day,
  }));
  const { error } = await supabase
    .from("flights")
    .upsert(rows, { onConflict: "flight_id" });
  if (error) return { ok: false, message: error.message };
  await logAuditServer({
    user_id: auth.user_id!,
    action: "import",
    entity_type: "flights",
    payload: { count: rows.length },
  });
  revalidatePath("/dashboard");
  return { ok: true, data: { count: rows.length } };
}

export async function persistAircraft(
  aircraft: Aircraft[],
): Promise<ActionResult<{ count: number }>> {
  const auth = await requireWriteRole();
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const rows = aircraft.map((a) => ({
    aircraft_id: a.aircraft_id,
    aircraft_type: a.aircraft_type,
    current_station: a.current_station,
    available_from: a.available_from.toISOString(),
    status: a.status,
    next_maintenance_time: a.next_maintenance_time
      ? a.next_maintenance_time.toISOString()
      : null,
    restriction: a.restriction,
  }));
  const { error } = await supabase
    .from("aircraft")
    .upsert(rows, { onConflict: "aircraft_id" });
  if (error) return { ok: false, message: error.message };
  await logAuditServer({
    user_id: auth.user_id!,
    action: "import",
    entity_type: "aircraft",
    payload: { count: rows.length },
  });
  revalidatePath("/dashboard");
  return { ok: true, data: { count: rows.length } };
}

export async function persistDisruption(
  event: DisruptionEvent,
): Promise<ActionResult<{ event_id: string }>> {
  const auth = await requireWriteRole();
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("disruption_events")
    .upsert(
      {
        event_id: event.event_id,
        event_type: event.event_type,
        affected_aircraft: event.affected_aircraft,
        affected_airport: event.affected_airport,
        affected_flight_id: event.affected_flight_id,
        start_time: event.start_time.toISOString(),
        end_time: event.end_time.toISOString(),
        severity: event.severity,
        description: event.description,
        created_by: auth.user_id,
      },
      { onConflict: "event_id" },
    );
  if (error) return { ok: false, message: error.message };
  await logAuditServer({
    user_id: auth.user_id!,
    action: "import",
    entity_type: "disruption_event",
    entity_id: event.event_id,
  });
  revalidatePath("/dashboard");
  return { ok: true, data: { event_id: event.event_id } };
}

export async function persistSimulation(
  result: SimulationResult,
): Promise<ActionResult<{ uuid: string }>> {
  const auth = await requireWriteRole();
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();

  const { data: ev } = await supabase
    .from("disruption_events")
    .select("id")
    .eq("event_id", result.event.event_id)
    .maybeSingle();

  const { data: sim, error: simErr } = await supabase
    .from("simulations")
    .insert({
      disruption_event_id: ev?.id ?? null,
      result_json: result,
      created_by: auth.user_id,
    })
    .select("id, uuid")
    .single();
  if (simErr || !sim) return { ok: false, message: simErr?.message ?? "Insert failed" };

  if (result.ranked_options.length) {
    const optionRows = result.ranked_options.map((o: RecoveryOption) => ({
      simulation_id: sim.id,
      option_id: o.option_id,
      option_type: o.option_type,
      rank: o.rank,
      score: o.score,
      risk_level: o.risk_level,
      total_delay_minutes: o.total_delay_minutes,
      max_delay_minutes: o.max_delay_minutes,
      impacted_flight_count: o.impacted_flight_count,
      swap_count: o.swap_count,
      curfew_violations: o.curfew_violations,
      recommendation: o.recommendation,
      reason_codes: o.reason_codes,
      score_breakdown: o.score_breakdown,
      flight_changes: o.flight_changes,
      aircraft_changes: o.aircraft_changes,
    }));
    const { error: optErr } = await supabase.from("recovery_options").insert(optionRows);
    if (optErr) return { ok: false, message: optErr.message };
  }

  await logAuditServer({
    user_id: auth.user_id!,
    action: "simulate",
    entity_type: "simulation",
    entity_id: sim.uuid,
    payload: {
      event_id: result.event.event_id,
      option_count: result.ranked_options.length,
    },
  });
  revalidatePath("/dashboard");
  return { ok: true, data: { uuid: sim.uuid } };
}

export async function approveOption(
  simulationUuid: string,
  optionId: string,
): Promise<ActionResult> {
  const auth = await requireWriteRole();
  if (!auth.ok) return { ok: false, message: auth.message };
  const supabase = await createSupabaseServerClient();

  const approval = await approveRecoveryOptionAtomic(supabase, {
    simulationUuid,
    optionId,
  });
  if (!approval.ok) return { ok: false, message: approval.message };

  await logAuditServer({
    user_id: auth.user_id!,
    action: "approve",
    entity_type: "recovery_option",
    entity_id: optionId,
    payload: { simulation_uuid: simulationUuid, by: auth.email },
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function logExport(
  optionId: string,
  format: "csv" | "json",
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: true }; // silently noop in stub mode
  const supabase = await createSupabaseServerClient();
  await supabase.from("audit_log").insert({
    actor: session.user_id,
    action: "export",
    entity_type: "recovery_option",
    entity_id: optionId,
    payload: { format },
  });
  return { ok: true };
}
