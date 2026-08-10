-- Acta inmutable de cada jornada de Carrera.

create table if not exists public.manager_career_matchday_reports (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  matchday integer not null check (matchday > 0),
  formation text,
  captain_id text references public.players(id),
  player_breakdown jsonb not null default '[]'::jsonb,
  lineup_points numeric(12,2) not null default 0,
  decision_points numeric(12,2) not null default 0,
  total_points numeric(12,2) not null default 0,
  mission jsonb,
  decision jsonb,
  confidence_before integer not null,
  confidence_after integer not null,
  reputation_before integer not null,
  reputation_after integer not null,
  budget_before numeric(12,2) not null,
  budget_after numeric(12,2) not null,
  consecutive_failures_after integer not null default 0,
  status_after text not null,
  ranking_position integer,
  previous_ranking_position integer,
  created_at timestamptz not null default now(),
  unique(career_id,matchday)
);

create index if not exists manager_career_reports_idx on public.manager_career_matchday_reports(career_id,matchday desc);
alter table public.manager_career_matchday_reports enable row level security;
drop policy if exists manager_career_reports_owner on public.manager_career_matchday_reports;
create policy manager_career_reports_owner on public.manager_career_matchday_reports for select using (
  exists(select 1 from public.manager_careers career where career.id=career_id and career.owner_id=auth.uid())
);

