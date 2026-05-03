"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createSupabaseBrowserClient,
  isAuthRequiredBrowser,
  isStubModeAllowedBrowser,
  isSupabaseConfiguredBrowser,
} from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabaseReady = isSupabaseConfiguredBrowser();
  const stubModeAllowed = isStubModeAllowedBrowser();
  const authRequired = isAuthRequiredBrowser();
  const signInDisabled = busy || !supabaseReady;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!supabaseReady) {
      setErr(
        stubModeAllowed
          ? "Supabase is not configured. Development stub mode is available below."
          : "Supabase is not configured for this deployment. Dashboard access is locked until production auth is configured.",
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
            ? "Use your team email to access the OCC dashboard."
            : stubModeAllowed
              ? "Development stub mode is available because Supabase is not configured."
              : "Production auth is not configured. Dashboard access is locked."}
        </p>

        {!supabaseReady && authRequired && (
          <div className="mt-6 rounded-md border border-[color:var(--danger)] bg-red-50 p-3 text-sm text-red-900">
            Configure `NEXT_PUBLIC_SUPABASE_URL` and
            `NEXT_PUBLIC_SUPABASE_ANON_KEY` before using this deployment.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            placeholder="email@vietjetair.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
            required
            disabled={!supabaseReady}
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
            required
            disabled={!supabaseReady}
          />
          {err && <p className="text-xs text-[color:var(--danger)]">{err}</p>}
          <button
            type="submit"
            disabled={signInDisabled}
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {!supabaseReady && stubModeAllowed && (
          <Link
            href="/dashboard"
            className="mt-4 block text-center text-sm text-zinc-500 hover:underline"
          >
            Open development dashboard
          </Link>
        )}
      </div>
    </main>
  );
}
