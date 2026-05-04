import { notFound } from "next/navigation";
import {
  getSimulation,
  listAuditLog,
  type AuditEntry,
} from "@/lib/supabase/queries";
import { SimulationReportView } from "@/components/report/report-view";

export const dynamic = "force-dynamic";

interface ReportPageProps {
  params: Promise<{ uuid: string }>;
  searchParams?: Promise<{ print?: string }>;
}

export default async function ReportPage({ params, searchParams }: ReportPageProps) {
  const { uuid } = await params;
  const query = searchParams ? await searchParams : {};
  const [simulation, entries] = await Promise.all([
    getSimulation(uuid),
    listAuditLog(200),
  ]);

  if (!simulation) {
    notFound();
  }

  const relatedEntries = entries.filter((entry) => {
    const simulationUuid = getSimulationUuidFromEntry(entry);
    if (simulationUuid === simulation.uuid) return true;
    return simulation.options.some(
      (option) =>
        entry.entity_type === "recovery_option" &&
        entry.entity_id === option.option_id,
    );
  });

  return (
    <SimulationReportView
      simulation={simulation}
      auditEntries={relatedEntries}
      autoPrint={query.print === "1"}
    />
  );
}

function getSimulationUuidFromEntry(entry: AuditEntry): string | null {
  if (entry.entity_type === "simulation" && entry.entity_id) {
    return entry.entity_id;
  }
  const simulationUuid = entry.payload?.simulation_uuid;
  return typeof simulationUuid === "string" ? simulationUuid : null;
}
