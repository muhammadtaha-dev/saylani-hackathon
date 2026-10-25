/**
 * HCM Lite — seed data layer (single source of truth for demo data).
 *
 * All figures live here; services derive every number from this file so the
 * dashboard and the AI tools can never disagree. Sensitive fields (salary,
 * cnic, bank account) exist ONLY in this module and are never returned by any
 * service, tool, or API response.
 */

import { hashPassword } from "./auth";
import { loadPersistedState, savePersistedState } from "./persistence";

export type Role = "admin" | "hr" | "employee";
export type DepartmentName = "Engineering" | "Sales" | "HR";
export type EmploymentStatus = "active" | "inactive";
export type AttendanceStatus = "present" | "late" | "absent" | "leave";
export type LeaveType = "annual" | "sick" | "casual";
export type LeaveStatus = "pending" | "approved" | "rejected";

export const DEPARTMENTS: DepartmentName[] = ["Engineering", "Sales", "HR"];

export const LEAVE_TYPES: LeaveType[] = ["annual", "sick", "casual"];

/** Yearly entitlement per leave type (Section 3 policy rules, v1). */
export const LEAVE_ENTITLEMENTS: Record<LeaveType, number> = {
  annual: 14,
  sick: 8,
  casual: 10,
};

export interface Employee {
  id: string;
  name: string;
  email: string;
  department: DepartmentName;
  designation: string;
  role: Role;
  status: EmploymentStatus;
  joinedOn: string; // ISO date
  /** Sensitive — never leaves this module. */
  salaryMonthlyPkr: number;
  /** Sensitive — never leaves this module. */
  cnic: string;
  /** Sensitive — never leaves this module. */
  bankAccount: string;
  /** scrypt hash (salt:hash). Empty means "no password set yet". */
  passwordHash?: string;
}

export interface AttendanceRecord {
  employeeId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  /** HH:MM in Asia/Karachi. Late when checkIn is after LATE_CUTOFF. */
  checkIn?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: LeaveType;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  days: number;
  status: LeaveStatus;
  reason: string;
  appliedOn: string; // ISO date
  aiSuggested?: boolean;
}

