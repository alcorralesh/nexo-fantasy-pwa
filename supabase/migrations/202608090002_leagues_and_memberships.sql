-- Ligas, participaciones y reservas atómicas de plaza.

create table if not exists public.leagues (
  id text primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  competition_id text not null references public.competitions(id),
  name text not null,
  visibility text not null,
  mode text not null,
  roster_policy text not null,
  accent text not null default 'blue',
  capacity integer not null default 16,
  starting_budget numeric(12,2) not null default 100,
  target_squad_value numeric(12,2) not null default 100,
  join_locked boolean not null default false,
  access_code_hash text,
  featured boolean not null default false,
  status text not null default 'open',
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_visibility check (visibility in ('public', 'private')),
  constraint leagues_mode check (mode in ('market', 'fantasy')),
  constraint leagues_roster_policy check (roster_policy in ('exclusive', 'repeatable')),
  constraint leagues_accent check (accent in ('lime', 'blue', 'violet')),
  constraint leagues_capacity check (capacity between 2 and 5000),
  constraint leagues_status check (status in ('draft', 'open', 'locked', 'live', 'finished', 'closed')),
  constraint leagues_private_code check (visibility = 'public' or access_code_hash is not null)
);

create table if not exists public.league_memberships (
  id uuid primary key default gen_random_uuid(),
  league_id text not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null default 'member',
  budget numeric(12,2) not null default 0,
  roster_id uuid,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  constraint league_memberships_role check (role in ('admin', 'member')),
  unique (league_id, user_id)
);

create table if not exists public.league_join_reservations (
  id uuid primary key default gen_random_uuid(),
  league_id text not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (league_id, user_id)
);

create index if not exists leagues_directory_idx on public.leagues(status, visibility, competition_id, mode);
create index if not exists league_memberships_active_idx on public.league_memberships(league_id) where left_at is null;
create index if not exists league_memberships_user_idx on public.league_memberships(user_id) where left_at is null;
create index if not exists league_join_reservations_expiry_idx on public.league_join_reservations(league_id, expires_at);

drop trigger if exists leagues_set_updated_at on public.leagues;
create trigger leagues_set_updated_at before update on public.leagues
for each row execute function public.set_updated_at();

insert into public.leagues (id, competition_id, name, visibility, mode, roster_policy, accent, capacity, starting_budget, target_squad_value, access_code_hash, featured, rules)
values
  ('league_primera_publica', 'primera', 'Primera Abierta', 'public', 'market', 'exclusive', 'blue', 16, 100, 104, null, true, '{"renewalHours":24,"maxDebtPercent":20,"maxBenchPlayers":20}'::jsonb),
  ('league_primera_privada', 'primera', 'Los del barrio', 'private', 'market', 'exclusive', 'lime', 10, 100, 104, encode(digest('AMIGOS1','sha256'),'hex'), false, '{"renewalHours":24,"maxDebtPercent":20,"maxBenchPlayers":20,"initialSquadSize":16}'::jsonb),
  ('league_primera_fantasy', 'primera', 'Fantástica Primera', 'public', 'fantasy', 'repeatable', 'violet', 500, 100, 100, null, true, '{"lineupBudget":100}'::jsonb),
  ('league_segunda_publica', 'segunda', 'Segunda Abierta', 'public', 'market', 'exclusive', 'blue', 16, 100, 104, null, true, '{"renewalHours":24,"maxDebtPercent":20,"maxBenchPlayers":20}'::jsonb),
  ('league_segunda_privada', 'segunda', 'La Peña de Plata', 'private', 'market', 'exclusive', 'lime', 10, 100, 104, encode(digest('AMIGOS2','sha256'),'hex'), false, '{"renewalHours":24,"maxDebtPercent":20,"maxBenchPlayers":20,"initialSquadSize":16}'::jsonb),
  ('league_segunda_fantasy', 'segunda', 'Fantástica Segunda', 'public', 'fantasy', 'repeatable', 'violet', 500, 100, 100, null, true, '{"lineupBudget":100}'::jsonb),
  ('league_f_publica', 'liga_f', 'Liga F Abierta', 'public', 'market', 'exclusive', 'blue', 16, 100, 104, null, true, '{"renewalHours":24,"maxDebtPercent":20,"maxBenchPlayers":20}'::jsonb),
  ('league_f_privada', 'liga_f', 'Reinas del Fútbol', 'private', 'market', 'exclusive', 'lime', 10, 100, 104, encode(digest('AMIGOSF','sha256'),'hex'), false, '{"renewalHours":24,"maxDebtPercent":20,"maxBenchPlayers":20,"initialSquadSize":16}'::jsonb),
  ('league_f_fantasy', 'liga_f', 'Fantástica Liga F', 'public', 'fantasy', 'repeatable', 'violet', 500, 100, 100, null, true, '{"lineupBudget":100}'::jsonb)
on conflict (id) do update set
  name = excluded.name,
  capacity = excluded.capacity,
  rules = excluded.rules;

