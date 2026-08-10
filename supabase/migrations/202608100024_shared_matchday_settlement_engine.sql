-- Un unico motor calcula alineaciones, puntos, pagos y clasificacion.
-- El cierre oficial persiste su salida; el simulador solo la previsualiza.

create or replace function public.resolve_matchday_settlement_lineups(target_matchday_id uuid)
returns table (
  matchday_id uuid,
  membership_id uuid,
  league_id text,
  league_name text,
  mode text,
  team_id uuid,
  team_name text,
  manager_name text,
  current_budget numeric,
  formation text,
  captain_player_id text,
  starter_player_ids text[],
  bench_player_ids text[],
  source text,
  valid boolean,
  scoring_version integer
)
language sql
stable
security definer
set search_path = public
as $$
  with round as (
    select * from public.competition_matchdays where id = target_matchday_id
  ), eligible as (
    select membership.id as membership_id, membership.league_id, membership.team_id,
      membership.budget as current_budget, league.name as league_name, league.mode::text as mode,
      team.name as team_name, profile.display_name as manager_name
    from round
    join public.leagues league on league.competition_id = round.competition_id
    join public.league_memberships membership on membership.league_id = league.id and membership.left_at is null
    join public.teams team on team.id = membership.team_id
    join public.profiles profile on profile.id = membership.user_id
    where public.league_participates_in_matchday(
      league.id, round.competition_id, round.season, round.matchday
    )
  ), frozen as (
    select snapshot.matchday_id, snapshot.membership_id, snapshot.league_id,
      eligible.league_name, eligible.mode, snapshot.team_id, eligible.team_name,
      eligible.manager_name, eligible.current_budget, snapshot.formation,
      snapshot.captain_player_id,
      coalesce(array_agg(selected.player_id order by selected.slot_order)
        filter (where selected.role = 'starter'), '{}'::text[]) as starter_player_ids,
      coalesce(array_agg(selected.player_id order by selected.slot_order)
        filter (where selected.role = 'bench'), '{}'::text[]) as bench_player_ids,
      snapshot.source, snapshot.valid, snapshot.scoring_version
    from public.matchday_lineup_snapshots snapshot
    join eligible on eligible.membership_id = snapshot.membership_id
    left join public.matchday_lineup_snapshot_players selected on selected.snapshot_id = snapshot.id
    where snapshot.matchday_id = target_matchday_id
    group by snapshot.id, eligible.league_name, eligible.mode, eligible.team_name,
      eligible.manager_name, eligible.current_budget
  ), current_lineups as (
    select round.id as matchday_id, eligible.membership_id, eligible.league_id,
      eligible.league_name, eligible.mode, eligible.team_id, eligible.team_name,
      eligible.manager_name, eligible.current_budget,
      coalesce(draft.formation, roster.formation, '4-4-2') as formation,
      coalesce(draft.captain_player_id, roster.captain_player_id) as captain_player_id,
      case when draft.id is not null then draft.starter_player_ids
           else coalesce(roster.starter_player_ids, '{}'::text[]) end as starter_player_ids,
      case when draft.id is not null then draft.bench_player_ids
           else coalesce(roster.bench_player_ids, '{}'::text[]) end as bench_player_ids,
      case when draft.id is not null then 'saved_draft'
           when roster.roster_id is not null then 'roster_fallback' else 'empty' end as source,
      draft.id is not null or roster.roster_id is not null as valid,
      round.scoring_version
    from round
    cross join eligible
    left join public.matchday_lineup_drafts draft
      on draft.membership_id = eligible.membership_id
      and draft.season = round.season and draft.matchday = round.matchday
    left join lateral (
      select base.id as roster_id, base.formation,
        coalesce(array_agg(item.player_id order by item.slot_order)
          filter (where item.is_starter), '{}'::text[]) as starter_player_ids,
        coalesce(array_agg(item.player_id order by item.slot_order)
          filter (where not item.is_starter), '{}'::text[]) as bench_player_ids,
        (array_agg(item.player_id order by case when player.position = 'DEL' then 0 else 1 end, item.slot_order)
          filter (where item.is_starter))[1] as captain_player_id
      from public.league_rosters base
      left join public.league_roster_players item on item.roster_id = base.id
      left join public.players player on player.id = item.player_id
      where base.membership_id = eligible.membership_id
      group by base.id
    ) roster on true
    where not exists (
      select 1 from public.matchday_lineup_snapshots snapshot
      where snapshot.matchday_id = round.id and snapshot.membership_id = eligible.membership_id
    )
  )
  select * from frozen
  union all
  select * from current_lineups;
