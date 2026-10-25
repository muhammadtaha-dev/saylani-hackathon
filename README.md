# HCM Lite — AI Assistant Module (M8)

An AI-assisted Human Capital Management system for **Admin, HR, Manager and
Employees**, built on Next.js 16 (App Router), TypeScript, Tailwind CSS 4 and
**Supabase (Postgres) as the single source of truth** — Row Level Security on
every table, Supabase Auth, Storage for leave attachments and Realtime for
notifications.

The AI assistant **explains and assists**; it is never an authority. The
database is the only source of truth, the shared permission layer is the only
source of permission, and the human is the only source of consent.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # zero TypeScript/lint errors, production build
npm test           # unit tests (balance arithmetic, permissions, smart leave)
npm run e2e        # end-to-end tests against a running, seeded server
```

### Supabase setup (required)

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migrations **in order**:
   `supabase/migrations/0001_schema_rls.sql`,
   `0002_audit_log.sql`, `0003_rpcs_realtime_storage.sql`.
3. Copy `.env.example` to `.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
4. Seed demo data: `node scripts/seed-supabase.mjs` (service role key; run
   locally, never on Vercel).
5. Restart the app. Until the env vars exist the app shows a **setup screen**
   instead of failing silently.

### Demo credentials

| Email                      | Password    | Role      | Notes                          |
| -------------------------- | ----------- | --------- | ------------------------------ |
| `admin@saylani.com`        | `Admin@123` | Admin     | org-wide + user management     |
| `hr@saylani.com`           | `HR@123`    | HR        | org-wide + user management     |
| `bilal.ahmed@saylani.com`  | `Manager@123` | Manager | Engineering team (direct reports) |
| `sana.khalid@saylani.com`  | `Manager@123` | Manager | Sales team (direct reports)    |
| `taha@saylani.com`         | `Taha@123`  | Employee  | reports to Bilal Ahmed         |
| …more employees            | `Taha@123`  | Employee  | seeded for realistic dashboards |

## Data model & Row Level Security

Migrations create: `profiles` (id, full_name, role, manager_id, department,
designation, status — linked to `auth.users` by the
`on_auth_user_created` trigger), `leave_types`, `leave_balances`,
`leave_requests`, `holidays`, `compensations`, `attendance`,
`notifications`, `chat_messages`, `audit_log`.

RLS is **enabled on every table**:

| Table | Employee | Manager | HR/Admin |
| --- | --- | --- | --- |
| `profiles` (directory-level: name/dept/designation — no pay, no PII) | read | read | read |
| `leave_requests`, `attendance`, `leave_balances` | own rows | own + direct reports | all |
| `compensations` (salaries) | — | — | read/write |
| `notifications` | own rows | own rows | own rows (write for HR/manager-of) |
| `chat_messages` | own rows | own rows | own rows |
| `audit_log` | own actor rows | own actor rows | all |

Plus explicit `REVOKE`s and trigger guards:

- `leave_requests` cannot be **edited** after submission; an owner can only
  flip status to `cancelled` (guard trigger); managers may decide their
  reports' pending requests; there is **no DELETE policy**.
- `audit_log` is **INSERT-only at the database level**: INSERT/UPDATE/DELETE
  are revoked from `anon`/`authenticated`, have no RLS policies, and row +
  statement triggers raise on any UPDATE/DELETE/TRUNCATE — even for the
  service role. A BEFORE INSERT trigger serialises appends under an advisory
  lock, assigns `seq`, links `prev_hash` to the previous row and stores
  `hash = sha256(...)`; `verify_audit_chain()` recomputes the chain for the
  UI's **Verify integrity** button. Writes go through the service-role client
  **server-side only**.
- Storage bucket `leave-attachments` (private, 5 MB): users read/write only
  their own folder `<auth.uid>/...`; HR/Admin can read everything.
