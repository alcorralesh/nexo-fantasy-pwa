-- Convierte las salidas reales detectadas por el catalogo en incidencias
-- jugables de Carrera, sin alterar jornadas ni alineaciones ya bloqueadas.

alter table public.manager_career_rules
  add column if not exists catalog_incidents_enabled boolean not null default true;
alter table public.manager_career_rules
  add column if not exists exit_reinvest_percent integer not null default 100
    check(exit_reinvest_percent between 50 and 120);
alter table public.manager_career_rules
  add column if not exists exit_identity_percent integer not null default 85
    check(exit_identity_percent between 50 and 100);

create table if not exists public.manager_career_catalog_incidents (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  change_event_id uuid not null references public.player_catalog_change_events(id) on delete cascade,
  player_id text not null references public.players(id),
  change_type text not null check(change_type in('club_exit','competition_exit','competition_change')),
  player_snapshot jsonb not null default '{}'::jsonb,
  previous_club_id text,
  current_club_id text,
  frozen_market_value numeric(12,2) not null check(frozen_market_value >= 0),
  status text not null default 'pending' check(status in('pending','resolving','resolved','cancelled')),
  resolution_choice text check(resolution_choice in('reinvest','identity')),
  budget_credit numeric(12,2),
  reputation_change integer,
  confidence_change integer,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(career_id,change_event_id)
);
create index if not exists manager_career_catalog_incidents_pending_idx
  on public.manager_career_catalog_incidents(career_id,status,created_at desc);
alter table public.manager_career_catalog_incidents enable row level security;
drop policy if exists manager_career_catalog_incidents_owner on public.manager_career_catalog_incidents;
create policy manager_career_catalog_incidents_owner
  on public.manager_career_catalog_incidents for select to authenticated
  using(exists(select 1 from public.manager_careers career where career.id=career_id and career.owner_id=auth.uid()));
grant select on public.manager_career_catalog_incidents to authenticated;
grant all on public.manager_career_catalog_incidents to service_role;

create or replace function public.capture_manager_career_catalog_incident()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  selected_player public.players%rowtype;
  selected_career record;
  old_club_id text:=new.previous_data->>'clubId';
  next_club_id text:=new.current_data->>'clubId';
  next_active boolean:=coalesce((new.current_data->>'active')::boolean,false);
  incident_type text;
  incident_id uuid;
