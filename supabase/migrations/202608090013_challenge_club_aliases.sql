-- Congela los valores al cierre anterior y empareja nombres cortos con razones deportivas.

create table if not exists public.player_market_value_snapshots (
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null,
  player_id text not null references public.players(id),
  price numeric(12,2) not null,
  captured_at timestamptz not null default now(),
  primary key (competition_id,season,matchday,player_id)
);

create or replace function public.normalized_sports_club_name(value text)
returns text language sql immutable set search_path=public,extensions as $$
  select regexp_replace(regexp_replace(
    regexp_replace(translate(lower(coalesce(value,'')),'áéíóúüñ','aeiouun'),'^[[:space:]]*r[.][[:space:]]*','real '),
    '\m(fc|cf|club|futbol|sad|r|rc|rcd|ca|ud|de|del|la|el)\M',' ','g'),'[^a-z0-9]+','','g');
$$;

create or replace function public.rebuild_fantasy_challenge_snapshot(target_league_id text)
returns void language plpgsql security definer set search_path=public as $$
declare challenge public.fantasy_challenges; selected_league public.leagues;
  event_season text; calculated_budget numeric(12,2); player_count integer;
begin
  select * into challenge from public.fantasy_challenges where league_id=target_league_id for update;
  if not found then raise exception 'El reto no existe'; end if;
  select * into selected_league from public.leagues where id=target_league_id for update;
  select min(f.season) into event_season from public.fantasy_challenge_fixtures cf join public.match_fixtures f on f.id=cf.fixture_id where cf.league_id=target_league_id;
  if not exists (select 1 from public.player_market_value_snapshots where competition_id=selected_league.competition_id and season=event_season and matchday=challenge.previous_matchday) then
    raise exception 'La jornada anterior aún no ha cerrado y no tiene valores congelados';
  end if;
  delete from public.fantasy_challenge_player_prices where league_id=target_league_id;
  insert into public.fantasy_challenge_player_prices (league_id,player_id,price)
  select target_league_id,p.id,history.price
  from public.players p join public.sports_clubs club on club.id=p.sports_club_id
  join public.player_market_value_snapshots history on history.player_id=p.id and history.competition_id=p.competition_id and history.season=event_season and history.matchday=challenge.previous_matchday
  where p.active and p.competition_id=selected_league.competition_id and club.id in (
    select matched.id from public.fantasy_challenge_fixtures cf join public.match_fixtures f on f.id=cf.fixture_id
    cross join lateral (values (f.home_club_name),(f.away_club_name)) included(name)
    cross join lateral (
      select candidate.id from public.sports_clubs candidate
      where candidate.competition_id=selected_league.competition_id
        and exists(select 1 from public.players active_player where active_player.sports_club_id=candidate.id and active_player.active)
        and (
        public.normalized_sports_club_name(candidate.name)=public.normalized_sports_club_name(included.name)
        or position(public.normalized_sports_club_name(candidate.name) in public.normalized_sports_club_name(included.name))>0
        or position(public.normalized_sports_club_name(included.name) in public.normalized_sports_club_name(candidate.name))>0
      )
      order by case when public.normalized_sports_club_name(candidate.name)=public.normalized_sports_club_name(included.name) then 0
        when public.normalized_sports_club_name(candidate.name) like public.normalized_sports_club_name(included.name)||'%' then 1
        when public.normalized_sports_club_name(included.name) like public.normalized_sports_club_name(candidate.name)||'%' then 2 else 3 end,
        abs(length(public.normalized_sports_club_name(candidate.name))-length(public.normalized_sports_club_name(included.name)))
      limit 1
    ) matched
    where cf.league_id=target_league_id
  );
  select count(*) into player_count from public.fantasy_challenge_player_prices where league_id=target_league_id;
  if player_count<22 then raise exception 'No hay suficientes jugadores de los clubes seleccionados'; end if;
  if exists (select 1 from (values ('POR',1),('DEF',4),('MED',4),('DEL',2)) quota(position,required)
    where (select count(*) from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position=quota.position)<quota.required)
  then raise exception 'El catálogo no permite formar un 4-4-2 completo'; end if;
  select ceil(sum(price)*2)/2 into calculated_budget from (
    (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='POR' order by cp.price limit 1)
    union all (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='DEF' order by cp.price limit 4)
    union all (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='MED' order by cp.price limit 4)
    union all (select cp.price from public.fantasy_challenge_player_prices cp join public.players p on p.id=cp.player_id where cp.league_id=target_league_id and p.position='DEL' order by cp.price limit 2)
  ) cheapest;
  calculated_budget:=ceil((calculated_budget*(1+challenge.budget_percentile::numeric/200))*2)/2;
  update public.fantasy_challenges set snapshot_id=gen_random_uuid(),snapshot_at=now(),budget=calculated_budget where league_id=target_league_id;
  update public.leagues set starting_budget=calculated_budget,target_squad_value=calculated_budget,
    rules=rules||jsonb_build_object('lineupBudget',calculated_budget,'fantasyChallenge',true),status='open' where id=target_league_id;
  update public.league_memberships set budget=calculated_budget where league_id=target_league_id and left_at is null;