create or replace function public.league_directory()
returns table (
  id text, name text, competition_id text, competition_name text, visibility text,
  mode text, roster_policy text, accent text, capacity integer, member_count bigint,
  starting_budget numeric, target_squad_value numeric, join_locked boolean, featured boolean, rules jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.competition_id, c.name, l.visibility, l.mode, l.roster_policy,
         l.accent, l.capacity,
         (select count(*) from public.league_memberships m where m.league_id = l.id and m.left_at is null),
         l.starting_budget, l.target_squad_value, l.join_locked, l.featured, l.rules
    from public.leagues l
    join public.competitions c on c.id = l.competition_id
   where l.status = 'open'
     and (l.visibility = 'public' or exists (
       select 1 from public.league_memberships mine
        where mine.league_id = l.id and mine.user_id = auth.uid() and mine.left_at is null
     ))
   order by l.featured desc, c.sort_order, l.name;
$$;

create or replace function public.my_league_memberships()
returns table (
  membership_id uuid, league_id text, team_id uuid, role text, budget numeric,
  name text, competition_id text, competition_name text, visibility text,
  mode text, roster_policy text, accent text, capacity integer, member_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.league_id, m.team_id, m.role, m.budget, l.name, l.competition_id,
         c.name, l.visibility, l.mode, l.roster_policy, l.accent, l.capacity,
         (select count(*) from public.league_memberships active_m where active_m.league_id = l.id and active_m.left_at is null)
    from public.league_memberships m
    join public.leagues l on l.id = m.league_id
    join public.competitions c on c.id = l.competition_id
   where m.user_id = auth.uid() and m.left_at is null;
$$;

create or replace function public.preview_private_league(access_code text)
returns table (
  id text, name text, competition_id text, competition_name text, mode text,
  roster_policy text, accent text, capacity integer, member_count bigint,
  join_locked boolean, starting_budget numeric, target_squad_value numeric, rules jsonb
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select l.id, l.name, l.competition_id, c.name, l.mode, l.roster_policy, l.accent,
         l.capacity,
         (select count(*) from public.league_memberships m where m.league_id = l.id and m.left_at is null),
         l.join_locked, l.starting_budget, l.target_squad_value,
         l.rules || jsonb_build_object('_participants', coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', m.id, 'userId', m.user_id, 'initials', p.initials,
             'userName', p.display_name, 'teamName', t.name, 'role', m.role
           ) order by m.joined_at)
             from public.league_memberships m
             join public.profiles p on p.id = m.user_id
             join public.teams t on t.id = m.team_id
            where m.league_id = l.id and m.left_at is null
         ), '[]'::jsonb))
    from public.leagues l
    join public.competitions c on c.id = l.competition_id
   where l.visibility = 'private' and l.status = 'open'
     and l.access_code_hash = encode(digest(upper(trim(access_code)), 'sha256'), 'hex')
   limit 1;
$$;

