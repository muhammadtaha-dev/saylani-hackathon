/**
 * HCM Lite — Pakistan public holiday calendar (Checklist D.15/D.20).
 *
 * Used by leave validation: holiday days inside a requested range do not
 * consume quota and are surfaced as warnings, exactly like weekend days.
 *
 * Dates for Islamic holidays are moon-sighting dependent; the list below
 * carries the government-announced/expected dates for 2026 and is versioned
 * so it can be updated yearly. Seeded demo attendance (March & October
 * 2026) is consistent with this list — e.g. 23 March 2026 (Pakistan Day) is
 * treated as a holiday, not a working day.
 */

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export const PK_HOLIDAYS_2026: PublicHoliday[] = [
  { date: "2026-02-05", name: "Kashmir Day" },
  { date: "2026-03-23", name: "Pakistan Day" },
  { date: "2026-03-20", name: "Eid al-Fitr (expected, subject to moon sighting)" },
  { date: "2026-03-21", name: "Eid al-Fitr holiday (expected, subject to moon sighting)" },
  { date: "2026-03-22", name: "Eid al-Fitr holiday (expected, subject to moon sighting)" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-27", name: "Eid al-Azha (expected, subject to moon sighting)" },
  { date: "2026-05-28", name: "Eid al-Azha holiday (expected, subject to moon sighting)" },
  { date: "2026-05-29", name: "Eid al-Azha holiday (expected, subject to moon sighting)" },
  { date: "2026-08-14", name: "Independence Day" },
  { date: "2026-08-26", name: "Eid Milad-un-Nabi (expected, subject to moon sighting)" },
  { date: "2026-11-09", name: "Iqbal Day" },
  { date: "2026-12-25", name: "Quaid-e-Azam Day / Christmas" },
];

const HOLIDAYS_BY_YEAR: Record<number, Map<string, string>> = {
  2026: new Map(PK_HOLIDAYS_2026.map((h) => [h.date, h.name])),
};

/** Holiday name for a date, or undefined when it is a normal working day. */
export function holidayName(iso: string): string | undefined {
  const year = Number(iso.slice(0, 4));
  return HOLIDAYS_BY_YEAR[year]?.get(iso);
}

export function isPublicHoliday(iso: string): boolean {
  return holidayName(iso) !== undefined;
}

/** All holidays of a year, sorted by date (for a holiday calendar view). */
export function holidaysOfYear(year: number): PublicHoliday[] {
  const map = HOLIDAYS_BY_YEAR[year];
  if (!map) return [];
  return [...map.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