end;
$$;

create or replace function public.admin_snapshot_fantasy_challenge(target_league_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Acceso reservado a administradores'; end if;
  perform public.rebuild_fantasy_challenge_snapshot(target_league_id);
end;
$$;

create or replace function public.admin_create_fantasy_challenge(
  challenge_name text, challenge_description text, challenge_format text, selected_fixture_ids text[],
  requested_lineup_policy text default 'fixed', requested_max_players_per_club integer default 6,
  requested_capacity integer default 500, requested_featured boolean default false, requested_budget_percentile integer default 60
) returns text language plpgsql security definer set search_path=public as $$
declare fixture_count integer; competition_count integer; matchday_count integer; selected_competition text;
  first_matchday integer; event_season text; new_league_id text:='challenge_'||replace(gen_random_uuid()::text,'-','');
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Acceso reservado a administradores'; end if;
  if char_length(trim(challenge_name)) not between 3 and 40 then raise exception 'El nombre debe tener entre 3 y 40 caracteres'; end if;
  if challenge_format not in ('partidazo','matches') then raise exception 'Formato no válido'; end if;
  if requested_capacity not between 2 and 5000 or requested_max_players_per_club not between 1 and 11 then raise exception 'Configuración no válida'; end if;
  select count(*),count(distinct competition_id),count(distinct matchday),min(competition_id),min(matchday),min(season)
  into fixture_count,competition_count,matchday_count,selected_competition,first_matchday,event_season
  from public.match_fixtures where id=any(selected_fixture_ids) and status<>'cancelled';
  if fixture_count<>cardinality(selected_fixture_ids) then raise exception 'Algún partido no está disponible'; end if;
  if challenge_format='partidazo' and fixture_count<>1 then raise exception 'El Partido de la jornada debe contener un partido'; end if;
  if challenge_format='matches' and fixture_count<>2 then raise exception 'Clásicos de la jornada debe contener exactamente dos partidos'; end if;
  if competition_count<>1 or matchday_count<>1 then raise exception 'Los partidos deben pertenecer a la misma competición y jornada'; end if;
  if requested_featured then update public.leagues set featured=false where mode='fantasy'; end if;
  insert into public.leagues(id,owner_id,competition_id,name,visibility,mode,roster_policy,accent,capacity,starting_budget,target_squad_value,featured,status,rules)
  values(new_league_id,auth.uid(),selected_competition,trim(challenge_name),'public','fantasy','repeatable','violet',requested_capacity,0,0,requested_featured,'open',jsonb_build_object('fantasyChallenge',true));
  insert into public.fantasy_challenges(league_id,description,format,lineup_policy,max_players_per_club,previous_matchday,budget_percentile,created_by)
  values(new_league_id,trim(challenge_description),challenge_format,case when challenge_format='partidazo' then 'fixed' else requested_lineup_policy end,requested_max_players_per_club,greatest(0,first_matchday-1),requested_budget_percentile,auth.uid());
  insert into public.fantasy_challenge_fixtures(league_id,fixture_id,slot_order)
  select new_league_id,fixture_id,ordinality from unnest(selected_fixture_ids) with ordinality selected(fixture_id,ordinality);
  if first_matchday=1 then
    insert into public.player_market_value_snapshots(competition_id,season,matchday,player_id,price)
    select selected_competition,event_season,0,p.id,p.market_value from public.players p where p.competition_id=selected_competition and p.active
    on conflict(competition_id,season,matchday,player_id) do nothing;
  end if;
  if exists(select 1 from public.player_market_value_snapshots where competition_id=selected_competition and season=event_season and matchday=greatest(0,first_matchday-1)) then
    perform public.rebuild_fantasy_challenge_snapshot(new_league_id);
  end if;
  return new_league_id;
end;
$$;

create or replace function public.fantasy_challenge_directory()
returns table (league_id text,name text,description text,competition_id text,competition_name text,format text,lineup_policy text,max_players_per_club smallint,capacity integer,member_count bigint,featured boolean,status text,previous_matchday smallint,budget_percentile smallint,budget numeric,snapshot_id uuid,snapshot_at timestamptz,fixtures jsonb,player_prices jsonb)
language sql stable security definer set search_path=public as $$
  select l.id,l.name,ch.description,l.competition_id,c.name,ch.format,ch.lineup_policy,ch.max_players_per_club,l.capacity,
    (select count(*) from public.league_memberships m where m.league_id=l.id and m.left_at is null),l.featured,
    case when ch.snapshot_id is null then 'announced' else l.status end,ch.previous_matchday,ch.budget_percentile,ch.budget,ch.snapshot_id,ch.snapshot_at,
    coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'home',f.home_club_name,'away',f.away_club_name,'matchday',f.matchday,'kickoffAt',f.kickoff_at) order by cf.slot_order) from public.fantasy_challenge_fixtures cf join public.match_fixtures f on f.id=cf.fixture_id where cf.league_id=l.id),'[]'::jsonb),
    coalesce((select jsonb_object_agg(cp.player_id,cp.price) from public.fantasy_challenge_player_prices cp where cp.league_id=l.id),'{}'::jsonb)
  from public.fantasy_challenges ch join public.leagues l on l.id=ch.league_id join public.competitions c on c.id=l.competition_id
  where l.status in ('open','live','finished') order by l.featured desc,ch.created_at desc;