$$;

create or replace function public.calculate_matchday_settlement(target_matchday_id uuid)
returns table (
  matchday_id uuid,
  membership_id uuid,
  league_id text,
  league_name text,
  mode text,
  team_name text,
  manager_name text,
  source text,
  valid boolean,
  formation text,
  captain_player_id text,
  starter_count integer,
  current_budget numeric,
  points numeric,
  payout numeric,
  calculated_rank bigint,
  player_breakdown jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with round as (
    select * from public.competition_matchdays where id = target_matchday_id
  ), calculated as (
    select lineup.matchday_id, lineup.membership_id, lineup.league_id,
      lineup.league_name, lineup.mode, lineup.team_name, lineup.manager_name,
      lineup.source, lineup.valid, lineup.formation, lineup.captain_player_id,
      cardinality(lineup.starter_player_ids)::integer as starter_count,
      lineup.current_budget,
      coalesce(score.points, 0)::numeric(12,2) as points,
      case when lineup.mode = 'market' then
        least(config.maximum_payout, greatest(config.minimum_payout, coalesce(score.points, 0) * config.money_per_point))
      else 0 end::numeric(12,2) as payout,
      coalesce(score.player_breakdown, '[]'::jsonb) as player_breakdown
    from round
    join public.resolve_matchday_settlement_lineups(target_matchday_id) lineup on true
    cross join public.matchday_lifecycle_config config
    left join lateral (
      select
        coalesce(sum(coalesce(player_points.points, 0) *
          case when listed.player_id = lineup.captain_player_id then config.captain_multiplier else 1 end), 0) as points,
        coalesce(jsonb_agg(jsonb_build_object(
          'playerId', listed.player_id,
          'rawPoints', coalesce(player_points.points, 0),
          'multiplier', case when listed.player_id = lineup.captain_player_id then config.captain_multiplier else 1 end,
          'points', coalesce(player_points.points, 0) *
            case when listed.player_id = lineup.captain_player_id then config.captain_multiplier else 1 end,
          'isCaptain', listed.player_id = lineup.captain_player_id
        ) order by listed.slot_order) filter (where listed.player_id is not null), '[]'::jsonb) as player_breakdown
      from unnest(lineup.starter_player_ids) with ordinality listed(player_id, slot_order)
      left join public.player_matchday_points player_points
        on player_points.competition_id = round.competition_id
        and player_points.season = round.season
        and player_points.matchday = round.matchday
        and player_points.player_id = listed.player_id
        and player_points.scoring_version = lineup.scoring_version
    ) score on true
  )
  select calculated.matchday_id, calculated.membership_id, calculated.league_id,
    calculated.league_name, calculated.mode, calculated.team_name, calculated.manager_name,
    calculated.source, calculated.valid, calculated.formation, calculated.captain_player_id,
    calculated.starter_count, calculated.current_budget, calculated.points, calculated.payout,
    row_number() over (
      partition by calculated.league_id
      order by calculated.points desc, calculated.membership_id
    ) as calculated_rank,
    calculated.player_breakdown
  from calculated;
$$;

create or replace function public.process_matchday_lifecycle(processed_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record record;
  locked_count integer := 0;
  closed_count integer := 0;
  payout_record record;
begin
  perform public.refresh_matchday_windows();
  for round_record in
    select * from public.competition_matchdays
    where state='open' and lock_at<=processed_at order by lock_at for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
    perform public.snapshot_matchday_lineups(round_record.id);
    update public.competition_matchdays set state='locked',locked_at=processed_at,updated_at=now()
    where id=round_record.id and state='open';
    locked_count := locked_count + 1;
  end loop;

  update public.competition_matchdays round set state='awaiting_stats',updated_at=now()
  where round.state='locked' and round.fixture_count>0
    and round.final_fixture_count=round.fixture_count and round.stats_ready_count<round.fixture_count;

  for round_record in
    select * from public.competition_matchdays
    where state in ('locked','awaiting_stats') and fixture_count>0 and stats_ready_count=fixture_count
    order by matchday for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
    insert into public.matchday_member_results (matchday_id,membership_id,league_id,points,payout)
    select result.matchday_id,result.membership_id,result.league_id,result.points,result.payout
    from public.calculate_matchday_settlement(round_record.id) result
    on conflict (matchday_id,membership_id) do nothing;

    insert into public.membership_balance_ledger (membership_id,matchday_id,kind,amount)
    select result.membership_id,result.matchday_id,'matchday_payout',result.payout
    from public.matchday_member_results result
    join public.league_memberships membership on membership.id=result.membership_id
    join public.leagues league on league.id=membership.league_id
    where result.matchday_id=round_record.id and league.mode='market'
    on conflict (membership_id,matchday_id,kind) do nothing;

    for payout_record in
      select ledger.* from public.membership_balance_ledger ledger
      where ledger.matchday_id=round_record.id and not ledger.applied for update
    loop
      update public.league_memberships set budget=budget+payout_record.amount where id=payout_record.membership_id;
      update public.membership_balance_ledger set applied=true,applied_at=now() where id=payout_record.id;
    end loop;
    update public.competition_matchdays set state='closed',closed_at=processed_at,updated_at=now()
    where id=round_record.id;
    closed_count := closed_count + 1;
  end loop;
  return jsonb_build_object('processedAt',processed_at,'locked',locked_count,'closed',closed_count);
end;
$$;

create or replace function public.admin_preview_manager_career_settlement(target_matchday_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_round public.competition_matchdays;
  career_before jsonb := '{}'::jsonb;
  objective_before jsonb := '{}'::jsonb;
  preview jsonb := jsonb_build_object('careers','[]'::jsonb,'careerCount',0,'dismissals',0);
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found then raise exception 'La jornada no existe en el calendario'; end if;

  select coalesce(jsonb_object_agg(career.id::text,jsonb_build_object(
    'confidence',career.board_confidence,'reputation',career.reputation,
    'budget',career.budget,'failures',career.consecutive_failures,'status',career.status
  )),'{}'::jsonb) into career_before
  from public.manager_careers career
  where career.competition_id=selected_round.competition_id
    and (career.status='active' or exists(
      select 1 from public.manager_career_matchday_reports report
      where report.career_id=career.id and report.matchday=selected_round.matchday
    ));

  select coalesce(jsonb_object_agg(objective.id::text,objective.status),'{}'::jsonb)
  into objective_before
  from public.manager_career_objectives objective
  where career_before ? objective.career_id::text;

  begin
    if selected_round.state <> 'closed' then
      update public.competition_matchdays
      set state='closed',closed_at=coalesce(closed_at,now()),updated_at=now()
      where id=selected_round.id;
    else
      perform public.settle_manager_careers_for_matchday(selected_round.id);
    end if;

    select jsonb_build_object(
      'careerCount',count(*),
      'dismissals',count(*) filter(where report.status_after='dismissed'),
      'atRisk',count(*) filter(where report.status_after='active' and report.consecutive_failures_after>=2),
      'careers',coalesce(jsonb_agg(jsonb_build_object(
        'careerId',career.id,'managerName',profile.display_name,'sportsClubName',sports_club.name,
        'difficulty',career.difficulty,'formation',report.formation,
        'lineupPoints',report.lineup_points,'decisionPoints',report.decision_points,'totalPoints',report.total_points,
        'mission',report.mission,'decision',report.decision,
        'confidenceBefore',coalesce((career_before->career.id::text->>'confidence')::integer,report.confidence_before),
        'confidenceAfter',report.confidence_after,
        'confidenceChange',report.confidence_after-coalesce((career_before->career.id::text->>'confidence')::integer,report.confidence_before),
        'reputationBefore',coalesce((career_before->career.id::text->>'reputation')::integer,report.reputation_before),
        'reputationAfter',report.reputation_after,
        'reputationChange',report.reputation_after-coalesce((career_before->career.id::text->>'reputation')::integer,report.reputation_before),
        'budgetBefore',coalesce((career_before->career.id::text->>'budget')::numeric,report.budget_before),
        'budgetAfter',report.budget_after,
        'consecutiveFailuresBefore',coalesce((career_before->career.id::text->>'failures')::integer,0),
        'consecutiveFailuresAfter',report.consecutive_failures_after,
        'statusBefore',coalesce(career_before->career.id::text->>'status','active'),
        'statusAfter',report.status_after,
        'wouldBeDismissed',report.status_after='dismissed',
        'objectives',coalesce((select jsonb_agg(jsonb_build_object(
          'id',objective.id,'type',objective.objective_type,'title',objective.title,
          'targetValue',objective.target_value,'currentValue',objective.current_value,
          'previousStatus',coalesce(objective_before->>objective.id::text,'active'),
          'status',objective.status,
          'changed',coalesce(objective_before->>objective.id::text,'active') is distinct from objective.status,
          'reward',objective.reputation_reward,'penalty',objective.failure_penalty
        ) order by objective.objective_type,objective.created_at)
        from public.manager_career_objectives objective where objective.career_id=career.id),'[]'::jsonb),
        'rankingPosition',report.ranking_position,'previousRankingPosition',report.previous_ranking_position
      ) order by report.status_after='dismissed' desc,report.confidence_after,profile.display_name),'[]'::jsonb)
    ) into preview
    from public.manager_career_matchday_reports report
    join public.manager_careers career on career.id=report.career_id
    join public.profiles profile on profile.id=career.owner_id
    join public.sports_clubs sports_club on sports_club.id=career.sports_club_id
    where report.matchday=selected_round.matchday
      and career.competition_id=selected_round.competition_id;

    raise exception using errcode='P9001',message='ROLLBACK_CAREER_PREVIEW';
  exception when sqlstate 'P9001' then
    null;
  end;
  return preview;
end;
$$;

create or replace function public.admin_preview_fantasy_challenge_activation(target_matchday_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_round public.competition_matchdays;
  snapshot_before jsonb := '{}'::jsonb;
  preview jsonb := jsonb_build_object('challengeCount',0,'totalPlayers',0,'challenges','[]'::jsonb);
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found then raise exception 'La jornada no existe en el calendario'; end if;

  select coalesce(jsonb_object_agg(challenge.league_id,coalesce(challenge.snapshot_id::text,'')),'{}'::jsonb)
  into snapshot_before
  from public.fantasy_challenges challenge
  join public.leagues league on league.id=challenge.league_id
  where league.competition_id=selected_round.competition_id
    and challenge.previous_matchday=selected_round.matchday
    and exists(
      select 1 from public.fantasy_challenge_fixtures selected
      join public.match_fixtures fixture on fixture.id=selected.fixture_id
      where selected.league_id=challenge.league_id and fixture.season=selected_round.season
    );

  begin
    if selected_round.state <> 'closed' then
      update public.competition_matchdays
      set state='closed',closed_at=coalesce(closed_at,now()),updated_at=now()
      where id=selected_round.id;
    else
      perform public.activate_fantasy_challenges_for_closed_matchday(
        selected_round.competition_id,selected_round.season,selected_round.matchday
      );
    end if;

    select jsonb_build_object(
      'challengeCount',count(*),
      'totalPlayers',coalesce(sum(detail.player_count),0),
      'challenges',coalesce(jsonb_agg(jsonb_build_object(
        'leagueId',challenge.league_id,'name',league.name,'description',challenge.description,
        'format',challenge.format,'lineupPolicy',challenge.lineup_policy,
        'maxPlayersPerClub',challenge.max_players_per_club,
        'budgetPercentile',challenge.budget_percentile,'budget',challenge.budget,
        'snapshotId',challenge.snapshot_id,'snapshotAt',challenge.snapshot_at,
        'alreadyPublished',coalesce(snapshot_before->>challenge.league_id,'')<>'',
        'playerCount',detail.player_count,'minimumPrice',detail.minimum_price,
        'maximumPrice',detail.maximum_price,'averagePrice',detail.average_price,
        'positionCounts',detail.position_counts,'clubs',detail.clubs,
        'fixtures',detail.fixtures,'players',detail.players
      ) order by league.featured desc,league.name),'[]'::jsonb)
    ) into preview
    from public.fantasy_challenges challenge
    join public.leagues league on league.id=challenge.league_id
    join lateral (
      select count(*)::integer player_count,min(price.price) minimum_price,max(price.price) maximum_price,
        round(avg(price.price),2) average_price,
        coalesce((select jsonb_object_agg(grouped.position,grouped.amount) from (
          select player.position,count(*) amount
          from public.fantasy_challenge_player_prices item
          join public.players player on player.id=item.player_id
          where item.league_id=challenge.league_id group by player.position
        ) grouped),'{}'::jsonb) position_counts,
        coalesce((select jsonb_agg(club.name order by club.name) from (
          select distinct sports_club.name
          from public.fantasy_challenge_player_prices item
          join public.players player on player.id=item.player_id
          join public.sports_clubs sports_club on sports_club.id=player.sports_club_id
          where item.league_id=challenge.league_id
        ) club),'[]'::jsonb) clubs,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id',player.id,'name',player.name,'initials',player.initials,'position',player.position,
          'club',sports_club.name,'photoUrl',player.photo_url,'price',item.price
        ) order by case player.position when 'POR' then 1 when 'DEF' then 2 when 'MED' then 3 else 4 end,item.price desc,player.name)
        from public.fantasy_challenge_player_prices item
        join public.players player on player.id=item.player_id
        join public.sports_clubs sports_club on sports_club.id=player.sports_club_id
        where item.league_id=challenge.league_id),'[]'::jsonb) players,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id',fixture.id,'matchday',fixture.matchday,'homeClub',fixture.home_club_name,
          'awayClub',fixture.away_club_name,'kickoffAt',fixture.kickoff_at
        ) order by selected.slot_order)
        from public.fantasy_challenge_fixtures selected
        join public.match_fixtures fixture on fixture.id=selected.fixture_id
        where selected.league_id=challenge.league_id),'[]'::jsonb) fixtures
      from public.fantasy_challenge_player_prices price
      where price.league_id=challenge.league_id
    ) detail on true
    where league.competition_id=selected_round.competition_id
      and challenge.previous_matchday=selected_round.matchday
      and exists(
        select 1 from public.fantasy_challenge_fixtures selected
        join public.match_fixtures fixture on fixture.id=selected.fixture_id
        where selected.league_id=challenge.league_id and fixture.season=selected_round.season
      );

    raise exception using errcode='P9002',message='ROLLBACK_CHALLENGE_PREVIEW';
  exception when sqlstate 'P9002' then
    null;
  end;
  return preview;
