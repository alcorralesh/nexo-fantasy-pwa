-- Retos fantásticos reales: partidos oficiales, precios congelados y catálogo acotado.

create table if not exists public.fantasy_challenges (
  league_id text primary key references public.leagues(id) on delete cascade,
  description text not null default '',
  format text not null check (format in ('partidazo','matches')),
  lineup_policy text not null default 'fixed' check (lineup_policy in ('fixed','per_matchday')),
  max_players_per_club smallint not null default 6 check (max_players_per_club between 1 and 11),
  previous_matchday smallint not null check (previous_matchday between 0 and 49),
  budget_percentile smallint not null default 60 check (budget_percentile between 20 and 90),
  snapshot_id uuid,
  snapshot_at timestamptz,
  budget numeric(12,2),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.fantasy_challenge_fixtures (
  league_id text not null references public.fantasy_challenges(league_id) on delete cascade,
  fixture_id text not null references public.match_fixtures(id) on delete restrict,
  slot_order smallint not null,
  primary key (league_id, fixture_id),
  unique (league_id, slot_order)
);

create table if not exists public.fantasy_challenge_player_prices (
  league_id text not null references public.fantasy_challenges(league_id) on delete cascade,
  player_id text not null references public.players(id) on delete restrict,
  price numeric(12,2) not null check (price >= 0),
  primary key (league_id, player_id)
);

create index if not exists fantasy_challenge_fixture_idx on public.fantasy_challenge_fixtures(fixture_id);
create index if not exists fantasy_challenge_prices_idx on public.fantasy_challenge_player_prices(league_id, player_id);

create or replace function public.admin_snapshot_fantasy_challenge(target_league_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge public.fantasy_challenges;
  selected_league public.leagues;
  calculated_budget numeric(12,2);
  player_count integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  select * into challenge from public.fantasy_challenges where league_id = target_league_id for update;
  if not found then raise exception 'El reto no existe'; end if;
  select * into selected_league from public.leagues where id = target_league_id for update;

  delete from public.fantasy_challenge_player_prices where league_id = target_league_id;
  insert into public.fantasy_challenge_player_prices (league_id, player_id, price)
  select target_league_id, p.id, p.market_value
  from public.players p
  join public.sports_clubs club on club.id = p.sports_club_id
  where p.active and p.competition_id = selected_league.competition_id
    and exists (
      select 1 from public.fantasy_challenge_fixtures cf
      join public.match_fixtures f on f.id = cf.fixture_id
      where cf.league_id = target_league_id
        and club.name in (f.home_club_name, f.away_club_name)
    );

  select count(*) into player_count from public.fantasy_challenge_player_prices where league_id = target_league_id;
  if player_count < 22 then raise exception 'No hay suficientes jugadores de los clubes seleccionados'; end if;
  if exists (
    select 1 from (values ('POR',1),('DEF',4),('MED',4),('DEL',2)) quota(position, required)
    where (select count(*) from public.fantasy_challenge_player_prices cp join public.players p on p.id = cp.player_id
           where cp.league_id = target_league_id and p.position = quota.position) < quota.required
  ) then raise exception 'El catálogo no permite formar un 4-4-2 completo'; end if;

  select ceil(sum(price) * 2) / 2 into calculated_budget from (
    (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='POR' order by cp.price limit 1)
    union all
    (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='DEF' order by cp.price limit 4)
    union all
    (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='MED' order by cp.price limit 4)
    union all
    (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='DEL' order by cp.price limit 2)
  ) cheapest;
  calculated_budget := ceil((calculated_budget * (1 + challenge.budget_percentile::numeric / 200)) * 2) / 2;

  update public.fantasy_challenges set snapshot_id = gen_random_uuid(), snapshot_at = now(), budget = calculated_budget where league_id = target_league_id;
  update public.leagues set starting_budget = calculated_budget, target_squad_value = calculated_budget,
    rules = rules || jsonb_build_object('lineupBudget', calculated_budget, 'fantasyChallenge', true), status = 'open'
  where id = target_league_id;
end;
$$;

create or replace function public.admin_create_fantasy_challenge(
  challenge_name text,
  challenge_description text,
  challenge_format text,
  selected_fixture_ids text[],
  requested_lineup_policy text default 'fixed',
  requested_max_players_per_club integer default 6,
  requested_capacity integer default 500,
  requested_featured boolean default false,
  requested_budget_percentile integer default 60
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fixture_count integer;
  competition_count integer;
  matchday_count integer;
  selected_competition text;
  first_matchday integer;
  new_league_id text := 'challenge_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Acceso reservado a administradores'; end if;
  if char_length(trim(challenge_name)) not between 3 and 40 then raise exception 'El nombre debe tener entre 3 y 40 caracteres'; end if;
  if challenge_format not in ('partidazo','matches') then raise exception 'Formato no válido'; end if;
  if requested_lineup_policy not in ('fixed','per_matchday') then raise exception 'Política de alineación no válida'; end if;
  if requested_capacity not between 2 and 5000 then raise exception 'Capacidad no válida'; end if;
  if requested_max_players_per_club not between 1 and 11 then raise exception 'Máximo por club no válido'; end if;
  if requested_budget_percentile not between 20 and 90 then raise exception 'Percentil no válido'; end if;

  select count(*), count(distinct competition_id), count(distinct matchday), min(competition_id), min(matchday)
  into fixture_count, competition_count, matchday_count, selected_competition, first_matchday
  from public.match_fixtures where id = any(selected_fixture_ids) and status not in ('cancelled');
  if fixture_count <> cardinality(selected_fixture_ids) then raise exception 'Algún partido no existe o está cancelado'; end if;
  if challenge_format = 'partidazo' and fixture_count <> 1 then raise exception 'El Partido de la jornada debe contener un partido'; end if;
  if challenge_format = 'matches' and fixture_count <> 2 then raise exception 'Clásicos de la jornada debe contener exactamente dos partidos'; end if;
  if competition_count <> 1 or matchday_count <> 1 then raise exception 'Los partidos deben pertenecer a la misma competición y jornada'; end if;

  if requested_featured then update public.leagues set featured = false where mode='fantasy'; end if;
  insert into public.leagues (id, owner_id, competition_id, name, visibility, mode, roster_policy, accent, capacity, starting_budget, target_squad_value, featured, status, rules)
  values (new_league_id, auth.uid(), selected_competition, trim(challenge_name), 'public', 'fantasy', 'repeatable', 'violet', requested_capacity, 0, 0, requested_featured, 'draft', jsonb_build_object('fantasyChallenge',true));
  insert into public.fantasy_challenges (league_id, description, format, lineup_policy, max_players_per_club, previous_matchday, budget_percentile, created_by)
  values (new_league_id, trim(challenge_description), challenge_format, case when challenge_format='partidazo' then 'fixed' else requested_lineup_policy end,
          requested_max_players_per_club, greatest(0, first_matchday - 1), requested_budget_percentile, auth.uid());
  insert into public.fantasy_challenge_fixtures (league_id, fixture_id, slot_order)
  select new_league_id, fixture_id, ordinality from unnest(selected_fixture_ids) with ordinality selected(fixture_id, ordinality);
  perform public.admin_snapshot_fantasy_challenge(new_league_id);
  return new_league_id;
end;
$$;

create or replace function public.fantasy_challenge_directory()
returns table (
  league_id text, name text, description text, competition_id text, competition_name text,
  format text, lineup_policy text, max_players_per_club smallint, capacity integer,
  member_count bigint, featured boolean, status text, previous_matchday smallint,
  budget_percentile smallint, budget numeric, snapshot_id uuid, snapshot_at timestamptz,
  fixtures jsonb, player_prices jsonb
)
language sql stable security definer set search_path = public
as $$
  select l.id, l.name, ch.description, l.competition_id, c.name, ch.format, ch.lineup_policy,
    ch.max_players_per_club, l.capacity,
    (select count(*) from public.league_memberships m where m.league_id=l.id and m.left_at is null),
    l.featured, case when l.status='draft' then 'announced' else l.status end,
    ch.previous_matchday, ch.budget_percentile, ch.budget, ch.snapshot_id, ch.snapshot_at,
    coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'home',f.home_club_name,'away',f.away_club_name,'matchday',f.matchday,'kickoffAt',f.kickoff_at) order by cf.slot_order)
      from public.fantasy_challenge_fixtures cf join public.match_fixtures f on f.id=cf.fixture_id where cf.league_id=l.id), '[]'::jsonb),
    coalesce((select jsonb_object_agg(cp.player_id, cp.price) from public.fantasy_challenge_player_prices cp where cp.league_id=l.id), '{}'::jsonb)
  from public.fantasy_challenges ch join public.leagues l on l.id=ch.league_id join public.competitions c on c.id=l.competition_id
  where l.status in ('draft','open','live','finished')
  order by l.featured desc, ch.created_at desc;
