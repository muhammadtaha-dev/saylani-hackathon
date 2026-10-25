/**
 * Pakistan public holidays — the SEED SOURCE for the public.holidays table
 * (loaded by scripts/seed-supabase.mjs). The app itself reads holidays from
 * the database at runtime, never from this file.
 *
 * Islamic holiday dates are moon-sighting dependent; entries below carry the
 * government-announced/expected dates for 2026. Update the table yearly.
 */

import data from "./pk-holidays-2026.json";

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export const PK_HOLIDAYS_2026: PublicHoliday[] = data as PublicHoliday[];
