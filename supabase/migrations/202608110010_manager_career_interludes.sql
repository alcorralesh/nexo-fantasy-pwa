-- Interludios de temporada: gestión entre jornadas con una separación excepcional.

alter table public.manager_career_rules add column if not exists interlude_enabled boolean not null default true;
alter table public.manager_career_rules add column if not exists interlude_threshold_days integer not null default 10 check (interlude_threshold_days between 5 and 30);
alter table public.manager_career_rules add column if not exists interlude_auto_activate boolean not null default true;
alter table public.manager_career_rules add column if not exists interlude_recovery_confidence integer not null default 5 check (interlude_recovery_confidence between 0 and 20);
alter table public.manager_career_rules add column if not exists interlude_tactical_protection_percent integer not null default 50 check (interlude_tactical_protection_percent between 0 and 100);
alter table public.manager_career_rules add column if not exists interlude_academy_reputation integer not null default 4 check (interlude_academy_reputation between 0 and 20);
alter table public.manager_career_rules add column if not exists interlude_commercial_budget numeric(12,2) not null default 1.50 check (interlude_commercial_budget between 0 and 10);
alter table public.manager_career_rules add column if not exists interlude_commercial_confidence_cost integer not null default 3 check (interlude_commercial_confidence_cost between 0 and 20);