begin
  -- Si la fuente corrige el cambio antes de que el usuario responda, la
  -- incidencia pendiente se cancela y el jugador se conserva.
  if new.change_type='reactivated' or (next_active and next_club_id is not null) then
    update public.manager_career_catalog_incidents incident
      set status='cancelled',resolved_at=now()
    from public.manager_careers career
    where incident.career_id=career.id and incident.player_id=new.player_id
      and incident.status='pending' and career.sports_club_id=next_club_id;
  end if;

  if new.change_type not in('deactivated','competition','club')
    or old_club_id is null
    or not (select catalog_incidents_enabled from public.manager_career_rules where id)
  then return new; end if;

  select * into selected_player from public.players where id=new.player_id;
  if not found then return new; end if;
  incident_type:=case
    when new.change_type='deactivated' then 'competition_exit'
    when new.change_type='competition' then 'competition_change'
    else 'club_exit'
  end;

  for selected_career in
    select career.* from public.manager_careers career
    where career.status='active' and career.sports_club_id=old_club_id
      and exists(select 1 from public.manager_career_players owned where owned.career_id=career.id and owned.player_id=new.player_id)
    for update
  loop
    insert into public.manager_career_catalog_incidents(
      career_id,change_event_id,player_id,change_type,player_snapshot,
      previous_club_id,current_club_id,frozen_market_value
    ) values(
      selected_career.id,new.id,new.player_id,incident_type,
      jsonb_build_object(
        'name',coalesce(new.previous_data->>'name',selected_player.name),
        'initials',selected_player.initials,
        'position',coalesce(new.previous_data->>'position',selected_player.position),
        'photoUrl',selected_player.photo_url,
        'previousCompetitionId',new.previous_data->>'competitionId',
        'currentCompetitionId',new.current_data->>'competitionId',
        'previousClubId',old_club_id,
        'currentClubId',next_club_id
      ),old_club_id,next_club_id,selected_player.market_value
    ) on conflict(career_id,change_event_id) do nothing
    returning id into incident_id;

    if incident_id is not null then
      -- Un once historico queda intacto. Solo se elimina el borrador abierto
      -- que ya no podria validarse cuando llegue el cierre.
      delete from public.manager_career_lineups lineup
      where lineup.career_id=selected_career.id
        and lineup.matchday=selected_career.current_matchday
        and lineup.locked_at is null
        and new.player_id=any(lineup.player_ids);

      insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
      values(
        selected_career.id,'catalog_incident','Una salida cambia tus planes',
        coalesce(new.previous_data->>'name',selected_player.name)||' ya no pertenece al club real. Debes decidir como responder antes de preparar el once.',
        selected_career.current_matchday,0
      );
      insert into public.user_notifications(user_id,notification_type,title,body,target_section,source_key)
      values(
        selected_career.owner_id,'system','Decisión pendiente en Carrera',
        coalesce(new.previous_data->>'name',selected_player.name)||' ha salido del club real. Entra en Carrera para decidir el plan.',
        'inicio','career-catalog-incident:'||incident_id::text
      ) on conflict(user_id,source_key) where source_key is not null do nothing;
    end if;
    incident_id:=null;
  end loop;
  return new;
end $$;

drop trigger if exists manager_career_catalog_incident_trigger on public.player_catalog_change_events;
create trigger manager_career_catalog_incident_trigger
after insert on public.player_catalog_change_events
for each row execute function public.capture_manager_career_catalog_incident();

create or replace function public.guard_manager_career_player_pending_incident()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(
    select 1 from public.manager_career_catalog_incidents incident
    where incident.career_id=old.career_id and incident.player_id=old.player_id and incident.status='pending'
  ) then raise exception 'Resuelve primero la salida real del jugador desde el resumen de Carrera'; end if;
  return old;
end $$;
drop trigger if exists guard_manager_career_player_pending_incident_trigger on public.manager_career_players;
create trigger guard_manager_career_player_pending_incident_trigger
before delete on public.manager_career_players
for each row execute function public.guard_manager_career_player_pending_incident();

create or replace function public.guard_manager_career_lineup_catalog()
returns trigger language plpgsql security definer set search_path=public as $$
declare selected_competition text;
begin
  select competition_id into selected_competition from public.manager_careers where id=new.career_id;
  if exists(
    select 1 from unnest(new.player_ids) selected(player_id)
    left join public.players player on player.id=selected.player_id
    where player.id is null or not player.active or player.competition_id<>selected_competition
  ) then raise exception 'El once contiene un jugador que ya no esta disponible en la competicion'; end if;
  if exists(
    select 1 from public.manager_career_catalog_incidents incident
    where incident.career_id=new.career_id and incident.status='pending' and incident.player_id=any(new.player_ids)
  ) then raise exception 'Resuelve primero las salidas pendientes de tu plantilla'; end if;
  return new;
end $$;
drop trigger if exists guard_manager_career_lineup_catalog_trigger on public.manager_career_lineups;
create trigger guard_manager_career_lineup_catalog_trigger
before insert or update on public.manager_career_lineups
for each row execute function public.guard_manager_career_lineup_catalog();

