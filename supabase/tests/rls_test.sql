-- Row-level security checks. Run after auth_stub.sql and 0001_household.sql:
--   psql -v ON_ERROR_STOP=1 -f auth_stub.sql -f ../migrations/0001_household.sql -f rls_test.sql
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''

set role authenticated;

-- A creates a household
select set_config('test.uid', :A, false);
create temp table h on commit preserve rows as select * from public.create_household('Casa', 'Alex');
grant select on h to authenticated;
select update_my_member('Alex', array['peanuts']);
insert into public.items (id, household_id, name, category, location, purchased_at, expires_at)
  select gen_random_uuid(), id, 'milk', 'dairy', 'fridge', current_date, current_date + 7 from h;

-- B joins with the code (lower case and a dash, as people type it)
select set_config('test.uid', :B, false);
select public.join_household(lower(substr(invite_code,1,3) || '-' || substr(invite_code,4)), 'Bea') from h;
do $$ begin
  if (select count(*) from public.items) <> 1 then raise exception 'FAIL: B cannot see shared milk'; end if;
  if (select count(*) from public.household_members) <> 2 then raise exception 'FAIL: B cannot see members'; end if;
  if not exists (select 1 from public.household_members where display_name = 'Alex' and allergies = array['peanuts']) then
    raise exception 'FAIL: B cannot see Alex''s allergies';
  end if;
end $$;
update public.items set count = 2 where name = 'milk';
insert into public.shopping (id, household_id, name) select gen_random_uuid(), id, 'eggs' from h;

-- A sees B's edits, stamped by the server
select set_config('test.uid', :A, false);
do $$ begin
  if (select count from public.items where name = 'milk') <> 2 then raise exception 'FAIL: A does not see B''s update'; end if;
  if (select updated_by from public.items where name = 'milk') <> 'bbbbbbbb-0000-0000-0000-000000000002' then raise exception 'FAIL: updated_by not stamped'; end if;
  if (select count(*) from public.shopping) <> 1 then raise exception 'FAIL: A cannot see B''s list item'; end if;
end $$;

-- C is an outsider: sees nothing, cannot write in, cannot sneak a membership row in
select set_config('test.uid', :C, false);
do $$ begin
  if (select count(*) from public.items) <> 0 then raise exception 'FAIL: outsider sees items'; end if;
  if (select count(*) from public.households) <> 0 then raise exception 'FAIL: outsider sees household'; end if;
  if (select count(*) from public.household_members) <> 0 then raise exception 'FAIL: outsider sees members'; end if;
end $$;
do $$ begin
  begin
    insert into public.items (id, household_id, name, category, location, purchased_at, expires_at)
      select gen_random_uuid(), id, 'evil', 'other', 'fridge', current_date, current_date from h;
    raise exception 'FAIL: outsider inserted an item';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.household_members (household_id, user_id) select id, auth.uid() from h;
    raise exception 'FAIL: outsider inserted a membership';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.items set name = 'hacked';  -- silently matches no rows under RLS
do $$ begin
  begin
    perform public.join_household('ZZZZZZ', 'Cal');
    raise exception 'FAIL: joined with a bogus code';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- A can't join a second household while in one
select set_config('test.uid', :A, false);
do $$ begin
  if (select name from public.items limit 1) <> 'milk' then raise exception 'FAIL: outsider changed data'; end if;
  begin
    perform public.create_household('Second', 'Alex');
    raise exception 'FAIL: created a second household';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- Leaving: B leaves, A still has data; A leaves last and the household is cleaned up
select set_config('test.uid', :B, false);
select public.leave_household();
do $$ begin
  if (select count(*) from public.items) <> 0 then raise exception 'FAIL: B still sees items after leaving'; end if;
end $$;
select set_config('test.uid', :A, false);
select public.leave_household();
reset role;
do $$ begin
  if (select count(*) from public.households) <> 0 then raise exception 'FAIL: empty household not deleted'; end if;
  if (select count(*) from public.items) <> 0 then raise exception 'FAIL: items not cleaned up'; end if;
end $$;

\echo ALL RLS CHECKS PASSED