$$;

create or replace function public.validate_fantasy_challenge_lineup()
returns trigger language plpgsql set search_path=public as $$
declare challenge_budget numeric(12,2); snapshot_total numeric(12,2); allowed_count integer;
begin
  select budget into challenge_budget from public.fantasy_challenges where league_id=new.league_id;
  if not found then return new; end if;
  select count(*), coalesce(sum(cp.price),0) into allowed_count, snapshot_total
  from unnest(new.starter_player_ids) selected(player_id)
  join public.fantasy_challenge_player_prices cp on cp.league_id=new.league_id and cp.player_id=selected.player_id;
  if allowed_count <> cardinality(new.starter_player_ids) then raise exception 'Solo puedes elegir jugadores de los equipos incluidos en el reto'; end if;
  if snapshot_total > challenge_budget then raise exception 'El once supera el presupuesto congelado del reto'; end if;
  new.total_value := snapshot_total;
  return new;
end;
$$;

drop trigger if exists matchday_lineup_validate_challenge on public.matchday_lineup_drafts;
create trigger matchday_lineup_validate_challenge before insert or update on public.matchday_lineup_drafts
for each row execute function public.validate_fantasy_challenge_lineup();

alter table public.fantasy_challenges enable row level security;
alter table public.fantasy_challenge_fixtures enable row level security;
alter table public.fantasy_challenge_player_prices enable row level security;
create policy fantasy_challenges_read on public.fantasy_challenges for select to anon, authenticated using (true);
create policy fantasy_challenge_fixtures_read on public.fantasy_challenge_fixtures for select to anon, authenticated using (true);
create policy fantasy_challenge_prices_read on public.fantasy_challenge_player_prices for select to anon, authenticated using (true);
grant select on public.fantasy_challenges, public.fantasy_challenge_fixtures, public.fantasy_challenge_player_prices to anon, authenticated;
grant execute on function public.fantasy_challenge_directory() to anon, authenticated;
grant execute on function public.admin_create_fantasy_challenge(text,text,text,text[],text,integer,integer,boolean,integer) to authenticated;
grant execute on function public.admin_snapshot_fantasy_challenge(text) to authenticated;
revoke all on function public.validate_fantasy_challenge_lineup() from public, anon, authenticated;
grant all on public.fantasy_challenges, public.fantasy_challenge_fixtures, public.fantasy_challenge_player_prices to service_role;
