"use client";

import { useData } from "@/components/data-context";
import { cn } from "@/lib/utils";

export default function RulesPage() {
  const { rulesYaml, setRulesYaml, rules, rulesError } = useData();

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Business rules
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Edit the YAML used by the recovery engine. Changes apply immediately
          to subsequent simulations on this device.
        </p>
      </div>

      <textarea
        value={rulesYaml}
        onChange={(e) => setRulesYaml(e.target.value)}
        rows={28}
        spellCheck={false}
        className={cn(
          "w-full rounded border bg-background p-3 text-xs font-mono",
          rulesError ? "border-[color:var(--danger)]" : "border-border",
        )}
      />

      {rulesError && (
        <div className="rounded border border-[color:var(--danger)] bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">Rules YAML is invalid.</div>
          <div className="mt-1 font-mono text-xs">{rulesError}</div>
          <div className="mt-1 text-xs">
            The engine is still using the last valid rules snapshot.
          </div>
        </div>
      )}

      <div className="rounded border border-border p-3 text-xs">
        <h3 className="font-semibold mb-1">
          {rulesError ? "Last valid parsed snapshot" : "Parsed snapshot"}
        </h3>
        <pre className="text-[10px] overflow-x-auto">
          {JSON.stringify(rules, null, 2)}
        </pre>
      </div>
    </div>
  );
}
