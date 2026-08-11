-- Delegaciones equilibradas, desbloqueos por objetivos y recompensa de final de temporada.

alter table public.manager_career_rules alter column delegation_max_uses set default 5;
alter table public.manager_career_rules alter column delegation_cooldown_matchdays set default 3;
alter table public.manager_career_rules add column if not exists delegation_max_bonus_uses integer not null default 2 check (delegation_max_bonus_uses between 0 and 5);
alter table public.manager_career_rules add column if not exists delegation_unlocks_enabled boolean not null default true;
alter table public.manager_career_rules add column if not exists delegation_unused_reward_threshold integer not null default 3 check (delegation_unused_reward_threshold between 0 and 10);
alter table public.manager_career_rules add column if not exists delegation_unused_reward_coins integer not null default 100 check (delegation_unused_reward_coins >= 0);
alter table public.manager_career_rules add column if not exists delegation_never_used_reward_coins integer not null default 300 check (delegation_never_used_reward_coins >= 0);
alter table public.manager_career_rules add column if not exists delegation_never_used_reputation integer not null default 10 check (delegation_never_used_reputation between 0 and 30);

update public.manager_career_rules
set delegation_max_uses=case when delegation_max_uses=2 then 5 else delegation_max_uses end,
    delegation_cooldown_matchdays=case when delegation_cooldown_matchdays=2 then 3 else delegation_cooldown_matchdays end,
    updated_at=now();

create table if not exists public.manager_career_delegation_unlocks (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  objective_id uuid not null references public.manager_career_objectives(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unique(career_id,objective_id)
);
alter table public.manager_career_delegation_unlocks enable row level security;
drop policy if exists manager_career_delegation_unlocks_owner on public.manager_career_delegation_unlocks;
create policy manager_career_delegation_unlocks_owner on public.manager_career_delegation_unlocks for select using (
  exists(select 1 from public.manager_careers career where career.id=career_id and career.owner_id=auth.uid())
);

create table if not exists public.profile_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null,
  title text not null,
  description text not null,
  rarity text not null default 'legendary',
  coin_reward integer not null default 0,
  unlocked_at timestamptz not null default now(),
  reward_claimed_at timestamptz,
  unique(user_id,achievement_key)
);
alter table public.profile_achievements enable row level security;
drop policy if exists profile_achievements_owner on public.profile_achievements;
create policy profile_achievements_owner on public.profile_achievements for select using (user_id=auth.uid());

create table if not exists public.manager_career_season_rewards (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  reward_key text not null check (reward_key in ('unused_delegations','always_in_charge')),
  unused_delegations integer not null default 0,
  coin_reward integer not null default 0,
  reputation_reward integer not null default 0,
  created_at timestamptz not null default now(),
  unique(career_id,reward_key)
);
alter table public.manager_career_season_rewards enable row level security;
drop policy if exists manager_career_season_rewards_owner on public.manager_career_season_rewards;
create policy manager_career_season_rewards_owner on public.manager_career_season_rewards for select using (
  exists(select 1 from public.manager_careers career where career.id=career_id and career.owner_id=auth.uid())
);

