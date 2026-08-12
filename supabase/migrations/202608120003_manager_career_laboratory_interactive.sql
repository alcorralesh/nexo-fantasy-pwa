-- Experiencia interactiva del usuario dentro del laboratorio aislado de Carrera.
create or replace function public.manager_career_lab_seed_experience(target_state jsonb,target_difficulty text,target_matchday integer) returns jsonb
language plpgsql immutable set search_path=public as $$
declare state jsonb:=coalesce(target_state,'{}'::jsonb); season_target integer; mission_target integer; original_count integer;
begin
  season_target:=case target_difficulty when 'relaxed' then 1800 when 'elite' then 2700 else 2300 end;
  mission_target:=case target_difficulty when 'relaxed' then 42 when 'elite' then 62 else 52 end;
  select count(*) into original_count from jsonb_array_elements(coalesce(state->'squad','[]'::jsonb)) item where coalesce((item->>'original')::boolean,false);
  if state->'objectives' is null then
    state:=jsonb_set(state,'{objectives}',jsonb_build_array(
      jsonb_build_object('id','season','type','season','title','Objetivo deportivo','description','Acumula los puntos fantasy exigidos durante toda la temporada.','targetValue',season_target,'currentValue',coalesce((state->>'sportingPoints')::integer,0),'reputationReward',25,'failurePenalty',10,'status','active'),
      jsonb_build_object('id','identity','type','identity','title','Protege la identidad','description','Mantén al menos 8 jugadores originales y 7 en el once.','targetValue',8,'currentValue',original_count,'reputationReward',8,'failurePenalty',8,'status','active'),
      jsonb_build_object('id','matchday-'||target_matchday,'type','matchday','title','Reto de la Jornada '||target_matchday,'description','Supera el objetivo fantasy de esta jornada.','targetValue',mission_target,'currentValue',0,'reputationReward',6,'failurePenalty',8,'status','active','expiresMatchday',target_matchday),
      jsonb_build_object('id','confidence','type','confidence','title','Respaldo de la directiva','description','Termina la temporada con al menos 70 de confianza.','targetValue',70,'currentValue',coalesce((state->>'confidence')::integer,60),'reputationReward',10,'failurePenalty',10,'status','active')
    ));
  end if;
  if state->'decisionPrompt' is null then
    state:=jsonb_set(state,'{decisionPrompt}',jsonb_build_object('key','weekly-'||target_matchday,'title',case target_matchday%3 when 1 then 'El vestuario pide una señal' when 2 then 'La grada exige una respuesta' else 'La directiva quiere certezas' end,'description','Elige una postura antes de cerrar la jornada. Verás sus efectos antes de confirmarla.','choices',jsonb_build_array(
      jsonb_build_object('key','academy','title','Apostar por la cantera','summary','Inversión de futuro con una condición deportiva.','reputationChange',3,'confidenceChange',2,'budgetChange',-0.5,'sportingPointsChange',0,'condition','Alinea al menos 8 originales','conditionalBonus',3),
      jsonb_build_object('key','experience','title','Proteger el resultado','summary','Menor impacto social, pero una ayuda deportiva segura.','reputationChange',1,'confidenceChange',1,'budgetChange',0,'sportingPointsChange',1,'conditionalBonus',0)
    )));
  end if;
  return state;
end $$;

