import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getAirportTimezone } from "@/lib/engine/time-utils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-GB", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  });
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
