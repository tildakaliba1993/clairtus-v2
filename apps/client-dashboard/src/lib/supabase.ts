import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** True when Supabase Auth env is configured (NEXT_PUBLIC_* are inlined into the client bundle). */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** A browser Supabase client. Only call when supabaseConfigured() is true. */
export function browserSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  );
}