create or replace function public.manager_career_lab_experience_trigger() returns trigger
language plpgsql set search_path=public as $$
declare report jsonb; points integer; mission_target integer; originals integer; next_objective jsonb;
begin
  new.state:=public.manager_career_lab_seed_experience(new.state,new.difficulty,new.current_matchday);
  if tg_op='UPDATE' and old.phase='played' and new.phase<>'played' then
    report:=coalesce(new.state->'reports'->-1,'{}'::jsonb); points:=coalesce((report->>'points')::integer,0);
    mission_target:=case new.difficulty when 'relaxed' then 42 when 'elite' then 62 else 52 end;
    originals:=coalesce((old.state->'currentLineup'->>'originals')::integer,0);
    new.state:=jsonb_set(new.state,'{objectives}',coalesce((select jsonb_agg(case
      when item->>'type'='season' then item||jsonb_build_object('currentValue',(new.state->>'sportingPoints')::integer,'status',case when new.phase='completed' then case when (new.state->>'sportingPoints')::integer>=(item->>'targetValue')::integer then 'completed' else 'failed' end else 'active' end)
      when item->>'type'='identity' then item||jsonb_build_object('currentValue',originals,'status',case when originals>=7 then 'completed' else 'failed' end)
      when item->>'type'='confidence' then item||jsonb_build_object('currentValue',(new.state->>'confidence')::integer,'status',case when new.phase='completed' then case when (new.state->>'confidence')::integer>=(item->>'targetValue')::integer then 'completed' else 'failed' end else 'active' end)
      when item->>'id'='matchday-'||old.current_matchday then item||jsonb_build_object('currentValue',points,'status',case when points>=(item->>'targetValue')::integer then 'completed' else 'failed' end)
      else item end) from jsonb_array_elements(new.state->'objectives') item),'[]'::jsonb));
    if new.current_matchday>old.current_matchday and new.phase='preparation' then
      next_objective:=jsonb_build_object('id','matchday-'||new.current_matchday,'type','matchday','title','Reto de la Jornada '||new.current_matchday,'description','Supera el objetivo fantasy de esta jornada.','targetValue',mission_target,'currentValue',0,'reputationReward',6,'failurePenalty',8,'status','active','expiresMatchday',new.current_matchday);
      new.state:=jsonb_set(new.state,'{objectives}',new.state->'objectives'||jsonb_build_array(next_objective));
      new.state:=new.state-'decisionPrompt';
      new.state:=public.manager_career_lab_seed_experience(new.state,new.difficulty,new.current_matchday);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists manager_career_lab_experience_before_write on public.manager_career_lab_sessions;
create trigger manager_career_lab_experience_before_write before insert or update of state,phase,current_matchday on public.manager_career_lab_sessions for each row execute function public.manager_career_lab_experience_trigger();

update public.manager_career_lab_sessions set state=public.manager_career_lab_seed_experience(state,difficulty,current_matchday);

