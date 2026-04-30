"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type ComparePayload,
  hydrateComparePayload,
} from "@/lib/compare";
import { CompareOptionsView } from "@/components/compare-options-view";

export function CompareSessionFallback() {
  const [payload, setPayload] = useState<ComparePayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const raw = sessionStorage.getItem("occ:compare");
      if (!raw) {
        setMissing(true);
        return;
      }
      try {
        const parsed = hydrateComparePayload(JSON.parse(raw) as ComparePayload);
        if (parsed.options.length !== 2) {
          setMissing(true);
          return;
        }
        setPayload(parsed);
      } catch {
        setMissing(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (missing) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Compare options</h1>
        <p className="text-sm text-zinc-600">
          No comparison loaded. Go to{" "}
          <Link
            href="/dashboard/simulate"
            className="text-primary underline underline-offset-2"
          >
            Simulate
          </Link>
          , tick 2 options in the ranked list, then click <em>Open compare</em>.
        </p>
      </div>
    );
  }

  if (!payload) {
    return <div className="text-sm text-zinc-500">Loading...</div>;
  }

  return (
    <CompareOptionsView
      options={[payload.options[0], payload.options[1]]}
      savedAt={payload.saved_at}
      simulationUuid={payload.simulation_uuid}
      backHref="/dashboard/simulate"
      backLabel="Back to Simulate"
    />
  );
}
