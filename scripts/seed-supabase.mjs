#!/usr/bin/env node
/**
 * HCM Lite — Supabase seed script.
 *
 * Creates demo users for every role (Supabase Auth + profiles via the
 * on_auth_user_created trigger), leave types, Pakistan public holidays,
 * leave balances, compensations and realistic attendance/leave demo data
 * relative to today's date.
 *
 * Server-only: uses SUPABASE_SERVICE_ROLE_KEY from the environment.
 *
 *   node scripts/seed-supabase.mjs
 *
 * Demo credentials (idempotent — re-running updates passwords):
 *   admin@saylani.com          Admin@123   Admin
 *   hr@saylani.com             HR@123      HR
 *   bilal.ahmed@saylani.com    Manager@123 Manager (Engineering)
 *   sana.khalid@saylani.com    Manager@123 Manager (Sales)
 *   taha@saylani.com           Taha@123    Employee (reports to Bilal)
 *   ... plus more employees for realistic dashboards
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PK_HOLIDAYS_2026 = JSON.parse(
  readFileSync(path.join(here, "..", "lib", "pk-holidays-2026.json"), "utf8")
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing environment variables.\n" +
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example), then re-run."
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const YEAR = new Date().getFullYear();

function iso(date) {
  return date.toISOString().slice(0, 10);
}
function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function weekdaysBetween(start, end) {
  const out = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const wd = cursor.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(iso(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}
function ts(date, hhmm) {
  return `${iso(date)}T${hhmm}:00+05:00`;
}

const today = new Date();
const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
const prevMonthEnd = new Date(monthStart - 1);
const yesterday = addDays(today, -1);
const lastMonthStart = prevMonthStart;

// ---------------------------------------------------------------------------
// Demo people. managerEmail sets profiles.manager_id; salaries feed the
// payroll aggregate for HR/Admin (compensations table, never in profiles).
// ---------------------------------------------------------------------------
const PEOPLE = [
  { email: "admin@saylani.com", password: "Admin@123", name: "Ayesha Siddiqui", role: "admin", department: "HR", designation: "System Administrator", salary: 350000, managerEmail: null },
  { email: "hr@saylani.com", password: "HR@123", name: "Saima Yusuf", role: "hr", department: "HR", designation: "HR Manager", salary: 300000, managerEmail: "admin@saylani.com" },
  { email: "bilal.ahmed@saylani.com", password: "Manager@123", name: "Bilal Ahmed", role: "manager", department: "Engineering", designation: "Senior Software Engineer", salary: 260000, managerEmail: "admin@saylani.com" },
  { email: "sana.khalid@saylani.com", password: "Manager@123", name: "Sana Khalid", role: "manager", department: "Sales", designation: "Sales Manager", salary: 280000, managerEmail: "admin@saylani.com" },
  { email: "taha@saylani.com", password: "Taha@123", name: "Muhammad Taha", role: "employee", department: "Engineering", designation: "Software Engineer", salary: 180000, managerEmail: "bilal.ahmed@saylani.com" },
  { email: "hira.naveed@saylani.com", password: "Taha@123", name: "Hira Naveed", role: "employee", department: "Engineering", designation: "QA Engineer", salary: 140000, managerEmail: "bilal.ahmed@saylani.com" },
  { email: "usman.ghani@saylani.com", password: "Taha@123", name: "Usman Ghani", role: "employee", department: "Engineering", designation: "DevOps Engineer", salary: 220000, managerEmail: "bilal.ahmed@saylani.com" },
  { email: "fatima.zahra@saylani.com", password: "Taha@123", name: "Fatima Zahra", role: "employee", department: "Engineering", designation: "Frontend Developer", salary: 160000, managerEmail: "bilal.ahmed@saylani.com" },
  { email: "omar.farooq@saylani.com", password: "Taha@123", name: "Omar Farooq", role: "employee", department: "Engineering", designation: "Backend Developer", salary: 190000, managerEmail: "bilal.ahmed@saylani.com" },
  { email: "ahmed.raza@saylani.com", password: "Taha@123", name: "Ahmed Raza", role: "employee", department: "Sales", designation: "Sales Executive", salary: 130000, managerEmail: "sana.khalid@saylani.com" },
  { email: "hamza.tariq@saylani.com", password: "Taha@123", name: "Hamza Tariq", role: "employee", department: "Sales", designation: "Sales Executive", salary: 125000, managerEmail: "sana.khalid@saylani.com" },
  { email: "maryam.aslam@saylani.com", password: "Taha@123", name: "Maryam Aslam", role: "employee", department: "Sales", designation: "Account Executive", salary: 145000, managerEmail: "sana.khalid@saylani.com" },
  { email: "ali.raza@saylani.com", password: "Taha@123", name: "Ali Raza", role: "employee", department: "Sales", designation: "Sales Executive", salary: 120000, managerEmail: "sana.khalid@saylani.com" },
  { email: "adeel.hassan@saylani.com", password: "Taha@123", name: "Adeel Hassan", role: "employee", department: "HR", designation: "HR Generalist", salary: 135000, managerEmail: "hr@saylani.com" },
  { email: "kiran.shah@saylani.com", password: "Taha@123", name: "Kiran Shah", role: "employee", department: "HR", designation: "Recruiter", salary: 125000, managerEmail: "hr@saylani.com" },
];

// Late/absent patterns for the current + previous month (demo realism).
const LATE_COUNT = { "ahmed.raza@saylani.com": 4, "bilal.ahmed@saylani.com": 3, "hamza.tariq@saylani.com": 2, "usman.ghani@saylani.com": 1 };
const ABSENT_COUNT = { "bilal.ahmed@saylani.com": 1, "omar.farooq@saylani.com": 1, "fatima.zahra@saylani.com": 1 };
const LATE_CHECKINS = ["09:22", "09:37", "09:41", "09:55", "10:05", "09:48"];

const LEAVE_TYPES = [
  { id: "annual", label: "Annual", annual_entitlement: 14, is_paid: true },
  { id: "sick", label: "Sick", annual_entitlement: 8, is_paid: true },
  { id: "casual", label: "Casual", annual_entitlement: 10, is_paid: true },
];

async function ensureAuthUser(person) {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === person.email);
  if (existing) {
    await db.auth.admin.updateUserById(existing.id, { password: person.password, email_confirm: true });
    return existing.id;
  }
  const { data, error } = await db.auth.admin.createUser({
    email: person.email,
    password: person.password,
    email_confirm: true,
    user_metadata: {
      full_name: person.name,
      role: person.role,
      department: person.department,
      designation: person.designation,
    },
  });
  if (error) throw new Error(`createUser(${person.email}): ${error.message}`);
  return data.user.id;
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL} …\n`);

  // 1. Leave types + holidays.
  await db.from("leave_types").upsert(LEAVE_TYPES);
  await db.from("holidays").upsert(PK_HOLIDAYS_2026.map((h) => ({ date: h.date, name: h.name })));
  // Also seed next year's fixed holidays so January demos work.
  await db.from("holidays").upsert(
    PK_HOLIDAYS_2026
      .filter((h) => !/Eid|Milad|Ashura/i.test(h.name))
      .map((h) => ({ date: `${YEAR + 1}${h.date.slice(4)}`, name: h.name.replace(" (expected, subject to moon sighting)", "") }))
  );

  // 2. Auth users (profiles auto-created by the trigger).
  const ids = {};
  for (const person of PEOPLE) {
    ids[person.email] = await ensureAuthUser(person);
    console.log(`  auth user ok: ${person.email}`);
  }

  // 3. Profiles: manager links, roles, statuses.
  for (const person of PEOPLE) {
    await db
      .from("profiles")
      .update({
        full_name: person.name,
        role: person.role,
        department: person.department,
        designation: person.designation,
        status: "active",
        manager_id: person.managerEmail ? ids[person.managerEmail] : null,
      })
      .eq("id", ids[person.email]);
  }
  console.log("  profiles linked (managers assigned)");

  // 4. Compensations (HR/Admin-only table).
  await db.from("compensations").upsert(
    PEOPLE.map((p) => ({ employee_id: ids[p.email], salary_monthly: p.salary, currency: "PKR" }))
  );

  // 5. Leave balances for this year and next.
  const balances = [];
  for (const person of PEOPLE) {
    for (const lt of LEAVE_TYPES) {
      for (const y of [YEAR, YEAR + 1]) {
        balances.push({ employee_id: ids[person.email], leave_type_id: lt.id, year: y, entitled: lt.annual_entitlement, carried_over: 0 });
      }
    }
  }
  await db.from("leave_balances").upsert(balances);

  // 6. Attendance for the previous + current month (up to yesterday).
  const days = [
    ...weekdaysBetween(prevMonthStart, prevMonthEnd),
    ...weekdaysBetween(monthStart, yesterday),
  ];
  const attendance = [];
  for (const person of PEOPLE) {
    if (person.role === "admin" || person.role === "hr") continue; // keep HR/admin out of ops data
    let lates = 0;
    let absents = 0;
    for (const day of days) {
      const lateLimit = LATE_COUNT[person.email] ?? 0;
      const absentLimit = ABSENT_COUNT[person.email] ?? 0;
      if (lates < lateLimit && day.endsWith("2") === false && (day.charCodeAt(9) + lates) % 3 === 0) {
        lates++;
        attendance.push({ employee_id: ids[person.email], date: day, status: "late", check_in: ts(day, LATE_CHECKINS[lates % LATE_CHECKINS.length]) });
      } else if (absents < absentLimit && (day.charCodeAt(8) + absents) % 7 === 0) {
        absents++;
        attendance.push({ employee_id: ids[person.email], date: day, status: "absent" });
      } else {
        attendance.push({ employee_id: ids[person.email], date: day, status: "present", check_in: ts(day, "09:00") });
      }
    }
  }
  for (let i = 0; i < attendance.length; i += 500) {
    await db.from("attendance").upsert(attendance.slice(i, i + 500), { onConflict: "employee_id,date" });
  }
  console.log(`  attendance rows: ${attendance.length}`);

  // 7. Demo leave requests (skip if already seeded for the same employee+start).
  async function seedLeave(email, type, start, end, status, reason, comment) {
    const employeeId = ids[email];
    const { data: existing } = await db
      .from("leave_requests")
      .select("id")
      .eq("employee_id", employeeId)
      .eq("start_date", iso(start))
      .maybeSingle();
    if (existing) return;
    const days = weekdaysBetween(iso(start), iso(end)).length || 1;
    await db.from("leave_requests").insert({
      employee_id: employeeId,
      leave_type_id: type,
      start_date: iso(start),
      end_date: iso(end),
      days,
      status,
      reason,
      decision_comment: comment ?? null,
      decided_by: status === "approved" ? ids["hr@saylani.com"] : null,
      decided_at: status === "pending" ? null : new Date().toISOString(),
    });
    if (status === "approved") {
      const rows = weekdaysBetween(iso(start), iso(end)).map((d) => ({
        employee_id: employeeId,
        date: d,
        status: "leave",
      }));
      if (rows.length) await db.from("attendance").upsert(rows, { onConflict: "employee_id,date" });
    }
  }

  await seedLeave("taha@saylani.com", "sick", addDays(lastMonthStart, 9), addDays(lastMonthStart, 10), "approved", "Fever and flu");
  await seedLeave("taha@saylani.com", "sick", addDays(today, 4), addDays(today, 5), "pending", "Migraine, doctor advised rest");
  await seedLeave("taha@saylani.com", "casual", addDays(today, -14), addDays(today, -14), "approved", "Family event");
  await seedLeave("maryam.aslam@saylani.com", "annual", addDays(today, -1), addDays(today, 1), "approved", "Family wedding out of city");
  await seedLeave("hamza.tariq@saylani.com", "casual", addDays(today, -7), addDays(today, -7), "approved", "Personal errand");
  await seedLeave("ahmed.raza@saylani.com", "casual", addDays(today, 2), addDays(today, 3), "pending", "Family function at home");
  console.log("  leave requests seeded");

  console.log("\nSeed complete. Demo accounts:");
  for (const p of PEOPLE.slice(0, 4)) {
    console.log(`  ${p.role.padEnd(8)} ${p.email.padEnd(28)} ${p.password}`);
  }
  console.log(`  (plus ${PEOPLE.length - 4} employee accounts, password Taha@123)`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
