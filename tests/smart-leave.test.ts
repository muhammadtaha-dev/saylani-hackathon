import { describe, expect, it } from "vitest";
import {
  approvalRiskNote,
  resolveRelativeDates,
  validateSuggestion,
  workingDaysBetween,
} from "@/lib/smartLeave";

const TODAY = "2026-10-25"; // a Sunday
// Holiday set as fetched from public.holidays for the tested ranges.
const HOLIDAYS = new Map<string, string>([
  ["2026-03-20", "Eid al-Fitr (expected)"],
  ["2026-03-23", "Pakistan Day"],
  ["2026-11-09", "Iqbal Day"],
]);

describe("working-day counting", () => {
  it("counts zero days for a weekend-only range", () => {
    expect(workingDaysBetween("2026-11-07", "2026-11-08")).toBe(0); // Sat–Sun
  });

  it("counts five days for a full Mon–Fri week", () => {
    expect(workingDaysBetween("2026-11-02", "2026-11-06")).toBe(5);
  });

  it("excludes database-provided public holidays", () => {
    // 2026-03-23 is a Monday and a holiday; 20 is Friday + Eid holiday.
    expect(workingDaysBetween("2026-03-20", "2026-03-24", new Set(HOLIDAYS.keys()))).toBe(1);
    // A clean week: Mon 2 – Fri 6 November has no holidays.
    expect(workingDaysBetween("2026-11-02", "2026-11-06", new Set(HOLIDAYS.keys()))).toBe(5);
  });
});

describe("validateSuggestion pipeline", () => {
  it("rejects past dates as a manual-form case", () => {
    const result = validateSuggestion(
      { type: "casual", start: "2026-10-01", end: "2026-10-02", reason: "x" },
      TODAY,
      HOLIDAYS
    );
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("manual");
    expect(result.stage).toBe("past");
  });

  it("rejects end-before-start as retryable", () => {
    const result = validateSuggestion(
      { type: "casual", start: "2026-11-10", end: "2026-11-09", reason: "x" },
      TODAY,
      HOLIDAYS
    );
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("order");
  });

  it("warns about weekends and public holidays inside the range", () => {
    const result = validateSuggestion(
      { type: "casual", start: "2026-11-09", end: "2026-11-10", reason: "family" },
      TODAY,
      HOLIDAYS
    );
    expect(result.ok).toBe(true);
    const text = result.warnings.join(" ");
    expect(text).toMatch(/holiday/i);
  });
});

describe("relative date resolution (server-authoritative)", () => {
  it("resolves 'tomorrow' from the given today", () => {
    expect(resolveRelativeDates("I need tomorrow off", TODAY)?.start).toBe("2026-10-26");
  });

  it("resolves explicit ISO dates", () => {
    const r = resolveRelativeDates("off from 2026-11-02 to 2026-11-04", TODAY);
    expect(r?.start).toBe("2026-11-02");
    expect(r?.end).toBe("2026-11-04");
  });

  it("finds the next weekday for 'next monday'", () => {
    // 2026-10-25 is a Sunday → next Monday is 2026-10-26.
    expect(resolveRelativeDates("next monday", TODAY)?.start).toBe("2026-10-26");
  });

  it("returns undefined when no date info exists", () => {
    expect(resolveRelativeDates("I need some days off for a family event", TODAY)).toBeUndefined();
  });
});

describe("plain-language approval-outlook note", () => {
  it("flags risk when the request exceeds the remaining balance", () => {
    const note = approvalRiskNote({
      type: "annual",
      requestedWorkingDays: 15,
      remaining: 14,
      pendingDays: 0,
      offCount: 0,
      teamSize: 5,
      offNames: [],
    });
    expect(note).toMatch(/exceeds/i);
  });

  it("mentions conflicting teammates", () => {
    const note = approvalRiskNote({
      type: "annual",
      requestedWorkingDays: 2,
      remaining: 10,
      pendingDays: 0,
      offCount: 2,
      teamSize: 5,
      offNames: ["Maryam Aslam", "Ali Raza"],
    });
    expect(note).toMatch(/2 of your 5 teammates/i);
  });

  it("sounds positive when balance is fine and nobody is off", () => {
    const note = approvalRiskNote({
      type: "annual",
      requestedWorkingDays: 2,
      remaining: 10,
      pendingDays: 0,
      offCount: 0,
      teamSize: 5,
      offNames: [],
    });
    expect(note).toMatch(/likely to be approved/i);
  });
});