create or replace function public.manager_career_catalog_incidents(target_career_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare selected_career public.manager_careers%rowtype; selected_rules public.manager_career_rules%rowtype;
begin
  select * into selected_career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into selected_rules from public.manager_career_rules where id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',incident.id,'playerId',incident.player_id,
      'playerName',incident.player_snapshot->>'name','initials',incident.player_snapshot->>'initials',
      'position',incident.player_snapshot->>'position','photoUrl',incident.player_snapshot->>'photoUrl',
      'changeType',incident.change_type,'previousClubId',incident.previous_club_id,'currentClubId',incident.current_club_id,
      'frozenMarketValue',incident.frozen_market_value,'status',incident.status,'resolutionChoice',incident.resolution_choice,
      'budgetCredit',incident.budget_credit,'reputationChange',incident.reputation_change,'confidenceChange',incident.confidence_change,
      'createdAt',incident.created_at,'resolvedAt',incident.resolved_at,
      'choices',case when incident.status='pending' then jsonb_build_array(
        jsonb_build_object(
          'key','reinvest','title','Reinvertir la salida',
          'summary','La directiva libera todo el valor congelado para buscar un sustituto. Ganas respaldo interno, pero el proyecto pierde algo de identidad.',
          'budgetCredit',round(incident.frozen_market_value*selected_rules.exit_reinvest_percent/100.0,2),
          'reputationChange',-1,'confidenceChange',2
        ),
        jsonb_build_object(
          'key','identity','Proteger la identidad',
          'summary','Una parte del ingreso se destina a cantera y estructura. Dispones de menos presupuesto, pero club y aficion respaldan el plan.',
          'budgetCredit',round(incident.frozen_market_value*selected_rules.exit_identity_percent/100.0,2),
          'reputationChange',3,'confidenceChange',1
        )
      ) else '[]'::jsonb end
    ) order by case incident.status when 'pending' then 0 else 1 end,incident.created_at desc)
    from public.manager_career_catalog_incidents incident where incident.career_id=selected_career.id
  ),'[]'::jsonb);
end $$;

