-- Separa la decisión diaria del usuario del avance temporal del laboratorio.
-- El observador elige una actividad; Administración decide cuándo pasa el día.

do $$ begin
  if to_regprocedure('public.manager_career_lab_public_action_v4_base(text,text,jsonb)') is null then
    alter function public.manager_career_lab_public_action(text,text,jsonb)
      rename to manager_career_lab_public_action_v4_base;
  end if;
end $$;

create or replace function public.manager_career_lab_public_action(
  target_token text,
  target_action text,
  target_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_public>>
declare
  selected public.manager_career_lab_sessions%rowtype;
  state jsonb;
  active jsonb;
  strategy text;
  title text;
  detail text;
  day_number integer;
  action jsonb;
begin
  if target_action<>'interlude' then
    return public.manager_career_lab_public_action_v4_base(target_token,target_action,target_payload);
  end if;

  select * into selected from public.manager_career_lab_sessions
  where preview_token=target_token and preview_enabled and status='running' and expires_at>now()
  for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  if selected.phase<>'interlude' or selected.state->'activeInterlude' is null then
    raise exception 'No hay un interludio pendiente';
  end if;

  state:=selected.state;
  active:=state->'activeInterlude';
  day_number:=greatest(1,coalesce((active->>'currentDay')::integer,1));
  if exists(
    select 1 from jsonb_array_elements(coalesce(active->'actions','[]'::jsonb)) item
    where coalesce((item->>'day')::integer,0)=day_number
  ) then raise exception 'La actividad de este día ya está completada'; end if;

  strategy:=coalesce(target_payload->>'strategy','recovery');
  if strategy='recovery' then
    title:='Recuperar al grupo'; detail:='+5 confianza · reduce un fallo';
    state:=jsonb_set(state,'{confidence}',to_jsonb(least(100,(state->>'confidence')::integer+5)));
    state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-1)));
  elsif strategy='commercial' then
    title:='Compromiso comercial'; detail:='+1,5 M · -3 confianza';
    state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+1.5));
    state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,(state->>'confidence')::integer-3)));
  elsif strategy='academy' then
    title:='Día de cantera'; detail:='+4 reputación';
    state:=jsonb_set(state,'{reputation}',to_jsonb(least(100,(state->>'reputation')::integer+4)));
  elsif strategy='tactical' then
    title:='Sesión táctica'; detail:='Protección para la próxima misión';
    state:=jsonb_set(state,'{tacticalProtection}',to_jsonb(50));
  else raise exception 'Actividad no válida';
  end if;

  action:=jsonb_build_object(
    'day',day_number,'strategy',strategy,'title',title,'detail',detail,
    'completedAt',now(),'status','completed'
  );
  active:=jsonb_set(active,'{actions}',coalesce(active->'actions','[]'::jsonb)||jsonb_build_array(action));
  state:=jsonb_set(state,'{activeInterlude}',active);
  update public.manager_career_lab_sessions
  set state=lab_public.state,last_report=jsonb_build_object(
    'action','interlude_activity','detail','Actividad del día '||day_number||' completada: '||lab_public.title||'.',
    'matchday',current_matchday,'phaseBefore','interlude','phaseAfter','interlude',
    'checks',public.manager_career_lab_checks(lab_public.state)
  ),updated_at=now()
  where id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

do $$ begin
  if to_regprocedure('public.admin_step_manager_career_lab_v4_base(uuid,text,jsonb)') is null then
    alter function public.admin_step_manager_career_lab(uuid,text,jsonb)
      rename to admin_step_manager_career_lab_v4_base;
  end if;
end $$;

create or replace function public.admin_step_manager_career_lab(
  target_session_id uuid,
  target_action text,
  target_options jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_admin>>
declare
  selected public.manager_career_lab_sessions%rowtype;
  before_state jsonb;
  state jsonb;
  active jsonb;
  day_number integer;
  activity_days integer;
  next_matchday integer;
  next_phase text;
  detail text;
  sequence_no integer;
  action_taken boolean;
begin
  if target_action<>'advance_interlude_day' then
    return public.admin_step_manager_career_lab_v4_base(target_session_id,target_action,target_options);
  end if;

  perform public.manager_career_lab_assert_admin();
  select * into selected from public.manager_career_lab_sessions
  where id=target_session_id and created_by=auth.uid() for update;
  if not found then raise exception 'Laboratorio no disponible'; end if;
  if selected.phase<>'interlude' or selected.state->'activeInterlude' is null then
    raise exception 'No hay un día de interludio que avanzar';
  end if;

  before_state:=selected.state;
  state:=selected.state;
  active:=state->'activeInterlude';
  day_number:=greatest(1,coalesce((active->>'currentDay')::integer,1));
  activity_days:=greatest(1,coalesce((active->>'activityDays')::integer,1));
  action_taken:=exists(
    select 1 from jsonb_array_elements(coalesce(active->'actions','[]'::jsonb)) item
    where coalesce((item->>'day')::integer,0)=day_number
  );

  if not action_taken then
    active:=jsonb_set(active,'{skippedDays}',coalesce(active->'skippedDays','[]'::jsonb)||to_jsonb(day_number));
  end if;

  if day_number>=activity_days then
    active:=active||jsonb_build_object('status','completed','completedAt',now());
    state:=jsonb_set(state,'{interludes}',coalesce(state->'interludes','[]'::jsonb)||jsonb_build_array(active));
    state:=state-'activeInterlude';
    next_matchday:=selected.current_matchday+1;
    next_phase:='preparation';
    state:=jsonb_set(state,'{currentLineup}','null'::jsonb)-'decisionPrompt';
    state:=public.manager_career_lab_seed_experience(state,selected.difficulty,next_matchday);
    detail:='Finaliza el interludio y se abre la preparación de la J'||next_matchday||'.';
  else
    active:=jsonb_set(active,'{currentDay}',to_jsonb(day_number+1));
    state:=jsonb_set(state,'{activeInterlude}',active);
    next_matchday:=selected.current_matchday;
    next_phase:='interlude';
    detail:='El reloj del laboratorio avanza al día '||(day_number+1)||' de '||activity_days||'.';
  end if;

  update public.manager_career_lab_sessions
  set state=lab_admin.state,current_matchday=next_matchday,phase=next_phase,status='running',
      last_report=jsonb_build_object(
        'action','advance_interlude_day','detail',detail,'matchday',selected.current_matchday,
        'phaseBefore','interlude','phaseAfter',next_phase,
        'checks',public.manager_career_lab_checks(lab_admin.state)
      ),updated_at=now()
  where id=selected.id;

  select coalesce(max(sequence),0)+1 into sequence_no
  from public.manager_career_lab_checkpoints where session_id=selected.id;
  insert into public.manager_career_lab_checkpoints(session_id,sequence,matchday,phase,label,state)
  values(selected.id,sequence_no,next_matchday,next_phase,'Día de interludio '||day_number,state);
  perform public.manager_career_lab_log(
    selected.id,'advance_interlude_day','Día de interludio avanzado',detail,
    before_state,state,'success'
  );
  return public.admin_manager_career_lab_state(selected.id);
end $$;

revoke all on function public.manager_career_lab_public_action_v4_base(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
revoke all on function public.admin_step_manager_career_lab(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_step_manager_career_lab(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
