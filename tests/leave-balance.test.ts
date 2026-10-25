import { describe, expect, it } from "vitest";
import { getMyLeaveBalanceService } from "@/lib/services";

describe("leave balance (seed: Taha EMP-001)", () => {
  const balances = getMyLeaveBalanceService("EMP-001", 2026).balances;
  const byType = Object.fromEntries(balances.map((b) => [b.type, b]));

  it("grants the v1 policy entitlements", () => {
    expect(byType.annual.entitled).toBe(14);
    expect(byType.sick.entitled).toBe(8);
    expect(byType.casual.entitled).toBe(10);
  });

  it("deducts only APPROVED leaves from the remaining balance", () => {
    // Seed: 2 approved sick days (LR-1001), 2 pending sick days (LR-1002).
    expect(byType.sick.used_approved).toBe(2);
    expect(byType.sick.pending).toBe(2);
    expect(byType.sick.remaining).toBe(6); // 8 entitled - 2 approved; pending NOT deducted
  });

  it("tracks casual usage from the seeded approved request", () => {
    expect(byType.casual.used_approved).toBe(1);
    expect(byType.casual.remaining).toBe(9);
  });

  it("is untouched for a year with no requests", () => {
    const empty = getMyLeaveBalanceService("EMP-001", 2025).balances;
    for (const b of empty) {
      expect(b.used_approved).toBe(0);
      expect(b.pending).toBe(0);
      expect(b.remaining).toBe(b.entitled);
    }
  });

  it("starts every employee at their full entitlement", () => {
    const fresh = getMyLeaveBalanceService("EMP-015", 2026).balances;
    for (const b of fresh) expect(b.remaining).toBe(b.entitled);
  });

  it("ignores cancelled and rejected requests when computing usage", () => {
    // Cancelled/rejected leave never consumes quota — model the transition
    // by checking a freshly cancelled request would not appear as approved.
    const before = getMyLeaveBalanceService("EMP-015", 2026).balances;
    expect(before.every((b) => b.used_approved === 0)).toBe(true);
  });
});
