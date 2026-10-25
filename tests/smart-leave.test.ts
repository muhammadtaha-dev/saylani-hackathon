import { describe, expect, it } from "vitest";
import {
  approvalRiskNote,
  resolveRelativeDates,
  teamOverlapFor,
  validateSuggestion,
  workingDaysBetween,
} from "@/lib/smartLeave";
import { holidaysOfYear } from "@/lib/holidays";

const TODAY = "2026-10-25"; // a Sunday

describe("working-day counting", () => {
  it("counts zero days for a weekend-only range", () => {
    expect(workingDaysBetween("2026-11-07", "2026-11-08")).toBe(0); // Sat–Sun
  });

  it("counts five days for a full Mon–Fri week", () => {
    expect(workingDaysBetween("2026-11-02", "2026-11-06")).toBe(5);
  });

  it("excludes holidays in a multi-day range", () => {
    // 2026-03-20 (Fri) is Eid al-Fitr in the calendar, 21–22 weekend,
    // 23 (Mon) Pakistan Day → only Tue 24 is a working day.
    expect(workingDaysBetween("2026-03-20", "2026-03-24")).toBe(1);
    // A clean week: Mon 2 – Fri 6 November has no holidays.
    expect(workingDaysBetween("2026-11-02", "2026-11-06")).toBe(5);
  });
});

describe("holiday calendar (Pakistan 2026)", () => {
  it("lists the fixed national days", () => {
    const holidays = holidaysOfYear(2026).map((h) => h.date);
    for (const date of ["2026-02-05", "2026-03-23", "2026-05-01", "2026-08-14", "2026-11-09", "2026-12-25"]) {
      expect(holidays).toContain(date);
    }
  });

  it("returns nothing for an unconfigured year", () => {
    expect(holidaysOfYear(1999)).toEqual([]);
  });
});

describe("validateSuggestion pipeline", () => {
  it("rejects past dates as a manual-form case", () => {
    const result = validateSuggestion(
      { type: "casual", start: "2026-10-01", end: "2026-10-02", reason: "x" },
      TODAY
    );
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("manual");
    expect(result.stage).toBe("past");
  });

  it("rejects end-before-start as retryable", () => {
    const result = validateSuggestion(
      { type: "casual", start: "2026-11-10", end: "2026-11-09", reason: "x" },
      TODAY
    );
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("order");
  });

  it("warns about weekends inside an otherwise valid range", () => {
    const result = validateSuggestion(
      { type: "annual", start: "2026-11-02", end: "2026-11-08", reason: "trip" },
      TODAY
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/weekend/);
  });

  it("warns about public holidays inside the range", () => {
    const result = validateSuggestion(
      { type: "casual", start: "2026-11-09", end: "2026-11-10", reason: "family" },
      TODAY
    );
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/holiday/i);
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

describe("team overlap and risk notes", () => {
  it("detects an approved teammate leave overlapping the range (Sales, Oct 22–23)", () => {
    // Seed: Maryam (EMP-011, Sales) approved Oct 22–23. Ahmed Raza (EMP-008) is Sales too.
    const overlap = teamOverlapFor("EMP-008", "2026-10-22", "2026-10-23");
    expect(overlap.offCount).toBe(1);
    expect(overlap.offNames[0].name).toBe("Maryam Aslam");
    expect(overlap.teamSize).toBeGreaterThan(0);
  });

  it("flags risk when the request exceeds the remaining balance", () => {
    const note = approvalRiskNote({
      type: "annual",
      requestedWorkingDays: 15,
      remaining: 14,
      pendingDays: 0,
      overlap: { teamSize: 5, offCount: 0, offNames: [] },
    });
    expect(note).toMatch(/exceeds/i);
  });

  it("sounds positive when balance is fine and nobody is off", () => {
    const note = approvalRiskNote({
      type: "annual",
      requestedWorkingDays: 2,
      remaining: 10,
      pendingDays: 0,
      overlap: { teamSize: 5, offCount: 0, offNames: [] },
    });
    expect(note).toMatch(/likely to be approved/i);
  });
});