create or replace function public.settle_manager_careers_for_matchday(target_matchday_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare
  selected_round public.competition_matchdays%rowtype;
  selected_career record;
  final_career public.manager_careers%rowtype;
  lineup_record public.manager_career_lineups%rowtype;
  mission_record public.manager_career_objectives%rowtype;
  fantasy_points numeric;
  captain_points numeric;
  decision_points numeric;
  originals integer;
  total_points numeric;
  rewards integer;
  failed_penalty integer;
  failure boolean;
  processed integer:=0;
  dismissal_threshold integer;
  max_matchday integer;
  player_breakdown jsonb;
  decision_snapshot jsonb;
begin
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found or selected_round.state<>'closed' then return 0; end if;
  select dismissal_confidence_threshold into dismissal_threshold from public.manager_career_rules where id;
  select coalesce(max(matchday),38) into max_matchday from public.match_fixtures where competition_id=selected_round.competition_id and season=selected_round.season;

  for selected_career in
    select * from public.manager_careers career
    where career.competition_id=selected_round.competition_id and career.status='active'
      and not exists(select 1 from public.manager_career_matchday_reports report where report.career_id=career.id and report.matchday=selected_round.matchday)
    for update skip locked
  loop
    perform public.ensure_manager_career_content(selected_career.id,selected_round.matchday);
    select * into lineup_record from public.manager_career_lineups where career_id=selected_career.id and matchday=selected_round.matchday;
    fantasy_points:=0; captain_points:=0; decision_points:=0; originals:=0; player_breakdown:='[]'::jsonb;

    if lineup_record.career_id is not null then
      select
        coalesce(sum(coalesce(points.points,0)*case when listed.player_id=lineup_record.captain_id then config.captain_multiplier else 1 end),0),
        coalesce(max(case when listed.player_id=lineup_record.captain_id then coalesce(points.points,0)*config.captain_multiplier else 0 end),0),
        count(*) filter(where career_player.is_original)
      into fantasy_points,captain_points,originals
      from unnest(lineup_record.player_ids) listed(player_id)
      join public.manager_career_players career_player on career_player.career_id=selected_career.id and career_player.player_id=listed.player_id
      cross join public.matchday_lifecycle_config config
      left join public.player_matchday_points points on points.competition_id=selected_round.competition_id and points.season=selected_round.season and points.matchday=selected_round.matchday and points.player_id=listed.player_id and points.scoring_version=selected_round.scoring_version;

      select coalesce(jsonb_agg(jsonb_build_object(
        'playerId',player.id,'name',player.name,'initials',player.initials,'position',player.position,'photoUrl',player.photo_url,
        'isCaptain',player.id=lineup_record.captain_id,'basePoints',coalesce(points.points,0),
        'multiplier',case when player.id=lineup_record.captain_id then config.captain_multiplier else 1 end,
        'finalPoints',coalesce(points.points,0)*case when player.id=lineup_record.captain_id then config.captain_multiplier else 1 end
      ) order by case player.position when 'POR' then 1 when 'DEF' then 2 when 'MED' then 3 else 4 end,player.name),'[]'::jsonb)
      into player_breakdown
      from unnest(lineup_record.player_ids) listed(player_id)
      join public.players player on player.id=listed.player_id
      cross join public.matchday_lifecycle_config config
      left join public.player_matchday_points points on points.competition_id=selected_round.competition_id and points.season=selected_round.season and points.matchday=selected_round.matchday and points.player_id=listed.player_id and points.scoring_version=selected_round.scoring_version;
    end if;

    select coalesce(sum(sporting_points_change+case when conditional_original_target is not null and originals>=conditional_original_target then conditional_sporting_bonus else 0 end),0)
    into decision_points from public.manager_career_decisions where career_id=selected_career.id and matchday=selected_round.matchday;
    total_points:=fantasy_points+decision_points;

    update public.manager_career_lineups set points=total_points,locked_at=coalesce(locked_at,selected_round.locked_at),settled_at=now()
    where career_id=selected_career.id and matchday=selected_round.matchday;

    update public.manager_career_objectives set current_value=case
      when objective_type='matchday' and metric_key='points' then total_points
      when objective_type='matchday' and metric_key='originals' then originals
      when objective_type='matchday' and metric_key='captain_points' then captain_points
      when objective_type='matchday' and metric_key='new_signings' then greatest(0,11-originals)
      when objective_type='matchday' and metric_key='budget_floor' then selected_career.budget
      when objective_type='season' then selected_career.sporting_points+total_points
      when objective_type='identity' then (select count(*) from public.manager_career_players where career_id=selected_career.id and is_original)
      when objective_type='confidence' then selected_career.board_confidence
      else current_value end,updated_at=now()
    where career_id=selected_career.id and status='active' and (objective_type<>'matchday' or expires_matchday=selected_round.matchday);

    select coalesce(sum(reputation_reward),0) into rewards from public.manager_career_objectives
    where career_id=selected_career.id and status='active' and current_value>=target_value;
    update public.manager_career_objectives set status='completed',updated_at=now()
    where career_id=selected_career.id and status='active' and current_value>=target_value;
    select coalesce(max(failure_penalty),0) into failed_penalty from public.manager_career_objectives
    where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value;
    select exists(select 1 from public.manager_career_objectives where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value) into failure;
    update public.manager_career_objectives set status='failed',updated_at=now()
    where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value;

    select * into mission_record from public.manager_career_objectives
    where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday order by created_at limit 1;
    select jsonb_build_object('choiceTitle',choice_title,'consequence',consequence,'reputationChange',reputation_change,'confidenceChange',confidence_change,'budgetChange',budget_change,'sportingPointsChange',sporting_points_change,'conditionalOriginalTarget',conditional_original_target,'conditionalSportingBonus',conditional_sporting_bonus,'conditionMet',conditional_original_target is null or originals>=conditional_original_target)
    into decision_snapshot from public.manager_career_decisions where career_id=selected_career.id and matchday=selected_round.matchday order by decided_at limit 1;

    update public.manager_careers set sporting_points=sporting_points+total_points,objective_points=objective_points+rewards,
      reputation=greatest(0,least(100,reputation+rewards)),
      board_confidence=greatest(0,least(100,board_confidence+rewards-case when failure then failed_penalty else 0 end)),
      consecutive_failures=case when failure then consecutive_failures+1 else 0 end,
      current_matchday=least(max_matchday,greatest(current_matchday,selected_round.matchday+1)),updated_at=now()
    where id=selected_career.id returning * into final_career;
    update public.manager_careers set status='dismissed',updated_at=now()
    where id=selected_career.id and board_confidence<=dismissal_threshold and consecutive_failures>=3 returning * into final_career;
    if final_career.id is null then select * into final_career from public.manager_careers where id=selected_career.id; end if;

    insert into public.manager_career_matchday_reports(
      career_id,matchday,formation,captain_id,player_breakdown,lineup_points,decision_points,total_points,mission,decision,
      confidence_before,confidence_after,reputation_before,reputation_after,budget_before,budget_after,consecutive_failures_after,status_after
    ) values (
      selected_career.id,selected_round.matchday,lineup_record.formation,lineup_record.captain_id,player_breakdown,fantasy_points,decision_points,total_points,
      case when mission_record.id is null then null else jsonb_build_object('id',mission_record.id,'title',mission_record.title,'description',mission_record.description,'metricKey',mission_record.metric_key,'targetValue',mission_record.target_value,'currentValue',mission_record.current_value,'status',mission_record.status,'reward',mission_record.reputation_reward,'penalty',mission_record.failure_penalty) end,
      decision_snapshot,selected_career.board_confidence,final_career.board_confidence,selected_career.reputation,final_career.reputation,selected_career.budget,final_career.budget,final_career.consecutive_failures,final_career.status
    ) on conflict(career_id,matchday) do nothing;

    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
    select id,'dismissal','La directiva pone fin a tu etapa','Tres misiones fallidas consecutivas y una confianza de '||board_confidence||'/100.',selected_round.matchday,0
    from public.manager_careers where id=selected_career.id and status='dismissed'
      and not exists(select 1 from public.manager_career_events event where event.career_id=selected_career.id and event.event_type='dismissal');
    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
    values(selected_career.id,'matchday_result','Jornada evaluada',total_points||' puntos · '||case when failure then 'misión incumplida' else 'misión completada' end,selected_round.matchday,rewards-case when failure then failed_penalty else 0 end);
    processed:=processed+1;
  end loop;

  with comparable as (
    select report.id,
      rank() over(partition by career.sports_club_id,career.difficulty,career.season_label order by
        coalesce((select sum(lineup.points) from public.manager_career_lineups lineup where lineup.career_id=career.id and lineup.settled_at is not null),0) desc,
        (select count(*) from public.manager_career_objectives objective where objective.career_id=career.id and objective.status='completed') desc,
        career.board_confidence desc)::integer as position,
      (select previous.ranking_position from public.manager_career_matchday_reports previous where previous.career_id=career.id and previous.matchday=selected_round.matchday-1) as previous_position
    from public.manager_career_matchday_reports report join public.manager_careers career on career.id=report.career_id
    where report.matchday=selected_round.matchday and career.competition_id=selected_round.competition_id
  )
  update public.manager_career_matchday_reports report set ranking_position=comparable.position,previous_ranking_position=comparable.previous_position
  from comparable where comparable.id=report.id;
  return processed;
end $$;

create or replace function public.manager_career_matchday_reports(target_career_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'matchday',report.matchday,'formation',report.formation,'captainId',report.captain_id,'players',report.player_breakdown,
    'lineupPoints',report.lineup_points,'decisionPoints',report.decision_points,'totalPoints',report.total_points,
    'mission',report.mission,'decision',report.decision,'confidenceBefore',report.confidence_before,'confidenceAfter',report.confidence_after,
    'reputationBefore',report.reputation_before,'reputationAfter',report.reputation_after,'budgetBefore',report.budget_before,'budgetAfter',report.budget_after,
    'consecutiveFailuresAfter',report.consecutive_failures_after,'statusAfter',report.status_after,'rankingPosition',report.ranking_position,
    'previousRankingPosition',report.previous_ranking_position,'createdAt',report.created_at
  ) order by report.matchday desc),'[]'::jsonb)
  from public.manager_career_matchday_reports report join public.manager_careers career on career.id=report.career_id
  where report.career_id=target_career_id and career.owner_id=auth.uid();
$$;

revoke all on function public.settle_manager_careers_for_matchday(uuid) from public,anon,authenticated;
grant execute on function public.settle_manager_careers_for_matchday(uuid) to service_role;
revoke all on function public.manager_career_matchday_reports(uuid) from public,anon;
grant execute on function public.manager_career_matchday_reports(uuid) to authenticated;
grant all on public.manager_career_matchday_reports to service_role;
notify pgrst,'reload schema';
