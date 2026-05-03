type SupabaseRuntimeEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_ALLOW_STUB_MODE?: string;
  NODE_ENV?: string;
};

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function isStubModeAllowed(): boolean {
  return (
    process.env.NEXT_PUBLIC_ALLOW_STUB_MODE === "1" || process.env.NODE_ENV !== "production"
  );
}

export function isAuthRequired(): boolean {
  return hasSupabaseEnv() || !isStubModeAllowed();
}

