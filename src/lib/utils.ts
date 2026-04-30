import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getAirportTimezone, localToUtc } from "@/lib/engine/time-utils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Vietnam timezone — the operational reference for Vietjet OCC. */
export const VN_TZ = "Asia/Ho_Chi_Minh";

/**
 * Format a Date as Vietnam local date+time (dd/MM/yyyy, HH:mm).
 * Used as the default display format throughout the app.
 */
export function formatDateTime(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-GB", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatUtcIso(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString();
}

/** Format a Date as Vietnam local time only (HH:mm). */
export function formatTime(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-GB", {
    timeZone: VN_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Extract the ops-date string (YYYY-MM-DD) from a UTC Date, interpreted in
 * Vietnam timezone. This ensures a flight at 01:00Z (= 08:00 VN) yields
 * the correct VN-local calendar date.
 */
export function formatOpsDateVn(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Convert a VN-local HH:MM + YYYY-MM-DD ops date to a UTC Date.
 * Used by the disruption event form where the Duty Manager enters times
 * in Vietnam local time.
 */
export function vnLocalToUtc(opsDateStr: string, hhmm: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opsDateStr);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) return null;
  return localToUtc(
    Number(dm[1]),
    Number(dm[2]),
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    VN_TZ,
  );
}

/**
 * Format a UTC instant as the airport's local clock time. Used for schedule
 * displays where controllers expect to read times the same way the AIMS
 * DayRep prints them (origin-local STD, destination-local STA).
 */
export function formatAirportLocal(
  d: Date | string,
  airport: string,
): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-GB", {
    timeZone: getAirportTimezone(airport),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTimeAirportLocal(
  d: Date | string,
  airport: string,
): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-GB", {
    timeZone: getAirportTimezone(airport),
    hour: "2-digit",
    minute: "2-digit",
  });
}