create or replace function public.manager_career_delegation_state(target_career_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  career public.manager_careers%rowtype; rules public.manager_career_rules%rowtype;
  current_delegation public.manager_career_delegations%rowtype;
  used integer; last_matchday integer; unavailable integer; lineup_size integer; bonus_uses integer; maximum_uses integer;
  pending_incident boolean; reasons jsonb:='[]'::jsonb; blocked text;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  select * into current_delegation from public.manager_career_delegations where career_id=career.id and matchday=career.current_matchday and status='scheduled';
  select count(*),max(matchday) into used,last_matchday from public.manager_career_delegations where career_id=career.id and status<>'cancelled';
  select least(rules.delegation_max_bonus_uses,count(*)) into bonus_uses from public.manager_career_delegation_unlocks where career_id=career.id;
  maximum_uses:=rules.delegation_max_uses+coalesce(bonus_uses,0);
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
  elsif used>=maximum_uses then blocked:='Has agotado las delegaciones de esta temporada';
  elsif last_matchday is not null and career.current_matchday-last_matchday<=rules.delegation_cooldown_matchdays then blocked:='Debes esperar hasta la Jornada '||(last_matchday+rules.delegation_cooldown_matchdays+1);
  elsif exists(select 1 from public.manager_career_decisions decision where decision.career_id=career.id and decision.matchday=career.current_matchday) then blocked:='Ya has tomado la decision semanal de esta jornada'; end if;
  return jsonb_build_object(
    'enabled',rules.delegation_enabled,'eligible',blocked is null,'blockingReason',blocked,'used',used,'baseMaximum',rules.delegation_max_uses,
    'bonusUses',coalesce(bonus_uses,0),'maximum',maximum_uses,'remaining',greatest(0,maximum_uses-used),
    'cooldownMatchdays',rules.delegation_cooldown_matchdays,'nextAvailableMatchday',case when last_matchday is null then career.current_matchday else last_matchday+rules.delegation_cooldown_matchdays+1 end,
    'recommended',jsonb_array_length(reasons)>0,'recommendationReasons',reasons,
    'current',case when current_delegation.id is null then null else jsonb_build_object('id',current_delegation.id,'matchday',current_delegation.matchday,'plan',current_delegation.plan,'status',current_delegation.status,'cost',current_delegation.cost,'confidenceChange',current_delegation.confidence_change,'failuresReduced',current_delegation.failures_reduced,'formation',current_delegation.formation,'captainId',current_delegation.captain_id,'viceCaptainId',current_delegation.vice_captain_id,'playerIds',current_delegation.player_ids,'fallbackPlayerIds',current_delegation.fallback_player_ids,'createdAt',current_delegation.created_at) end,
    'plans',jsonb_build_array(
      jsonb_build_object('key','close_ranks','title','Cerrar filas','cost',rules.delegation_close_ranks_cost,'confidenceChange',rules.delegation_close_ranks_confidence,'failuresReduced',1,'description','Recupera respaldo inmediato y corta una parte de la mala racha.'),
      jsonb_build_object('key','tactical','title','Golpe tactico','cost',rules.delegation_tactical_cost,'confidenceChange',0,'failuresReduced',0,'description','Designa vicecapitan y suplentes por posicion para cubrir ausencias reales.'),
      jsonb_build_object('key','academy','title','Proyecto de cantera','cost',rules.delegation_academy_cost,'confidenceChange',0,'failuresReduced',0,'pointsMultiplier',rules.delegation_academy_points_multiplier,'identityRewardMultiplier',rules.delegation_identity_reward_multiplier,'description','Prioriza originales y potencia sus puntos y la recompensa de identidad.')
    )
  );
end $$;

alter function public.settle_manager_careers_for_matchday(uuid) rename to settle_manager_careers_for_matchday_delegation_base;
create or replace function public.settle_manager_careers_for_matchday(target_matchday_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare
  processed integer; selected_round public.competition_matchdays%rowtype; rules public.manager_career_rules%rowtype;
  max_matchday integer; career_record record; used integer; bonus_uses integer; maximum_uses integer; unused integer; inserted_reward uuid;
begin
  processed:=public.settle_manager_careers_for_matchday_delegation_base(target_matchday_id);
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found or selected_round.state<>'closed' then return processed; end if;
  select * into rules from public.manager_career_rules where id;
  if rules.delegation_unlocks_enabled then
    with candidates as (
      select objective.career_id,objective.id,
        row_number() over(partition by objective.career_id order by objective.updated_at,objective.id) as candidate_number,
        (select count(*) from public.manager_career_delegation_unlocks existing where existing.career_id=objective.career_id) as already_unlocked
      from public.manager_career_objectives objective join public.manager_careers career on career.id=objective.career_id
      where career.competition_id=selected_round.competition_id and objective.status='completed' and objective.objective_type<>'matchday'
        and not exists(select 1 from public.manager_career_delegation_unlocks existing where existing.objective_id=objective.id)
    ), unlocked as (
      insert into public.manager_career_delegation_unlocks(career_id,objective_id)
      select career_id,id from candidates where candidate_number<=greatest(0,rules.delegation_max_bonus_uses-already_unlocked)
      on conflict do nothing returning career_id
    )
    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
    select distinct career_id,'delegation_unlock','La directiva amplia tu margen','Has desbloqueado una delegacion adicional al cumplir un objetivo importante.',selected_round.matchday,0 from unlocked;
  end if;
  select coalesce(max(matchday),38) into max_matchday from public.match_fixtures where competition_id=selected_round.competition_id and season=selected_round.season;
  if selected_round.matchday<>max_matchday then return processed; end if;
  for career_record in
    select career.* from public.manager_careers career where career.competition_id=selected_round.competition_id and career.status='active'
      and exists(select 1 from public.manager_career_matchday_reports report where report.career_id=career.id and report.matchday=selected_round.matchday)
    for update
  loop
    select count(*) into used from public.manager_career_delegations where career_id=career_record.id and status<>'cancelled';
    select least(rules.delegation_max_bonus_uses,count(*)) into bonus_uses from public.manager_career_delegation_unlocks where career_id=career_record.id;
    maximum_uses:=rules.delegation_max_uses+coalesce(bonus_uses,0); unused:=greatest(0,maximum_uses-used); inserted_reward:=null;
    if used=0 then
      insert into public.manager_career_season_rewards(career_id,reward_key,unused_delegations,coin_reward,reputation_reward)
      values(career_record.id,'always_in_charge',unused,rules.delegation_never_used_reward_coins,rules.delegation_never_used_reputation)
      on conflict do nothing returning id into inserted_reward;
      if inserted_reward is not null then
        update public.profiles set coins=coins+rules.delegation_never_used_reward_coins,updated_at=now() where id=career_record.owner_id;
        update public.manager_careers set reputation=least(100,reputation+rules.delegation_never_used_reputation) where id=career_record.id;
        insert into public.profile_achievements(user_id,achievement_key,title,description,rarity,coin_reward,reward_claimed_at)
        values(career_record.owner_id,'always_in_charge','Siempre al mando','Completa una temporada de Carrera sin delegar ninguna jornada.','legendary',rules.delegation_never_used_reward_coins,now()) on conflict do nothing;
        perform public.create_nexo_notification(career_record.owner_id,'achievement','Siempre al mando','Temporada completada sin delegar: +'||rules.delegation_never_used_reward_coins||' monedas y +'||rules.delegation_never_used_reputation||' de reputacion.',null,'perfil','career-always-in-charge:'||career_record.id);
      end if;
    elsif unused>=rules.delegation_unused_reward_threshold then
      insert into public.manager_career_season_rewards(career_id,reward_key,unused_delegations,coin_reward,reputation_reward)
      values(career_record.id,'unused_delegations',unused,rules.delegation_unused_reward_coins,0) on conflict do nothing returning id into inserted_reward;
      if inserted_reward is not null then
        update public.profiles set coins=coins+rules.delegation_unused_reward_coins,updated_at=now() where id=career_record.owner_id;
        perform public.create_nexo_notification(career_record.owner_id,'achievement','Reserva estrategica','Terminaste con '||unused||' delegaciones disponibles: +'||rules.delegation_unused_reward_coins||' monedas.',null,'perfil','career-unused-delegations:'||career_record.id);
      end if;
    end if;
    update public.manager_careers set status='completed',updated_at=now() where id=career_record.id;
  end loop;
  return processed;
end $$;

create or replace function public.my_profile_achievements() returns table(achievement_key text,title text,description text,rarity text,coin_reward integer,unlocked_at timestamptz,reward_claimed_at timestamptz)
language sql stable security definer set search_path=public as $$
  select achievement_key,title,description,rarity,coin_reward,unlocked_at,reward_claimed_at from public.profile_achievements where user_id=auth.uid() order by unlocked_at desc;
$$;

drop function if exists public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric,boolean,integer,integer,boolean,integer,integer,integer,numeric,numeric,numeric,integer,numeric,numeric);
create or replace function public.update_manager_career_rules(
  next_enabled boolean,next_free_careers integer,next_extra_cost integer,next_initial_budget numeric,next_minimum_original_squad integer,next_minimum_original_lineup integer,
  next_weekly_decisions boolean,next_same_club_ranking boolean,next_academy_cost numeric,next_failure_penalty integer,next_dismissal_threshold integer,
  next_relaxed_multiplier numeric,next_balanced_multiplier numeric,next_elite_multiplier numeric,next_catalog_incidents_enabled boolean,next_exit_reinvest_percent integer,next_exit_identity_percent integer,
  next_delegation_enabled boolean,next_delegation_max_uses integer,next_delegation_cooldown integer,next_delegation_warning_margin integer,next_delegation_close_ranks_cost numeric,
  next_delegation_tactical_cost numeric,next_delegation_academy_cost numeric,next_delegation_close_ranks_confidence integer,next_delegation_academy_multiplier numeric,next_delegation_identity_multiplier numeric,
  next_delegation_max_bonus_uses integer,next_delegation_unlocks_enabled boolean,next_delegation_unused_reward_threshold integer,next_delegation_unused_reward_coins integer,
  next_delegation_never_used_reward_coins integer,next_delegation_never_used_reputation integer
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administracion puede cambiar estas reglas'; end if;
  update public.manager_career_rules set enabled=next_enabled,free_careers_per_competition=next_free_careers,extra_career_coin_cost=next_extra_cost,initial_budget=next_initial_budget,
    minimum_original_squad=next_minimum_original_squad,minimum_original_lineup=next_minimum_original_lineup,weekly_decision_enabled=next_weekly_decisions,same_club_ranking_enabled=next_same_club_ranking,
    academy_decision_cost=next_academy_cost,failure_confidence_penalty=next_failure_penalty,dismissal_confidence_threshold=next_dismissal_threshold,relaxed_target_multiplier=next_relaxed_multiplier,
    balanced_target_multiplier=next_balanced_multiplier,elite_target_multiplier=next_elite_multiplier,catalog_incidents_enabled=next_catalog_incidents_enabled,exit_reinvest_percent=next_exit_reinvest_percent,
    exit_identity_percent=next_exit_identity_percent,delegation_enabled=next_delegation_enabled,delegation_max_uses=next_delegation_max_uses,delegation_cooldown_matchdays=next_delegation_cooldown,
    delegation_warning_margin=next_delegation_warning_margin,delegation_close_ranks_cost=next_delegation_close_ranks_cost,delegation_tactical_cost=next_delegation_tactical_cost,
    delegation_academy_cost=next_delegation_academy_cost,delegation_close_ranks_confidence=next_delegation_close_ranks_confidence,delegation_academy_points_multiplier=next_delegation_academy_multiplier,
    delegation_identity_reward_multiplier=next_delegation_identity_multiplier,delegation_max_bonus_uses=next_delegation_max_bonus_uses,delegation_unlocks_enabled=next_delegation_unlocks_enabled,
    delegation_unused_reward_threshold=next_delegation_unused_reward_threshold,delegation_unused_reward_coins=next_delegation_unused_reward_coins,
    delegation_never_used_reward_coins=next_delegation_never_used_reward_coins,delegation_never_used_reputation=next_delegation_never_used_reputation,updated_at=now() where id;
end $$;

revoke all on function public.settle_manager_careers_for_matchday(uuid),public.settle_manager_careers_for_matchday_delegation_base(uuid) from public,anon,authenticated;
grant execute on function public.settle_manager_careers_for_matchday(uuid),public.settle_manager_careers_for_matchday_delegation_base(uuid) to service_role;
revoke all on function public.my_profile_achievements() from public,anon;
grant execute on function public.my_profile_achievements() to authenticated;
grant all on public.manager_career_delegation_unlocks,public.manager_career_season_rewards,public.profile_achievements to service_role;
notify pgrst,'reload schema';
