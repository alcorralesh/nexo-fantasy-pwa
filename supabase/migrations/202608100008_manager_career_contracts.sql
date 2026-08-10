-- Carrera de mánager: contratos variables, decisiones transparentes y liquidación por jornada.

alter table public.manager_career_rules add column if not exists academy_decision_cost numeric(12,2) not null default 0.50;
alter table public.manager_career_rules add column if not exists failure_confidence_penalty integer not null default 8;
alter table public.manager_career_rules add column if not exists dismissal_confidence_threshold integer not null default 15;
alter table public.manager_career_rules add column if not exists relaxed_target_multiplier numeric(5,2) not null default 0.85;
alter table public.manager_career_rules add column if not exists balanced_target_multiplier numeric(5,2) not null default 1.00;
alter table public.manager_career_rules add column if not exists elite_target_multiplier numeric(5,2) not null default 1.12;

alter table public.manager_careers add column if not exists contract_tier text not null default 'stability';
alter table public.manager_careers add column if not exists board_confidence integer not null default 60;
alter table public.manager_careers add column if not exists consecutive_failures integer not null default 0;
alter table public.manager_careers drop constraint if exists manager_careers_status_check;
alter table public.manager_careers add constraint manager_careers_status_check check (status in ('active','completed','abandoned','dismissed'));

alter table public.manager_career_lineups add column if not exists locked_at timestamptz;
alter table public.manager_career_lineups add column if not exists settled_at timestamptz;
alter table public.manager_career_lineups add column if not exists points numeric(12,2);

alter table public.manager_career_decisions add column if not exists sporting_points_change numeric(12,2) not null default 0;
alter table public.manager_career_decisions add column if not exists confidence_change integer not null default 0;
alter table public.manager_career_decisions add column if not exists conditional_original_target integer;
alter table public.manager_career_decisions add column if not exists conditional_sporting_bonus numeric(12,2) not null default 0;

alter table public.manager_career_objectives add column if not exists failure_penalty integer not null default 0;
alter table public.manager_career_objectives add column if not exists updated_at timestamptz not null default now();

create or replace function public.guard_manager_career_lineup_window() returns trigger
language plpgsql security definer set search_path=public as $$
declare selected_career public.manager_careers%rowtype;
begin
  select * into selected_career from public.manager_careers where id=new.career_id;
  if tg_op='UPDATE' and new.formation=old.formation and new.captain_id=old.captain_id and new.player_ids=old.player_ids then return new; end if;
  if tg_op='UPDATE' and old.locked_at is not null then raise exception 'La alineación de esta jornada ya está bloqueada'; end if;
  if exists(select 1 from public.competition_matchdays where competition_id=selected_career.competition_id and matchday=new.matchday and state<>'open') then raise exception 'La alineación de esta jornada ya está bloqueada'; end if;
  return new;
end $$;
drop trigger if exists guard_manager_career_lineup_window_trigger on public.manager_career_lineups;
create trigger guard_manager_career_lineup_window_trigger before insert or update on public.manager_career_lineups for each row execute function public.guard_manager_career_lineup_window();
create unique index if not exists manager_career_matchday_objective_unique on public.manager_career_objectives(career_id,objective_type,expires_matchday) where expires_matchday is not null;

drop function if exists public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean);
create or replace function public.update_manager_career_rules(next_enabled boolean,next_free_careers integer,next_extra_cost integer,next_initial_budget numeric,next_minimum_original_squad integer,next_minimum_original_lineup integer,next_weekly_decisions boolean,next_same_club_ranking boolean,next_academy_cost numeric,next_failure_penalty integer,next_dismissal_threshold integer,next_relaxed_multiplier numeric,next_balanced_multiplier numeric,next_elite_multiplier numeric) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administración puede cambiar estas reglas'; end if;
  update public.manager_career_rules set enabled=next_enabled,free_careers_per_competition=next_free_careers,extra_career_coin_cost=next_extra_cost,initial_budget=next_initial_budget,minimum_original_squad=next_minimum_original_squad,minimum_original_lineup=next_minimum_original_lineup,weekly_decision_enabled=next_weekly_decisions,same_club_ranking_enabled=next_same_club_ranking,academy_decision_cost=next_academy_cost,failure_confidence_penalty=next_failure_penalty,dismissal_confidence_threshold=next_dismissal_threshold,relaxed_target_multiplier=next_relaxed_multiplier,balanced_target_multiplier=next_balanced_multiplier,elite_target_multiplier=next_elite_multiplier,updated_at=now() where id;
