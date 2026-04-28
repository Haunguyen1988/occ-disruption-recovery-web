"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Calendar,
  CloudSun,
  FileText,
  Gauge,
  History,
  PlaneTakeoff,
  Settings,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/schedule", label: "Schedule", icon: Calendar },
  { href: "/dashboard/simulate", label: "Simulate", icon: PlaneTakeoff },
  { href: "/dashboard/decoders", label: "MET / NOTAM", icon: CloudSun },
  { href: "/dashboard/audit", label: "Audit", icon: History },
  { href: "/dashboard/data", label: "Data", icon: FileText },
  { href: "/dashboard/rules", label: "Rules", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
            OCC
          </div>
          <span className="text-sm font-semibold">Recovery</span>
        </Link>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active =
            path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href));
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-2 rounded px-3 py-2 text-sm transition",
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 text-[11px] text-zinc-500 border-t border-border">
        v0.1.0 — MVP demo
      </div>
    </aside>
  );
}
