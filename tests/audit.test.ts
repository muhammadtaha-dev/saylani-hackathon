import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import {
  appendAuditEvent,
  auditFilePath,
  listAuditEvents,
  resetAuditForTests,
  verifyAuditChain,
} from "@/lib/audit";

const FILE = auditFilePath();

beforeEach(() => {
  resetAuditForTests();
});

function actor() {
  return { userId: "EMP-001", name: "Muhammad Taha", role: "employee" as const };
}

describe("append-only hash-chained audit trail", () => {
  it("chains every row to the previous hash and verifies clean", () => {
    appendAuditEvent({ action: "login_success", actor: actor(), targetType: "auth", targetId: "EMP-001", ip: "1.2.3.4" });
    appendAuditEvent({ action: "leave_submitted", actor: actor(), targetType: "leave_request", targetId: "LR-1", ip: "1.2.3.4" });
    appendAuditEvent({ action: "login_failed", actor: { userId: "x@y.z", name: "x@y.z", role: "anonymous" }, targetType: "auth", targetId: "x@y.z", ip: "5.6.7.8" });

    const verification = verifyAuditChain();
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBe(3);
  });

  it("detects an edited row (content/hash mismatch)", () => {
    appendAuditEvent({ action: "login_success", actor: actor(), targetType: "auth", targetId: "EMP-001", ip: "1.2.3.4" });
    appendAuditEvent({ action: "leave_submitted", actor: actor(), targetType: "leave_request", targetId: "LR-1", ip: "1.2.3.4" });

    const raw = readFileSync(FILE, "utf8").split("\n").filter(Boolean);
    const row = JSON.parse(raw[1]);
    row.action = "leave_approved"; // tamper with history
    raw[1] = JSON.stringify(row);
    writeFileSync(FILE, raw.join("\n") + "\n", "utf8");

    const verification = verifyAuditChain();
    expect(verification.ok).toBe(false);
    expect(verification.broken_at_seq).toBe(2);
  });

  it("detects a deleted row (chain link break)", () => {
    appendAuditEvent({ action: "login_success", actor: actor(), targetType: "auth", targetId: "EMP-001" });
    appendAuditEvent({ action: "leave_submitted", actor: actor(), targetType: "leave_request", targetId: "LR-1" });
    appendAuditEvent({ action: "logout", actor: actor(), targetType: "auth", targetId: "EMP-001" });

    const raw = readFileSync(FILE, "utf8").split("\n").filter(Boolean);
    raw.splice(1, 1); // remove row seq=2
    writeFileSync(FILE, raw.join("\n") + "\n", "utf8");

    const verification = verifyAuditChain();
    expect(verification.ok).toBe(false);
    expect(verification.broken_at_seq).toBe(3);
  });

  it("stores who, what, when, ip and before/after values", () => {
    appendAuditEvent({
      action: "leave_approved",
      actor: { userId: "EMP-014", name: "Saima Yusuf", role: "hr" },
      targetType: "leave_request",
      targetId: "LR-1006",
      ip: "10.0.0.9",
      before: { status: "pending" },
      after: { status: "approved" },
    });
    const [event] = listAuditEvents({ action: "leave_approved" });
    expect(event.actor_name).toBe("Saima Yusuf");
    expect(event.actor_role).toBe("hr");
    expect(event.action).toBe("leave_approved");
    expect(event.target_id).toBe("LR-1006");
    expect(event.ip).toBe("10.0.0.9");
    expect(event.before).toEqual({ status: "pending" });
    expect(event.after).toEqual({ status: "approved" });
    expect(event.ts).toBeTruthy();
    expect(event.prev_hash).toBeTruthy();
    expect(event.hash).not.toBe(event.prev_hash);
  });

  it("filters by user, action and date", () => {
    appendAuditEvent({ action: "login_success", actor: actor(), targetType: "auth", targetId: "EMP-001", ip: "1.2.3.4" });
    appendAuditEvent({ action: "leave_submitted", actor: actor(), targetType: "leave_request", targetId: "LR-1" });
    appendAuditEvent({ action: "login_success", actor: { userId: "EMP-002", name: "Bilal Ahmed", role: "employee" }, targetType: "auth", targetId: "EMP-002" });

    expect(listAuditEvents({ actorId: "EMP-001" })).toHaveLength(2);
    expect(listAuditEvents({ action: "login_success" })).toHaveLength(2);
    expect(listAuditEvents({ userName: "bilal" })).toHaveLength(1);

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect(listAuditEvents({ from: tomorrow })).toHaveLength(0);
  });

  it("persists to the append-only JSONL file and only appends", () => {
    appendAuditEvent({ action: "login_success", actor: actor(), targetType: "auth", targetId: "EMP-001" });
    expect(existsSync(FILE)).toBe(true);
    const first = readFileSync(FILE, "utf8");
    expect(first.trim().split("\n")).toHaveLength(1);
    appendAuditEvent({ action: "logout", actor: actor(), targetType: "auth", targetId: "EMP-001" });
    const second = readFileSync(FILE, "utf8");
    // Pure append: the first write is still a prefix of the file.
    expect(second.startsWith(first)).toBe(true);
  });

  it("ignores a truncated tail line instead of crashing reads", () => {
    appendAuditEvent({ action: "login_success", actor: actor(), targetType: "auth", targetId: "EMP-001" });
    writeFileSync(FILE, readFileSync(FILE, "utf8").trim() + "\n{\"seq\":2,\"id\":\"half", "utf8");
    expect(() => verifyAuditChain()).not.toThrow();
    // resetAuditForTests must also cope with the file
    expect(() => resetAuditForTests()).not.toThrow();
  });

  it("starts empty after reset", () => {
    expect(listAuditEvents()).toHaveLength(0);
    if (existsSync(FILE)) unlinkSync(FILE);
  });
});
