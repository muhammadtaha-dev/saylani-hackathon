-- ============================================================================
-- HCM Lite — Migration 0001: core schema, RLS on every table, auth linking
-- ============================================================================
-- Roles: employee | manager | hr | admin
--   Employee: own rows only.
--   Manager:  own rows + direct reports (profiles.manager_id).
--   HR/Admin: everything.
-- profiles is directory-level (name, department, designation — no pay, no
-- PII) and readable by every authenticated user so the directory search and
-- who-is-off-today tools work; every sensitive table below is strictly
-- scoped by role.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles — linked 1:1 with auth.users via the on_auth_user_created trigger
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null,
  role        text not null check (role in ('employee', 'manager', 'hr', 'admin')),
  manager_id  uuid references public.profiles (id),
  department  text not null default 'General',
  designation text,
  status      text not null default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Directory-level employee data. No compensation or PII beyond name/work email/department.';

create index if not exists profiles_manager_idx on public.profiles (manager_id);
create index if not exists profiles_department_idx on public.profiles (department);

-- Link auth.users -> profiles: every new auth user gets a profile built from
-- their signup metadata (full_name, role, department, designation, manager_id).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, manager_id, department, designation, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case
      when new.raw_user_meta_data ->> 'role' in ('employee', 'manager', 'hr', 'admin')
        then new.raw_user_meta_data ->> 'role'
      else 'employee'
    end,
    (new.raw_user_meta_data ->> 'manager_id')::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'department', ''), 'General'),
    nullif(new.raw_user_meta_data ->> 'designation', ''),
    'active'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync when auth email changes.
create or replace function public.handle_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_sync();

-- ---------------------------------------------------------------------------
-- Shared RLS helper functions (security definer so policies can use them
-- without recursive policy lookups)
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_hr_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('hr', 'admin'), false)
$$;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'manager', false)
$$;

create or replace function public.is_manager_of(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = target and manager_id = auth.uid()
  )
$$;

create or replace function public.is_managed_by(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and manager_id = target
  )
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select status from public.profiles where id = auth.uid()) = 'active', false)
$$;

-- ---------------------------------------------------------------------------
-- leave_types
-- ---------------------------------------------------------------------------
create table if not exists public.leave_types (
  id                  text primary key check (id in ('annual', 'sick', 'casual')),
  label               text not null,
  annual_entitlement  int  not null,
  is_paid             boolean not null default true
);

alter table public.leave_types enable row level security;
drop policy if exists "leave_types readable" on public.leave_types;
create policy "leave_types readable"
  on public.leave_types for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- leave_balances — per employee/type/year entitlement + carry-over.
-- `used_approved` is derived from approved leave_requests at query time.
-- ---------------------------------------------------------------------------
create table if not exists public.leave_balances (
  employee_id   uuid not null references public.profiles (id) on delete cascade,
  leave_type_id text not null references public.leave_types (id),
  year          int  not null,
  entitled      int  not null,
  carried_over  numeric(4, 1) not null default 0,
  primary key (employee_id, leave_type_id, year)
);

alter table public.leave_balances enable row level security;
drop policy if exists "balances read own/manager/hr" on public.leave_balances;
create policy "balances read own/manager/hr"
  on public.leave_balances for select to authenticated
  using (
    employee_id = auth.uid()
    or is_manager_of(employee_id)
    or is_hr_or_admin()
  );
drop policy if exists "balances written by hr" on public.leave_balances;
create policy "balances written by hr"
  on public.leave_balances for all to authenticated
  using (is_hr_or_admin()) with check (is_hr_or_admin());

-- ---------------------------------------------------------------------------
-- holidays (Pakistan public holidays, per year)
-- ---------------------------------------------------------------------------
create table if not exists public.holidays (
  date date primary key,
  name text not null
);

alter table public.holidays enable row level security;
drop policy if exists "holidays readable" on public.holidays;
create policy "holidays readable"
  on public.holidays for select to authenticated using (true);
drop policy if exists "holidays written by hr" on public.holidays;
create policy "holidays written by hr"
  on public.holidays for all to authenticated
  using (is_hr_or_admin()) with check (is_hr_or_admin());

-- ---------------------------------------------------------------------------
-- compensations — salary lives here, NOT in profiles. HR/Admin only, ever.
-- ---------------------------------------------------------------------------
create table if not exists public.compensations (
  employee_id    uuid primary key references public.profiles (id) on delete cascade,
  salary_monthly int not null check (salary_monthly >= 0),
  currency       text not null default 'PKR',
  updated_at     timestamptz not null default now()
);

alter table public.compensations enable row level security;
drop policy if exists "compensation hr/admin only" on public.compensations;
create policy "compensation hr/admin only"
  on public.compensations for select to authenticated using (is_hr_or_admin());
drop policy if exists "compensation written by hr" on public.compensations;
create policy "compensation written by hr"
  on public.compensations for all to authenticated
  using (is_hr_or_admin()) with check (is_hr_or_admin());

