-- Leave Portal schema. Run once in Supabase Dashboard > SQL Editor.
-- Security is enforced here (Row Level Security), not in the browser.

-- ---------- Tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  employee_code text,
  department text,
  role text not null default 'employee' check (role in ('employee','manager')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  days int not null default 0,              -- working days (Mon-Fri), set by trigger
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  manager_comment text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_user_idx on public.leave_requests(user_id);
create index if not exists leave_status_idx on public.leave_requests(status);
create index if not exists leave_dates_idx on public.leave_requests(start_date, end_date);

-- ---------- Helpers ----------
create or replace function public.is_manager() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager' and active)
$$;

-- New auth user -> profile. Role is ALWAYS 'employee' here; only the
-- create-employee function (service role) or you via SQL can make managers.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, employee_code, department)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)),
    new.email,
    new.raw_user_meta_data->>'employee_code',
    new.raw_user_meta_data->>'department'
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Employees may only change their own must_change_password flag.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if new.role <> old.role or new.active <> old.active or new.email <> old.email
       or new.full_name <> old.full_name
       or new.employee_code is distinct from old.employee_code
       or new.department is distinct from old.department then
      raise exception 'You can only change your password flag';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- Leave rules: compute working days, block overlaps, restrict who can change what.
create or replace function public.leave_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
  mgr boolean := public.is_manager();
begin
  if tg_op = 'INSERT' then
    select count(*) into n
      from generate_series(new.start_date, new.end_date, interval '1 day') d
      where extract(isodow from d) < 6;
    if n = 0 then raise exception 'Selected dates contain no working days'; end if;
    new.days := n;
    if exists (
      select 1 from public.leave_requests r
      where r.user_id = new.user_id and r.status in ('pending','approved')
        and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception 'You already have a pending or approved request overlapping these dates';
    end if;
    new.status := 'pending';
    new.manager_comment := null; new.decided_by := null; new.decided_at := null;
    return new;
  end if;

  -- UPDATE: nothing except status / comment may change
  if new.user_id <> old.user_id or new.leave_type <> old.leave_type
     or new.start_date <> old.start_date or new.end_date <> old.end_date
     or new.days <> old.days or new.reason is distinct from old.reason then
    raise exception 'Leave details cannot be edited; cancel and re-apply';
  end if;

  if new.status <> old.status then
    if mgr then
      new.decided_by := auth.uid();
      new.decided_at := now();
    elsif old.user_id = auth.uid() and old.status = 'pending' and new.status = 'cancelled' then
      null; -- employee cancelling own pending request
    else
      raise exception 'Not allowed';
    end if;
  end if;
  if not mgr and new.manager_comment is distinct from old.manager_comment then
    raise exception 'Not allowed';
  end if;
  return new;
end $$;

drop trigger if exists leave_guard on public.leave_requests;
create trigger leave_guard before insert or update on public.leave_requests
  for each row execute function public.leave_before_write();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.leave_requests enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_manager());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_mgr on public.profiles;
create policy profiles_update_mgr on public.profiles for update
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists leave_select on public.leave_requests;
create policy leave_select on public.leave_requests for select
  using (user_id = auth.uid() or public.is_manager());

drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests for insert
  with check (user_id = auth.uid());

drop policy if exists leave_update_own on public.leave_requests;
create policy leave_update_own on public.leave_requests for update
  using (user_id = auth.uid() and status = 'pending') with check (user_id = auth.uid());

drop policy if exists leave_update_mgr on public.leave_requests;
create policy leave_update_mgr on public.leave_requests for update
  using (public.is_manager()) with check (public.is_manager());

-- No delete policies: nobody can delete requests from the browser.

-- ---------- Make your FIRST manager ----------
-- 1) Dashboard > Authentication > Users > Add user (tick "Auto Confirm").
-- 2) Then run (with your email):
--    update public.profiles set role = 'manager' where email = 'you@company.com';
