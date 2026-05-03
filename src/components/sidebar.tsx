"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Calendar,
  CloudSun,
  FileText,
  Gauge,
  GitCompare,
  History,
  LogOut,
  PlaneTakeoff,
  Settings,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/schedule", label: "Schedule", icon: Calendar },
  { href: "/dashboard/simulate", label: "Simulate", icon: PlaneTakeoff },
  { href: "/dashboard/compare", label: "Compare", icon: GitCompare },
  { href: "/dashboard/decoders", label: "MET / NOTAM", icon: CloudSun },
  { href: "/dashboard/audit", label: "Audit", icon: History },
  { href: "/dashboard/data", label: "Data", icon: FileText },
  { href: "/dashboard/rules", label: "Rules", icon: Settings },
];

interface SidebarProps {
  role?: "viewer" | "controller" | "admin" | null;
  email?: string | null;
}

export function Sidebar({ role = null, email = null }: SidebarProps) {
  const path = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-white/10 bg-sidebar text-sidebar-foreground shadow-2xl md:w-64">
      <div className="border-b border-white/10 p-5">
        <Link href="/" className="flex items-center justify-center gap-3 md:justify-start">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-xs font-black text-zinc-950 shadow-sm">
            OCC
          </div>
          <div className="hidden md:block">
            <div className="text-sm font-semibold leading-tight">Recovery</div>
            <div className="text-[11px] text-zinc-400">Command center</div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-2 md:p-3">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active =
            path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href));
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "group flex items-center justify-center gap-3 rounded-md px-3 py-2.5 text-sm transition md:justify-start",
                active
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-300 hover:bg-white/8 hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  active ? "text-[color:var(--accent)]" : "text-zinc-500 group-hover:text-zinc-200",
                )}
              />
              <span className="hidden font-medium md:inline">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t border-white/10 p-4 md:block">
        {email ? (
          <div className="rounded-md bg-white/6 p-3">
            <div className="truncate text-xs font-medium" title={email}>
              {email}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="rounded bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase text-zinc-300">
                {role ?? "viewer"}
              </span>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white"
                aria-label="Sign out"
              >
                <LogOut className="h-3 w-3" /> Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md bg-white/6 p-3 text-xs">
            <span className="text-zinc-400">Stub mode</span>
            <Link href="/login" className="font-medium text-white hover:underline">
              Sign in
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