-- ---------------------------------------------------------------------------
-- leave_requests — no DELETE policy exists anywhere: leave history is kept.
-- ---------------------------------------------------------------------------
create table if not exists public.leave_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.profiles (id),
  leave_type_id     text not null references public.leave_types (id),
  start_date        date not null,
  end_date          date not null,
  days              numeric(4, 1) not null check (days > 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason            text not null,
  decision_comment  text,
  decided_by        uuid references public.profiles (id),
  decided_at        timestamptz,
  attachment_path   text,
  applied_at        timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists leave_requests_employee_idx on public.leave_requests (employee_id);
create index if not exists leave_requests_status_idx on public.leave_requests (status);
create index if not exists leave_requests_dates_idx on public.leave_requests (start_date, end_date);

alter table public.leave_requests enable row level security;
drop policy if exists "leave read own/manager/hr" on public.leave_requests;
create policy "leave read own/manager/hr"
  on public.leave_requests for select to authenticated
  using (
    employee_id = auth.uid()
    or is_manager_of(employee_id)
    or is_hr_or_admin()
  );
drop policy if exists "leave insert own pending" on public.leave_requests;
create policy "leave insert own pending"
  on public.leave_requests for insert to authenticated
  with check (
    employee_id = auth.uid()
    and status = 'pending'
    and is_active_user()
  );
drop policy if exists "leave update approver or owner-cancel" on public.leave_requests;
create policy "leave update approver or owner-cancel"
  on public.leave_requests for update to authenticated
  using (
    is_hr_or_admin()
    or is_manager_of(employee_id)
    or employee_id = auth.uid()
  )
  with check (
    is_hr_or_admin()
    or is_manager_of(employee_id)
    or employee_id = auth.uid()
  );
-- No DELETE policy: deletes are impossible via the API for every role.

-- Guard trigger: an owner may ONLY flip status to 'cancelled' (and only from
-- pending/approved). Substance (dates, type, employee) can never be edited;
-- decision fields can only be set by HR/Admin or the employee's manager.
create or replace function public.leave_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role (seed scripts / server jobs)
  end if;

  if new.employee_id <> old.employee_id
     or new.leave_type_id <> old.leave_type_id
     or new.start_date <> old.start_date
     or new.end_date <> old.end_date
     or coalesce(new.days, 0) <> coalesce(old.days, 0) then
    raise exception 'leave requests cannot be edited after submission';
  end if;

  if auth.uid() = old.employee_id
     and not is_hr_or_admin()
     and not is_manager_of(old.employee_id) then
    if new.status = 'cancelled'
       and old.status in ('pending', 'approved')
       and new.decided_by is not distinct from old.decided_by then
      return new;
    end if;
    raise exception 'you can only cancel your own pending or future leave';
  end if;

  if new.status in ('approved', 'rejected', 'cancelled')
     and new.status <> old.status
     and not (is_hr_or_admin() or is_manager_of(old.employee_id)) then
    raise exception 'only HR/Admin or the employee''s manager can decide leave requests';
  end if;

  return new;
end;
$$;

drop trigger if exists leave_requests_guard_trigger on public.leave_requests;
create trigger leave_requests_guard_trigger
  before update on public.leave_requests
  for each row execute function public.leave_requests_guard();

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  status      text not null check (status in ('present', 'late', 'absent', 'leave', 'half_day')),
  check_in    timestamptz,
  check_out   timestamptz,
  unique (employee_id, date)
);

create index if not exists attendance_date_idx on public.attendance (date);
create index if not exists attendance_employee_idx on public.attendance (employee_id);

alter table public.attendance enable row level security;
drop policy if exists "attendance read own/manager/hr" on public.attendance;
create policy "attendance read own/manager/hr"
  on public.attendance for select to authenticated
  using (
    employee_id = auth.uid()
    or is_manager_of(employee_id)
    or is_hr_or_admin()
  );
drop policy if exists "attendance written by hr" on public.attendance;
create policy "attendance written by hr"
  on public.attendance for all to authenticated
  using (is_hr_or_admin() or is_manager_of(employee_id))
  with check (is_hr_or_admin() or is_manager_of(employee_id));

-- ---------------------------------------------------------------------------
-- notifications — Realtime-enabled (see migration 0003)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text,
  type       text not null default 'info',
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications inserted by hr/manager" on public.notifications;
create policy "notifications inserted by hr/manager"
  on public.notifications for insert to authenticated
  with check (
    is_hr_or_admin()
    or is_manager_of(user_id)      -- approver notifies the employee
    or is_managed_by(user_id)      -- applicant notifies their manager
    or user_id = auth.uid()
  );
-- No DELETE policy.

-- ---------------------------------------------------------------------------
-- chat_messages — per-user assistant history, append-only
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  tools_used      text[],
  refused         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists chat_messages_conv_idx
  on public.chat_messages (user_id, conversation_id, created_at);

alter table public.chat_messages enable row level security;
drop policy if exists "chat read own" on public.chat_messages;
create policy "chat read own"
  on public.chat_messages for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "chat insert own" on public.chat_messages;
create policy "chat insert own"
  on public.chat_messages for insert to authenticated
  with check (user_id = auth.uid());
-- No UPDATE or DELETE policies: history is append-only.
