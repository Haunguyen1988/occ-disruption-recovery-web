"use client";

import { createBrowserClient } from "@supabase/ssr";
import { hasSupabaseEnv, isAuthRequired, isStubModeAllowed } from "./auth-mode";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createBrowserClient(url, anon);
}

export function isSupabaseConfiguredBrowser(): boolean {
  return hasSupabaseEnv();
}

export function isStubModeAllowedBrowser(): boolean {
  return isStubModeAllowed();
}

export function isAuthRequiredBrowser(): boolean {
  return isAuthRequired();
}
