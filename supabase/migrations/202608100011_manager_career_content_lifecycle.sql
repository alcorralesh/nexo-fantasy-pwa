-- Integra el catálogo de misiones con el cierre y la lectura de cada Carrera.

create or replace function public.settle_manager_careers_for_matchday(target_matchday_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare selected_round public.competition_matchdays%rowtype; selected_career record; lineup_record public.manager_career_lineups%rowtype; fantasy_points numeric; captain_points numeric; decision_points numeric; originals integer; total_points numeric; rewards integer; failed_penalty integer; failure boolean; processed integer:=0; dismissal_threshold integer; max_matchday integer;
begin
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found or selected_round.state<>'closed' then return 0; end if;
  select dismissal_confidence_threshold into dismissal_threshold from public.manager_career_rules where id;
  select coalesce(max(matchday),38) into max_matchday from public.match_fixtures where competition_id=selected_round.competition_id and season=selected_round.season;
  for selected_career in select * from public.manager_careers c where c.competition_id=selected_round.competition_id and c.status='active' and not exists(select 1 from public.manager_career_events e where e.career_id=c.id and e.event_type='matchday_result' and e.matchday=selected_round.matchday) for update skip locked loop
    perform public.ensure_manager_career_content(selected_career.id,selected_round.matchday);
    select * into lineup_record from public.manager_career_lineups where career_id=selected_career.id and matchday=selected_round.matchday;
    fantasy_points:=0; captain_points:=0; decision_points:=0; originals:=0;
    if lineup_record.career_id is not null then
      select coalesce(sum(coalesce(pp.points,0)*case when listed.player_id=lineup_record.captain_id then cfg.captain_multiplier else 1 end),0),
        coalesce(max(case when listed.player_id=lineup_record.captain_id then coalesce(pp.points,0)*cfg.captain_multiplier else 0 end),0),
        count(*) filter(where cp.is_original)
      into fantasy_points,captain_points,originals
      from unnest(lineup_record.player_ids) listed(player_id)
      join public.manager_career_players cp on cp.career_id=selected_career.id and cp.player_id=listed.player_id
      cross join public.matchday_lifecycle_config cfg
      left join public.player_matchday_points pp on pp.competition_id=selected_round.competition_id and pp.season=selected_round.season and pp.matchday=selected_round.matchday and pp.player_id=listed.player_id and pp.scoring_version=selected_round.scoring_version;
    end if;
    select coalesce(sum(sporting_points_change+case when conditional_original_target is not null and originals>=conditional_original_target then conditional_sporting_bonus else 0 end),0) into decision_points from public.manager_career_decisions where career_id=selected_career.id and matchday=selected_round.matchday;
    total_points:=fantasy_points+decision_points;
    update public.manager_career_lineups set points=total_points,locked_at=coalesce(locked_at,selected_round.locked_at),settled_at=now() where career_id=selected_career.id and matchday=selected_round.matchday;
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
    select coalesce(sum(reputation_reward),0) into rewards from public.manager_career_objectives where career_id=selected_career.id and status='active' and current_value>=target_value;
    update public.manager_career_objectives set status='completed',updated_at=now() where career_id=selected_career.id and status='active' and current_value>=target_value;
    select coalesce(max(failure_penalty),0) into failed_penalty from public.manager_career_objectives where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value;
    select exists(select 1 from public.manager_career_objectives where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value) into failure;
    update public.manager_career_objectives set status='failed',updated_at=now() where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value;
    update public.manager_careers set sporting_points=sporting_points+total_points,objective_points=objective_points+rewards,reputation=greatest(0,least(100,reputation+rewards)),board_confidence=greatest(0,least(100,board_confidence+rewards-case when failure then failed_penalty else 0 end)),consecutive_failures=case when failure then consecutive_failures+1 else 0 end,current_matchday=least(max_matchday,greatest(current_matchday,selected_round.matchday+1)),updated_at=now() where id=selected_career.id;
    update public.manager_careers set status='dismissed',updated_at=now() where id=selected_career.id and board_confidence<=dismissal_threshold and consecutive_failures>=3;
    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
    select id,'dismissal','La directiva pone fin a tu etapa','Tres misiones fallidas consecutivas y una confianza de '||board_confidence||'/100.',selected_round.matchday,0
    from public.manager_careers where id=selected_career.id and status='dismissed'
      and not exists(select 1 from public.manager_career_events event where event.career_id=selected_career.id and event.event_type='dismissal');
    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(selected_career.id,'matchday_result','Jornada evaluada',total_points||' puntos · '||case when failure then 'misión incumplida' else 'misión completada' end,selected_round.matchday,rewards-case when failure then failed_penalty else 0 end);
    processed:=processed+1;
  end loop;
  return processed;
end $$;

create or replace function public.sync_manager_careers_with_matchday() returns trigger
language plpgsql security definer set search_path=public as $$
declare career_row record;
begin
  if new.state='locked' and old.state is distinct from new.state then
    update public.manager_career_lineups l set locked_at=coalesce(l.locked_at,new.locked_at,now()) from public.manager_careers c where c.id=l.career_id and c.competition_id=new.competition_id and l.matchday=new.matchday;
    update public.manager_careers set current_matchday=current_matchday+1,updated_at=now() where competition_id=new.competition_id and current_matchday=new.matchday and status='active';
    for career_row in select id,current_matchday from public.manager_careers where competition_id=new.competition_id and status='active' loop perform public.ensure_manager_career_content(career_row.id,career_row.current_matchday); end loop;
  end if;
  if new.state='closed' and old.state is distinct from new.state then perform public.settle_manager_careers_for_matchday(new.id); end if;
  return new;
end $$;

create or replace function public.manager_career_workspace(target_career_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public as $$
declare selected_career public.manager_careers%rowtype; result jsonb;
begin
  select * into selected_career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  if selected_career.status='active' then perform public.ensure_manager_career_content(selected_career.id,selected_career.current_matchday); end if;
  select * into selected_career from public.manager_careers where id=target_career_id;
  select jsonb_build_object(
    'career',jsonb_build_object('id',selected_career.id,'matchday',selected_career.current_matchday,'budget',selected_career.budget,'boardConfidence',selected_career.board_confidence,'consecutiveFailures',selected_career.consecutive_failures,'contractTier',selected_career.contract_tier,'status',selected_career.status),
    'squad',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'value',p.market_value,'photoUrl',p.photo_url,'isOriginal',cp.is_original,'acquisitionValue',cp.acquisition_value) order by p.position,p.name) from public.manager_career_players cp join public.players p on p.id=cp.player_id join public.sports_clubs sc on sc.id=p.sports_club_id where cp.career_id=selected_career.id),'[]'::jsonb),
    'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchday',l.matchday,'formation',l.formation,'captainId',l.captain_id,'playerIds',l.player_ids,'savedAt',l.saved_at,'lockedAt',l.locked_at,'points',l.points) order by l.matchday desc) from public.manager_career_lineups l where l.career_id=selected_career.id),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(jsonb_build_object('matchday',d.matchday,'decisionKey',d.decision_key,'choiceKey',d.choice_key,'choiceTitle',d.choice_title,'consequence',d.consequence,'reputationChange',d.reputation_change,'confidenceChange',d.confidence_change,'budgetChange',d.budget_change,'sportingPointsChange',d.sporting_points_change,'conditionalOriginalTarget',d.conditional_original_target,'conditionalSportingBonus',d.conditional_sporting_bonus,'decidedAt',d.decided_at) order by d.matchday desc) from public.manager_career_decisions d where d.career_id=selected_career.id),'[]'::jsonb),
    'objectives',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'type',o.objective_type,'title',o.title,'description',o.description,'targetValue',o.target_value,'currentValue',o.current_value,'reputationReward',o.reputation_reward,'failurePenalty',o.failure_penalty,'status',o.status,'expiresMatchday',o.expires_matchday,'metricKey',o.metric_key) order by case o.objective_type when 'season' then 0 when 'identity' then 1 when 'matchday' then 2 else 3 end) from public.manager_career_objectives o where o.career_id=selected_career.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('type',e.event_type,'title',e.title,'detail',e.detail,'matchday',e.matchday,'reputationChange',e.reputation_change,'createdAt',e.created_at) order by e.created_at desc) from public.manager_career_events e where e.career_id=selected_career.id),'[]'::jsonb),
    'decisionPrompt',case when selected_career.status='active' then public.manager_career_decision_prompt(target_career_id) else null end,
    'market',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'value',p.market_value,'photoUrl',p.photo_url) order by p.market_value desc,p.name) from public.players p join public.sports_clubs sc on sc.id=p.sports_club_id where p.competition_id=selected_career.competition_id and p.active and not exists(select 1 from public.manager_career_players cp where cp.career_id=selected_career.id and cp.player_id=p.id)),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.settle_manager_careers_for_matchday(uuid) from public,anon,authenticated;
grant execute on function public.settle_manager_careers_for_matchday(uuid) to service_role;
notify pgrst,'reload schema';
