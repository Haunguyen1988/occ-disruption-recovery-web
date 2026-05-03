import { describe, expect, it } from "vitest";
import {
  hasSupabaseEnv,
  isAuthRequired,
  isStubModeAllowed,
} from "@/lib/supabase/auth-mode";

describe("auth mode", () => {
  it("requires auth when Supabase is configured", () => {
    const env = {
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    };

    expect(hasSupabaseEnv(env)).toBe(true);
    expect(isAuthRequired(env)).toBe(true);
  });

  it("allows stub mode only outside production by default", () => {
    expect(isStubModeAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isAuthRequired({ NODE_ENV: "development" })).toBe(false);

    expect(isStubModeAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(isAuthRequired({ NODE_ENV: "production" })).toBe(true);
  });

  it("allows an explicit stub-mode override for controlled demos", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_ALLOW_STUB_MODE: "1",
    };

    expect(isStubModeAllowed(env)).toBe(true);
    expect(isAuthRequired(env)).toBe(false);
  });
});

