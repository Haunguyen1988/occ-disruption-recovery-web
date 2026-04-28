"use client";

import { useData } from "@/components/data-context";

export default function RulesPage() {
  const { rulesYaml, setRulesYaml, rules } = useData();

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
        className="w-full rounded border border-border bg-background p-3 text-xs font-mono"
      />

      <div className="rounded border border-border p-3 text-xs">
        <h3 className="font-semibold mb-1">Parsed snapshot</h3>
        <pre className="text-[10px] overflow-x-auto">
          {JSON.stringify(rules, null, 2)}
        </pre>
      </div>
    </div>
  );
}
