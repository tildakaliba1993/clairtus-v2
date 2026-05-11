// supabase/functions/_shared/supabaseClient.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export function getSupabaseClient() {
  // We use the built-in environment variables provided by Supabase
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("CRITICAL: Missing Supabase URL or Service Role Key.");
  }

  // The Service Role Key bypasses Row Level Security (RLS) so our backend webhook can write freely
  return createClient(supabaseUrl, supabaseServiceKey);
}