end;
$$;

create or replace function public.admin_simulate_matchday_close(
  target_competition_id text,
  target_season text,
  target_matchday integer,
  target_scenario text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_id uuid;
  simulation_result jsonb;
  selected_round public.competition_matchdays;
  challenge_count integer;
  settlement_ready boolean;
  simulated_final integer;
  blocked_reason text;
  career_preview jsonb;
  challenge_preview jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  if target_scenario not in ('normal','postponed','advanced') then
    raise exception 'Escenario de simulacion no valido';
  end if;

  select * into selected_round from public.competition_matchdays
  where competition_id=target_competition_id and season=target_season and matchday=target_matchday;
  if not found then raise exception 'La jornada no existe en el calendario'; end if;

  simulated_final := case when target_scenario='postponed'
    then greatest(0,selected_round.fixture_count-1) else selected_round.fixture_count end;
  settlement_ready := selected_round.state='closed' or (
    target_scenario<>'postponed' and selected_round.fixture_count>0
    and selected_round.stats_ready_count=selected_round.fixture_count
  );
  blocked_reason := case
    when settlement_ready then null
    when target_scenario='postponed' then 'Queda un partido aplazado: el cierre oficial esperaria sus estadisticas.'
    when selected_round.fixture_count=0 then 'La jornada no tiene partidos sincronizados.'
    else format('Solo hay estadisticas finales de %s de %s partidos.',selected_round.stats_ready_count,selected_round.fixture_count)
  end;

  career_preview := public.admin_preview_manager_career_settlement(selected_round.id);
  challenge_preview := public.admin_preview_fantasy_challenge_activation(selected_round.id);
  challenge_count := coalesce((challenge_preview->>'challengeCount')::integer,0);

  with result as (
    select * from public.calculate_matchday_settlement(selected_round.id)
  )
  select jsonb_build_object(
    'competitionId',target_competition_id,'season',target_season,'matchday',target_matchday,
    'scenario',target_scenario,'officialState',selected_round.state,
    'productionUntouched',true,'usesOfficialEngine',true,'pointsSource','player_matchday_points',
    'settlementReady',settlement_ready,'blockedReason',blocked_reason,
    'fixtureCount',selected_round.fixture_count,'statsReadyCount',selected_round.stats_ready_count,
    'simulatedFinalFixtures',simulated_final,'memberships',count(*),
    'validLineups',count(*) filter(where valid),'zeroLineups',count(*) filter(where not valid),
    'totalPoints',coalesce(sum(points),0),
    'totalPayout',case when settlement_ready then coalesce(sum(payout) filter(where mode='market'),0) else 0 end,
    'calculatedPayout',coalesce(sum(payout) filter(where mode='market'),0),
    'careerSimulation',career_preview,
    'challengeSimulation',challenge_preview,
    'marketMemberships',count(*) filter(where mode='market'),
    'fantasyMemberships',count(*) filter(where mode<>'market'),
    'challengesToActivate',challenge_count,
    'results',coalesce(jsonb_agg(jsonb_build_object(
      'membershipId',membership_id,'leagueId',league_id,'leagueName',league_name,
      'mode',mode,'economicEligible',mode='market',
      'teamName',team_name,'managerName',manager_name,'source',source,
      'valid',valid,'formation',formation,'captainPlayerId',captain_player_id,
      'starterCount',starter_count,'points',points,
      'payout',case when mode='market' and settlement_ready then payout else 0 end,
      'calculatedPayout',case when mode='market' then payout else 0 end,
      'currentBudget',current_budget,
      'simulatedBudget',current_budget+case when mode='market' and settlement_ready then payout else 0 end,
      'rank',calculated_rank,'playerBreakdown',player_breakdown
    ) order by league_name,calculated_rank),'[]'::jsonb)
  ) into simulation_result from result;

  insert into public.matchday_simulation_runs(created_by,competition_id,season,matchday,scenario,result)
  values(auth.uid(),target_competition_id,target_season,target_matchday,target_scenario,simulation_result)
  returning id into run_id;
  return simulation_result || jsonb_build_object('runId',run_id,'createdAt',now());
end;
$$;

comment on function public.calculate_matchday_settlement(uuid) is
  'Motor unico y sin efectos laterales para puntos, pagos, desglose y clasificacion de una jornada.';

revoke all on function public.resolve_matchday_settlement_lineups(uuid),
  public.calculate_matchday_settlement(uuid),
  public.admin_preview_manager_career_settlement(uuid),
  public.admin_preview_fantasy_challenge_activation(uuid) from public,anon,authenticated;
grant execute on function public.resolve_matchday_settlement_lineups(uuid),
  public.calculate_matchday_settlement(uuid),
  public.admin_preview_manager_career_settlement(uuid),
  public.admin_preview_fantasy_challenge_activation(uuid) to service_role;
notify pgrst,'reload schema';