export const EMPLOYEES: Employee[] = [
  {
    id: "EMP-000",
    name: "Ayesha Siddiqui",
    email: "admin@saylani.com",
    department: "HR",
    designation: "System Administrator",
    role: "admin",
    status: "active",
    joinedOn: "2021-02-01",
    salaryMonthlyPkr: 350000,
    cnic: "42101-1111111-1",
    bankAccount: "PK00-BANK-0000000000000",
  },
  {
    id: "EMP-001",
    name: "Muhammad Taha",
    email: "taha@saylani.com",
    department: "Engineering",
    designation: "Software Engineer",
    role: "employee",
    status: "active",
    joinedOn: "2023-03-15",
    salaryMonthlyPkr: 180000,
    cnic: "42101-2222222-2",
    bankAccount: "PK00-BANK-1111111111111",
  },
  {
    id: "EMP-002",
    name: "Bilal Ahmed",
    email: "bilal.ahmed@saylani.com",
    department: "Engineering",
    designation: "Senior Software Engineer",
    role: "employee",
    status: "active",
    joinedOn: "2022-06-10",
    salaryMonthlyPkr: 260000,
    cnic: "42101-3333333-3",
    bankAccount: "PK00-BANK-2222222222222",
  },
  {
    id: "EMP-003",
    name: "Hira Naveed",
    email: "hira.naveed@saylani.com",
    department: "Engineering",
    designation: "QA Engineer",
    role: "employee",
    status: "active",
    joinedOn: "2023-09-01",
    salaryMonthlyPkr: 140000,
    cnic: "42101-4444444-4",
    bankAccount: "PK00-BANK-3333333333333",
  },
  {
    id: "EMP-004",
    name: "Usman Ghani",
    email: "usman.ghani@saylani.com",
    department: "Engineering",
    designation: "DevOps Engineer",
    role: "employee",
    status: "active",
    joinedOn: "2022-01-20",
    salaryMonthlyPkr: 220000,
    cnic: "42101-5555555-5",
    bankAccount: "PK00-BANK-4444444444444",
  },
  {
    id: "EMP-005",
    name: "Fatima Zahra",
    email: "fatima.zahra@saylani.com",
    department: "Engineering",
    designation: "Frontend Developer",
    role: "employee",
    status: "active",
    joinedOn: "2024-02-12",
    salaryMonthlyPkr: 160000,
    cnic: "42101-6666666-6",
    bankAccount: "PK00-BANK-5555555555555",
  },
  {
    id: "EMP-006",
    name: "Omar Farooq",
    email: "omar.farooq@saylani.com",
    department: "Engineering",
    designation: "Backend Developer",
    role: "employee",
    status: "active",
    joinedOn: "2023-05-08",
    salaryMonthlyPkr: 190000,
    cnic: "42101-7777777-7",
    bankAccount: "PK00-BANK-6666666666666",
  },
  {
    id: "EMP-007",
    name: "Zainab Iqbal",
    email: "zainab.iqbal@saylani.com",
    department: "Engineering",
    designation: "Software Engineer",
    role: "employee",
    status: "inactive",
    joinedOn: "2023-01-09",
    salaryMonthlyPkr: 150000,
    cnic: "42101-8888888-8",
    bankAccount: "PK00-BANK-7777777777777",
  },
  {
    id: "EMP-008",
    name: "Ahmed Raza",
    email: "ahmed.raza@saylani.com",
    department: "Sales",
    designation: "Sales Executive",
    role: "employee",
    status: "active",
    joinedOn: "2022-11-05",
    salaryMonthlyPkr: 130000,
    cnic: "42101-9999999-9",
    bankAccount: "PK00-BANK-8888888888888",
  },
  {
    id: "EMP-009",
    name: "Sana Khalid",
    email: "sana.khalid@saylani.com",
    department: "Sales",
    designation: "Sales Manager",
    role: "employee",
    status: "active",
    joinedOn: "2021-07-19",
    salaryMonthlyPkr: 280000,
    cnic: "42101-1212121-2",
    bankAccount: "PK00-BANK-9999999999999",
  },
  {
    id: "EMP-010",
    name: "Hamza Tariq",
    email: "hamza.tariq@saylani.com",
    department: "Sales",
    designation: "Sales Executive",
    role: "employee",
    status: "active",
    joinedOn: "2023-04-03",
    salaryMonthlyPkr: 125000,
    cnic: "42101-1313131-3",
    bankAccount: "PK00-BANK-1010101010101",
  },
  {
    id: "EMP-011",
    name: "Maryam Aslam",
    email: "maryam.aslam@saylani.com",
    department: "Sales",
    designation: "Account Executive",
    role: "employee",
    status: "active",
    joinedOn: "2022-08-22",
    salaryMonthlyPkr: 145000,
    cnic: "42101-1414141-4",
    bankAccount: "PK00-BANK-1111222222223",
  },
  {
    id: "EMP-012",
    name: "Ali Raza",
    email: "ali.raza@saylani.com",
    department: "Sales",
    designation: "Sales Executive",
    role: "employee",
    status: "active",
    joinedOn: "2024-01-15",
    salaryMonthlyPkr: 120000,
    cnic: "42101-1515151-5",
    bankAccount: "PK00-BANK-1212121212122",
  },
  {
    id: "EMP-013",
    name: "Nida Baig",
    email: "nida.baig@saylani.com",
    department: "Sales",
    designation: "Sales Representative",
    role: "employee",
    status: "active",
    joinedOn: "2024-05-27",
    salaryMonthlyPkr: 115000,
    cnic: "42101-1616161-6",
    bankAccount: "PK00-BANK-1313131313133",
  },
  {
    id: "EMP-014",
    name: "Saima Yusuf",
    email: "hr@saylani.com",
    department: "HR",
    designation: "HR Manager",
    role: "hr",
    status: "active",
    joinedOn: "2021-03-01",
    salaryMonthlyPkr: 300000,
    cnic: "42101-1717171-7",
    bankAccount: "PK00-BANK-1414141414144",
  },
  {
    id: "EMP-015",
    name: "Adeel Hassan",
    email: "adeel.hassan@saylani.com",
    department: "HR",
    designation: "HR Generalist",
    role: "employee",
    status: "active",
    joinedOn: "2023-10-02",
    salaryMonthlyPkr: 135000,
    cnic: "42101-1818181-8",
    bankAccount: "PK00-BANK-1515151515155",
  },
  {
    id: "EMP-016",
    name: "Kiran Shah",
    email: "kiran.shah@saylani.com",
    department: "HR",
    designation: "Recruiter",
    role: "employee",
    status: "active",
    joinedOn: "2023-12-11",
    salaryMonthlyPkr: 125000,
    cnic: "42101-1919191-9",
    bankAccount: "PK00-BANK-1616161616166",
  },
];

