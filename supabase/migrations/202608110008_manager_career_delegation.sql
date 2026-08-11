-- Delegacion temporal de una jornada en Carrera de manager.

alter table public.manager_career_rules add column if not exists delegation_enabled boolean not null default true;
alter table public.manager_career_rules add column if not exists delegation_max_uses integer not null default 2 check (delegation_max_uses between 0 and 10);
alter table public.manager_career_rules add column if not exists delegation_cooldown_matchdays integer not null default 2 check (delegation_cooldown_matchdays between 0 and 10);
alter table public.manager_career_rules add column if not exists delegation_warning_margin integer not null default 10 check (delegation_warning_margin between 0 and 50);
alter table public.manager_career_rules add column if not exists delegation_close_ranks_cost numeric(12,2) not null default 0.50 check (delegation_close_ranks_cost >= 0);
alter table public.manager_career_rules add column if not exists delegation_tactical_cost numeric(12,2) not null default 0.50 check (delegation_tactical_cost >= 0);
alter table public.manager_career_rules add column if not exists delegation_academy_cost numeric(12,2) not null default 0.75 check (delegation_academy_cost >= 0);
alter table public.manager_career_rules add column if not exists delegation_close_ranks_confidence integer not null default 6 check (delegation_close_ranks_confidence between 0 and 30);
alter table public.manager_career_rules add column if not exists delegation_academy_points_multiplier numeric(5,2) not null default 1.10 check (delegation_academy_points_multiplier between 1 and 1.50);
alter table public.manager_career_rules add column if not exists delegation_identity_reward_multiplier numeric(5,2) not null default 2.00 check (delegation_identity_reward_multiplier between 1 and 3);

alter table public.manager_career_lineups add column if not exists vice_captain_id text references public.players(id);
alter table public.manager_career_lineups add column if not exists delegated boolean not null default false;

create table if not exists public.manager_career_delegations (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  matchday integer not null check (matchday > 0),
  plan text not null check (plan in ('close_ranks','tactical','academy')),
  status text not null default 'scheduled' check (status in ('scheduled','settled','cancelled')),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  confidence_change integer not null default 0,
  failures_reduced integer not null default 0,
  formation text not null,
  captain_id text not null references public.players(id),
  vice_captain_id text references public.players(id),
  player_ids text[] not null,
  fallback_player_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique(career_id,matchday)
);

create index if not exists manager_career_delegations_career_idx on public.manager_career_delegations(career_id,matchday desc);
alter table public.manager_career_delegations enable row level security;
drop policy if exists manager_career_delegations_owner on public.manager_career_delegations;
create policy manager_career_delegations_owner on public.manager_career_delegations for select using (
  exists(select 1 from public.manager_careers career where career.id=career_id and career.owner_id=auth.uid())
);

