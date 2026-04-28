"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createSupabaseBrowserClient,
  isSupabaseConfiguredBrowser,
} from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabaseReady = isSupabaseConfiguredBrowser();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!supabaseReady) {
      setErr(
        "Supabase environment variables not configured. Sign-in is disabled in stub mode — go directly to the dashboard.",
      );
      return;
    }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/dashboard");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-2 mb-8 text-sm text-zinc-500 hover:text-foreground"
        >
          <span className="h-7 w-7 rounded bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
            OCC
          </span>
          Recovery
        </Link>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {supabaseReady
            ? "Use your team email to sign in."
            : "Stub mode — Supabase not configured. You can still open the dashboard."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            placeholder="email@vietjetair.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
            required
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
            required
          />
          {err && (
            <p className="text-xs text-[color:var(--danger)]">{err}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <Link
          href="/dashboard"
          className="mt-4 block text-center text-sm text-zinc-500 hover:underline"
        >
          Continue without signing in →
        </Link>
      </div>
    </main>
  );
}
