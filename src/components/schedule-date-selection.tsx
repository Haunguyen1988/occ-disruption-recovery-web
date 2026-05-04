"use client";

import { cn } from "@/lib/utils";
import type { ScheduleDateFilterSummary } from "@/components/data-context";

export function ScheduleDateFilterSelect({
  filter,
  onChange,
  className,
}: {
  filter: ScheduleDateFilterSummary;
  onChange: (date: string | null) => void | Promise<void>;
  className?: string;
}) {
  const totalFlights = filter.candidates.reduce(
    (sum, candidate) => sum + candidate.rowCount,
    0,
  );
  const format = filter.detectedFormat === "aims_dayrep" ? "AIMS" : "schedule";

  return (
    <div
      className={cn(
        "rounded-lg border border-border p-4 text-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Operating date</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {filter.fileName} contains {filter.candidates.length} dates in the{" "}
            {format} file.
          </p>
        </div>
        <label className="flex min-w-56 flex-col gap-1 text-xs text-zinc-600">
          Select date
          <select
            value={filter.selectedDate ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">All dates ({totalFlights} flights)</option>
            {filter.candidates.map((candidate) => (
              <option key={candidate.date} value={candidate.date}>
                {candidate.date} ({candidate.rowCount} flights)
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
