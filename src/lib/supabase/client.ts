"use client";

import { createBrowserClient } from "@supabase/ssr";
import { hasSupabaseEnv, isAuthRequired, isStubModeAllowed } from "./auth-mode";

const browserEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_ALLOW_STUB_MODE: process.env.NEXT_PUBLIC_ALLOW_STUB_MODE,
  NODE_ENV: process.env.NODE_ENV,
};

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createBrowserClient(url, anon);
}

export function isSupabaseConfiguredBrowser(): boolean {
  return hasSupabaseEnv(browserEnv);
}

export function isStubModeAllowedBrowser(): boolean {
  return isStubModeAllowed(browserEnv);
}

export function isAuthRequiredBrowser(): boolean {
  return isAuthRequired(browserEnv);
}
