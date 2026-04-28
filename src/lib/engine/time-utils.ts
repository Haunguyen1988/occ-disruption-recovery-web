import type { OccRules } from "@/lib/types";

export function overlaps(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && startB < endA;
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60000);
}

export function maxDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

export function minTurnaroundForType(
  aircraftType: string,
  rules: OccRules,
): number {
  const turn = rules.turnaround_rules ?? {
    default_minutes: 40,
    by_aircraft_type: {},
  };
  return turn.by_aircraft_type?.[aircraftType] ?? turn.default_minutes ?? 40;
}
