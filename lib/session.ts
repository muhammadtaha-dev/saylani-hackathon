/**
 * HCM Lite — server-side session identity (Art. III.2).
 *
 * Identity is derived ONLY from the signed session cookie and looked up in
 * the data layer. No code path may read user_id/role/scope from the request
 * body or from model output. This is a demo session manager for the
 * hackathon: a production build would swap this for the real auth provider
 * while keeping the same SessionIdentity contract.
 */

import { createHmac } from "crypto";
import { cookies } from "next/headers";
import { findEmployeeById } from "./hcmData";
import type { SessionIdentity } from "./permissions";

export const SESSION_COOKIE = "hcm_session";
const SECRET = process.env.SESSION_SECRET ?? "hcm-lite-demo-signing-secret";

function sign(userId: string): string {
  return createHmac("sha256", SECRET).update(userId).digest("hex").slice(0, 32);
}

export function sessionCookieValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function sessionSetCookie(userId: string): string {
  return `${SESSION_COOKIE}=${sessionCookieValue(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export async function getSession(): Promise<SessionIdentity | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;
  const userId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (sign(userId) !== signature) return null;
  const user = findEmployeeById(userId);
  if (!user || user.status !== "active") return null;
  return {
    userId: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
  };
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  designation: string;
}

/** The three demo accounts shown in the role switcher (public info only). */
export const DEMO_USERS: PublicUser[] = [
  {
    id: "EMP-000",
    name: "Ayesha Siddiqui",
    email: "admin@saylani.com",
    role: "admin",
    department: "All departments",
    designation: "System Administrator",
  },
  {
    id: "EMP-014",
    name: "Saima Yusuf",
    email: "hr@saylani.com",
    role: "hr",
    department: "All departments",
    designation: "HR Manager",
  },
  {
    id: "EMP-001",
    name: "Muhammad Taha",
    email: "taha@saylani.com",
    role: "employee",
    department: "Engineering",
    designation: "Software Engineer",
  },
];