$$;

create or replace function public.validate_fantasy_challenge_lineup()
returns trigger language plpgsql set search_path=public as $$
declare challenge public.fantasy_challenges;snapshot_total numeric(12,2);allowed_count integer;
begin
  select * into challenge from public.fantasy_challenges where league_id=new.league_id;if not found then return new;end if;
  if challenge.snapshot_id is null then raise exception 'El presupuesto se publicará al cerrar la jornada anterior';end if;
  select count(*),coalesce(sum(cp.price),0) into allowed_count,snapshot_total from unnest(new.starter_player_ids) selected(player_id) join public.fantasy_challenge_player_prices cp on cp.league_id=new.league_id and cp.player_id=selected.player_id;
  if allowed_count<>cardinality(new.starter_player_ids) then raise exception 'Solo puedes elegir jugadores de los equipos incluidos en el reto';end if;
  if exists(select 1 from unnest(new.starter_player_ids) selected(player_id) join public.players p on p.id=selected.player_id group by p.sports_club_id having count(*)>challenge.max_players_per_club) then raise exception 'El once supera el máximo de jugadores permitido por club';end if;
  if snapshot_total>challenge.budget then raise exception 'El once supera el presupuesto congelado del reto';end if;new.total_value:=snapshot_total;return new;
end;
$$;

create or replace function public.activate_challenges_after_matchday_close()
returns trigger language plpgsql security definer set search_path=public as $$
declare item record;
begin
  if new.state='closed' and old.state is distinct from 'closed' then
    insert into public.player_market_value_snapshots(competition_id,season,matchday,player_id,price)
    select new.competition_id,new.season,new.matchday,p.id,p.market_value from public.players p where p.competition_id=new.competition_id and p.active
    on conflict(competition_id,season,matchday,player_id) do nothing;
    for item in select ch.league_id from public.fantasy_challenges ch join public.leagues l on l.id=ch.league_id
      where l.competition_id=new.competition_id and ch.previous_matchday=new.matchday and ch.snapshot_id is null
    loop perform public.rebuild_fantasy_challenge_snapshot(item.league_id);end loop;
  end if;return new;
end;
$$;

drop trigger if exists competition_matchdays_activate_challenges on public.competition_matchdays;
create trigger competition_matchdays_activate_challenges after update of state on public.competition_matchdays
for each row execute function public.activate_challenges_after_matchday_close();

delete from public.fantasy_challenge_player_prices;
update public.fantasy_challenges set snapshot_id=null,snapshot_at=null,budget=null;
update public.leagues set starting_budget=0,target_squad_value=0,rules=(rules-'lineupBudget')||jsonb_build_object('fantasyChallenge',true)
where id in(select league_id from public.fantasy_challenges);
insert into public.player_market_value_snapshots(competition_id,season,matchday,player_id,price)
select distinct l.competition_id,f.season,0,p.id,p.market_value
from public.fantasy_challenges ch join public.leagues l on l.id=ch.league_id
join public.fantasy_challenge_fixtures cf on cf.league_id=ch.league_id
join public.match_fixtures f on f.id=cf.fixture_id and f.matchday=1
join public.players p on p.competition_id=l.competition_id and p.active
on conflict(competition_id,season,matchday,player_id) do nothing;
do $$ declare item record;begin
  for item in select ch.league_id from public.fantasy_challenges ch join public.leagues l on l.id=ch.league_id
    join public.fantasy_challenge_fixtures cf on cf.league_id=ch.league_id join public.match_fixtures f on f.id=cf.fixture_id
    where exists(select 1 from public.player_market_value_snapshots h where h.competition_id=l.competition_id and h.season=f.season and h.matchday=ch.previous_matchday)
  loop perform public.rebuild_fantasy_challenge_snapshot(item.league_id);end loop;
end $$;

alter table public.player_market_value_snapshots enable row level security;
revoke all on public.player_market_value_snapshots from anon,authenticated;
grant all on public.player_market_value_snapshots to service_role;
grant execute on function public.fantasy_challenge_directory() to anon,authenticated;
grant execute on function public.admin_create_fantasy_challenge(text,text,text,text[],text,integer,integer,boolean,integer),public.admin_snapshot_fantasy_challenge(text) to authenticated;
revoke all on function public.normalized_sports_club_name(text),public.rebuild_fantasy_challenge_snapshot(text),public.validate_fantasy_challenge_lineup(),public.activate_challenges_after_matchday_close() from public,anon,authenticated;
grant execute on function public.normalized_sports_club_name(text),public.rebuild_fantasy_challenge_snapshot(text),public.activate_challenges_after_matchday_close() to service_role;