end $$;

create or replace function public.build_manager_career_contract(target_career_id uuid, reset_contract boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare
  selected_career public.manager_careers%rowtype; selected_rules public.manager_career_rules%rowtype;
  club_value numeric; stronger_clubs integer; club_count integer; selected_tier text;
  difficulty_multiplier numeric; season_target integer; matchday_target integer; identity_target integer;
begin
  select * into selected_career from public.manager_careers where id=target_career_id for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into selected_rules from public.manager_career_rules where id;

  select coalesce(sum(p.market_value),0) into club_value from public.players p where p.sports_club_id=selected_career.sports_club_id and p.active;
  with club_values as (
    select sc.id,coalesce(sum(p.market_value),0) value
    from public.sports_clubs sc left join public.players p on p.sports_club_id=sc.id and p.active
    where sc.competition_id=selected_career.competition_id and sc.active group by sc.id
  ) select count(*) filter(where value>club_value),count(*) into stronger_clubs,club_count from club_values;
  selected_tier:=case when club_count>0 and stronger_clubs<greatest(1,club_count/3) then 'title' when club_count>0 and stronger_clubs<(club_count*2)/3 then 'europe' else 'stability' end;
  difficulty_multiplier:=case selected_career.difficulty when 'relaxed' then selected_rules.relaxed_target_multiplier when 'elite' then selected_rules.elite_target_multiplier else selected_rules.balanced_target_multiplier end;
  season_target:=round((case selected_tier when 'title' then 2300 when 'europe' then 2050 else 1800 end)*difficulty_multiplier);
  matchday_target:=round((case selected_tier when 'title' then 62 when 'europe' then 55 else 48 end)*difficulty_multiplier);
  identity_target:=selected_rules.minimum_original_squad;

  update public.manager_careers set contract_tier=selected_tier,board_confidence=case when reset_contract then 60 else board_confidence end,updated_at=now() where id=target_career_id;
  if reset_contract then delete from public.manager_career_objectives where career_id=target_career_id; end if;
  if not exists(select 1 from public.manager_career_objectives where career_id=target_career_id) then
    insert into public.manager_career_objectives(career_id,objective_type,title,description,target_value,reputation_reward,failure_penalty,expires_matchday) values
      (target_career_id,'identity','Protege la identidad','Mantén el mínimo de jugadores originales exigido por la directiva.',identity_target,8,selected_rules.failure_confidence_penalty,null),
      (target_career_id,'matchday','Debut con carácter','Supera el objetivo fantasy de tu primera jornada.',matchday_target,6,selected_rules.failure_confidence_penalty,1),
      (target_career_id,'season','Objetivo deportivo','Alcanza los puntos fantasy acumulados exigidos para toda la temporada.',season_target,25,selected_rules.failure_confidence_penalty,null),
      (target_career_id,'confidence','Respaldo de la directiva','Termina la temporada con una confianza mínima de 70.',70,10,selected_rules.failure_confidence_penalty,null);
  end if;
end $$;

create or replace function public.create_manager_career(target_club_id uuid,target_sports_club_id text,target_difficulty text default 'balanced') returns uuid
language plpgsql security definer set search_path=public as $$
declare selected_owner_id uuid:=auth.uid(); selected_competition text; new_career_id uuid; initial_career_budget numeric; player_count integer;
begin
  if selected_owner_id is null then raise exception 'Debes iniciar sesión'; end if;
  if target_difficulty not in ('relaxed','balanced','elite') then raise exception 'Dificultad no válida'; end if;
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=selected_owner_id and active) then raise exception 'El club no te pertenece'; end if;
  select competition_id into selected_competition from public.sports_clubs where id=target_sports_club_id and active;
  if selected_competition is null then raise exception 'Equipo real no disponible'; end if;
  select count(*) into player_count from public.players where sports_club_id=target_sports_club_id and active;
  if player_count<11 then raise exception 'El equipo no tiene una plantilla suficiente'; end if;
  select initial_budget into initial_career_budget from public.manager_career_rules where id;
  insert into public.manager_careers(owner_id,club_id,competition_id,sports_club_id,difficulty,budget) values(selected_owner_id,target_club_id,selected_competition,target_sports_club_id,target_difficulty,initial_career_budget) returning id into new_career_id;
  insert into public.manager_career_players(career_id,player_id,acquisition_value) select new_career_id,id,market_value from public.players where sports_club_id=target_sports_club_id and active;
  perform public.build_manager_career_contract(new_career_id,true);
  insert into public.manager_career_events(career_id,event_type,title,detail,reputation_change) values(new_career_id,'start','Comienza una nueva era','La directiva te entrega el equipo y un contrato adaptado a su nivel.',0);
  return new_career_id;
