import { describe, expect, it } from "vitest";
import { computeLeaveBalances } from "@/lib/services";

describe("leave balance arithmetic (pure — DB rows in, balances out)", () => {
  const entitled = [
    { leave_type_id: "annual", entitled: 14, carried_over: 0 },
    { leave_type_id: "sick", entitled: 8, carried_over: 0 },
    { leave_type_id: "casual", entitled: 10, carried_over: 0 },
  ];

  it("deducts only APPROVED leaves from the remaining balance", () => {
    const balances = computeLeaveBalances(entitled, [
      { leave_type_id: "sick", days: 2, status: "approved" },
      { leave_type_id: "sick", days: 2, status: "pending" },
    ]);
    const sick = balances.find((b) => b.type === "sick")!;
    expect(sick.used_approved).toBe(2);
    expect(sick.pending).toBe(2);
    expect(sick.remaining).toBe(6); // 8 - 2 approved; pending NOT deducted
  });

  it("ignores rejected and cancelled requests", () => {
    const balances = computeLeaveBalances(entitled, [
      { leave_type_id: "annual", days: 5, status: "rejected" },
      { leave_type_id: "annual", days: 3, status: "cancelled" },
    ]);
    const annual = balances.find((b) => b.type === "annual")!;
    expect(annual.remaining).toBe(14);
  });

  it("adds carry-over to the entitlement", () => {
    const balances = computeLeaveBalances(
      [{ leave_type_id: "annual", entitled: 14, carried_over: 2.5 }],
      [{ leave_type_id: "annual", days: 1, status: "approved" }]
    );
    expect(balances[0].remaining).toBe(15.5);
  });

  it("falls back to zero entitlement when no balance row exists", () => {
    const balances = computeLeaveBalances([], [{ leave_type_id: "casual", days: 1, status: "approved" }]);
    expect(balances.find((b) => b.type === "casual")!.remaining).toBe(-1);
  });
});
