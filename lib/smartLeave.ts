/**
 * HCM Lite — Smart Leave parsing and validation (Art. V, Spec §8).
 *
 * The SERVER independently resolves relative dates ("next Monday and
 * Tuesday") from the current date and timezone and overrides any mismatch.
 * Validation runs in the spec's fixed order; the first failure stops the
 * pipeline. On retryable failure the model is retried once, then the manual
 * form is shown — the user never sees a raw error.
 */

import { TIMEZONE, todayInTimezone } from "./services";

export type SmartLeaveType = "annual" | "sick" | "casual";

export interface LeaveSuggestion {
  type: SmartLeaveType;
  start: string;
  end: string;
  reason: string;
}

export interface ResolvedRange {
  start: string;
  end: string;
  matched: string[];
}

const MONTH_WORDS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const WEEKDAY_WORDS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Count Mon-Fri days in the inclusive range. */
export function workingDaysBetween(start: string, end: string): number {
  if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end) return 0;
  let count = 0;
  let cursor = start;
  while (cursor <= end) {
    const wd = weekdayOf(cursor);
    if (wd !== 0 && wd !== 6) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

function nextWeekday(from: string, targetWeekday: number): string {
  for (let i = 1; i <= 7; i++) {
    const candidate = addDays(from, i);
    if (weekdayOf(candidate) === targetWeekday) return candidate;
  }
  return from;
}

/**
 * Server-authoritative relative date resolution. Returns undefined when no
 * explicit date information is found.
 */
export function resolveRelativeDates(text: string, today: string): ResolvedRange | undefined {
  const lower = text.toLowerCase();

  // Explicit ISO dates in the text.
  const isoMatches = lower.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoMatches && isoMatches.length >= 1) {
    const valid = isoMatches.filter(isValidIsoDate).sort();
    if (valid.length >= 2) return { start: valid[0], end: valid[valid.length - 1], matched: isoMatches };
    if (valid.length === 1) return { start: valid[0], end: valid[0], matched: isoMatches };
  }

  // "day after tomorrow" / "tomorrow".
  if (/day after tomorrow/.test(lower)) {
    const d = addDays(today, 2);
    return { start: d, end: d, matched: ["day after tomorrow"] };
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = addDays(today, 1);
    return { start: d, end: d, matched: ["tomorrow"] };
  }

  // Named months with day numbers: "28 October", "Oct 28", "March 3 2026".
  const monthDay =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/.exec(
      lower
    ) ??
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s*,?\s*(\d{4}))?/.exec(
      lower
    );
  if (monthDay) {
    const now = todayInTimezone();
    const monthToken = monthDay[1] ?? monthDay[2];
    const dayToken = monthDay[1] && monthDay[2] ? monthDay[2] : monthDay[1];
    const month = MONTH_WORDS[monthToken.slice(0, 3)] ?? MONTH_WORDS[monthToken];
    const day = Number(dayToken);
    const year = monthDay[3] ? Number(monthDay[3]) : now.year;
    if (month && day >= 1 && day <= 31) {
      const iso = toIso(year, month, day);
      const resolved = iso < today && !monthDay[3] ? toIso(year + 1, month, day) : iso;
      return { start: resolved, end: resolved, matched: [monthDay[0]] };
    }
  }

  // Weekday phrases: "next monday and tuesday", "monday to friday", "this friday".
  const weekdayPattern =
    /\b(next|this|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;
  const found: { name: string; index: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = weekdayPattern.exec(lower)) !== null) {
    found.push({ name: match[2], index: match.index });
  }
  if (found.length >= 1) {
    const dates = found.map((f) => nextWeekday(today, WEEKDAY_WORDS[f.name]));
    dates.sort();
    return { start: dates[0], end: dates[dates.length - 1], matched: found.map((f) => f.name) };
  }

  return undefined;
}

