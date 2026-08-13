-- El observador del laboratorio reproduce delegación, seguridad del puesto e interludios diarios.

alter function public.manager_career_lab_public_action(text,text,jsonb)
  rename to manager_career_lab_public_action_base;

create or replace function public.manager_career_lab_public_action(target_token text,target_action text,target_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_action>>
declare
  selected public.manager_career_lab_sessions%rowtype; state jsonb; active jsonb; lineup jsonb;
  strategy text; plan text; day_number integer; total_days integer; preparation_days integer;
  activity_days integer; used integer; maximum_uses integer:=5; next_available integer; cost numeric:=0;
begin
  if target_action not in ('interlude','delegate') then
    return public.manager_career_lab_public_action_base(target_token,target_action,target_payload);
  end if;
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status='running' and expires_at>now() for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);

  if target_action='delegate' then
    if selected.phase<>'preparation' then raise exception 'Solo puedes delegar antes de bloquear la jornada'; end if;
    used:=coalesce((state->'delegation'->>'used')::integer,0);
    next_available:=coalesce((state->'delegation'->>'nextAvailableMatchday')::integer,1);
    if used>=maximum_uses then raise exception 'Has agotado las delegaciones de esta temporada'; end if;
    if selected.current_matchday<next_available then raise exception 'La delegación vuelve a estar disponible en la Jornada %',next_available; end if;
    plan:=coalesce(target_payload->>'plan','close_ranks');
    if plan not in ('close_ranks','tactical','academy') then raise exception 'Plan de delegación no válido'; end if;
    cost:=case plan when 'academy' then .75 else .50 end;
    if (state->>'budget')::numeric<cost then raise exception 'No hay presupuesto suficiente'; end if;
    lineup:=public.manager_career_lab_build_lineup(state,case when plan='academy' then 'academy' else selected.manager_profile end,selected.seed,selected.current_matchday)||jsonb_build_object('locked',true,'delegated',true,'delegationPlan',plan);
    state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric-cost));
    if plan='close_ranks' then
      state:=jsonb_set(state,'{confidence}',to_jsonb(least(100,(state->>'confidence')::integer+6)));
      state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-1)));
    elsif plan='tactical' then state:=jsonb_set(state,'{tacticalProtection}',to_jsonb(50));
    else state:=jsonb_set(state,'{academyMultiplier}',to_jsonb(1.10)); end if;
    state:=jsonb_set(state,'{currentLineup}',lineup);
    state:=jsonb_set(state,'{delegation}',jsonb_build_object(
      'used',used+1,'maximum',maximum_uses,'remaining',maximum_uses-used-1,'cooldownMatchdays',3,
      'nextAvailableMatchday',selected.current_matchday+3,'current',jsonb_build_object('matchday',selected.current_matchday,'plan',plan,'cost',cost)
    ));
    selected.phase:='locked';
  else
    if selected.phase<>'interlude' or state->'activeInterlude' is null then raise exception 'No hay un interludio pendiente'; end if;
    active:=state->'activeInterlude'; strategy:=coalesce(target_payload->>'strategy','recovery');
    if strategy not in ('recovery','commercial','academy','tactical') then raise exception 'Actividad no válida'; end if;
    total_days:=greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14));
    preparation_days:=least(3,total_days-1); activity_days:=total_days-preparation_days;
    day_number:=greatest(1,coalesce((active->>'currentDay')::integer,1));
    if day_number>activity_days then raise exception 'Las actividades han terminado: ya puedes preparar la siguiente jornada'; end if;
    if strategy='recovery' then state:=jsonb_set(state,'{confidence}',to_jsonb(least(100,(state->>'confidence')::integer+5))); state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-1)));
    elsif strategy='commercial' then state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+1.5)); state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,(state->>'confidence')::integer-3)));
    elsif strategy='academy' then state:=jsonb_set(state,'{reputation}',to_jsonb(least(100,(state->>'reputation')::integer+4)));
    else state:=jsonb_set(state,'{tacticalProtection}',to_jsonb(50)); end if;
    active:=active||jsonb_build_object('totalDays',total_days,'preparationDays',preparation_days,'currentDay',day_number+1,'activityDays',activity_days,'status','active');
    active:=jsonb_set(active,'{actions}',coalesce(active->'actions','[]'::jsonb)||jsonb_build_array(jsonb_build_object('day',day_number,'strategy',strategy,'createdAt',now())));
    if day_number>=activity_days then
      state:=jsonb_set(state,'{interludes}',coalesce(state->'interludes','[]'::jsonb)||jsonb_build_array(active||jsonb_build_object('status','completed')));
      state:=state-'activeInterlude'; selected.current_matchday:=selected.current_matchday+1; selected.phase:='preparation';
      state:=jsonb_set(state,'{currentLineup}','null'::jsonb); state:=state-'decisionPrompt';
      state:=public.manager_career_lab_seed_experience(state,selected.difficulty,selected.current_matchday);
    else state:=jsonb_set(state,'{activeInterlude}',active); end if;
  end if;
  update public.manager_career_lab_sessions target set state=lab_action.state,phase=selected.phase,current_matchday=selected.current_matchday,updated_at=now() where target.id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype; safe_state jsonb; delegation jsonb; active jsonb;
begin
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status<>'archived' and expires_at>now();
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  safe_state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  delegation:=coalesce(safe_state->'delegation',jsonb_build_object('used',0,'maximum',5,'remaining',5,'cooldownMatchdays',3,'nextAvailableMatchday',1,'current',null));
  active:=safe_state->'activeInterlude';
  if active is not null then
    active:=active||jsonb_build_object(
      'totalDays',greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14)),
      'preparationDays',3,'currentDay',greatest(1,coalesce((active->>'currentDay')::integer,1)),
      'activityDays',greatest(2,greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14))-3),
      'actions',coalesce(active->'actions','[]'::jsonb)
    );
  end if;
  return jsonb_build_object(
    'session',jsonb_build_object('title',selected.title,'userName',(select display_name from public.profiles where id=selected.subject_user_id),'competitionId',selected.competition_id,'sportsClubName',(select name from public.sports_clubs where id=selected.sports_club_id),'status',selected.status,'matchday',selected.current_matchday,'maximumMatchday',selected.maximum_matchday,'phase',selected.phase,'updatedAt',selected.updated_at),
    'state',jsonb_build_object(
      'budget',safe_state->'budget','confidence',safe_state->'confidence','reputation',safe_state->'reputation','sportingPoints',safe_state->'sportingPoints','objectivePoints',safe_state->'objectivePoints',
      'consecutiveFailures',safe_state->'consecutiveFailures','dismissalThreshold',15,'status',safe_state->'status','squad',safe_state->'squad','currentLineup',safe_state->'currentLineup',
      'reports',safe_state->'reports','decisions',safe_state->'decisions','objectives',safe_state->'objectives','decisionPrompt',safe_state->'decisionPrompt','incidents',safe_state->'incidents',
      'interludes',safe_state->'interludes','activeInterlude',active,'delegation',delegation,'calendarExceptions',safe_state->'calendarExceptions','realSideEffects',0
    )
  );
end $$;

revoke all on function public.manager_career_lab_public_action_base(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
