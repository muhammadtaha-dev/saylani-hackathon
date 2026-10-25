/**
 * HCM Lite — grounded mock assistant (Constitution Art. I.6, Art. VIII).
 *
 * Used when no provider key is configured or the provider fails. It is a
 * deterministic intent planner that answers ONLY from tool results through
 * the same executor and permission layer as the real model — so refusals,
 * scope and parity behave identically. It never fabricates figures.
 */

import { EMPLOYEES } from "./hcmData";
import { GENERIC_REFUSAL, INJECTION_REFUSAL, SALARY_REFUSAL } from "./permissions";
import type { SessionIdentity } from "./permissions";
import { executeTool } from "./tools";
import { POLICY_FALLBACK } from "./prompt";
import { todayIso } from "./services";
import type { AiFeature } from "./aiLogs";

export interface MockAnswer {
  answer: string;
  toolsUsed: string[];
  feature: AiFeature;
  provider: "mock";
  /** True when the reply is a privacy/permission refusal (for the audit log). */
  refused?: boolean;
}

function pkr(amount: number): string {
  return `PKR ${amount.toLocaleString("en-US")}`;
}

function detectDepartment(text: string): string | undefined {
  if (/\bengineering\b|\beng\b/i.test(text)) return "Engineering";
  if (/\bsales\b/i.test(text)) return "Sales";
  if (/\bhr\b|human resources/i.test(text)) return "HR";
  return undefined;
}

function detectPeriod(text: string): string {
  if (/last month/i.test(text)) return "last_month";
  if (/this year|ytd/i.test(text)) return "this_year";
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{4})\b/i.exec(text);
  if (named) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.indexOf(named[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return `${named[2]}-${String(monthIndex + 1).padStart(2, "0")}`;
  }
  return "this_month";
}

function detectLeaveType(text: string): string | undefined {
  if (/\bsick\b|\billness\b/i.test(text)) return "sick";
  if (/\bannual\b|\bvacation\b/i.test(text)) return "annual";
  if (/\bcasual\b/i.test(text)) return "casual";
  return undefined;
}

const INTRO =
  "Hello! I'm the HCM Lite assistant. I can answer questions about headcount, attendance, late arrivals, leave summaries and payroll aggregates (as your role allows), tell you your own leave balance, who is off today, and help you apply for leave from the Smart Leave section. What would you like to know?";

const INTRO_URDU =
  "السلام علیکم! میں HCM Lite اسسٹنٹ ہوں۔ میں حاضری، تاخیر، چھٹی کا بیلنس، آج چھٹی پر کون ہے، اور (اپنی اجازت کے مطابق) مجموعی رپورٹس کے بارے میں بتا سکتا ہوں۔ بتائیں کیا جاننا چاہیں گے؟";

const FALLBACK_CAPABILITIES =
  "I can help with headcount, attendance rates, late arrivals, leave summaries, who is off today, your own leave balance and payroll aggregates. For anything else, please check with HR.";

const FALLBACK_CAPABILITIES_URDU =
  "میں حاضری، چھٹی کا بیلنس، آج چھٹی پر کون ہے، تاخیر اور (اجازت کے مطابق) پے رول کے مجموعی اعداد و شمار میں مدد کر سکتا ہوں۔ باقی معلومات کے لیے براہِ کرم HR سے رابطہ کریں۔";

const REFUSAL_SCOPE_URDU =
  "معذرت، یہ معلومات دینے کا میں مجاز نہیں ہوں۔ براہِ کرم HR سے رابطہ کریں۔";

const SALARY_REFUSAL_URDU =
  "معذرت، میں دوسرے ملازمین کی تنخواہ کی معلومات دینے کا مجاز نہیں ہوں۔ انفرادی تنخواہیں خفیہ ہیں؛ کسی خاص معلومات کے لیے براہِ کرم HR سے رابطہ کریں۔";

const TYPE_LABELS_URDU: Record<string, string> = {
  annual: "سالانہ",
  sick: "بیماری",
  casual: "معمول کی",
};

