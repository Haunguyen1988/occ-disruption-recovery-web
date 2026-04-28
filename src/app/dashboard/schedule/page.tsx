"use client";

import { useMemo } from "react";
import { useData } from "@/components/data-context";
import { GanttSchedule } from "@/components/gantt-schedule";
import { findImpactedFlights } from "@/lib/engine";

export default function SchedulePage() {
  const { schedule, disruption, rules } = useData();

  const impacted = useMemo(() => {
    if (!disruption) return [];
    return findImpactedFlights(disruption, schedule, rules);
  }, [disruption, schedule, rules]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Schedule overview
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Rotation timeline (one row per aircraft). Impacted legs are
          highlighted by the active disruption.
        </p>
      </div>
      <GanttSchedule
        schedule={schedule}
        impacted={impacted}
        highlightAircraft={disruption?.affected_aircraft ?? null}
      />
    </div>
  );
}