end $$;

create or replace function public.manager_career_decision_prompt(target_career_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected_career public.manager_careers%rowtype; selected_rules public.manager_career_rules%rowtype; multiplier numeric; decision_index integer;
begin
  select * into selected_career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active';
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into selected_rules from public.manager_career_rules where id;
  if not selected_rules.weekly_decision_enabled then return null; end if;
  multiplier:=case selected_career.difficulty when 'relaxed' then 0.80 when 'elite' then 1.35 else 1.00 end;
  decision_index:=(selected_career.current_matchday-1)%3;
  if decision_index=0 then
    return jsonb_build_object('key','youth_minutes','title','El vestuario pide una señal','description','Un joven reclama protagonismo antes de un partido importante.','choices',jsonb_build_array(
      jsonb_build_object('key','academy','title','Apostar por la cantera','summary','Inversión de futuro con una condición deportiva.','reputationChange',round(3*multiplier),'budgetChange',-selected_rules.academy_decision_cost,'sportingPointsChange',0,'condition','Alinea al menos '||(selected_rules.minimum_original_lineup+1)||' originales','conditionalBonus',3),
      jsonb_build_object('key','experience','title','Proteger el resultado','summary','Menor impacto social, pero una ayuda deportiva segura.','reputationChange',round(1*multiplier),'budgetChange',0,'sportingPointsChange',1,'condition',null,'conditionalBonus',0)
    ));
  elsif decision_index=1 then
    return jsonb_build_object('key','transfer_plan','title','La dirección deportiva espera una respuesta','description','Debes decidir cuánto arriesgar antes del siguiente cierre.','choices',jsonb_build_array(
      jsonb_build_object('key','invest','title','Invertir en el proyecto','summary','Gastas ahora para reforzar la confianza del entorno.','reputationChange',round(4*multiplier),'budgetChange',-1.00,'sportingPointsChange',0,'condition',null,'conditionalBonus',0),
      jsonb_build_object('key','prudence','title','Guardar margen salarial','summary','Recuperas presupuesto, pero la afición lo interpreta como falta de ambición.','reputationChange',round(-1*multiplier),'budgetChange',0.50,'sportingPointsChange',0,'condition',null,'conditionalBonus',0)
    ));
  else
    return jsonb_build_object('key','training_load','title','El cuerpo técnico divide al vestuario','description','La carga de trabajo puede darte una ventaja inmediata o proteger la moral.','choices',jsonb_build_array(
      jsonb_build_object('key','intense','title','Subir la intensidad','summary','Pagas una concentración especial y obtienes puntos deportivos al cierre.','reputationChange',round(1*multiplier),'budgetChange',-0.25,'sportingPointsChange',3,'condition',null,'conditionalBonus',0),
      jsonb_build_object('key','recovery','title','Priorizar la recuperación','summary','Sin coste económico y con una mejora moderada de reputación.','reputationChange',round(2*multiplier),'budgetChange',0,'sportingPointsChange',0,'condition',null,'conditionalBonus',0)
    ));
  end if;
end $$;

create or replace function public.save_manager_career_decision(target_career_id uuid,target_decision_key text,target_choice_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare selected_career public.manager_careers%rowtype; prompt jsonb; choice jsonb; rep_delta integer; budget_delta numeric; points_delta numeric; conditional_target integer; conditional_bonus numeric; consequence text;
begin
  select * into selected_career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  prompt:=public.manager_career_decision_prompt(target_career_id);
  if prompt is null or prompt->>'key'<>target_decision_key then raise exception 'Esta decisión no está disponible'; end if;
  select value into choice from jsonb_array_elements(prompt->'choices') where value->>'key'=target_choice_key;
  if choice is null then raise exception 'Opción no válida'; end if;
  if exists(select 1 from public.manager_career_decisions where career_id=target_career_id and matchday=selected_career.current_matchday and decision_key=target_decision_key) then raise exception 'Ya has tomado esta decisión en la jornada'; end if;
  rep_delta:=(choice->>'reputationChange')::integer; budget_delta:=(choice->>'budgetChange')::numeric; points_delta:=(choice->>'sportingPointsChange')::numeric; conditional_bonus:=(choice->>'conditionalBonus')::numeric;
  if choice->>'condition' is not null then conditional_target:=nullif(regexp_replace(choice->>'condition','[^0-9]','','g'),'')::integer; end if;
  if selected_career.budget+budget_delta<0 then raise exception 'No tienes presupuesto para asumir esta decisión'; end if;
  consequence:=choice->>'summary';
  insert into public.manager_career_decisions(career_id,matchday,decision_key,choice_key,choice_title,consequence,reputation_change,budget_change,sporting_points_change,confidence_change,conditional_original_target,conditional_sporting_bonus)
  values(target_career_id,selected_career.current_matchday,target_decision_key,target_choice_key,choice->>'title',consequence,rep_delta,budget_delta,points_delta,rep_delta,conditional_target,conditional_bonus);
  update public.manager_careers set budget=budget+budget_delta,reputation=greatest(0,least(100,reputation+rep_delta)),board_confidence=greatest(0,least(100,board_confidence+rep_delta)),updated_at=now() where id=target_career_id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(target_career_id,'decision',choice->>'title',consequence,selected_career.current_matchday,rep_delta);
  return choice;
end $$;

create or replace function public.settle_manager_careers_for_matchday(target_matchday_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare selected_round public.competition_matchdays%rowtype; selected_career record; lineup_record public.manager_career_lineups%rowtype; fantasy_points numeric; decision_points numeric; originals integer; total_points numeric; rewards integer; failed_penalty integer; failure boolean; processed integer:=0; dismissal_threshold integer; max_matchday integer;
begin
  select * into selected_round from public.competition_matchdays where id=target_matchday_id;
  if not found or selected_round.state<>'closed' then return 0; end if;
  select dismissal_confidence_threshold into dismissal_threshold from public.manager_career_rules where id;
  select coalesce(max(matchday),38) into max_matchday from public.match_fixtures where competition_id=selected_round.competition_id and season=selected_round.season;
  for selected_career in select * from public.manager_careers c where c.competition_id=selected_round.competition_id and c.status='active' and not exists(select 1 from public.manager_career_events e where e.career_id=c.id and e.event_type='matchday_result' and e.matchday=selected_round.matchday) for update skip locked loop
    select * into lineup_record from public.manager_career_lineups where career_id=selected_career.id and matchday=selected_round.matchday;
    fantasy_points:=0; decision_points:=0; originals:=0;
    if lineup_record.career_id is not null then
      select coalesce(sum(coalesce(pp.points,0)*case when listed.player_id=lineup_record.captain_id then cfg.captain_multiplier else 1 end),0),count(*) filter(where cp.is_original)
      into fantasy_points,originals
      from unnest(lineup_record.player_ids) listed(player_id)
      join public.manager_career_players cp on cp.career_id=selected_career.id and cp.player_id=listed.player_id
      cross join public.matchday_lifecycle_config cfg
      left join public.player_matchday_points pp on pp.competition_id=selected_round.competition_id and pp.season=selected_round.season and pp.matchday=selected_round.matchday and pp.player_id=listed.player_id and pp.scoring_version=selected_round.scoring_version;
    end if;
    select coalesce(sum(sporting_points_change+case when conditional_original_target is not null and originals>=conditional_original_target then conditional_sporting_bonus else 0 end),0) into decision_points from public.manager_career_decisions where career_id=selected_career.id and matchday=selected_round.matchday;
    total_points:=fantasy_points+decision_points;
    update public.manager_career_lineups set points=total_points,locked_at=coalesce(locked_at,selected_round.locked_at),settled_at=now() where career_id=selected_career.id and matchday=selected_round.matchday;
    update public.manager_career_objectives set current_value=case objective_type when 'matchday' then total_points when 'season' then selected_career.sporting_points+total_points when 'identity' then (select count(*) from public.manager_career_players where career_id=selected_career.id and is_original) when 'confidence' then selected_career.board_confidence else current_value end,updated_at=now() where career_id=selected_career.id and status='active' and (objective_type<>'matchday' or expires_matchday=selected_round.matchday);
    select coalesce(sum(reputation_reward),0) into rewards from public.manager_career_objectives where career_id=selected_career.id and status='active' and current_value>=target_value;
    update public.manager_career_objectives set status='completed',updated_at=now() where career_id=selected_career.id and status='active' and current_value>=target_value;
    select coalesce(max(failure_penalty),0) into failed_penalty from public.manager_career_objectives where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value;
    select exists(select 1 from public.manager_career_objectives where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value) into failure;
    update public.manager_career_objectives set status='failed',updated_at=now() where career_id=selected_career.id and objective_type='matchday' and expires_matchday=selected_round.matchday and status='active' and current_value<target_value;
    update public.manager_careers set sporting_points=sporting_points+total_points,objective_points=objective_points+rewards,reputation=greatest(0,least(100,reputation+rewards)),board_confidence=greatest(0,least(100,board_confidence+rewards-case when failure then failed_penalty else 0 end)),consecutive_failures=case when failure then consecutive_failures+1 else 0 end,current_matchday=least(max_matchday,greatest(current_matchday,selected_round.matchday+1)),updated_at=now() where id=selected_career.id;
    update public.manager_careers set status='dismissed',updated_at=now() where id=selected_career.id and board_confidence<=dismissal_threshold and consecutive_failures>=3;
    insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(selected_career.id,'matchday_result','Jornada evaluada',total_points||' puntos · '||case when failure then 'objetivo incumplido' else 'contrato al día' end,selected_round.matchday,rewards-case when failure then failed_penalty else 0 end);
    processed:=processed+1;
  end loop;
  return processed;
end $$;

create or replace function public.sync_manager_careers_with_matchday() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.state='locked' and old.state is distinct from new.state then
    update public.manager_career_lineups l set locked_at=coalesce(l.locked_at,new.locked_at,now()) from public.manager_careers c where c.id=l.career_id and c.competition_id=new.competition_id and l.matchday=new.matchday;
    update public.manager_careers set current_matchday=current_matchday+1,updated_at=now() where competition_id=new.competition_id and current_matchday=new.matchday and status='active';
    insert into public.manager_career_objectives(career_id,objective_type,title,description,target_value,reputation_reward,failure_penalty,expires_matchday)
    select c.id,'matchday','Objetivo de la Jornada '||(new.matchday+1),'Supera los puntos fantasy exigidos por la directiva en esta jornada.',round((case c.contract_tier when 'title' then 62 when 'europe' then 55 else 48 end)*(case c.difficulty when 'relaxed' then r.relaxed_target_multiplier when 'elite' then r.elite_target_multiplier else r.balanced_target_multiplier end)),6,r.failure_confidence_penalty,new.matchday+1
    from public.manager_careers c cross join public.manager_career_rules r where r.id and c.competition_id=new.competition_id and c.current_matchday=new.matchday+1 and c.status='active'
    on conflict(career_id,objective_type,expires_matchday) where expires_matchday is not null do nothing;
  end if;
  if new.state='closed' and old.state is distinct from new.state then perform public.settle_manager_careers_for_matchday(new.id); end if;
  return new;
end $$;

drop trigger if exists sync_manager_careers_matchday_trigger on public.competition_matchdays;
create trigger sync_manager_careers_matchday_trigger after update of state on public.competition_matchdays for each row execute function public.sync_manager_careers_with_matchday();

create or replace function public.manager_career_workspace(target_career_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected_career public.manager_careers%rowtype; result jsonb;
begin
  select * into selected_career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  select jsonb_build_object(
    'career',jsonb_build_object('id',selected_career.id,'matchday',selected_career.current_matchday,'budget',selected_career.budget,'boardConfidence',selected_career.board_confidence,'contractTier',selected_career.contract_tier,'status',selected_career.status),
    'squad',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'value',p.market_value,'photoUrl',p.photo_url,'isOriginal',cp.is_original,'acquisitionValue',cp.acquisition_value) order by p.position,p.name) from public.manager_career_players cp join public.players p on p.id=cp.player_id join public.sports_clubs sc on sc.id=p.sports_club_id where cp.career_id=selected_career.id),'[]'::jsonb),
    'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchday',l.matchday,'formation',l.formation,'captainId',l.captain_id,'playerIds',l.player_ids,'savedAt',l.saved_at,'lockedAt',l.locked_at,'points',l.points) order by l.matchday desc) from public.manager_career_lineups l where l.career_id=selected_career.id),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(jsonb_build_object('matchday',d.matchday,'decisionKey',d.decision_key,'choiceKey',d.choice_key,'choiceTitle',d.choice_title,'consequence',d.consequence,'reputationChange',d.reputation_change,'budgetChange',d.budget_change,'sportingPointsChange',d.sporting_points_change,'conditionalOriginalTarget',d.conditional_original_target,'conditionalSportingBonus',d.conditional_sporting_bonus,'decidedAt',d.decided_at) order by d.matchday desc) from public.manager_career_decisions d where d.career_id=selected_career.id),'[]'::jsonb),
    'objectives',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'type',o.objective_type,'title',o.title,'description',o.description,'targetValue',o.target_value,'currentValue',o.current_value,'reputationReward',o.reputation_reward,'failurePenalty',o.failure_penalty,'status',o.status,'expiresMatchday',o.expires_matchday) order by case o.objective_type when 'season' then 0 when 'identity' then 1 when 'matchday' then 2 else 3 end) from public.manager_career_objectives o where o.career_id=selected_career.id),'[]'::jsonb),
    'decisionPrompt',case when selected_career.status='active' then public.manager_career_decision_prompt(target_career_id) else null end,
    'market',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'value',p.market_value,'photoUrl',p.photo_url) order by p.market_value desc,p.name) from public.players p join public.sports_clubs sc on sc.id=p.sports_club_id where p.competition_id=selected_career.competition_id and p.active and not exists(select 1 from public.manager_career_players cp where cp.career_id=selected_career.id and cp.player_id=p.id)),'[]'::jsonb)
  ) into result;
  return result;
end $$;

do $$ declare career_row record; begin for career_row in select id from public.manager_careers where status='active' loop perform public.build_manager_career_contract(career_row.id,true); end loop; end $$;

revoke all on function public.manager_career_decision_prompt(uuid),public.build_manager_career_contract(uuid,boolean),public.settle_manager_careers_for_matchday(uuid) from public,anon;
grant execute on function public.manager_career_decision_prompt(uuid) to authenticated;
grant execute on function public.settle_manager_careers_for_matchday(uuid) to service_role;
grant execute on function public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