- RPCs `on_leave_today()` and `team_overlap(start, end)` (SECURITY DEFINER,
  directory-level columns only) are the controlled exception that keeps
  "who is off today" and overlap warnings available to every role.

## AI assistant (grounded, permission-checked, labelled)

- 9 tools (headcount, attendance, latecomers, leave summary, own balance,
  payroll aggregates, directory search, who-is-off-today, pending approvals)
  executed **with the caller's JWT** — RLS applies, never the service role.
- Pre-model guard refuses individual-salary/PII questions and prompt
  injections in English **and Urdu**; every call and every denial is
  appended to `audit_log`.
- `gemini-2.5-flash` tool-calling with a 15 s timeout; **no key → grounded
  mock** answers from the same tools. Provider failures fall back and are
  logged server-side.
- Replies in the user's language (English / Urdu script / Roman Urdu).
- Role-scoped quick chips, DB-backed chat history per user (`chat_messages`),
  New chat, Retry, source line (tools + date) and the mandatory
  **AI-generated** label.

## Smart Leave

Plain language → AI pre-filled form → user confirms through the validated
endpoint. Validation: past dates, order, weekends, **public holidays from the
DB**, overlap, balance; team-overlap warnings and a plain-language approval
outlook. Employees can cancel pending (any time) or approved-future leave;
managers approve their reports' requests; rejections require a comment.
Optional supporting documents upload to Supabase Storage. Submissions and
decisions fire **Realtime notifications** to the affected users.

## Architecture

```
Browser (app/page.tsx + components/*)
  │  fetches ONLY internal routes; Supabase JS (anon key) only for
  │  Realtime notifications + attachment uploads (own storage folder)
  ▼
middleware.ts ── session refresh + route protection
  ▼
API routes (app/api/**) ── session identity, rate limit, input limits, guard
  │
  ├─ lib/supabase/server.ts  user-scoped client (JWT → RLS) + admin client
  ├─ lib/permissions.ts      role × tool × arguments matrix + pre-model guard
  ├─ lib/services.ts         THE single source of truth (async, RLS-aware)
  ├─ lib/tools.ts            9-tool registry, strict zod schemas, audit rows
  ├─ lib/audit.ts            audit_log writer (service role, server-only)
  ├─ lib/gemini.ts           Gemini client, 15s timeout, key from env only
  ├─ lib/mockAssistant.ts    grounded deterministic fallback (EN + UR)
  ├─ lib/smartLeave.ts       relative-date resolution + spec-ordered validation
  ├─ lib/rateLimit.ts        20 requests / user / hour (HTTP 429)
  └─ lib/auth.ts             login throttle (8 fails → 15-minute lock)
```

## Tests

- `npm test` — 32 unit tests: balance arithmetic (approved-only consumption,
  carry-over), the full permission matrix incl. the manager role, guard
  refusals (EN/UR/injection), smart-leave validation and relative dates.
- `npm run e2e` — 46 HTTP-level checks against a running, seeded server:
  auth for all roles, wrong-role enforcement on every endpoint, leave
  apply/approve/reject/cancel, AI guards, audit scoping + CSV + hash-chain
  verification, rate limiting. Skips with a clear message when Supabase is
  not configured.

## Known limitations

- Islamic holiday dates are expected/announced values, moon-sighting
  dependent — update `public.holidays` yearly (seed source:
  `lib/pk-holidays-2026.json`).
- Rate limiting and the in-flight Gemini tool loop are per-server-instance
  in memory; everything else is in Postgres.
- Login lockouts are per-instance memory (documented demo trade-off).
- The AI writes nothing: `leave_requests` INSERTs only happen through the
  user-confirmed standard endpoint (RLS + guard trigger).

## Deploy on Vercel

Push to the connected repository and set **all six** environment variables
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, optional `GEMINI_API_KEY`) in the Vercel project.
Run the migrations and the seed script once against the Supabase project.
Until the env vars exist the deployment shows the setup screen instead of
leaking errors.
