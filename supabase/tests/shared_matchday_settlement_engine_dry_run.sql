-- Regresion reversible: el calculador compartido debe coincidir con la formula
-- oficial y el simulador no puede modificar ningun dato deportivo o economico.

begin;

do $$
declare
  target_round public.competition_matchdays;
  mismatch_count integer;
  admin_id uuid;
  rounds_before text;
  budgets_before text;
  results_before text;
  snapshots_before integer;
  careers_before text;
  objectives_before text;
  career_reports_before integer;
  career_events_before integer;
  challenges_before text;
  challenge_prices_before text;
  market_snapshots_before text;
  leagues_before text;
  simulation jsonb;
begin
  select * into target_round
  from public.competition_matchdays
  where state = 'closed'
  order by closed_at desc nulls last
  limit 1;
  if not found then raise exception 'La prueba necesita al menos una jornada cerrada'; end if;

  with baseline as (
    select target_round.id matchday_id, snapshot.membership_id, snapshot.league_id,
      coalesce(sum(coalesce(points.points,0) *
        case when selected.is_captain then config.captain_multiplier else 1 end),0)::numeric(12,2) points,
      case when league.mode='market' then least(config.maximum_payout,greatest(config.minimum_payout,
        coalesce(sum(coalesce(points.points,0) *
          case when selected.is_captain then config.captain_multiplier else 1 end),0) * config.money_per_point))
      else 0 end::numeric(12,2) payout
    from public.matchday_lineup_snapshots snapshot
    join public.leagues league on league.id=snapshot.league_id
    cross join public.matchday_lifecycle_config config
    left join public.matchday_lineup_snapshot_players selected
      on selected.snapshot_id=snapshot.id and selected.role='starter'
    left join public.player_matchday_points points
      on points.competition_id=target_round.competition_id
      and points.season=target_round.season and points.matchday=target_round.matchday
      and points.player_id=selected.player_id and points.scoring_version=snapshot.scoring_version
    where snapshot.matchday_id=target_round.id
    group by snapshot.id,snapshot.membership_id,snapshot.league_id,league.mode,
      config.maximum_payout,config.minimum_payout,config.money_per_point
  ), shared as (
    select * from public.calculate_matchday_settlement(target_round.id)
  )
  select count(*) into mismatch_count
  from shared
  full join baseline using(matchday_id,membership_id,league_id)
  where shared.membership_id is null or baseline.membership_id is null
    or shared.points<>baseline.points or shared.payout<>baseline.payout;
  if mismatch_count <> 0 then
    raise exception 'El motor compartido difiere de la formula oficial en % participaciones', mismatch_count;
  end if;

  if exists (
    select 1 from public.calculate_matchday_settlement(target_round.id)
    where mode <> 'market' and payout <> 0
  ) then
    raise exception 'Una liga fantastica ha recibido un pago economico';
  end if;

  select md5(coalesce(string_agg(id::text||':'||state||':'||coalesce(closed_at::text,''),',' order by id),''))
    into rounds_before from public.competition_matchdays;
  select md5(coalesce(string_agg(id::text||':'||budget::text,',' order by id),''))
    into budgets_before from public.league_memberships;
  select md5(coalesce(string_agg(matchday_id::text||':'||membership_id::text||':'||points::text||':'||payout::text,
    ',' order by matchday_id,membership_id),'')) into results_before from public.matchday_member_results;
  select count(*) into snapshots_before from public.matchday_lineup_snapshots;
  select md5(coalesce(string_agg(id::text||':'||status||':'||board_confidence::text||':'||reputation::text||':'||budget::text||':'||consecutive_failures::text,',' order by id),''))
    into careers_before from public.manager_careers;
  select md5(coalesce(string_agg(id::text||':'||status||':'||current_value::text,',' order by id),''))
    into objectives_before from public.manager_career_objectives;
  select count(*) into career_reports_before from public.manager_career_matchday_reports;
  select count(*) into career_events_before from public.manager_career_events;
  select md5(coalesce(string_agg(league_id||':'||coalesce(snapshot_id::text,'')||':'||coalesce(budget::text,''),',' order by league_id),''))
    into challenges_before from public.fantasy_challenges;
  select md5(coalesce(string_agg(league_id||':'||player_id||':'||price::text,',' order by league_id,player_id),''))
    into challenge_prices_before from public.fantasy_challenge_player_prices;
  select md5(coalesce(string_agg(competition_id||':'||season||':'||matchday::text||':'||player_id||':'||price::text,',' order by competition_id,season,matchday,player_id),''))
    into market_snapshots_before from public.player_market_value_snapshots;
  select md5(coalesce(string_agg(id||':'||status||':'||starting_budget::text||':'||target_squad_value::text||':'||rules::text,',' order by id),''))
    into leagues_before from public.leagues;

  select id into admin_id from public.profiles where role='admin' order by created_at limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  simulation := public.admin_simulate_matchday_close(
    target_round.competition_id,target_round.season,target_round.matchday,'normal'
  );
  if simulation->>'usesOfficialEngine' <> 'true' then raise exception 'La simulacion no uso el motor oficial'; end if;

  if rounds_before <> (select md5(coalesce(string_agg(id::text||':'||state||':'||coalesce(closed_at::text,''),',' order by id),'')) from public.competition_matchdays)
    or budgets_before <> (select md5(coalesce(string_agg(id::text||':'||budget::text,',' order by id),'')) from public.league_memberships)
    or results_before <> (select md5(coalesce(string_agg(matchday_id::text||':'||membership_id::text||':'||points::text||':'||payout::text,',' order by matchday_id,membership_id),'')) from public.matchday_member_results)
    or snapshots_before <> (select count(*) from public.matchday_lineup_snapshots)
    or careers_before <> (select md5(coalesce(string_agg(id::text||':'||status||':'||board_confidence::text||':'||reputation::text||':'||budget::text||':'||consecutive_failures::text,',' order by id),'')) from public.manager_careers)
    or objectives_before <> (select md5(coalesce(string_agg(id::text||':'||status||':'||current_value::text,',' order by id),'')) from public.manager_career_objectives)
    or career_reports_before <> (select count(*) from public.manager_career_matchday_reports)
    or career_events_before <> (select count(*) from public.manager_career_events)
    or challenges_before <> (select md5(coalesce(string_agg(league_id||':'||coalesce(snapshot_id::text,'')||':'||coalesce(budget::text,''),',' order by league_id),'')) from public.fantasy_challenges)
    or challenge_prices_before <> (select md5(coalesce(string_agg(league_id||':'||player_id||':'||price::text,',' order by league_id,player_id),'')) from public.fantasy_challenge_player_prices)
    or market_snapshots_before <> (select md5(coalesce(string_agg(competition_id||':'||season||':'||matchday::text||':'||player_id||':'||price::text,',' order by competition_id,season,matchday,player_id),'')) from public.player_market_value_snapshots)
    or leagues_before <> (select md5(coalesce(string_agg(id||':'||status||':'||starting_budget::text||':'||target_squad_value::text||':'||rules::text,',' order by id),'')) from public.leagues)
  then raise exception 'La simulacion modifico datos oficiales'; end if;
end $$;

rollback;
