import { CompareOptionsView } from "@/components/compare-options-view";
import { CompareSessionFallback } from "@/components/compare-session-fallback";
import { getSimulation } from "@/lib/supabase/queries";
import { selectCompareOptions } from "@/lib/compare";
import Link from "next/link";

interface ComparePageProps {
  searchParams: Promise<{
    simulation?: string | string[];
    a?: string | string[];
    b?: string | string[];
  }>;
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const rawSearch = await searchParams;
  const simulationUuid = firstValue(rawSearch.simulation);
  const optionA = firstValue(rawSearch.a);
  const optionB = firstValue(rawSearch.b);

  if (simulationUuid && optionA && optionB) {
    const simulation = await getSimulation(simulationUuid);
    if (simulation) {
      const selected = selectCompareOptions(simulation.options, [optionA, optionB]);
      if (selected) {
        return (
          <CompareOptionsView
            options={[selected[0], selected[1]]}
            savedAt={simulation.created_at}
            simulationUuid={simulation.uuid}
            backHref={`/dashboard/audit/${simulation.uuid}`}
            backLabel="Back to Audit"
          />
        );
      }
    }

    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Compare options</h1>
        <p className="text-sm text-zinc-600">
          The saved comparison could not be loaded from simulation{" "}
          <span className="font-mono">{simulationUuid}</span>.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={`/dashboard/audit/${simulationUuid}`}
            className="text-primary underline underline-offset-2"
          >
            Back to simulation detail
          </Link>
          <Link
            href="/dashboard/audit"
            className="text-primary underline underline-offset-2"
          >
            Back to Audit
          </Link>
        </div>
      </div>
    );
  }

  return <CompareSessionFallback />;
}

function firstValue(value?: string | string[]): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
