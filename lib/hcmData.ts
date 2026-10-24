/**
 * HCM Lite — seed data layer (single source of truth for demo data).
 *
 * All figures live here; services derive every number from this file so the
 * dashboard and the AI tools can never disagree. Sensitive fields (salary,
 * cnic, bank account) exist ONLY in this module and are never returned by any
 * service, tool, or API response.
 */

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
}
