type SupabaseRuntimeEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_ALLOW_STUB_MODE?: string;
  NODE_ENV?: string;
};

export function hasSupabaseEnv(
  env: SupabaseRuntimeEnv = process.env,
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function isStubModeAllowed(
  env: SupabaseRuntimeEnv = process.env,
): boolean {
  return (
    env.NEXT_PUBLIC_ALLOW_STUB_MODE === "1" || env.NODE_ENV !== "production"
  );
}

export function isAuthRequired(
  env: SupabaseRuntimeEnv = process.env,
): boolean {
  return hasSupabaseEnv(env) || !isStubModeAllowed(env);
}