/** Urdu-script or Roman-Urdu input? Drives the mock's reply language. */
export function isUrdu(text: string): boolean {
  if (/[\u0600-\u06FF]/.test(text)) return true;
  return /(chh?utt?i|chh?uttee|mujhe|meri\s|mera\s|kitn|batao|batayen|tanq?w|tankhw|balens)/i.test(text);
}

/**
 * Refusal message for a pre-model guard hit, in the user's language
 * (exported so the chat route can refuse in Urdu without reaching a tool).
 */
export function guardRefusalMessage(kind: "salary" | "injection" | "sensitive_pii", message: string): string {
  if (isUrdu(message)) {
    return kind === "salary" ? SALARY_REFUSAL_URDU : REFUSAL_SCOPE_URDU;
  }
  if (kind === "salary") return SALARY_REFUSAL;
  if (kind === "injection") return INJECTION_REFUSAL;
  return GENERIC_REFUSAL;
}

function formatForbidden(urdu: boolean): string {
  return urdu ? REFUSAL_SCOPE_URDU : "I'm not authorized to share that information. Please check with HR.";
}

function mentionsAnotherEmployee(message: string, session: SessionIdentity): boolean {
  const self = EMPLOYEES.find((e) => e.id === session.userId);
  const selfFirst = self?.name.split(" ")[0].toLowerCase();
  return EMPLOYEES.some((e) => {
    if (e.id === session.userId) return false;
    const first = e.name.split(" ")[0].toLowerCase();
    if (first.length < 3) return false;
    if (first === selfFirst) return false;
    return new RegExp(`\\b${first}\\b`, "i").test(message);
  });
}

