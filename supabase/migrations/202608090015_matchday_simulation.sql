-- Simulaciones administrativas de cierre completamente aisladas de la temporada real.
-- Solo se conserva el informe; no se modifican jornadas, puntos, saldos, rankings ni retos.

create table if not exists public.matchday_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null check (matchday between 1 and 50),
  scenario text not null check (scenario in ('normal','postponed','advanced')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists matchday_simulation_runs_admin_idx
  on public.matchday_simulation_runs(created_by, created_at desc);

create or replace function public.admin_simulate_matchday_close(
  target_competition_id text,
  target_season text,
  target_matchday integer,
  target_scenario text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  run_id uuid;
  simulation_result jsonb;
  selected_round public.competition_matchdays;
  config public.matchday_lifecycle_config;
  challenge_count integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  if target_scenario not in ('normal','postponed','advanced') then
    raise exception 'Escenario de simulación no válido';
  end if;

  select * into selected_round
    from public.competition_matchdays
   where competition_id = target_competition_id
     and season = target_season
     and matchday = target_matchday;
  if not found then raise exception 'La jornada no existe en el calendario'; end if;

  select * into config from public.matchday_lifecycle_config where id = true;
  select count(*) into challenge_count
    from public.fantasy_challenges challenge
    join public.leagues league on league.id = challenge.league_id
   where league.competition_id = target_competition_id
     and challenge.previous_matchday = target_matchday
     and challenge.snapshot_id is null;

  with active_members as (
    select membership.id as membership_id, membership.league_id, membership.budget,
           league.name as league_name, league.mode, membership.team_id,
           team.name as team_name, profile.display_name as manager_name
      from public.league_memberships membership
      join public.leagues league on league.id = membership.league_id
      join public.teams team on team.id = membership.team_id
      join public.profiles profile on profile.id = membership.user_id
     where membership.left_at is null and league.competition_id = target_competition_id
  ), roster_starters as (
    select roster.membership_id, array_agg(player.player_id order by player.slot_order) filter (where player.is_starter) as starter_ids,
           (array_agg(player.player_id order by case when catalog.position = 'DEL' then 0 else 1 end, player.slot_order) filter (where player.is_starter))[1] as captain_id
      from public.league_rosters roster
      join public.league_roster_players player on player.roster_id = roster.id
      join public.players catalog on catalog.id = player.player_id
     group by roster.membership_id
  ), prepared as (
    select member.*,
           case when draft.id is not null then draft.starter_player_ids
                when member.mode = 'market' then coalesce(roster.starter_ids, '{}'::text[])
                else '{}'::text[] end as starter_ids,
           case when draft.id is not null then draft.captain_player_id
                when member.mode = 'market' then roster.captain_id
                else null end as captain_id,
           case when draft.id is not null then 'saved_draft'
                when member.mode = 'market' and cardinality(coalesce(roster.starter_ids, '{}'::text[])) = 11 then 'roster_fallback'
                else 'empty' end as source
      from active_members member
      left join public.matchday_lineup_drafts draft
        on draft.membership_id = member.membership_id
       and draft.season = target_season and draft.matchday = target_matchday
      left join roster_starters roster on roster.membership_id = member.membership_id
  ), player_scores as (
    select prepared.membership_id,
           sum((1 + (get_byte(decode(substr(md5(selected.player_id || ':' || target_season || ':' || target_matchday::text), 1, 2), 'hex'), 0) % 10))
             * case when selected.player_id = prepared.captain_id then config.captain_multiplier else 1 end)::numeric as points
      from prepared
      left join lateral unnest(prepared.starter_ids) selected(player_id) on true
     group by prepared.membership_id
  ), calculated as (
    select prepared.*,
           case when prepared.source = 'empty' then 0 else coalesce(player_scores.points, 0) end::numeric(12,2) as points,
           least(config.maximum_payout, greatest(config.minimum_payout,
             case when prepared.source = 'empty' then 0 else coalesce(player_scores.points, 0) * config.money_per_point end))::numeric(12,2) as payout
      from prepared
      left join player_scores on player_scores.membership_id = prepared.membership_id
  ), ranked as (
    select calculated.*,
           row_number() over (partition by calculated.league_id order by calculated.points desc, calculated.membership_id) as simulated_rank
      from calculated
  )
  select jsonb_build_object(
    'competitionId', target_competition_id,
    'season', target_season,
    'matchday', target_matchday,
    'scenario', target_scenario,
    'officialState', selected_round.state,
    'productionUntouched', true,
    'fixtureCount', selected_round.fixture_count,
    'simulatedFinalFixtures', case when target_scenario = 'postponed' then greatest(0, selected_round.fixture_count - 1) else selected_round.fixture_count end,
    'memberships', count(*),
    'validLineups', count(*) filter (where source <> 'empty'),
    'zeroLineups', count(*) filter (where source = 'empty'),
    'totalPoints', coalesce(sum(points), 0),
    'totalPayout', coalesce(sum(payout), 0),
    'challengesToActivate', challenge_count,
    'results', coalesce(jsonb_agg(jsonb_build_object(
      'membershipId', membership_id,
      'leagueId', league_id,
      'leagueName', league_name,
      'mode', mode,
      'teamName', team_name,
      'managerName', manager_name,
      'source', source,
      'points', points,
      'payout', payout,
      'currentBudget', budget,
      'simulatedBudget', budget + payout,
      'rank', simulated_rank
    ) order by league_name, simulated_rank), '[]'::jsonb)
  ) into simulation_result
  from ranked;

  insert into public.matchday_simulation_runs(created_by, competition_id, season, matchday, scenario, result)
  values (auth.uid(), target_competition_id, target_season, target_matchday, target_scenario, simulation_result)
  returning id into run_id;

  return simulation_result || jsonb_build_object('runId', run_id, 'createdAt', now());
end;
$$;

create or replace function public.admin_delete_matchday_simulation(target_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  delete from public.matchday_simulation_runs where id = target_run_id and created_by = auth.uid();
end;
$$;

alter table public.matchday_simulation_runs enable row level security;
revoke all on public.matchday_simulation_runs from anon, authenticated;
grant all on public.matchday_simulation_runs to service_role;
grant execute on function public.admin_simulate_matchday_close(text,text,integer,text) to authenticated;
grant execute on function public.admin_delete_matchday_simulation(uuid) to authenticated;
