"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, LogIn, ShieldCheck } from "lucide-react";

const DEMO_ACCOUNTS = [
  { email: "admin@saylani.com", password: "Admin@123", role: "Admin", name: "Ayesha Siddiqui" },
  { email: "hr@saylani.com", password: "HR@123", role: "HR Manager", name: "Saima Yusuf" },
  { email: "bilal.ahmed@saylani.com", password: "Manager@123", role: "Manager (Engineering)", name: "Bilal Ahmed" },
  { email: "taha@saylani.com", password: "Taha@123", role: "Employee", name: "Muhammad Taha" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed. Please try again.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Could not reach the sign-in service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "h-11 w-full rounded-lg border border-slate-200 px-3.5 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md">
            <Building2 className="h-6 w-6 text-white" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">HCM Lite</h1>
          <p className="text-sm text-slate-500">AI Assistant Module (M8) · Sign in to continue</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={signIn} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Work email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@saylani.com"
                autoComplete="username"
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                className={inputClass}
                required
              />
            </label>

            {error && (
              <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" aria-hidden />
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              Demo accounts — click to fill
            </p>
            <div className="mt-2 space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError(null);
                  }}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                  <span>
                    <span className="font-medium text-slate-800">{account.role}</span>
                    <span className="text-slate-400"> · </span>
                    <span className="font-mono text-slate-500">{account.email}</span>
                  </span>
                  <span className="font-mono text-slate-400">{account.password}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">
          Passwords are stored as scrypt hashes. Sessions are HMAC-signed, expire after 7 days,
          and die immediately when an account is removed.
        </p>
      </div>
    </main>
  );
}