/**
 * Attendance seed. Two seeded months:
 *  - March 2026 (22 working days)
 *  - October 2026 (working days from Oct 1 up to the latest seeded day, Oct 23)
 * Everyone not listed here is "present" with a 09:00 check-in for those months.
 */
const LATE_BY_EMPLOYEE: Record<string, string[]> = {
  // October 2026: Ahmed Raza is the clear top latecomer (4), then Bilal (3), Hamza (2), Usman (1).
  // March 2026: Bilal Ahmed is the top latecomer (4), then Ahmed Raza (2), Usman (1).
  "EMP-008": [
    "2026-10-02",
    "2026-10-06",
    "2026-10-14",
    "2026-10-20",
    "2026-03-05",
    "2026-03-17",
  ],
  "EMP-002": [
    "2026-10-06",
    "2026-10-13",
    "2026-10-23",
    "2026-03-03",
    "2026-03-12",
    "2026-03-19",
    "2026-03-26",
  ],
  "EMP-010": ["2026-10-09", "2026-10-19"],
  "EMP-004": ["2026-10-01", "2026-03-11"],
};

const ABSENT_BY_EMPLOYEE: Record<string, string[]> = {
  "EMP-002": ["2026-10-08"],
  "EMP-006": ["2026-10-13"],
  "EMP-012": ["2026-10-22"],
  "EMP-005": ["2026-10-15", "2026-03-10"],
  "EMP-010": ["2026-03-30"],
  "EMP-013": ["2026-03-05"],
  "EMP-001": ["2026-03-24"],
};

const LATE_CHECKINS = ["09:22", "09:37", "09:41", "09:55", "10:05", "09:48"];

function buildMonthAttendance(
  year: number,
  month: number,
  days: number[]
): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  const lateCounter: Record<string, number> = {};
  for (const employee of EMPLOYEES) {
    if (employee.status !== "active") continue;
    for (const day of days) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const lates = LATE_BY_EMPLOYEE[employee.id] ?? [];
      const absents = ABSENT_BY_EMPLOYEE[employee.id] ?? [];
      if (lates.includes(date)) {
        lateCounter[employee.id] = (lateCounter[employee.id] ?? 0) + 1;
        records.push({
          employeeId: employee.id,
          date,
          status: "late",
          checkIn: LATE_CHECKINS[lateCounter[employee.id] % LATE_CHECKINS.length],
        });
      } else if (absents.includes(date)) {
        records.push({ employeeId: employee.id, date, status: "absent" });
      }
      // "leave" days are patched in from approved leave requests below.
      else {
        records.push({
          employeeId: employee.id,
          date,
          status: "present",
          checkIn: "09:00",
        });
      }
    }
  }
  return records;
}

const MARCH_2026_WEEKDAYS = [
  2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30,
  31,
];
const OCTOBER_2026_WEEKDAYS = [
  1, 2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23,
];