export function inferLeaveType(text: string): SmartLeaveType {
  const lower = text.toLowerCase();
  if (/\b(sick|ill|illness|fever|flu|migraine|doctor|hospital|medical|surgery|dengue|cough|unwell|not well|health)\b/.test(lower)) {
    return "sick";
  }
  if (/\b(vacation|holiday|annual|trip|tour|abroad|overseas|vacations)\b/.test(lower)) {
    return "annual";
  }
  return "casual";
}

export function inferReason(text: string): string {
  const patterns = [
    /for\s+(?:my\s+)?(.{3,80}?)(?:[.,;!]|$)/i,
    /because\s+(?:of\s+)?(?:my\s+)?(.{3,80}?)(?:[.,;!]|$)/i,
    /due\s+to\s+(?:my\s+)?(.{3,80}?)(?:[.,;!]|$)/i,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m) {
      let reason = m[1].trim().replace(/\s+/g, " ");
      reason = reason.replace(/^(i|i'm|i am|need|have|want|going|attending|the)\s+/i, "").trim();
      if (reason.length >= 3) {
        return reason.charAt(0).toUpperCase() + reason.slice(1);
      }
    }
  }
  return "Personal leave";
}

// ---------------------------------------------------------------------------
// Validation pipeline (Spec §8, in order)
// ---------------------------------------------------------------------------

export type FailureSeverity = "retry" | "manual";

export interface ValidationResult {
  ok: boolean;
  /** retry = retry the model once; manual = show the manual form. */
  severity?: FailureSeverity;
  stage?: string;
  issue?: string;
  warnings: string[];
}

const LEAVE_TYPE_SET: SmartLeaveType[] = ["annual", "sick", "casual"];

export function validateSuggestion(
  value: unknown,
  today: string
): ValidationResult {
  const warnings: string[] = [];

  // 1-2. Shape and required fields.
  if (!value || typeof value !== "object") {
    return { ok: false, severity: "retry", stage: "json", issue: "Output is not a JSON object", warnings };
  }
  const suggestion = value as Record<string, unknown>;
  const { type, start, end, reason } = suggestion;
  if (typeof type !== "string" || typeof start !== "string" || typeof end !== "string" || typeof reason !== "string") {
    return { ok: false, severity: "retry", stage: "fields", issue: "Required fields type/start/end/reason missing or invalid", warnings };
  }

  // 3. Leave type.
  if (!LEAVE_TYPE_SET.includes(type as SmartLeaveType)) {
    return { ok: false, severity: "retry", stage: "type", issue: `Unknown leave type '${type}'`, warnings };
  }

  // 4. ISO dates.
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) {
    return { ok: false, severity: "retry", stage: "iso_dates", issue: "start/end are not valid YYYY-MM-DD dates", warnings };
  }

  // 5. start <= end.
  if (start > end) {
    return { ok: false, severity: "retry", stage: "order", issue: "start date is after end date", warnings };
  }

  // 6. Not in the past.
  if (end < today) {
    return { ok: false, severity: "manual", stage: "past", issue: "The requested dates are in the past", warnings };
  }
  if (start < today) {
    warnings.push("Start date is in the past; the range was kept as requested for HR review.");
  }

  // 7. Weekend handling — pre-fill with a note.
  const weekendDays: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    const wd = weekdayOf(cursor);
    if (wd === 0 || wd === 6) weekendDays.push(cursor);
    cursor = addDays(cursor, 1);
  }
  if (weekendDays.length > 0) {
    warnings.push(
      `${weekendDays.length} weekend day(s) inside the range are not counted as leave days.`
    );
  }
  if (weekdayOf(start) === 0 || weekdayOf(start) === 6) {
    warnings.push("The start date falls on a weekend.");
  }

  return { ok: true, warnings };
}

export function formatSuggestion(
  type: SmartLeaveType,
  start: string,
  end: string,
  reason: string,
  warnings: string[] = []
): { suggestion: LeaveSuggestion & { warnings: string[] } } {
  return {
    suggestion: { type, start, end, reason, warnings },
  };
}

export { TIMEZONE };
