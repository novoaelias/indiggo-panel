import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Env } from "../env";

/**
 * Cliente Supabase con service_role. Sólo se usa desde el Worker (servidor),
 * nunca desde el browser. Bypassa RLS.
 */
export function supa(env: Env) {
  return createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