export const ATTENDANCE_RECORDS: AttendanceRecord[] = [
  ...buildMonthAttendance(2026, 3, MARCH_2026_WEEKDAYS),
  ...buildMonthAttendance(2026, 10, OCTOBER_2026_WEEKDAYS),
];

export const LEAVE_REQUESTS: LeaveRequest[] = [
  {
    id: "LR-1001",
    employeeId: "EMP-001", // Taha: approved sick leave in September (counted against quota)
    type: "sick",
    start: "2026-09-10",
    end: "2026-09-11",
    days: 2,
    status: "approved",
    reason: "Fever and flu",
    appliedOn: "2026-09-09",
  },
  {
    id: "LR-1002",
    employeeId: "EMP-001", // Taha: PENDING sick leave — must NOT reduce his remaining balance
    type: "sick",
    start: "2026-10-29",
    end: "2026-10-30",
    days: 2,
    status: "pending",
    reason: "Migraine, doctor advised rest",
    appliedOn: "2026-10-20",
  },
  {
    id: "LR-1003",
    employeeId: "EMP-001",
    type: "casual",
    start: "2026-03-27",
    end: "2026-03-27",
    days: 1,
    status: "approved",
    reason: "Family event",
    appliedOn: "2026-03-20",
  },
  {
    id: "LR-1004",
    employeeId: "EMP-011", // Maryam: on approved annual leave Oct 22–23 ("On Leave" KPI)
    type: "annual",
    start: "2026-10-22",
    end: "2026-10-23",
    days: 2,
    status: "approved",
    reason: "Family wedding out of city",
    appliedOn: "2026-10-10",
  },
  {
    id: "LR-1005",
    employeeId: "EMP-010", // Hamza: approved casual leave Oct 16
    type: "casual",
    start: "2026-10-16",
    end: "2026-10-16",
    days: 1,
    status: "approved",
    reason: "Personal errand",
    appliedOn: "2026-10-12",
  },
  {
    id: "LR-1006",
    employeeId: "EMP-008", // Ahmed Raza: PENDING casual leave — ready for the HR approve/reject demo
    type: "casual",
    start: "2026-10-27",
    end: "2026-10-28",
    days: 2,
    status: "pending",
    reason: "Family function at home",
    appliedOn: "2026-10-23",
  },
];

// Patch attendance for approved leave days overlapping seeded months.
for (const leave of LEAVE_REQUESTS) {
  if (leave.status !== "approved") continue;
  for (const record of ATTENDANCE_RECORDS) {
    if (
      record.employeeId === leave.employeeId &&
      record.date >= leave.start &&
      record.date <= leave.end
    ) {
      record.status = "leave";
      delete record.checkIn;
    }
  }
}

// ---- Authentication seeds and user management ----------------------------

/** Demo credentials (shown on the login page): admin@saylani.com/Admin@123,
 *  hr@saylani.com/HR@123, taha@saylani.com/Taha@123. Other seeded accounts
 *  have no password until an Admin or HR sets one. */
const SEED_PASSWORD_HASHES: Record<string, string> = {
  "EMP-000":
    "c3d80427074dcea261d8a205d7ed3784:e3ed0e11ea32f70ff7753e4992d69d46e19ed10dc5a4c57ac3644eaf76ad9e5707fcd6d53cbbffa93c29bb9e410c4c6f5abed42071239136b009e56e651aae04",
  "EMP-014":
    "be99150b32abf34aef9aa1279fb8e90e:67b8cffccd9a335382f9083108a57ccc96e6ddc61778567668810a9245b4df7155df67dc6650e50d4d116eaee0c4fbde6c07e7c8a5fcdcd35f7791dd5da0da33",
  "EMP-001":
    "4d542a4596c638429cad0d3b75561bb6:40f194b864301e0d3351c308b8a49bfc63c525ec1fabf581bd99ef9581ade2510e02db84c0133f86a23a737979581ea224deec5ace7f7d1ecbaa2d5917848985",
};