export async function runMockAssistant(
  message: string,
  session: SessionIdentity
): Promise<MockAnswer> {
  const toolsUsed: string[] = [];
  const period = detectPeriod(message);
  const department = detectDepartment(message) as "Engineering" | "Sales" | "HR" | undefined;
  const lower = message.toLowerCase();
  const urdu = isUrdu(message);

  const featureFor = (): AiFeature =>
    /(policy|maternity|probation|allowance|bonus|gratuity|overtime|reimburse|insurance|wfh|work from home|notice period|resign)/i.test(
      message
    )
      ? "policy"
      : "chat";

  // 0. Who is off today (directory-level "who is away" question).
  if (/\b(off today|on leave today|who('s| is| are)?\s+off|away today|out today|leave today)\b/i.test(message) || /چھٹی پر کون|آج.*چھٹی/.test(message)) {
    toolsUsed.push("get_on_leave_today");
    const envelope = await executeTool("get_on_leave_today", {}, session, { feature: featureFor() });
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    if (envelope.status === "not_found") {
      return {
        answer: urdu
          ? "آج کسی کو منظور شدہ چھٹی پر نہیں ہے۔"
          : "No one is on approved leave today.",
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
    const data = envelope.data! as { date: string; on_leave: { name: string; department: string; type: string; start: string; end: string }[]; count: number };
    if (urdu) {
      const lines = data.on_leave.map(
        (r) => `• ${r.name} (${r.department}) — ${TYPE_LABELS_URDU[r.type] ?? r.type} چھٹی، ${r.start} تا ${r.end}`
      );
      return {
        answer: `آج (${data.date}) چھٹی پر ${data.count} فرد ہیں:\n${lines.join("\n")}`,
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
    const lines = data.on_leave.map(
      (r) => `• ${r.name} (${r.department}) — ${r.type} leave, ${r.start} → ${r.end}`
    );
    return {
      answer: `On ${data.date}, ${data.count} ${data.count === 1 ? "person is" : "people are"} on approved leave:\n${lines.join("\n")}`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 0b. Pending approval queue (Admin/HR tool; employees get a logged refusal).
  if ((/\bpending\b/i.test(message) && /\b(approval|approvals|approve|request|requests|leave)\b/i.test(message)) || /زیرِ التوا|زیر التوا/.test(message)) {
    toolsUsed.push("get_pending_leave_requests");
    const envelope = await executeTool("get_pending_leave_requests", {}, session, { feature: featureFor() });
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    if (envelope.status === "not_found") {
      return {
        answer: urdu
          ? "ابھی کوئی چھٹی کی درخواست زیرِ التوا نہیں ہے۔"
          : "There are no leave requests waiting for approval right now.",
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
    const data = envelope.data! as { pending: { employee_name: string; type: string; start: string; end: string; days: number }[]; count: number };
    const lines = data.pending.map(
      (r) => `• ${r.employee_name} — ${r.type}, ${r.start} → ${r.end} (${r.days} day${r.days === 1 ? "" : "s"})`
    );
    return {
      answer: urdu
        ? `${data.count} درخواستیں زیرِ التوا ہیں:\n${lines.join("\n")}`
        : `${data.count} leave ${data.count === 1 ? "request is" : "requests are"} pending approval:\n${lines.join("\n")}`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 0c. Another person's leave/attendance record — refused for employees
  // with a clear explanation and who to contact (Checklist C.9). HR/Admin
  // may ask about others; their question flows to the normal intents.
  if (
    session.role === "employee" &&
    mentionsAnotherEmployee(message, session) &&
    /\b(leave|balance|attendance|absent|late|off|present|salary|salaries)\b/i.test(message)
  ) {
    return {
      answer: urdu
        ? "میں کسی دوسرے ملازم کی چھٹی یا حاضری کی انفرادی معلومات شیئر نہیں کر سکتا۔ ایسی معلومات کے لیے براہِ کرم HR سے رابطہ کریں۔"
        : "I can only share leave and attendance information for your own record — an individual colleague's details are confidential. For anything about another employee, please contact HR.",
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
      refused: true,
    };
  }

  // 1. Late comers ranking.
  if (/\blate\b|\blatecomer|\btard/i.test(message) && /who|most|often|frequent|rank|top|list/i.test(lower)) {
    toolsUsed.push("get_late_comers");
    const envelope = await executeTool("get_late_comers", { department, period, limit: 5 }, session, {
      feature: "chat",
    });
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    if (envelope.status === "not_found") {
      return { answer: "No late arrivals were recorded for that period.", toolsUsed, feature: featureFor(), provider: "mock" };
    }
    const data = envelope.data!;
    const ranking = data.ranking as { name: string; department: string; late_count: number }[];
    const lines = ranking
      .map((r, i) => `${i + 1}. ${r.name} (${r.department}) — ${r.late_count} late arrival${r.late_count === 1 ? "" : "s"}`);
    return {
      answer: `In ${data.period}, with late defined as check-in after ${data.late_cutoff}, the most frequent latecomers were:\n${lines.join("\n")}`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 2. Own leave balance.
  if (
    (/\b(my|do i have|i have left|remaining|left|entitle)/i.test(message) &&
      /\b(leave|leaves|balance|days?|entitlement|off)\b/i.test(message)) ||
    /(میری|میرا|بیلنس)/.test(message)
  ) {
    toolsUsed.push("get_my_leave_balance");
    const type = detectLeaveType(message);
    const envelope = await executeTool(
      "get_my_leave_balance",
      { ...(type ? { type } : {}), year: Number(todayIso().slice(0, 4)) },
      session,
      { feature: "chat" }
    );
    const data = envelope.data!;
    const balances = data.balances as { type: string; entitled: number; used_approved: number; pending: number; remaining: number }[];
    const year = data.year;
    if (type && balances.length === 1) {
      const b = balances[0];
      if (urdu) {
        return {
          answer: `${year} میں آپ کے پاس ${TYPE_LABELS_URDU[b.type] ?? b.type} چھٹی کے ${b.remaining} دن باقی ہیں (${b.entitled} میں سے ${b.used_approved} منظور شدہ استعمال ہوئے)۔ زیرِ التوا درخواستیں (${b.pending} دن) منظوری تک شمار نہیں ہوتیں۔`,
          toolsUsed,
          feature: featureFor(),
          provider: "mock",
        };
      }
      return {
        answer: `You have ${b.remaining} ${b.type} leave day${b.remaining === 1 ? "" : "s"} left in ${year} (${b.entitled} entitled − ${b.used_approved} approved used). Pending requests (${b.pending} day${b.pending === 1 ? "" : "s"}) are excluded until approved.`,
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
    if (urdu) {
      const linesUrdu = balances.map(
        (b) => `• ${TYPE_LABELS_URDU[b.type] ?? b.type}: ${b.entitled} میں سے ${b.remaining} باقی (${b.used_approved} منظور شدہ استعمال شدہ، ${b.pending} زیرِ التوا — شمار نہیں)`
      );
      return {
        answer: `${year} کے لیے آپ کا چھٹی بیلنس (صرف منظور شدہ چھٹیاں کوٹہ استعمال کرتی ہیں):\n${linesUrdu.join("\n")}`,
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
    const lines = balances.map(
      (b) => `• ${b.type.charAt(0).toUpperCase() + b.type.slice(1)}: ${b.remaining} of ${b.entitled} remaining (${b.used_approved} approved used, ${b.pending} pending — excluded)`
    );
    return {
      answer: `Your leave balances for ${year} (approved leaves only consume quota):\n${lines.join("\n")}`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 3. Attendance rate / attendance summary.
  if (/\battendance\b|\bpresent rate\b|\babsent rate\b/i.test(message)) {
    const selfOnly = session.role === "employee" && (!/\bmy\b/i.test(message) || mentionsAnotherEmployee(message, session));
    if (selfOnly) {
      return {
        answer: "I can only share attendance information for your own record. Please ask HR for anything beyond that.",
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
    toolsUsed.push("get_attendance_summary");
    const envelope = await executeTool("get_attendance_summary", { department, period }, session, { feature: "chat" });
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    if (envelope.status === "not_found") {
      return { answer: "No attendance records were found for that period.", toolsUsed, feature: featureFor(), provider: "mock" };
    }
    const data = envelope.data as {
      period: string;
      working_days: number;
      present: number;
      late: number;
      absent: number;
      attendance_rate: number;
    };
    const own = typeof envelope.meta.note === "string" && envelope.meta.note.includes("own attendance");
    const scope = department ? department : "the whole company";
    const prefix = own ? "Your attendance" : `The attendance rate for ${scope}`;
    return {
      answer: `${prefix} in ${data.period}: ${data.attendance_rate}% over ${data.working_days} recorded working days (${data.present} present + ${data.late} late of ${data.present + data.late + data.absent} attended days, ${data.absent} absent; approved leave days excluded).`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 4. Payroll aggregates.
  if (/\bpayroll\b|\bsalary cost\b|\bsalary total\b|\baverage salary\b|\btotal .*cost\b/i.test(message)) {
    toolsUsed.push("get_payroll_summary");
    const envelope = await executeTool("get_payroll_summary", { department, period }, session, { feature: "chat" });
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    const data = envelope.data as { period: string; headcount: number; total: number; average: number };
    return {
      answer: `Payroll for ${data.period}: ${data.headcount} active employees${department ? ` in ${department}` : ""}, total ${pkr(data.total)} per month, average ${pkr(data.average)}. Individual salaries are never disclosed.`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 5. Leave summary (org-wide aggregates).
  if (/\bleaves?\b/i.test(message) && /how many|summary|approved|pending|rejected|taken|overview/i.test(lower) && !/\bmy\b/i.test(message)) {
    toolsUsed.push("get_leave_summary");
    const type = detectLeaveType(message);
    const envelope = await executeTool(
      "get_leave_summary",
      { department, period, ...(type ? { type } : {}) },
      session,
      { feature: "chat" }
    );
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    const data = envelope.data!;
    const byType = data.by_type_and_status as Record<string, Record<string, { requests: number; days: number }>>;
    const lines: string[] = [];
    for (const [type2, statuses] of Object.entries(byType)) {
      const parts = Object.entries(statuses)
        .filter(([, v]) => v.requests > 0)
        .map(([status, v]) => `${v.requests} ${status} (${v.days} day${v.days === 1 ? "" : "s"})`);
      lines.push(`• ${type2.charAt(0).toUpperCase() + type2.slice(1)}: ${parts.length ? parts.join(", ") : "no requests"}`);
    }
    return {
      answer: `Leave requests for ${data.period}${department ? ` in ${department}` : ""}:\n${lines.join("\n")}`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 6. Headcount.
  if (/\bhow many\b|\bheadcount\b|\bnumber of\b|\bcount\b/i.test(message) && /\bemployee|people|staff|worker|member/i.test(lower)) {
    toolsUsed.push("get_headcount");
    const status = /\binactive\b|\bleft\b|\bex-?employee/i.test(lower) ? "inactive" : /\ball\b/.test(lower) ? "all" : "active";
    const envelope = await executeTool("get_headcount", { department, status }, session, { feature: "chat" });
    if (envelope.status === "forbidden") return { answer: formatForbidden(urdu), toolsUsed, feature: featureFor(), provider: "mock" };
    const data = envelope.data!;
    const scope = data.department === "All departments" ? "across all departments" : `in ${data.department}`;
    return {
      answer: `There ${data.count === 1 ? "is" : "are"} ${data.count} ${status} employee${data.count === 1 ? "" : "s"} ${scope} (as of ${data.as_of}).`,
      toolsUsed,
      feature: featureFor(),
      provider: "mock",
    };
  }

  // 7. Directory search / who-is.
  const cleaned = message.trim().replace(/[?.!,]+$/, "");
  const whoMatch =
    /^(?:who\s+is|who's|who\s+are|find|search(?:\s+for)?|tell\s+me\s+about|details?\s+(?:of|for)|info(?:rmation)?\s+(?:about|on))\s+(.+)$/i.exec(
      cleaned
    );
  const bareName = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/.exec(cleaned);
  if (whoMatch || (/\bfind\b|\bsearch\b/i.test(message) && bareName)) {
    const query = (whoMatch?.[1] ?? bareName?.[1] ?? "").trim();
    if (query) {
      toolsUsed.push("search_employees");
      const envelope = await executeTool("search_employees", { query, department }, session, { feature: "chat" });
      if (envelope.status === "not_found") {
        return { answer: `I couldn't find anyone matching "${query}".`, toolsUsed, feature: featureFor(), provider: "mock" };
      }
      const matches = (envelope.data!.matches ?? []) as { name: string; department: string; designation: string }[];
      if (envelope.status === "ambiguous") {
        const list = matches.map((m) => `• ${m.name} — ${m.designation}, ${m.department}`).join("\n");
        return {
          answer: `More than one employee matches "${query}":\n${list}\nWhich one did you mean?`,
          toolsUsed,
          feature: featureFor(),
          provider: "mock",
        };
      }
      const m = matches[0];
      return {
        answer: `${m.name} is a ${m.designation} in the ${m.department} department. (Directory information only — personal details are not disclosed.)`,
        toolsUsed,
        feature: featureFor(),
        provider: "mock",
      };
    }
  }

  // 8. Leave application intent in chat → point to Smart Leave.
  if (/\b(apply|need|take|want|request)\b.*\b(leave|off|day|days)\b/i.test(message)) {
    return {
      answer:
        "I can help you apply for leave from the Smart Leave section: describe your leave in plain words there, review the pre-filled form, then press Confirm & Submit. Nothing is submitted without your confirmation.",
      toolsUsed,
      feature: "chat",
      provider: "mock",
    };
  }

  // 9. Policy questions not covered by Section 3.
  if (featureFor() === "policy") {
    return {
      answer: urdu
        ? "مجھے اس پالیسی کی معلومات نہیں ہیں۔ براہِ کرم HR سے رابطہ کریں۔"
        : POLICY_FALLBACK,
      toolsUsed,
      feature: "policy",
      provider: "mock",
    };
  }

  // 10. Greetings / anything else.
  if (/^(hi|hello|hey|salam|assalam)/i.test(lower) || /\bhelp\b|what can you/i.test(lower) || /^(السلام|سلام|ہیلو|ہائے)/.test(message)) {
    return { answer: urdu ? INTRO_URDU : INTRO, toolsUsed, feature: "chat", provider: "mock" };
  }

  return {
    answer: urdu ? FALLBACK_CAPABILITIES_URDU : FALLBACK_CAPABILITIES,
    toolsUsed,
    feature: "chat",
    provider: "mock",
  };
}
