-- ============================================================================
-- HCM Lite — Migration 0002: append-only, hash-chained audit_log
-- ============================================================================
-- * INSERT only: RLS has NO insert/update/delete policy for anon or
--   authenticated; INSERT/UPDATE/DELETE are revoked from both; statement and
--   row triggers raise on any UPDATE/DELETE/TRUNCATE — even for the table
--   owner and the service role.
-- * Every row is hash-chained: a BEFORE INSERT trigger serialises appends
--   with an advisory lock, assigns the next seq, links prev_hash to the
--   previous row's hash and computes hash = sha256(canonical fields).
--   verify_audit_chain() recomputes the chain and reports the first break.
-- * Writes happen ONLY from the server with the service role key.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  seq         int not null,
  ts          timestamptz not null default now(),
  actor_id    text not null default 'system',
  actor_name  text not null default 'system',
  actor_role  text not null default 'system',
  action      text not null,
  target_type text not null default 'system',
  target_id   text not null default '',
  ip          text not null default 'unknown',
  before      jsonb,
  after       jsonb,
  details     jsonb,
  prev_hash   text not null default 'GENESIS',
  hash        text not null default '',
  unique (seq)
);

create index if not exists audit_log_ts_idx on public.audit_log (ts desc);
create index if not exists audit_log_action_idx on public.audit_log (action);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);

alter table public.audit_log enable row level security;

-- Read: HR/Admin see everything; every authenticated user sees their own
-- actor rows (Checklist E.23). No other policies exist on purpose.
drop policy if exists "audit read hr/admin or own" on public.audit_log;
create policy "audit read hr/admin or own"
  on public.audit_log for select to authenticated
  using (is_hr_or_admin() or actor_id = auth.uid()::text);

-- Writes are server-only (service role bypasses RLS). Lock the API down:
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hash chain: seq + prev_hash + hash are assigned by the trigger; the client
-- supplies none of them.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  last_row record;
begin
  -- Serialise appends so concurrent writers cannot fork the chain.
  perform pg_advisory_xact_lock(hashtextextended('public.audit_log', 0));

  select seq, hash into last_row
  from public.audit_log
  order by seq desc
  limit 1;

  new.seq := coalesce(last_row.seq, 0) + 1;
  new.prev_hash := coalesce(last_row.hash, 'GENESIS');
  new.hash := encode(
    digest(
      concat_ws('|',
        new.prev_hash,
        new.seq,
        new.ts,
        new.actor_id,
        new.actor_role,
        new.action,
        new.target_type,
        new.target_id,
        new.ip,
        coalesce(new.before::text, ''),
        coalesce(new.after::text, ''),
        coalesce(new.details::text, '')
      ),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

drop trigger if exists audit_log_before_insert_trigger on public.audit_log;
create trigger audit_log_before_insert_trigger
  before insert on public.audit_log
  for each row execute function public.audit_log_before_insert();

-- ---------------------------------------------------------------------------
-- Immutability: no UPDATE, DELETE or TRUNCATE — ever, for anyone.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', TG_OP;
end;
$$;

drop trigger if exists audit_log_no_update_trigger on public.audit_log;
create trigger audit_log_no_update_trigger
  before update on public.audit_log
  for each row execute function public.audit_log_immutable();

drop trigger if exists audit_log_no_delete_trigger on public.audit_log;
create trigger audit_log_no_delete_trigger
  before delete on public.audit_log
  for each row execute function public.audit_log_immutable();

drop trigger if exists audit_log_no_truncate_trigger on public.audit_log;
create trigger audit_log_no_truncate_trigger
  before truncate on public.audit_log
  for statement execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- Integrity verification (Checklist E.24): recompute the whole chain.
-- Called by the app's "Verify integrity" button via RPC (HR/Admin enforced
-- in the API route as well).
-- ---------------------------------------------------------------------------
create or replace function public.verify_audit_chain()
returns table (ok boolean, checked int, broken_at int, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  expected_prev text := 'GENESIS';
  expected_seq  int := 0;
  computed      text;
  total         int;
begin
  select count(*) into total from public.audit_log;

  for r in
    select * from public.audit_log order by seq
  loop
    if r.seq <> expected_seq + 1 then
      return query select false, expected_seq, r.seq, 'sequence gap: expected ' || (expected_seq + 1)::text;
      return;
    end if;
    if r.prev_hash is distinct from expected_prev then
      return query select false, expected_seq, r.seq, 'row does not link to the previous hash';
      return;
    end if;

    computed := encode(
      digest(
        concat_ws('|',
          r.prev_hash, r.seq, r.ts, r.actor_id, r.actor_role, r.action,
          r.target_type, r.target_id, r.ip,
          coalesce(r.before::text, ''), coalesce(r.after::text, ''),
          coalesce(r.details::text, '')
        ),
        'sha256'
      ),
      'hex'
    );
    if computed is distinct from r.hash then
      return query select false, r.seq - 1, r.seq, 'row content does not match its stored hash';
      return;
    end if;

    expected_prev := r.hash;
    expected_seq := r.seq;
  end loop;

  return query select true, total, null::int, null::text;
end;
$$;

grant execute on function public.verify_audit_chain() to authenticated;
