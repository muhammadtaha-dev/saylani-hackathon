-- ============================================================================
-- HCM Lite — Migration 0003: RPCs, Realtime, Storage
-- ============================================================================

-- ---------------------------------------------------------------------------
-- RPC: who is on approved leave today (directory-level info only — names,
-- department, leave type and dates; no personal details). SECURITY DEFINER
-- is the controlled exception to "employee: own rows" so the approved
-- "Who is off today" feature keeps working for every role.
-- ---------------------------------------------------------------------------
create or replace function public.on_leave_today()
returns table (
  full_name   text,
  department  text,
  leave_type  text,
  start_date  date,
  end_date    date
)
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name, p.department, lr.leave_type_id, lr.start_date, lr.end_date
  from public.leave_requests lr
  join public.profiles p on p.id = lr.employee_id and p.status = 'active'
  where lr.status = 'approved'
    and current_date between lr.start_date and lr.end_date
  order by p.department, p.full_name
$$;

grant execute on function public.on_leave_today() to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: teammates (same department, excluding the caller) with approved leave
-- overlapping a range — powers the Smart Leave overlap warning. Returns
-- counts plus names only (directory-level), no reason/decision data.
-- ---------------------------------------------------------------------------
create or replace function public.team_overlap(p_start date, p_end date)
returns table (team_size int, off_count int, off_names jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me        public.profiles;
  v_names   jsonb;
  v_count   int;
  v_size    int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null then
    return query select 0, 0, '[]'::jsonb;
    return;
  end if;

  select count(*)::int into v_size
  from public.profiles
  where department = me.department
    and status = 'active'
    and id <> auth.uid();

  select jsonb_agg(jsonb_build_object(
           'name', p.full_name,
           'type', lr.leave_type_id,
           'start', lr.start_date,
           'end', lr.end_date
         )),
         count(*)::int
    into v_names, v_count
  from public.leave_requests lr
  join public.profiles p on p.id = lr.employee_id
  where lr.status = 'approved'
    and lr.start_date <= p_end
    and lr.end_date >= p_start
    and p.department = me.department
    and p.status = 'active'
    and p.id <> auth.uid();

  return query select v_size, coalesce(v_count, 0), coalesce(v_names, '[]'::jsonb);
end;
$$;

grant execute on function public.team_overlap(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: push notifications inserts to subscribed clients.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: leave attachments in a PRIVATE bucket.
-- Path convention: <auth.uid()>/<leave_request_id>/<filename>
--   insert/select/delete: own folder only
--   select: HR/Admin can read every attachment (reviewing requests)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('leave-attachments', 'leave-attachments', false, 5242880) -- 5 MB
on conflict (id) do nothing;

drop policy if exists "attachments insert own folder" on storage.objects;
create policy "attachments insert own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attachments select own or hr" on storage.objects;
create policy "attachments select own or hr"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_hr_or_admin()
    )
  );

drop policy if exists "attachments delete own folder" on storage.objects;
create policy "attachments delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
