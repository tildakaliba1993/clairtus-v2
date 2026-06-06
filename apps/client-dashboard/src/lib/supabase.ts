import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AuthConfig {
  configured: boolean;
  url?: string;
  anonKey?: string;
}

/** Fetch the runtime Supabase config from the server (no build-time inlining). Never throws. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth-config');
    if (!res.ok) return { configured: false };
    return (await res.json()) as AuthConfig;
  } catch {
    return { configured: false };
  }
}

/** A browser Supabase client built from the runtime config. */
export function browserSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey);
}
