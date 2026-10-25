/**
 * HCM Lite — Supabase server-side clients.
 *
 * Two clients, two trust levels (Constitution Art. III.1):
 *  - supabaseServer(): cookie-bound client carrying the LOGGED-IN USER's
 *    JWT. Every data read/write and every AI tool call goes through this, so
 *    Row Level Security scopes the result to the caller's role. Never used
 *    with the service role key.
 *  - supabaseAdmin(): service-role client for the few server-only jobs that
 *    must bypass RLS by design: audit_log inserts (the table has no insert
 *    policy for clients at all), auth user administration and seeding. It is
 *    constructed only inside server code paths — the key is read from
 *    SUPABASE_SERVICE_ROLE_KEY and never shipped to the browser.
 */

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function missingConfigError(): Error {
  return new Error(
    "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (and SUPABASE_SERVICE_ROLE_KEY for server jobs), then restart."
  );
}

/** Cookie-bound client = the logged-in user's identity. RLS applies. */
export async function supabaseServer(): Promise<SupabaseClient> {
  if (!supabaseConfigured()) throw missingConfigError();
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — safe to ignore; the
          // middleware refreshes sessions on navigation.
        }
      },
    },
  });
}

/**
 * Server-only service-role client. NEVER import this from a client
 * component and NEVER log the key. Allowed uses: audit_log writes,
 * auth.admin user management, seeding.
 */
export function supabaseAdmin(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseConfigured() || !serviceKey) throw missingConfigError();
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