create or replace function public.reserve_league_place(target_league_id text, access_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  selected_league public.leagues;
  active_members bigint;
  active_reservations bigint;
  reservation_id uuid;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into selected_league from public.leagues where id = target_league_id for update;
  if not found or selected_league.status <> 'open' then raise exception 'La liga no está disponible'; end if;
  if selected_league.join_locked then raise exception 'Las inscripciones están bloqueadas'; end if;
  if selected_league.visibility = 'private' and selected_league.access_code_hash <> encode(digest(upper(trim(coalesce(access_code,''))), 'sha256'), 'hex') then
    raise exception 'El código no es válido';
  end if;
  if exists (select 1 from public.league_memberships where league_id = target_league_id and user_id = auth.uid() and left_at is null) then
    raise exception 'Ya participas en esta liga';
  end if;

  delete from public.league_join_reservations where expires_at <= now();
  select count(*) into active_members from public.league_memberships where league_id = target_league_id and left_at is null;
  select count(*) into active_reservations from public.league_join_reservations where league_id = target_league_id and expires_at > now();
  if active_members + active_reservations >= selected_league.capacity then raise exception 'La última plaza acaba de ocuparse'; end if;

  insert into public.league_join_reservations (league_id, user_id, expires_at)
  values (target_league_id, auth.uid(), now() + interval '3 minutes')
  on conflict (league_id, user_id) do update set expires_at = excluded.expires_at, created_at = now()
  returning id into reservation_id;
  return reservation_id;
end;
$$;

create or replace function public.confirm_league_join(reservation_id uuid, selected_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.league_join_reservations;
  selected_league public.leagues;
  selected_team public.teams;
  membership_id uuid;
  active_members bigint;
begin
  select * into reservation from public.league_join_reservations r where r.id = reservation_id and r.user_id = auth.uid() for update;
  if not found or reservation.expires_at <= now() then raise exception 'La reserva ha caducado'; end if;
  select * into selected_league from public.leagues where id = reservation.league_id for update;
  select * into selected_team from public.teams where id = selected_team_id and owner_id = auth.uid() and active for update;
  if not found then raise exception 'El equipo no es válido'; end if;
  if selected_team.competition_id <> selected_league.competition_id then raise exception 'El equipo pertenece a otra competición'; end if;
  select count(*) into active_members from public.league_memberships where league_id = selected_league.id and left_at is null;
  if active_members >= selected_league.capacity then raise exception 'La liga ya está completa'; end if;

  insert into public.league_memberships (league_id, user_id, team_id, role, budget, joined_at, left_at)
  values (selected_league.id, auth.uid(), selected_team.id, 'member', selected_league.starting_budget, now(), null)
  on conflict (league_id, user_id) do update set team_id = excluded.team_id, role = 'member', budget = excluded.budget, joined_at = now(), left_at = null
  returning id into membership_id;
  delete from public.league_join_reservations where id = reservation.id;
  return membership_id;
end;
$$;

create or replace function public.cancel_league_reservation(reservation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.league_join_reservations where id = reservation_id and user_id = auth.uid();
$$;

create or replace function public.create_private_league(
  league_name text, selected_team_id uuid, requested_capacity integer, requested_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  selected_team public.teams;
  new_league_id text := 'private_' || replace(gen_random_uuid()::text, '-', '');
  access_code text := 'NX-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
  new_membership_id uuid;
begin
  if char_length(trim(league_name)) not between 3 and 30 then raise exception 'El nombre debe tener entre 3 y 30 caracteres'; end if;
  if requested_capacity not between 2 and 100 then raise exception 'La capacidad no es válida'; end if;
  select * into selected_team from public.teams where id = selected_team_id and owner_id = auth.uid() and active;
  if not found then raise exception 'El equipo no es válido'; end if;
  insert into public.leagues (id, owner_id, competition_id, name, visibility, mode, roster_policy, accent, capacity, starting_budget, target_squad_value, access_code_hash, rules)
  values (new_league_id, auth.uid(), selected_team.competition_id, trim(league_name), 'private', 'market', 'exclusive', 'lime', requested_capacity,
          coalesce((requested_rules->>'startingBudget')::numeric, 100), 104,
          encode(digest(access_code, 'sha256'), 'hex'), requested_rules);
  insert into public.league_memberships (league_id, user_id, team_id, role, budget)
  values (new_league_id, auth.uid(), selected_team.id, 'admin', coalesce((requested_rules->>'startingBudget')::numeric, 100))
  returning id into new_membership_id;
  return jsonb_build_object('leagueId', new_league_id, 'membershipId', new_membership_id, 'accessCode', access_code);
end;
$$;

create or replace function public.leave_my_league(target_league_id text, successor_membership_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mine public.league_memberships;
  remaining_count bigint;
begin
  select * into mine from public.league_memberships where league_id = target_league_id and user_id = auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select count(*) into remaining_count from public.league_memberships where league_id = target_league_id and left_at is null and id <> mine.id;
  if mine.role = 'admin' and remaining_count > 0 then
    if successor_membership_id is null or not exists (select 1 from public.league_memberships where id = successor_membership_id and league_id = target_league_id and left_at is null and id <> mine.id) then
      raise exception 'Selecciona un nuevo administrador';
    end if;
    update public.league_memberships set role = 'admin' where id = successor_membership_id;
    update public.leagues set owner_id = (select user_id from public.league_memberships where id = successor_membership_id) where id = target_league_id;
  elsif mine.role = 'admin' and remaining_count = 0 then
    update public.leagues set status = 'closed', join_locked = true where id = target_league_id;
  end if;
  update public.league_memberships set left_at = now() where id = mine.id;
  delete from public.league_join_reservations where league_id = target_league_id and user_id = auth.uid();
end;
$$;

alter table public.leagues enable row level security;
alter table public.league_memberships enable row level security;
alter table public.league_join_reservations enable row level security;

drop policy if exists leagues_read_authenticated on public.leagues;
create policy leagues_read_authenticated on public.leagues for select to authenticated using (
  visibility = 'public' or owner_id = auth.uid() or exists (
    select 1 from public.league_memberships mine
     where mine.league_id = leagues.id and mine.user_id = auth.uid() and mine.left_at is null
  )
);
drop policy if exists league_memberships_read_authenticated on public.league_memberships;
create policy league_memberships_read_authenticated on public.league_memberships for select to authenticated using (user_id = auth.uid());
drop policy if exists reservations_read_own on public.league_join_reservations;
create policy reservations_read_own on public.league_join_reservations for select to authenticated using (user_id = auth.uid());

revoke all on public.leagues, public.league_memberships, public.league_join_reservations from anon, authenticated;
grant select on public.leagues, public.league_memberships to authenticated;
grant execute on function public.league_directory() to anon, authenticated;
grant execute on function public.my_league_memberships() to authenticated;
grant execute on function public.preview_private_league(text) to authenticated;
grant execute on function public.reserve_league_place(text, text) to authenticated;
grant execute on function public.confirm_league_join(uuid, uuid) to authenticated;
grant execute on function public.cancel_league_reservation(uuid) to authenticated;
grant execute on function public.create_private_league(text, uuid, integer, jsonb) to authenticated;
grant execute on function public.leave_my_league(text, uuid) to authenticated;
