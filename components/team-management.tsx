"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus, Users } from "lucide-react";
import type { Role } from "./types";

interface ManagedUser {
  id: string;
  name: string;
  email: string | null;
  role: Role | "admin";
  department: string;
  designation: string;
  status: string;
  manager_id: string | null;
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  hr: "bg-sky-100 text-sky-700",
  manager: "bg-amber-100 text-amber-700",
  employee: "bg-emerald-100 text-emerald-700",
};

/**
 * Team management (Admin: add/remove HR + Employees; HR: add/remove
 * Employees). Removal is a soft delete — the account can no longer sign in
 * and any active session dies immediately.
 */
export function TeamManagement({ role, selfId }: { role: Role; selfId: string }) {
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "employee" as "employee" | "manager" | "hr",
    department: "Engineering",
    designation: "",
    manager_id: "",
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.status === 401) {
      router.replace("/login");
      return;
    }
    const data = (await res.json()) as { users?: ManagedUser[] };
    setUsers(data.users ?? []);
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; setState after await
    load();
  }, [load]);

  async function addUser() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string; user?: ManagedUser };
      if (!res.ok) {
        setNotice({ tone: "error", text: data.error ?? "Could not create the user." });
        return;
      }
      setNotice({
        tone: "success",
        text: `${data.user?.name} added as ${
          data.user?.role === "hr" ? "HR Manager" : data.user?.role === "manager" ? "Manager" : "Employee"
        } — they can sign in with the password you set.`,
      });
      setForm((f) => ({ ...f, name: "", email: "", password: "", designation: "", manager_id: "" }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(user: ManagedUser) {
    if (!window.confirm(`Remove ${user.name} (${user.email})? They will be signed out immediately.`)) return;
    setNotice(null);
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNotice({ tone: "error", text: data.error ?? "Could not remove the user." });
      return;
    }
    setNotice({ tone: "success", text: `${user.name} has been removed and signed out.` });
    await load();
  }

  const canRemove = (u: ManagedUser) =>
    u.id !== selfId && u.role !== "admin" && (role === "admin" ? u.role === "hr" || u.role === "manager" || u.role === "employee" : u.role === "employee");
  const roleOptions = role === "admin" ? ["employee", "manager", "hr"] : ["employee"];
  const managers = (users ?? []).filter((u) => u.role === "manager" && u.status === "active");

  const inputClass =
    "h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-slate-400" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-900">Team Management</h2>
        <span className="text-xs text-slate-400">
          {role === "admin" ? "Admin: add/remove HR & Employee accounts" : "HR: add/remove Employee accounts"}
        </span>
      </div>

      {notice && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm ring-1 ${
            notice.tone === "error"
              ? "bg-rose-50 text-rose-800 ring-rose-200"
              : "bg-emerald-50 text-emerald-800 ring-emerald-200"
          }`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {/* Add-user form */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Full name"
          aria-label="Full name"
          className={inputClass}
        />
        <input
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="work@saylani.com"
          type="email"
          aria-label="Work email"
          className={inputClass}
        />
        <input
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder="Initial password (min 6 chars)"
          aria-label="Initial password"
          className={inputClass}
        />
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "employee" | "manager" | "hr" }))}
          aria-label="Role"
          className={inputClass}
        >
          {roleOptions.map((r) => (
            <option key={r} value={r}>{r === "hr" ? "HR Manager" : r === "manager" ? "Manager" : "Employee"}</option>
          ))}
        </select>
        <select
          value={form.department}
          onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
          aria-label="Department"
          className={inputClass}
        >
          {["Engineering", "Sales", "HR"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input
          value={form.designation}
          onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
          placeholder="Designation (e.g. Software Engineer)"
          aria-label="Designation"
          className={inputClass}
        />
        <select
          value={form.manager_id}
          onChange={(e) => setForm((f) => ({ ...f, manager_id: e.target.value }))}
          aria-label="Manager (direct reports)"
          className={inputClass}
        >
          <option value="">No manager assigned</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>{m.name} — {m.department}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={addUser}
        disabled={busy || !form.name || !form.email || form.password.length < 6 || !form.designation}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        {busy ? "Adding…" : "Add user"}
      </button>

      {/* User list */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Role</th>
              <th className="py-2 pr-3 font-medium">Department</th>
              <th className="py-2 pr-3 font-medium">Designation</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id} className={`border-b border-slate-50 text-slate-700 ${u.status === "inactive" ? "opacity-50" : ""}`}>
                <td className="py-2 pr-3 font-medium text-slate-800">{u.name}</td>
                <td className="py-2 pr-3 font-mono text-xs text-slate-500">{u.email}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${ROLE_BADGE[u.role] ?? "bg-slate-100"}`}>
                    {u.role}
                  </span>
                </td>
                <td className="py-2 pr-3">{u.department}</td>
                <td className="py-2 pr-3">{u.designation}</td>
                <td className="py-2 pr-3">
                  <span className={`text-xs font-medium ${u.status === "active" ? "text-emerald-600" : "text-rose-500"}`}>
                    {u.status}
                  </span>
                  {u.manager_id && (
                    <span className="ml-1 text-[10px] text-slate-400">
                      → {(users ?? []).find((m) => m.id === u.manager_id)?.name ?? "manager"}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {canRemove(u) && u.status === "active" && (
                    <button
                      type="button"
                      onClick={() => removeUser(u)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users && <p className="py-3 text-sm text-slate-400">Loading users…</p>}
      </div>
    </section>
  );
}