create or replace function public.manager_career_lab_public_action(target_token text,target_action text,target_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_action>>
declare selected public.manager_career_lab_sessions%rowtype; state jsonb; prompt jsonb; choice jsonb; lineup jsonb; strategy text; incident_id text; incident jsonb; player_id text; credit numeric:=0;
begin
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status='running' and expires_at>now() for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  if target_action='decision' then
    if selected.phase<>'preparation' then raise exception 'La decisión solo puede tomarse antes de bloquear la jornada'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) d where (d->>'matchday')::integer=selected.current_matchday) then raise exception 'La decisión de esta jornada ya está confirmada'; end if;
    prompt:=state->'decisionPrompt'; select value into choice from jsonb_array_elements(prompt->'choices') where value->>'key'=target_payload->>'choiceKey';
    if choice is null then raise exception 'Decisión no válida'; end if;
    state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,least(100,(state->>'confidence')::integer+coalesce((choice->>'confidenceChange')::integer,0)))));
    state:=jsonb_set(state,'{reputation}',to_jsonb(greatest(0,least(100,(state->>'reputation')::integer+coalesce((choice->>'reputationChange')::integer,0)))));
    state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+coalesce((choice->>'budgetChange')::numeric,0)));
    state:=jsonb_set(state,'{sportingPoints}',to_jsonb((state->>'sportingPoints')::integer+coalesce((choice->>'sportingPointsChange')::integer,0)));
    state:=jsonb_set(state,'{decisions}',coalesce(state->'decisions','[]'::jsonb)||jsonb_build_array(jsonb_build_object('matchday',selected.current_matchday,'decisionKey',prompt->>'key','choiceKey',choice->>'key','choiceTitle',choice->>'title','consequence',choice->>'summary','reputationChange',choice->'reputationChange','confidenceChange',choice->'confidenceChange','budgetChange',choice->'budgetChange','sportingPointsChange',choice->'sportingPointsChange','condition',choice->'condition','conditionalBonus',choice->'conditionalBonus','decidedAt',now())));
  elsif target_action='prepare_lineup' then
    if selected.phase<>'preparation' then raise exception 'La alineación ya no se puede preparar'; end if;
    lineup:=public.manager_career_lab_build_lineup(state,selected.manager_profile,selected.seed,selected.current_matchday); state:=jsonb_set(state,'{currentLineup}',lineup);
  elsif target_action='lock_lineup' then
    if selected.phase<>'preparation' or not coalesce((state->'currentLineup'->>'valid')::boolean,false) then raise exception 'No existe un once válido para confirmar'; end if;
    state:=jsonb_set(state,'{currentLineup,locked}','true'::jsonb); selected.phase:='locked';
  elsif target_action='interlude' then
    if selected.phase<>'interlude' or state->'activeInterlude' is null then raise exception 'No hay un interludio pendiente'; end if;
    strategy:=coalesce(target_payload->>'strategy','recovery');
    if strategy='recovery' then state:=jsonb_set(state,'{confidence}',to_jsonb(least(100,(state->>'confidence')::integer+5))); state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-1)));
    elsif strategy='commercial' then state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+1.5)); state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,(state->>'confidence')::integer-3)));
    elsif strategy='academy' then state:=jsonb_set(state,'{reputation}',to_jsonb(least(100,(state->>'reputation')::integer+4)));
    elsif strategy='tactical' then state:=jsonb_set(state,'{tacticalProtection}',to_jsonb(50)); else raise exception 'Plan no válido'; end if;
    state:=jsonb_set(state,'{interludes}',coalesce(state->'interludes','[]'::jsonb)||jsonb_build_array(state->'activeInterlude'||jsonb_build_object('strategy',strategy,'status','resolved'))); state:=state-'activeInterlude'; selected.current_matchday:=selected.current_matchday+1; selected.phase:='preparation'; state:=jsonb_set(state,'{currentLineup}','null'::jsonb); state:=state-'decisionPrompt'; state:=public.manager_career_lab_seed_experience(state,selected.difficulty,selected.current_matchday);
  elsif target_action='incident' then
    incident_id:=target_payload->>'incidentId'; select value into incident from jsonb_array_elements(coalesce(state->'incidents','[]'::jsonb)) where value->>'id'=incident_id and value->>'status'='pending'; if incident is null then raise exception 'Incidencia no disponible'; end if;
    player_id:=incident->>'playerId'; credit:=coalesce((incident->>'value')::numeric,(select (item->>'value')::numeric from jsonb_array_elements(state->'squad') item where item->>'id'=player_id),0);
    if target_payload->>'choice'='reinvest' then state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+credit)); state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,(state->>'confidence')::integer-2)));
    elsif target_payload->>'choice'='identity' then state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+credit*.85)); state:=jsonb_set(state,'{reputation}',to_jsonb(least(100,(state->>'reputation')::integer+3))); else raise exception 'Respuesta no válida'; end if;
    state:=jsonb_set(state,'{incidents}',(select jsonb_agg(case when item->>'id'=incident_id then item||jsonb_build_object('status','resolved','choice',target_payload->>'choice') else item end) from jsonb_array_elements(state->'incidents') item));
  else raise exception 'Acción no válida'; end if;
  update public.manager_career_lab_sessions target set state=lab_action.state,phase=selected.phase,current_matchday=selected.current_matchday,updated_at=now() where target.id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype; safe_state jsonb;
begin
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status<>'archived' and expires_at>now();
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  safe_state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  return jsonb_build_object('session',jsonb_build_object('title',selected.title,'userName',(select display_name from public.profiles where id=selected.subject_user_id),'competitionId',selected.competition_id,'sportsClubName',(select name from public.sports_clubs where id=selected.sports_club_id),'status',selected.status,'matchday',selected.current_matchday,'maximumMatchday',selected.maximum_matchday,'phase',selected.phase,'updatedAt',selected.updated_at),
    'state',jsonb_build_object('budget',safe_state->'budget','confidence',safe_state->'confidence','reputation',safe_state->'reputation','sportingPoints',safe_state->'sportingPoints','objectivePoints',safe_state->'objectivePoints','consecutiveFailures',safe_state->'consecutiveFailures','status',safe_state->'status','squad',safe_state->'squad','currentLineup',safe_state->'currentLineup','reports',safe_state->'reports','decisions',safe_state->'decisions','objectives',safe_state->'objectives','decisionPrompt',safe_state->'decisionPrompt','incidents',safe_state->'incidents','interludes',safe_state->'interludes','activeInterlude',safe_state->'activeInterlude','calendarExceptions',safe_state->'calendarExceptions','realSideEffects',0));
end $$;

revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
revoke all on function public.manager_career_lab_public_preview(text) from public;
grant execute on function public.manager_career_lab_public_preview(text) to anon,authenticated;
notify pgrst,'reload schema';
