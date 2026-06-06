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

// One client per browser context — multiple GoTrueClient instances share storage and misbehave.
let client: SupabaseClient | null = null;

/** The singleton browser Supabase client (created once from the runtime config). */
export function getSupabase(url: string, anonKey: string): SupabaseClient {
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
