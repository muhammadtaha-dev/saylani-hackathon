/**
 * HCM Lite — browser Supabase client (anon key + the user's own session from
 * cookies). Used ONLY for Supabase Realtime (leave-status notifications) and
 * leave-attachment uploads/downloads, both guarded by RLS/storage policies.
 * The anon key is public by design; the service role key never reaches here.
 */

import { createBrowserClient } from "@supabase/ssr";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function supabaseBrowserConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function supabaseBrowser() {
  if (!supabaseBrowserConfigured()) return null;
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