create or replace function public.manager_career_delegation_state(target_career_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  career public.manager_careers%rowtype;
  rules public.manager_career_rules%rowtype;
  current_delegation public.manager_career_delegations%rowtype;
  used integer;
  last_matchday integer;
  unavailable integer;
  lineup_size integer;
  pending_incident boolean;
  reasons jsonb:='[]'::jsonb;
  blocked text;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  select * into current_delegation from public.manager_career_delegations where career_id=career.id and matchday=career.current_matchday and status='scheduled';
  select count(*),max(matchday) into used,last_matchday from public.manager_career_delegations where career_id=career.id and status<>'cancelled';
  select count(*) into unavailable from public.manager_career_players owned join public.players player on player.id=owned.player_id where owned.career_id=career.id and not player.active;
  select coalesce(array_length(player_ids,1),0) into lineup_size from public.manager_career_lineups where career_id=career.id and matchday=career.current_matchday;
  select exists(select 1 from public.manager_career_catalog_incidents incident where incident.career_id=career.id and incident.status in ('pending','resolving')) into pending_incident;

  if career.board_confidence<=rules.dismissal_confidence_threshold+rules.delegation_warning_margin then reasons:=reasons||jsonb_build_array('Confianza cerca del umbral de destitucion'); end if;
  if career.consecutive_failures>=2 then reasons:=reasons||jsonb_build_array('Dos objetivos fallados de forma consecutiva'); end if;
  if lineup_size<>11 then reasons:=reasons||jsonb_build_array('El once de la jornada no esta completo'); end if;
  if unavailable>=2 then reasons:=reasons||jsonb_build_array(unavailable||' jugadores de la plantilla no disponibles'); end if;

  if not rules.delegation_enabled then blocked:='La delegacion esta desactivada por Administracion';
  elsif career.status<>'active' then blocked:='La Carrera no esta activa';
  elsif pending_incident then blocked:='Resuelve primero el incidente de plantilla pendiente';
  elsif current_delegation.id is not null then blocked:='La jornada ya esta delegada';
  elsif used>=rules.delegation_max_uses then blocked:='Has agotado las delegaciones de esta temporada';
  elsif last_matchday is not null and career.current_matchday-last_matchday<=rules.delegation_cooldown_matchdays then blocked:='Debes esperar hasta la Jornada '||(last_matchday+rules.delegation_cooldown_matchdays+1);
  elsif exists(select 1 from public.manager_career_decisions decision where decision.career_id=career.id and decision.matchday=career.current_matchday) then blocked:='Ya has tomado la decision semanal de esta jornada';
  end if;

  return jsonb_build_object(
    'enabled',rules.delegation_enabled,'eligible',blocked is null,'blockingReason',blocked,
    'used',used,'maximum',rules.delegation_max_uses,'remaining',greatest(0,rules.delegation_max_uses-used),
    'cooldownMatchdays',rules.delegation_cooldown_matchdays,'nextAvailableMatchday',case when last_matchday is null then career.current_matchday else last_matchday+rules.delegation_cooldown_matchdays+1 end,
    'recommended',jsonb_array_length(reasons)>0,'recommendationReasons',reasons,
    'current',case when current_delegation.id is null then null else jsonb_build_object(
      'id',current_delegation.id,'matchday',current_delegation.matchday,'plan',current_delegation.plan,'status',current_delegation.status,
      'cost',current_delegation.cost,'confidenceChange',current_delegation.confidence_change,'failuresReduced',current_delegation.failures_reduced,
      'formation',current_delegation.formation,'captainId',current_delegation.captain_id,'viceCaptainId',current_delegation.vice_captain_id,
      'playerIds',current_delegation.player_ids,'fallbackPlayerIds',current_delegation.fallback_player_ids,'createdAt',current_delegation.created_at
    ) end,
    'plans',jsonb_build_array(
      jsonb_build_object('key','close_ranks','title','Cerrar filas','cost',rules.delegation_close_ranks_cost,'confidenceChange',rules.delegation_close_ranks_confidence,'failuresReduced',1,'description','Recupera respaldo inmediato y corta una parte de la mala racha.'),
      jsonb_build_object('key','tactical','title','Golpe tactico','cost',rules.delegation_tactical_cost,'confidenceChange',0,'failuresReduced',0,'description','Designa vicecapitan y suplentes por posicion para cubrir ausencias reales.'),
      jsonb_build_object('key','academy','title','Proyecto de cantera','cost',rules.delegation_academy_cost,'confidenceChange',0,'failuresReduced',0,'pointsMultiplier',rules.delegation_academy_points_multiplier,'identityRewardMultiplier',rules.delegation_identity_reward_multiplier,'description','Prioriza originales y potencia sus puntos y la recompensa de identidad.')
    )
  );
end $$;

create or replace function public.delegate_manager_career_matchday(target_career_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  career public.manager_careers%rowtype;
  rules public.manager_career_rules%rowtype;
  state jsonb;
  plan_cost numeric;
  confidence_delta integer:=0;
  failures_delta integer:=0;
  formation_row record;
  selected_ids text[];
  candidate_ids text[];
  fallback_ids text[]:='{}';
  captain text;
  vice_captain text;
  originals integer;
  position_key text;
  required_count integer;
  delegation_id uuid;
begin
  if target_plan not in ('close_ranks','tactical','academy') then raise exception 'Plan de delegacion no valido'; end if;
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  state:=public.manager_career_delegation_state(career.id);
  if not coalesce((state->>'eligible')::boolean,false) then raise exception '%',coalesce(state->>'blockingReason','No puedes delegar esta jornada'); end if;
  plan_cost:=case target_plan when 'close_ranks' then rules.delegation_close_ranks_cost when 'tactical' then rules.delegation_tactical_cost else rules.delegation_academy_cost end;
  if career.budget<plan_cost then raise exception 'No tienes presupuesto suficiente para este plan'; end if;

  for formation_row in select * from (values
    ('4-4-2',1,4,4,2,1),('4-3-3',1,4,3,3,2),('3-4-3',1,3,4,3,3),('3-5-2',1,3,5,2,4),('5-3-2',1,5,3,2,5)
  ) as formations(name,por_count,def_count,med_count,del_count,priority) order by priority loop
    selected_ids:='{}';
    foreach position_key in array array['POR','DEF','MED','DEL'] loop
      required_count:=case position_key when 'POR' then formation_row.por_count when 'DEF' then formation_row.def_count when 'MED' then formation_row.med_count else formation_row.del_count end;
      select coalesce(array_agg(candidate.player_id order by candidate.rank_order),'{}') into candidate_ids from (
        select owned.player_id,row_number() over(order by
          case when target_plan='academy' then owned.is_original else false end desc,
          owned.is_original desc,player.market_value desc,player.name
        ) rank_order
        from public.manager_career_players owned join public.players player on player.id=owned.player_id
        where owned.career_id=career.id and player.active and player.competition_id=career.competition_id and player.position=position_key
          and not exists(select 1 from public.manager_career_catalog_incidents incident where incident.career_id=career.id and incident.player_id=player.id and incident.status in ('pending','resolving'))
        limit required_count
      ) candidate;
      selected_ids:=selected_ids||candidate_ids;
    end loop;
    select count(*) into originals from public.manager_career_players owned where owned.career_id=career.id and owned.is_original and owned.player_id=any(selected_ids);
    exit when coalesce(array_length(selected_ids,1),0)=11 and originals>=rules.minimum_original_lineup;
  end loop;
  if coalesce(array_length(selected_ids,1),0)<>11 or originals<rules.minimum_original_lineup then raise exception 'La plantilla no permite generar un once valido para delegar'; end if;

  select player_id into captain from public.manager_career_players owned join public.players player on player.id=owned.player_id where owned.career_id=career.id and owned.player_id=any(selected_ids) order by player.market_value desc,player.name limit 1;
  select player_id into vice_captain from public.manager_career_players owned join public.players player on player.id=owned.player_id where owned.career_id=career.id and owned.player_id=any(selected_ids) and owned.player_id<>captain order by player.market_value desc,player.name limit 1;
  if target_plan='tactical' then
    select coalesce(array_agg(player_id order by position,market_value desc),'{}') into fallback_ids from (
      select distinct on(player.position) owned.player_id,player.position,player.market_value
      from public.manager_career_players owned join public.players player on player.id=owned.player_id
      where owned.career_id=career.id and player.active and not owned.player_id=any(selected_ids)
      order by player.position,player.market_value desc
    ) fallback;
  end if;

  insert into public.manager_career_lineups(career_id,matchday,formation,captain_id,vice_captain_id,player_ids,saved_at,delegated)
  values(career.id,career.current_matchday,formation_row.name,captain,vice_captain,selected_ids,now(),true)
  on conflict(career_id,matchday) do update set formation=excluded.formation,captain_id=excluded.captain_id,vice_captain_id=excluded.vice_captain_id,player_ids=excluded.player_ids,saved_at=now(),delegated=true
  where public.manager_career_lineups.locked_at is null;
  if not found then raise exception 'La alineacion de esta jornada ya esta bloqueada'; end if;

  if target_plan='close_ranks' then confidence_delta:=rules.delegation_close_ranks_confidence; failures_delta:=least(1,career.consecutive_failures); end if;
  insert into public.manager_career_delegations(career_id,matchday,plan,cost,confidence_change,failures_reduced,formation,captain_id,vice_captain_id,player_ids,fallback_player_ids)
  values(career.id,career.current_matchday,target_plan,plan_cost,confidence_delta,failures_delta,formation_row.name,captain,vice_captain,selected_ids,fallback_ids) returning id into delegation_id;
  update public.manager_careers set budget=budget-plan_cost,board_confidence=least(100,board_confidence+confidence_delta),consecutive_failures=greatest(0,consecutive_failures-failures_delta),updated_at=now() where id=career.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
  values(career.id,'delegation','Jornada delegada',case target_plan when 'close_ranks' then 'Cerrar filas' when 'tactical' then 'Golpe tactico' else 'Proyecto de cantera' end||' · once '||formation_row.name||' generado por el segundo entrenador.',career.current_matchday,0);
  perform public.create_nexo_notification(career.owner_id,'system','El segundo entrenador toma el mando','La Jornada '||career.current_matchday||' queda delegada. Puedes revisar el once, pero no editarlo ni operar en el mercado.',null,'inicio','career-delegation:'||delegation_id);
  return public.manager_career_delegation_state(career.id);
end $$;

create or replace function public.guard_delegated_career_lineup() returns trigger
language plpgsql set search_path=public as $$
begin
  if auth.uid() is not null and exists(select 1 from public.manager_career_delegations delegation where delegation.career_id=new.career_id and delegation.matchday=new.matchday and delegation.status='scheduled')
    and (new.formation is distinct from old.formation or new.captain_id is distinct from old.captain_id or new.vice_captain_id is distinct from old.vice_captain_id or new.player_ids is distinct from old.player_ids)
  then raise exception 'El segundo entrenador ya ha fijado el once de esta jornada'; end if;
  return new;
end $$;
drop trigger if exists guard_delegated_career_lineup_trigger on public.manager_career_lineups;
create trigger guard_delegated_career_lineup_trigger before update on public.manager_career_lineups for each row execute function public.guard_delegated_career_lineup();

create or replace function public.guard_delegated_career_decision() returns trigger
language plpgsql set search_path=public as $$
begin
  if exists(select 1 from public.manager_career_delegations delegation where delegation.career_id=new.career_id and delegation.matchday=new.matchday and delegation.status='scheduled') then raise exception 'No hay decision semanal durante una jornada delegada'; end if;
  return new;
end $$;
drop trigger if exists guard_delegated_career_decision_trigger on public.manager_career_decisions;
create trigger guard_delegated_career_decision_trigger before insert on public.manager_career_decisions for each row execute function public.guard_delegated_career_decision();

create or replace function public.guard_delegated_career_squad() returns trigger
language plpgsql set search_path=public as $$
declare target_career uuid:=coalesce(new.career_id,old.career_id); open_matchday integer;
begin
  if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  select current_matchday into open_matchday from public.manager_careers where id=target_career;
  if exists(select 1 from public.manager_career_delegations where career_id=target_career and matchday=open_matchday and status='scheduled') then raise exception 'El mercado esta cerrado mientras dirige el segundo entrenador'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists guard_delegated_career_squad_trigger on public.manager_career_players;
create trigger guard_delegated_career_squad_trigger before insert or delete on public.manager_career_players for each row execute function public.guard_delegated_career_squad();

-- Impide comprar o vender a traves de las funciones publicas mientras la jornada esta delegada.
create or replace function public.assert_manager_career_not_delegated(target_career_id uuid,target_matchday integer) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if exists(select 1 from public.manager_career_delegations where career_id=target_career_id and matchday=target_matchday and status='scheduled') then raise exception 'El mercado esta cerrado mientras dirige el segundo entrenador'; end if;
end $$;

-- El cierre oficial conserva un unico motor. Este envoltorio prepara las protecciones tacticas,
-- ejecuta el cierre existente y aplica los modificadores de cantera sobre su acta inmutable.
alter function public.settle_manager_careers_for_matchday(uuid) rename to settle_manager_careers_for_matchday_base;

create or replace function public.prepare_manager_career_delegations(target_matchday_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare round_record public.competition_matchdays%rowtype; delegation record; missing_player text; replacement text; captain_available boolean;
begin
  select * into round_record from public.competition_matchdays where id=target_matchday_id;
  if not found or round_record.state<>'closed' then return; end if;
  for delegation in
    select delegated.*,lineup.player_ids,lineup.captain_id as lineup_captain
    from public.manager_career_delegations delegated join public.manager_careers career on career.id=delegated.career_id
    join public.manager_career_lineups lineup on lineup.career_id=delegated.career_id and lineup.matchday=delegated.matchday
    where delegated.matchday=round_record.matchday and delegated.status='scheduled' and delegated.plan='tactical' and career.competition_id=round_record.competition_id
    for update of delegated
  loop
    select exists(select 1 from public.player_matchday_points score where score.competition_id=round_record.competition_id and score.season=round_record.season and score.matchday=round_record.matchday and score.scoring_version=round_record.scoring_version and score.player_id=delegation.lineup_captain and coalesce(nullif(score.source_payload->>'minutes','')::numeric,1)>0) into captain_available;
    if not captain_available and delegation.vice_captain_id is not null then update public.manager_career_lineups set captain_id=delegation.vice_captain_id where career_id=delegation.career_id and matchday=delegation.matchday; end if;

    select listed.player_id into missing_player from unnest(delegation.player_ids) with ordinality listed(player_id,slot)
    where not exists(select 1 from public.player_matchday_points score where score.competition_id=round_record.competition_id and score.season=round_record.season and score.matchday=round_record.matchday and score.scoring_version=round_record.scoring_version and score.player_id=listed.player_id and coalesce(nullif(score.source_payload->>'minutes','')::numeric,1)>0)
    order by listed.slot limit 1;
    if missing_player is not null then
      select fallback.player_id into replacement from unnest(delegation.fallback_player_ids) fallback(player_id)
      join public.players reserve_player on reserve_player.id=fallback.player_id join public.players missing on missing.id=missing_player
      where reserve_player.position=missing.position and exists(select 1 from public.player_matchday_points score where score.competition_id=round_record.competition_id and score.season=round_record.season and score.matchday=round_record.matchday and score.scoring_version=round_record.scoring_version and score.player_id=fallback.player_id and coalesce(nullif(score.source_payload->>'minutes','')::numeric,1)>0)
      order by reserve_player.market_value desc limit 1;
      if replacement is not null then
        update public.manager_career_lineups set player_ids=array_replace(player_ids,missing_player,replacement),captain_id=case when captain_id=missing_player then coalesce(vice_captain_id,replacement) else captain_id end where career_id=delegation.career_id and matchday=delegation.matchday;
        insert into public.manager_career_events(career_id,event_type,title,detail,matchday) values(delegation.career_id,'delegation_substitution','Cambio automatico',missing_player||' fue sustituido por '||replacement||' al no disputar minutos.',delegation.matchday);
      end if;
    end if;
  end loop;
end $$;

create or replace function public.apply_manager_career_delegation_results(target_matchday_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare round_record public.competition_matchdays%rowtype; item record; rules public.manager_career_rules%rowtype; bonus numeric; rescued boolean; mission_reward integer; mission_penalty integer; confidence_after integer; reputation_after integer; status_after text;
begin
  select * into round_record from public.competition_matchdays where id=target_matchday_id;
  select * into rules from public.manager_career_rules where id;
  for item in
    select delegation.*,report.id report_id,report.player_breakdown,report.total_points,report.mission,career.owner_id
    from public.manager_career_delegations delegation join public.manager_career_matchday_reports report on report.career_id=delegation.career_id and report.matchday=delegation.matchday
    join public.manager_careers career on career.id=delegation.career_id
    where delegation.matchday=round_record.matchday and delegation.status='scheduled' and career.competition_id=round_record.competition_id
    for update of delegation
  loop
    bonus:=0;rescued:=false;mission_reward:=0;mission_penalty:=0;
    if item.plan='academy' then
      select round(coalesce(sum((player->>'finalPoints')::numeric*(rules.delegation_academy_points_multiplier-1)),0)) into bonus
      from jsonb_array_elements(item.player_breakdown) player join public.manager_career_players owned on owned.career_id=item.career_id and owned.player_id=player->>'playerId' and owned.is_original;
      if item.mission is not null and item.mission->>'status'='failed' and coalesce(item.mission->>'metricKey','points')='points' and item.total_points+bonus>=(item.mission->>'targetValue')::numeric then
        rescued:=true;mission_reward:=coalesce((item.mission->>'reward')::integer,0);mission_penalty:=coalesce((item.mission->>'penalty')::integer,0);
        update public.manager_career_objectives set status='completed',current_value=item.total_points+bonus,updated_at=now() where id=(item.mission->>'id')::uuid;
      elsif item.mission is not null and item.mission->>'status'='completed' and item.mission->>'metricKey'='originals' then
        mission_reward:=round(coalesce((item.mission->>'reward')::numeric,0)*(rules.delegation_identity_reward_multiplier-1));
      end if;
      update public.manager_career_lineups set points=points+bonus where career_id=item.career_id and matchday=item.matchday;
      update public.manager_careers set sporting_points=sporting_points+bonus,objective_points=objective_points+mission_reward,
        reputation=least(100,reputation+mission_reward),board_confidence=least(100,board_confidence+mission_reward+case when rescued then mission_penalty else 0 end),
        consecutive_failures=case when rescued then 0 else consecutive_failures end,status=case when rescued and status='dismissed' then 'active' else status end,updated_at=now()
      where id=item.career_id returning board_confidence,reputation,status into confidence_after,reputation_after,status_after;
      update public.manager_career_matchday_reports set lineup_points=lineup_points+bonus,total_points=total_points+bonus,
        mission=case when rescued then mission||jsonb_build_object('status','completed','currentValue',total_points+bonus,'rescuedByDelegation',true) else mission end,
        confidence_after=confidence_after+mission_reward+case when rescued then mission_penalty else 0 end,reputation_after=reputation_after+mission_reward,
        consecutive_failures_after=case when rescued then 0 else consecutive_failures_after end,status_after=case when rescued and status_after='dismissed' then 'active' else status_after end
      where id=item.report_id;
    end if;
    update public.manager_career_delegations set status='settled',settled_at=now() where id=item.id;
    perform public.create_nexo_notification(item.owner_id,'matchday','Jornada delegada resuelta','El segundo entrenador ha completado la Jornada '||item.matchday||'. Ya puedes revisar el informe y recuperar el control.',null,'inicio','career-delegation-settled:'||item.id);
  end loop;
end $$;

create or replace function public.settle_manager_careers_for_matchday(target_matchday_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare processed integer;
begin
  perform public.prepare_manager_career_delegations(target_matchday_id);
  processed:=public.settle_manager_careers_for_matchday_base(target_matchday_id);
  perform public.apply_manager_career_delegation_results(target_matchday_id);
  return processed;
end $$;

revoke all on function public.settle_manager_careers_for_matchday(uuid),public.settle_manager_careers_for_matchday_base(uuid),public.prepare_manager_career_delegations(uuid),public.apply_manager_career_delegation_results(uuid) from public,anon,authenticated;
grant execute on function public.settle_manager_careers_for_matchday(uuid),public.settle_manager_careers_for_matchday_base(uuid),public.prepare_manager_career_delegations(uuid),public.apply_manager_career_delegation_results(uuid) to service_role;

revoke all on function public.manager_career_delegation_state(uuid),public.delegate_manager_career_matchday(uuid,text) from public,anon;
grant execute on function public.manager_career_delegation_state(uuid),public.delegate_manager_career_matchday(uuid,text) to authenticated;
revoke all on function public.assert_manager_career_not_delegated(uuid,integer) from public,anon,authenticated;
grant all on public.manager_career_delegations to service_role;

drop function if exists public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric,boolean,integer,integer);
create or replace function public.update_manager_career_rules(
  next_enabled boolean,next_free_careers integer,next_extra_cost integer,next_initial_budget numeric,
  next_minimum_original_squad integer,next_minimum_original_lineup integer,next_weekly_decisions boolean,
  next_same_club_ranking boolean,next_academy_cost numeric,next_failure_penalty integer,next_dismissal_threshold integer,
  next_relaxed_multiplier numeric,next_balanced_multiplier numeric,next_elite_multiplier numeric,
  next_catalog_incidents_enabled boolean,next_exit_reinvest_percent integer,next_exit_identity_percent integer,
  next_delegation_enabled boolean,next_delegation_max_uses integer,next_delegation_cooldown integer,next_delegation_warning_margin integer,
  next_delegation_close_ranks_cost numeric,next_delegation_tactical_cost numeric,next_delegation_academy_cost numeric,
  next_delegation_close_ranks_confidence integer,next_delegation_academy_multiplier numeric,next_delegation_identity_multiplier numeric
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administracion puede cambiar estas reglas'; end if;
  if next_exit_reinvest_percent not between 50 and 120 or next_exit_identity_percent not between 50 and 100 then raise exception 'Porcentaje de salida no valido'; end if;
  update public.manager_career_rules set enabled=next_enabled,free_careers_per_competition=next_free_careers,extra_career_coin_cost=next_extra_cost,
    initial_budget=next_initial_budget,minimum_original_squad=next_minimum_original_squad,minimum_original_lineup=next_minimum_original_lineup,
    weekly_decision_enabled=next_weekly_decisions,same_club_ranking_enabled=next_same_club_ranking,academy_decision_cost=next_academy_cost,
    failure_confidence_penalty=next_failure_penalty,dismissal_confidence_threshold=next_dismissal_threshold,relaxed_target_multiplier=next_relaxed_multiplier,
    balanced_target_multiplier=next_balanced_multiplier,elite_target_multiplier=next_elite_multiplier,catalog_incidents_enabled=next_catalog_incidents_enabled,
    exit_reinvest_percent=next_exit_reinvest_percent,exit_identity_percent=next_exit_identity_percent,delegation_enabled=next_delegation_enabled,
    delegation_max_uses=next_delegation_max_uses,delegation_cooldown_matchdays=next_delegation_cooldown,delegation_warning_margin=next_delegation_warning_margin,
    delegation_close_ranks_cost=next_delegation_close_ranks_cost,delegation_tactical_cost=next_delegation_tactical_cost,delegation_academy_cost=next_delegation_academy_cost,
    delegation_close_ranks_confidence=next_delegation_close_ranks_confidence,delegation_academy_points_multiplier=next_delegation_academy_multiplier,
    delegation_identity_reward_multiplier=next_delegation_identity_multiplier,updated_at=now() where id;
end $$;
revoke all on function public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric,boolean,integer,integer,boolean,integer,integer,integer,numeric,numeric,numeric,integer,numeric,numeric) from public,anon;
grant execute on function public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric,boolean,integer,integer,boolean,integer,integer,integer,numeric,numeric,numeric,integer,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
