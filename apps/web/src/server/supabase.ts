import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "./runtime";

/**
 * Supabase Auth client bound to the request cookies (server only; no browser client, so no
 * NEXT_PUBLIC_* keys). Supabase is used for auth only (plan 01 D-07).
 */
export async function supabaseServer() {
  const cookieStore = await cookies();
  const { url, anonKey } = serverEnv().supabase;
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** Admin client (service role). Used only by the non-production E2E test-login route. */
export function supabaseAdmin() {
  const { url, serviceRoleKey } = serverEnv().supabase;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