create or replace function public.resolve_manager_career_catalog_incident(target_incident_id uuid,target_choice text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare incident public.manager_career_catalog_incidents%rowtype; career public.manager_careers%rowtype; rules public.manager_career_rules%rowtype;
  credit numeric; rep_delta integer; confidence_delta integer; player_name text; choice_title text;
begin
  if target_choice not in('reinvest','identity') then raise exception 'Respuesta no valida'; end if;
  select item.* into incident from public.manager_career_catalog_incidents item
  join public.manager_careers owned on owned.id=item.career_id
  where item.id=target_incident_id and item.status='pending' and owned.owner_id=auth.uid() and owned.status='active'
  for update of item;
  if not found then raise exception 'La incidencia ya no esta pendiente'; end if;
  select * into career from public.manager_careers where id=incident.career_id for update;
  select * into rules from public.manager_career_rules where id;
  player_name:=coalesce(incident.player_snapshot->>'name','El jugador');
  if target_choice='reinvest' then
    credit:=round(incident.frozen_market_value*rules.exit_reinvest_percent/100.0,2);
    rep_delta:=-1; confidence_delta:=2; choice_title:='Reinvertir la salida';
  else
    credit:=round(incident.frozen_market_value*rules.exit_identity_percent/100.0,2);
    rep_delta:=3; confidence_delta:=1; choice_title:='Proteger la identidad';
  end if;

  update public.manager_career_catalog_incidents set status='resolving' where id=incident.id;
  delete from public.manager_career_lineups lineup where lineup.career_id=career.id and lineup.matchday=career.current_matchday and lineup.locked_at is null and incident.player_id=any(lineup.player_ids);
  delete from public.manager_career_players where career_id=career.id and player_id=incident.player_id;
  update public.manager_careers set budget=budget+credit,reputation=greatest(0,least(100,reputation+rep_delta)),
    board_confidence=greatest(0,least(100,board_confidence+confidence_delta)),updated_at=now() where id=career.id;
  update public.manager_career_objectives set current_value=(select count(*) from public.manager_career_players where career_id=career.id and is_original),updated_at=now()
    where career_id=career.id and objective_type='identity' and status='active';
  update public.manager_career_objectives set current_value=greatest(0,least(100,career.board_confidence+confidence_delta)),updated_at=now()
    where career_id=career.id and objective_type='confidence' and status='active';
  update public.manager_career_catalog_incidents set status='resolved',resolution_choice=target_choice,budget_credit=credit,
    reputation_change=rep_delta,confidence_change=confidence_delta,resolved_at=now() where id=incident.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
  values(career.id,'catalog_incident_resolved',choice_title,player_name||' sale de la plantilla. Recuperas '||credit||' M y la confianza cambia '||case when confidence_delta>=0 then '+' else '' end||confidence_delta||'.',career.current_matchday,rep_delta);
  return jsonb_build_object('incidentId',incident.id,'choice',target_choice,'budgetCredit',credit,'reputationChange',rep_delta,'confidenceChange',confidence_delta);
end $$;

create or replace function public.append_career_incident_count_to_sync()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='succeeded' and old.status is distinct from new.status then
    update public.player_catalog_sync_jobs set summary=coalesce(summary,'{}'::jsonb)||jsonb_build_object(
      'careerIncidentsCreated',(select count(*) from public.manager_career_catalog_incidents where change_event_id in(select id from public.player_catalog_change_events where sync_job_id=new.id))
    ) where id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists append_career_incident_count_to_sync_trigger on public.player_catalog_sync_jobs;
create trigger append_career_incident_count_to_sync_trigger after update of status on public.player_catalog_sync_jobs
for each row execute function public.append_career_incident_count_to_sync();

drop function if exists public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric);
create or replace function public.update_manager_career_rules(
  next_enabled boolean,next_free_careers integer,next_extra_cost integer,next_initial_budget numeric,
  next_minimum_original_squad integer,next_minimum_original_lineup integer,next_weekly_decisions boolean,
  next_same_club_ranking boolean,next_academy_cost numeric,next_failure_penalty integer,next_dismissal_threshold integer,
  next_relaxed_multiplier numeric,next_balanced_multiplier numeric,next_elite_multiplier numeric,
  next_catalog_incidents_enabled boolean,next_exit_reinvest_percent integer,next_exit_identity_percent integer
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administracion puede cambiar estas reglas'; end if;
  if next_exit_reinvest_percent not between 50 and 120 or next_exit_identity_percent not between 50 and 100 then raise exception 'Porcentaje de salida no valido'; end if;
  update public.manager_career_rules set enabled=next_enabled,free_careers_per_competition=next_free_careers,
    extra_career_coin_cost=next_extra_cost,initial_budget=next_initial_budget,minimum_original_squad=next_minimum_original_squad,
    minimum_original_lineup=next_minimum_original_lineup,weekly_decision_enabled=next_weekly_decisions,
    same_club_ranking_enabled=next_same_club_ranking,academy_decision_cost=next_academy_cost,
    failure_confidence_penalty=next_failure_penalty,dismissal_confidence_threshold=next_dismissal_threshold,
    relaxed_target_multiplier=next_relaxed_multiplier,balanced_target_multiplier=next_balanced_multiplier,
    elite_target_multiplier=next_elite_multiplier,catalog_incidents_enabled=next_catalog_incidents_enabled,
    exit_reinvest_percent=next_exit_reinvest_percent,exit_identity_percent=next_exit_identity_percent,updated_at=now() where id;
end $$;

revoke all on function public.manager_career_catalog_incidents(uuid),public.resolve_manager_career_catalog_incident(uuid,text) from public,anon;
grant execute on function public.manager_career_catalog_incidents(uuid),public.resolve_manager_career_catalog_incident(uuid,text) to authenticated;
revoke all on function public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric,boolean,integer,integer) from public,anon;
grant execute on function public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean,numeric,integer,integer,numeric,numeric,numeric,boolean,integer,integer) to authenticated;
notify pgrst,'reload schema';