for (const [id, hash] of Object.entries(SEED_PASSWORD_HASHES)) {
  const employee = EMPLOYEES.find((e) => e.id === id);
  if (employee) employee.passwordHash = hash;
}

export interface NewEmployeeInput {
  name: string;
  email: string;
  password: string;
  role: "hr" | "employee";
  department: DepartmentName;
  designation: string;
}

/** Create an active employee (Admin/HR user management). */
export function addEmployee(input: NewEmployeeInput): Employee {
  const nextNumber =
    EMPLOYEES.reduce((max, e) => {
      const n = Number(e.id.split("-")[1]);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1;
  const employee: Employee = {
    id: `EMP-${String(nextNumber).padStart(3, "0")}`,
    name: input.name,
    email: input.email.toLowerCase(),
    department: input.department,
    designation: input.designation,
    role: input.role,
    status: "active",
    joinedOn: new Date().toISOString().slice(0, 10),
    salaryMonthlyPkr: 0,
    cnic: "",
    bankAccount: "",
    passwordHash: hashPassword(input.password),
  };
  EMPLOYEES.push(employee);
  addedEmployees.push(employee);
  persistState();
  return employee;
}

/** Soft-delete: deactivated users cannot log in and their session dies. */
export function setEmployeeStatus(
  id: string,
  status: EmploymentStatus
): Employee | undefined {
  const employee = findEmployeeById(id);
  if (employee) employee.status = status;
  if (!SEED_EMPLOYEE_IDS.has(id)) statusOverrides[id] = status;
  persistState();
  return employee;
}

/** Set a leave request's status (approve/reject) and persist the decision. */
export function setLeaveRequestStatus(
  id: string,
  status: LeaveStatus
): LeaveRequest | undefined {
  const leaveRequest = LEAVE_REQUESTS.find((lr) => lr.id === id);
  if (leaveRequest) leaveRequest.status = status;
  if (!SEED_LEAVE_IDS.has(id)) leaveStatusOverrides[id] = status;
  persistState();
  return leaveRequest;
}

// ---- Persistence: user/leave mutations survive server restarts -----------

const SEED_EMPLOYEE_IDS = new Set(EMPLOYEES.map((e) => e.id));
const SEED_LEAVE_IDS = new Set(LEAVE_REQUESTS.map((lr) => lr.id));

const persisted = loadPersistedState();
const addedEmployees = (persisted?.addedEmployees as Employee[] | undefined) ?? [];
const statusOverrides = (persisted?.statusOverrides as Record<string, string>) ?? {};
const extraLeaves = (persisted?.extraLeaves as LeaveRequest[] | undefined) ?? [];
const leaveStatusOverrides = (persisted?.leaveStatusOverrides as Record<string, string>) ?? {};

for (const employee of addedEmployees) {
  if (!findEmployeeById(employee.id)) EMPLOYEES.push(employee);
}
for (const [id, status] of Object.entries(statusOverrides)) {
  const employee = findEmployeeById(id);
  if (employee) employee.status = status as EmploymentStatus;
}
for (const leave of extraLeaves) {
  if (!LEAVE_REQUESTS.some((lr) => lr.id === leave.id)) LEAVE_REQUESTS.push(leave);
}
for (const [id, status] of Object.entries(leaveStatusOverrides)) {
  const leave = LEAVE_REQUESTS.find((lr) => lr.id === id);
  if (leave) leave.status = status as LeaveStatus;
}

function persistState(): void {
  savePersistedState({ addedEmployees, statusOverrides, extraLeaves, leaveStatusOverrides });
}

// ---- Lookups -------------------------------------------------------------

export function findEmployeeById(id: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.id === id);
}

export function findEmployeeByEmail(email: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.email.toLowerCase() === email.toLowerCase());
}

/** Append-only friendly store for new leave requests made through the app. */
export function addLeaveRequest(request: LeaveRequest): void {
  LEAVE_REQUESTS.push(request);
  extraLeaves.push(request);
  persistState();
}
