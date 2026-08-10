-- El cierre de una jornada congela los precios y activa todos los retos de la
-- misma competicion y temporada que dependan de ella. La operacion es
-- idempotente: puede reintentarse sin cambiar snapshots ya publicados.

create or replace function public.activate_fantasy_challenges_for_closed_matchday(
  target_competition_id text,
  target_season text,
  target_matchday integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  activated_count integer := 0;
begin
  if not exists (
    select 1
    from public.competition_matchdays round
    where round.competition_id = target_competition_id
      and round.season = target_season
      and round.matchday = target_matchday
      and round.state = 'closed'
  ) then
    return 0;
  end if;

  insert into public.player_market_value_snapshots (
    competition_id, season, matchday, player_id, price
  )
  select target_competition_id, target_season, target_matchday, player.id, player.market_value
  from public.players player
  where player.competition_id = target_competition_id
    and player.active
  on conflict (competition_id, season, matchday, player_id) do nothing;

  for item in
    select challenge.league_id
    from public.fantasy_challenges challenge
    join public.leagues league on league.id = challenge.league_id
    where league.competition_id = target_competition_id
      and challenge.previous_matchday = target_matchday
      and challenge.snapshot_id is null
      and exists (
        select 1
        from public.fantasy_challenge_fixtures selected
        join public.match_fixtures fixture on fixture.id = selected.fixture_id
        where selected.league_id = challenge.league_id
          and fixture.season = target_season
      )
    order by challenge.league_id
    for update of challenge skip locked
  loop
    perform public.rebuild_fantasy_challenge_snapshot(item.league_id);
    activated_count := activated_count + 1;
  end loop;

  return activated_count;
end;
$$;

create or replace function public.activate_challenges_after_matchday_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'closed' and old.state is distinct from 'closed' then
    perform public.activate_fantasy_challenges_for_closed_matchday(
      new.competition_id,
      new.season,
      new.matchday
    );
  end if;
  return new;
end;
$$;

drop trigger if exists competition_matchdays_activate_challenges on public.competition_matchdays;
create trigger competition_matchdays_activate_challenges
after update of state on public.competition_matchdays
for each row execute function public.activate_challenges_after_matchday_close();

-- Regulariza retos anunciados antes de instalar esta version. Solo procesa
-- jornadas realmente cerradas y conserva cualquier snapshot ya publicado.
do $$
declare
  round record;
begin
  for round in
    select competition_id, season, matchday
    from public.competition_matchdays
    where state = 'closed'
    order by competition_id, season, matchday
  loop
    perform public.activate_fantasy_challenges_for_closed_matchday(
      round.competition_id,
      round.season,
      round.matchday
    );
  end loop;
end;
$$;

revoke all on function public.activate_fantasy_challenges_for_closed_matchday(text,text,integer)
  from public, anon, authenticated;
grant execute on function public.activate_fantasy_challenges_for_closed_matchday(text,text,integer)
  to service_role;
