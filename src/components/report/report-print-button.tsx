"use client";

import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";

export function ReportPrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  const printedRef = useRef(false);

  useEffect(() => {
    if (!autoPrint || printedRef.current) return;
    printedRef.current = true;
    window.setTimeout(() => window.print(), 300);
  }, [autoPrint]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      <Printer className="h-4 w-4" />
      Export PDF
    </button>
  );
}