create table if not exists public.manager_career_interludes (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null references public.competitions(id),
  season text not null,
  from_matchday integer not null,
  to_matchday integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  gap_days numeric(6,2) not null,
  title text not null default 'Interludio de temporada',
  status text not null default 'active' check (status in ('pending','active','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(competition_id,season,from_matchday,to_matchday),
  check (to_matchday=from_matchday+1 and ends_at>starts_at)
);

create table if not exists public.manager_career_interlude_decisions (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  interlude_id uuid not null references public.manager_career_interludes(id) on delete cascade,
  target_matchday integer not null,
  plan text not null check (plan in ('recovery','tactical','academy','commercial')),
  title text not null,
  consequence text not null,
  confidence_change integer not null default 0,
  reputation_change integer not null default 0,
  budget_change numeric(12,2) not null default 0,
  failures_reduced integer not null default 0,
  next_effect jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(career_id,interlude_id)
);

create index if not exists manager_career_interludes_lookup_idx on public.manager_career_interludes(competition_id,season,to_matchday,status);
create index if not exists manager_career_interlude_decisions_idx on public.manager_career_interlude_decisions(career_id,target_matchday);
alter table public.manager_career_interludes enable row level security;
alter table public.manager_career_interlude_decisions enable row level security;
drop policy if exists manager_career_interludes_authenticated on public.manager_career_interludes;
create policy manager_career_interludes_authenticated on public.manager_career_interludes for select to authenticated using (true);
drop policy if exists manager_career_interlude_decisions_owner on public.manager_career_interlude_decisions;
create policy manager_career_interlude_decisions_owner on public.manager_career_interlude_decisions for select using (
  exists(select 1 from public.manager_careers career where career.id=career_id and career.owner_id=auth.uid())
);

create or replace function public.ensure_manager_career_interlude(target_career_id uuid) returns public.manager_career_interludes
language plpgsql volatile security definer set search_path=public as $$
declare
  career public.manager_careers%rowtype; rules public.manager_career_rules%rowtype; previous_round public.competition_matchdays%rowtype;
  current_round public.competition_matchdays%rowtype; previous_end timestamptz; next_start timestamptz; calculated_gap numeric; result public.manager_career_interludes%rowtype;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found or career.status<>'active' then return null; end if;
  select * into rules from public.manager_career_rules where id;
  if not rules.interlude_enabled or career.current_matchday<=1 then return null; end if;
  select * into current_round from public.competition_matchdays where competition_id=career.competition_id and matchday=career.current_matchday order by season desc limit 1;
  if not found or current_round.state not in ('scheduled','open') then return null; end if;
  select * into previous_round from public.competition_matchdays where competition_id=career.competition_id and season=current_round.season and matchday=career.current_matchday-1;
  if not found or previous_round.state<>'closed' then return null; end if;
  select max(kickoff_at) into previous_end from public.match_fixtures where competition_id=career.competition_id and season=current_round.season and matchday=career.current_matchday-1 and status not in ('postponed','cancelled') and kickoff_at is not null;
  select min(kickoff_at) into next_start from public.match_fixtures where competition_id=career.competition_id and season=current_round.season and matchday=career.current_matchday and status not in ('postponed','cancelled') and kickoff_at is not null;
  if previous_end is null or next_start is null or next_start<=previous_end then return null; end if;
  calculated_gap:=extract(epoch from (next_start-previous_end))/86400.0;
  if calculated_gap<rules.interlude_threshold_days then return null; end if;
  insert into public.manager_career_interludes(competition_id,season,from_matchday,to_matchday,starts_at,ends_at,gap_days,status)
  values(career.competition_id,current_round.season,career.current_matchday-1,career.current_matchday,previous_end,next_start,calculated_gap,case when rules.interlude_auto_activate then 'active' else 'pending' end)
  on conflict(competition_id,season,from_matchday,to_matchday) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,gap_days=excluded.gap_days,updated_at=now()
  returning * into result;
  if result.status='active' and result.ends_at<=now() then update public.manager_career_interludes set status='completed',updated_at=now() where id=result.id returning * into result; end if;
  return result;
end $$;

create or replace function public.manager_career_interlude_state(target_career_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public as $$
declare
  interlude public.manager_career_interludes%rowtype; career public.manager_careers%rowtype; rules public.manager_career_rules%rowtype;
  decision public.manager_career_interlude_decisions%rowtype; choices jsonb;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  interlude:=public.ensure_manager_career_interlude(target_career_id);
  if interlude.id is null then return null; end if;
  select * into decision from public.manager_career_interlude_decisions where career_id=career.id and interlude_id=interlude.id;
  choices:=jsonb_build_array(
    jsonb_build_object('key','recovery','title','Recuperar al grupo','summary','Rebaja la tension y corta parte de una mala racha antes del regreso.','immediate','+'||rules.interlude_recovery_confidence||' confianza · reduce un fallo acumulado','returnEffect','Sin modificador pendiente para la jornada','confidenceChange',rules.interlude_recovery_confidence,'reputationChange',0,'budgetChange',0),
    jsonb_build_object('key','tactical','title','Microciclo tactico','summary','Prepara mejor el regreso y amortigua una mision fallida.','immediate','Sin cambios inmediatos','returnEffect','Reduce un '||rules.interlude_tactical_protection_percent||'% la perdida de confianza si fallas la mision de la J'||interlude.to_matchday,'confidenceChange',0,'reputationChange',0,'budgetChange',0),
    jsonb_build_object('key','academy','title','Impulsar la cantera','summary','Convierte el regreso en una prueba de identidad del club.','immediate','Sin cambios inmediatos','returnEffect','+'||rules.interlude_academy_reputation||' reputacion si el once cumple el minimo de originales','confidenceChange',0,'reputationChange',0,'budgetChange',0),
    jsonb_build_object('key','commercial','title','Activar el area comercial','summary','Genera recursos, pero resta foco deportivo antes del regreso.','immediate','+'||rules.interlude_commercial_budget||' M · -'||rules.interlude_commercial_confidence_cost||' confianza','returnEffect','Sin modificador pendiente para la jornada','confidenceChange',-rules.interlude_commercial_confidence_cost,'reputationChange',0,'budgetChange',rules.interlude_commercial_budget)
  );
  return jsonb_build_object(
    'id',interlude.id,'title',interlude.title,'status',interlude.status,'fromMatchday',interlude.from_matchday,'toMatchday',interlude.to_matchday,
    'startsAt',interlude.starts_at,'endsAt',interlude.ends_at,'gapDays',interlude.gap_days,'canDecide',interlude.status='active' and interlude.ends_at>now() and decision.id is null,
    'decision',case when decision.id is null then null else jsonb_build_object('plan',decision.plan,'title',decision.title,'consequence',decision.consequence,'confidenceChange',decision.confidence_change,'reputationChange',decision.reputation_change,'budgetChange',decision.budget_change,'failuresReduced',decision.failures_reduced,'nextEffect',decision.next_effect,'decidedAt',decision.decided_at,'appliedAt',decision.applied_at) end,
    'choices',choices
  );
end $$;

create or replace function public.save_manager_career_interlude_decision(target_career_id uuid,target_interlude_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  career public.manager_careers%rowtype; interlude public.manager_career_interludes%rowtype; rules public.manager_career_rules%rowtype;
  title text; consequence text; confidence_delta integer:=0; reputation_delta integer:=0; budget_delta numeric:=0; failures_delta integer:=0; next_effect jsonb:='{}'; result jsonb;
begin
  if target_plan not in ('recovery','tactical','academy','commercial') then raise exception 'Plan de interludio no valido'; end if;
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into interlude from public.manager_career_interludes where id=target_interlude_id and competition_id=career.competition_id and to_matchday=career.current_matchday and status='active' for update;
  if not found or interlude.ends_at<=now() then raise exception 'El interludio ya no admite decisiones'; end if;
  if exists(select 1 from public.manager_career_interlude_decisions where career_id=career.id and interlude_id=interlude.id) then raise exception 'Ya has elegido un plan para este interludio'; end if;
  select * into rules from public.manager_career_rules where id;
  if target_plan='recovery' then title:='Recuperar al grupo';confidence_delta:=rules.interlude_recovery_confidence;failures_delta:=least(1,career.consecutive_failures);consequence:='El vestuario recupera energia y reduce la presion antes del regreso.';
  elsif target_plan='tactical' then title:='Microciclo tactico';next_effect:=jsonb_build_object('type','failure_protection','percent',rules.interlude_tactical_protection_percent);consequence:='La preparacion tactica protegera parte de la confianza si falla la proxima mision.';
  elsif target_plan='academy' then title:='Impulsar la cantera';next_effect:=jsonb_build_object('type','academy_reputation','reward',rules.interlude_academy_reputation);consequence:='La cantera ganara reputacion adicional si cumple la identidad del once de regreso.';
  else title:='Activar el area comercial';budget_delta:=rules.interlude_commercial_budget;confidence_delta:=-rules.interlude_commercial_confidence_cost;consequence:='El club obtiene recursos a cambio de reducir el foco deportivo.'; end if;
  insert into public.manager_career_interlude_decisions(career_id,interlude_id,target_matchday,plan,title,consequence,confidence_change,reputation_change,budget_change,failures_reduced,next_effect)
  values(career.id,interlude.id,interlude.to_matchday,target_plan,title,consequence,confidence_delta,reputation_delta,budget_delta,failures_delta,next_effect);
  update public.manager_careers set budget=budget+budget_delta,board_confidence=greatest(0,least(100,board_confidence+confidence_delta)),reputation=greatest(0,least(100,reputation+reputation_delta)),consecutive_failures=greatest(0,consecutive_failures-failures_delta),updated_at=now() where id=career.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(career.id,'interlude',title,consequence,interlude.to_matchday,reputation_delta);
  perform public.create_nexo_notification(career.owner_id,'system','Plan de interludio confirmado',title||'. '||consequence,null,'inicio','career-interlude:'||career.id||':'||interlude.id);
  result:=public.manager_career_interlude_state(career.id); return result;
end $$;

alter function public.settle_manager_careers_for_matchday(uuid) rename to settle_manager_careers_for_matchday_rewards_base;
create or replace function public.settle_manager_careers_for_matchday(target_matchday_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare
  processed integer; selected_round public.competition_matchdays%rowtype; item record; protection integer; originals integer; reward integer;
begin
  processed:=public.settle_manager_careers_for_matchday_rewards_base(target_matchday_id);
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found or selected_round.state<>'closed' then return processed; end if;
  for item in
    select decision.*,career.owner_id,career.board_confidence,career.reputation,career.status,report.id report_id,report.mission,report.confidence_after,report.reputation_after,report.status_after
    from public.manager_career_interlude_decisions decision join public.manager_careers career on career.id=decision.career_id
    join public.manager_career_matchday_reports report on report.career_id=decision.career_id and report.matchday=decision.target_matchday
    where decision.target_matchday=selected_round.matchday and decision.applied_at is null and career.competition_id=selected_round.competition_id for update of decision
  loop
    protection:=0;reward:=0;
    if item.plan='tactical' and item.mission is not null and item.mission->>'status'='failed' then
      protection:=round(abs(coalesce((item.mission->>'penalty')::numeric,0))*coalesce((item.next_effect->>'percent')::numeric,0)/100.0);
      update public.manager_careers set board_confidence=least(100,board_confidence+protection),status=case when status='dismissed' and board_confidence+protection>(select dismissal_confidence_threshold from public.manager_career_rules where id) then 'active' else status end,updated_at=now() where id=item.career_id;
      update public.manager_career_matchday_reports set confidence_after=least(100,confidence_after+protection),status_after=case when status_after='dismissed' and confidence_after+protection>(select dismissal_confidence_threshold from public.manager_career_rules where id) then 'active' else status_after end where id=item.report_id;
    elsif item.plan='academy' then
      select count(*) into originals from public.manager_career_lineups lineup join unnest(lineup.player_ids) listed(player_id) on true join public.manager_career_players owned on owned.career_id=lineup.career_id and owned.player_id=listed.player_id and owned.is_original where lineup.career_id=item.career_id and lineup.matchday=item.target_matchday;
      if originals>=(select minimum_original_lineup from public.manager_career_rules where id) then reward:=coalesce((item.next_effect->>'reward')::integer,0); end if;
      update public.manager_careers set reputation=least(100,reputation+reward),updated_at=now() where id=item.career_id;
      update public.manager_career_matchday_reports set reputation_after=least(100,reputation_after+reward) where id=item.report_id;
    end if;
    update public.manager_career_interlude_decisions set applied_at=now() where id=item.id;
    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(item.career_id,'interlude_result','Efecto del interludio aplicado',case when item.plan='tactical' then 'Proteccion de confianza: +'||protection else 'Recompensa de identidad: +'||reward||' reputacion' end,item.target_matchday,reward);
    perform public.create_nexo_notification(item.owner_id,'matchday','El plan de interludio ya tiene resultado',case when item.plan='tactical' then 'La preparacion tactica ha protegido '||protection||' puntos de confianza.' else 'El proyecto de cantera ha concedido +'||reward||' de reputacion.' end,null,'inicio','career-interlude-result:'||item.id);
  end loop;
  with comparable as (
    select report.id,rank() over(partition by career.sports_club_id,career.difficulty,career.season_label order by coalesce((select sum(lineup.points) from public.manager_career_lineups lineup where lineup.career_id=career.id and lineup.settled_at is not null),0) desc,(select count(*) from public.manager_career_objectives objective where objective.career_id=career.id and objective.status='completed') desc,career.board_confidence desc)::integer position
    from public.manager_career_matchday_reports report join public.manager_careers career on career.id=report.career_id where report.matchday=selected_round.matchday and career.competition_id=selected_round.competition_id
  ) update public.manager_career_matchday_reports report set ranking_position=comparable.position from comparable where comparable.id=report.id;
  return processed;
end $$;

create or replace function public.admin_manager_career_interludes() returns table(id uuid,competition_id text,season text,from_matchday integer,to_matchday integer,starts_at timestamptz,ends_at timestamptz,gap_days numeric,title text,status text,decision_count bigint)
language sql stable security definer set search_path=public as $$
  select interlude.id,interlude.competition_id,interlude.season,interlude.from_matchday,interlude.to_matchday,interlude.starts_at,interlude.ends_at,interlude.gap_days,interlude.title,interlude.status,count(decision.id)
  from public.manager_career_interludes interlude left join public.manager_career_interlude_decisions decision on decision.interlude_id=interlude.id
  where exists(select 1 from public.profiles where profiles.id=auth.uid() and profiles.role='admin') group by interlude.id order by interlude.starts_at desc;
$$;

create or replace function public.update_manager_career_interlude(target_interlude_id uuid,target_status text,target_title text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administracion puede gestionar interludios'; end if;
  if target_status not in ('pending','active','cancelled','completed') then raise exception 'Estado no valido'; end if;
  if target_status='cancelled' and exists(select 1 from public.manager_career_interlude_decisions where interlude_id=target_interlude_id) then raise exception 'No se puede cancelar un interludio con decisiones registradas'; end if;
  update public.manager_career_interludes set status=target_status,title=coalesce(nullif(trim(target_title),''),title),updated_at=now() where id=target_interlude_id;
end $$;

create or replace function public.update_manager_career_rules(
  next_enabled boolean,next_free_careers integer,next_extra_cost integer,next_initial_budget numeric,next_minimum_original_squad integer,next_minimum_original_lineup integer,next_weekly_decisions boolean,next_same_club_ranking boolean,
  next_academy_cost numeric,next_failure_penalty integer,next_dismissal_threshold integer,next_relaxed_multiplier numeric,next_balanced_multiplier numeric,next_elite_multiplier numeric,next_catalog_incidents_enabled boolean,next_exit_reinvest_percent integer,next_exit_identity_percent integer,
  next_delegation_enabled boolean,next_delegation_max_uses integer,next_delegation_cooldown integer,next_delegation_warning_margin integer,next_delegation_close_ranks_cost numeric,next_delegation_tactical_cost numeric,next_delegation_academy_cost numeric,next_delegation_close_ranks_confidence integer,next_delegation_academy_multiplier numeric,next_delegation_identity_multiplier numeric,
  next_delegation_max_bonus_uses integer,next_delegation_unlocks_enabled boolean,next_delegation_unused_reward_threshold integer,next_delegation_unused_reward_coins integer,next_delegation_never_used_reward_coins integer,next_delegation_never_used_reputation integer,
  next_interlude_enabled boolean,next_interlude_threshold_days integer,next_interlude_auto_activate boolean,next_interlude_recovery_confidence integer,next_interlude_tactical_protection_percent integer,next_interlude_academy_reputation integer,next_interlude_commercial_budget numeric,next_interlude_commercial_confidence_cost integer
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administracion puede cambiar estas reglas'; end if;
  update public.manager_career_rules set enabled=next_enabled,free_careers_per_competition=next_free_careers,extra_career_coin_cost=next_extra_cost,initial_budget=next_initial_budget,minimum_original_squad=next_minimum_original_squad,minimum_original_lineup=next_minimum_original_lineup,weekly_decision_enabled=next_weekly_decisions,same_club_ranking_enabled=next_same_club_ranking,
    academy_decision_cost=next_academy_cost,failure_confidence_penalty=next_failure_penalty,dismissal_confidence_threshold=next_dismissal_threshold,relaxed_target_multiplier=next_relaxed_multiplier,balanced_target_multiplier=next_balanced_multiplier,elite_target_multiplier=next_elite_multiplier,catalog_incidents_enabled=next_catalog_incidents_enabled,exit_reinvest_percent=next_exit_reinvest_percent,exit_identity_percent=next_exit_identity_percent,
    delegation_enabled=next_delegation_enabled,delegation_max_uses=next_delegation_max_uses,delegation_cooldown_matchdays=next_delegation_cooldown,delegation_warning_margin=next_delegation_warning_margin,delegation_close_ranks_cost=next_delegation_close_ranks_cost,delegation_tactical_cost=next_delegation_tactical_cost,delegation_academy_cost=next_delegation_academy_cost,delegation_close_ranks_confidence=next_delegation_close_ranks_confidence,delegation_academy_points_multiplier=next_delegation_academy_multiplier,delegation_identity_reward_multiplier=next_delegation_identity_multiplier,
    delegation_max_bonus_uses=next_delegation_max_bonus_uses,delegation_unlocks_enabled=next_delegation_unlocks_enabled,delegation_unused_reward_threshold=next_delegation_unused_reward_threshold,delegation_unused_reward_coins=next_delegation_unused_reward_coins,delegation_never_used_reward_coins=next_delegation_never_used_reward_coins,delegation_never_used_reputation=next_delegation_never_used_reputation,
    interlude_enabled=next_interlude_enabled,interlude_threshold_days=next_interlude_threshold_days,interlude_auto_activate=next_interlude_auto_activate,interlude_recovery_confidence=next_interlude_recovery_confidence,interlude_tactical_protection_percent=next_interlude_tactical_protection_percent,interlude_academy_reputation=next_interlude_academy_reputation,interlude_commercial_budget=next_interlude_commercial_budget,interlude_commercial_confidence_cost=next_interlude_commercial_confidence_cost,updated_at=now() where id;
end $$;

revoke all on function public.ensure_manager_career_interlude(uuid),public.manager_career_interlude_state(uuid),public.save_manager_career_interlude_decision(uuid,uuid,text) from public,anon;
grant execute on function public.manager_career_interlude_state(uuid),public.save_manager_career_interlude_decision(uuid,uuid,text) to authenticated;
grant execute on function public.ensure_manager_career_interlude(uuid) to authenticated,service_role;
revoke all on function public.admin_manager_career_interludes(),public.update_manager_career_interlude(uuid,text,text) from public,anon;
grant execute on function public.admin_manager_career_interludes(),public.update_manager_career_interlude(uuid,text,text) to authenticated;
revoke all on function public.settle_manager_careers_for_matchday(uuid),public.settle_manager_careers_for_matchday_rewards_base(uuid) from public,anon,authenticated;
grant execute on function public.settle_manager_careers_for_matchday(uuid),public.settle_manager_careers_for_matchday_rewards_base(uuid) to service_role;
grant all on public.manager_career_interludes,public.manager_career_interlude_decisions to service_role;
notify pgrst,'reload schema';
