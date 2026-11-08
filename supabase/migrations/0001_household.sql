-- FridgeChef: shared households.
-- Paste this whole file into the Supabase dashboard → SQL Editor → Run.
-- Safe to re-run: it only creates things that don't exist yet.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

-- One household per person keeps things simple for now.
create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null unique default auth.uid(),
  display_name text not null default '' check (char_length(display_name) <= 40),
  allergies    text[] not null default '{}',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Shared food. `id` is the UUID the app generates, so offline edits keep their identity.
create table if not exists public.items (
  id               uuid primary key,
  household_id     uuid not null references public.households (id) on delete cascade,
  name             text not null,
  category         text not null,
  location         text not null,
  count            integer not null default 1,
  qty_level        text not null default 'full',
  purchased_at     date not null,
  expires_at       date not null,
  expiry_estimated boolean not null default true,
  deleted          boolean not null default false,
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid()
);
create index if not exists items_household_updated on public.items (household_id, updated_at);

create table if not exists public.shopping (
  id           uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null,
  reason       text not null default '',
  checked      boolean not null default false,
  added_at     timestamptz not null default now(),
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
create index if not exists shopping_household_updated on public.shopping (household_id, updated_at);

-- Saved and imported recipes, shared as a household recipe box.
create table if not exists public.recipes (
  household_id uuid not null references public.households (id) on delete cascade,
  id           text not null,
  json         jsonb not null,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid(),
  primary key (household_id, id)
);
create index if not exists recipes_household_updated on public.recipes (household_id, updated_at);

-- ---------------------------------------------------------------------------
-- The server clock orders changes: every write gets a fresh updated_at.
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.touch_updated_at();
drop trigger if exists shopping_touch on public.shopping;
create trigger shopping_touch before insert or update on public.shopping
  for each row execute function public.touch_updated_at();
drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before insert or update on public.recipes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: you can only see and change your own household's data.
-- ---------------------------------------------------------------------------

-- security definer so policies can check membership without recursing into RLS.
create or replace function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.items             enable row level security;
alter table public.shopping          enable row level security;
alter table public.recipes           enable row level security;

drop policy if exists households_read on public.households;
create policy households_read on public.households
  for select to authenticated using (public.is_member(id));
drop policy if exists households_rename on public.households;
create policy households_rename on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

-- Members can see each other (names and allergies power "Cooking for").
-- Joining, leaving, and editing yourself go through the functions below.
drop policy if exists members_read on public.household_members;
create policy members_read on public.household_members
  for select to authenticated using (public.is_member(household_id));

do $$
declare t text;
begin
  foreach t in array array['items', 'shopping', 'recipes'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.is_member(household_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_member(household_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------------

-- 6 characters, no look-alikes (0/O, 1/I/L).
create or replace function public.new_invite_code() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end $$;

create or replace function public.create_household(p_name text, p_display_name text)
returns public.households
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You are already in a household. Leave it first.';
  end if;
  insert into households (name, invite_code, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Our kitchen'), new_invite_code(), auth.uid())
  returning * into h;
  insert into household_members (household_id, user_id, display_name)
  values (h.id, auth.uid(), coalesce(trim(p_display_name), ''));
  return h;
end $$;

create or replace function public.join_household(p_code text, p_display_name text)
returns public.households
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into h from households where invite_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'No household with that code'; end if;
  if exists (select 1 from household_members where user_id = auth.uid() and household_id <> h.id) then
    raise exception 'You are already in a household. Leave it first.';
  end if;
  insert into household_members (household_id, user_id, display_name)
  values (h.id, auth.uid(), coalesce(trim(p_display_name), ''))
  on conflict (household_id, user_id) do nothing;
  return h;
end $$;

-- The last person out deletes the household and its shared data.
create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  delete from household_members where user_id = auth.uid() returning household_id into hid;
  if hid is not null and not exists (select 1 from household_members where household_id = hid) then
    delete from households where id = hid;
  end if;
end $$;

create or replace function public.update_my_member(p_display_name text, p_allergies text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  update household_members
     set display_name = left(coalesce(trim(p_display_name), ''), 40),
         allergies    = coalesce(p_allergies, '{}')
   where user_id = auth.uid();
end $$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.leave_household() from public, anon;
revoke all on function public.update_my_member(text, text[]) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.update_my_member(text, text[]) to authenticated;

grant select, update on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update on public.items, public.shopping, public.recipes to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: other phones hear about changes within a second.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['items', 'shopping', 'recipes', 'household_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
