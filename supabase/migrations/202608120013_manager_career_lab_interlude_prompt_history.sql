-- El laboratorio recuerda todos los dilemas mostrados, aunque el usuario no
-- tome una decision, y nunca atraviesa automaticamente un interludio real.

alter function public.manager_career_lab_seed_experience(jsonb,text,integer)
  rename to manager_career_lab_seed_experience_v2_base;

create or replace function public.manager_career_lab_seed_experience(
  target_state jsonb,
  target_difficulty text,
  target_matchday integer
) returns jsonb
language plpgsql volatile set search_path=public as $$
declare
  state jsonb:=coalesce(target_state,'{}'::jsonb);
  selection_state jsonb;
  original_decisions jsonb:=coalesce(state->'decisions','[]'::jsonb);
  prompt_history jsonb:=coalesce(state->'promptHistory','[]'::jsonb);
  prompt jsonb;
begin
  if state->'decisionPrompt' is not null then return state; end if;

  -- La funcion base ya aplica contexto, cadenas narrativas y cooldown. Para el
  -- laboratorio, los prompts vistos se incorporan temporalmente al historial
  -- de decisiones para que omitir una eleccion no permita repetir el dilema.
  selection_state:=jsonb_set(state,'{decisions}',original_decisions||prompt_history);
  selection_state:=public.manager_career_lab_seed_experience_v2_base(
    selection_state,
    target_difficulty,
    target_matchday
  );
  prompt:=selection_state->'decisionPrompt';
  state:=jsonb_set(selection_state,'{decisions}',original_decisions);

  if prompt is not null and not exists(
    select 1
    from jsonb_array_elements(prompt_history) item
    where coalesce((item->>'matchday')::integer,0)=target_matchday
  ) then
    prompt_history:=prompt_history||jsonb_build_array(jsonb_build_object(
      'matchday',target_matchday,
      'decisionKey',prompt->>'key',
      'title',prompt->>'title',
      'shownAt',now()
    ));
    state:=jsonb_set(state,'{promptHistory}',prompt_history);
  end if;
  return state;
end $$;

create or replace function public.admin_run_manager_career_lab(
  target_session_id uuid,
  target_until text default 'season_end',
  target_limit integer default 200
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  selected public.manager_career_lab_sessions%rowtype;
  counter integer:=0;
  result jsonb;
begin
  perform public.manager_career_lab_assert_admin();
  loop
    select * into selected
    from public.manager_career_lab_sessions
    where id=target_session_id and created_by=auth.uid();
    exit when not found or selected.status not in ('running','paused')
      or selected.phase in ('completed','failed') or counter>=least(target_limit,500);

    if target_until='next_interlude' and counter>0 and selected.phase='interlude' then exit; end if;
    if target_until='next_failure' and counter>0 and coalesce((selected.state->>'consecutiveFailures')::integer,0)>0 then exit; end if;

    if selected.status='paused' then
      perform public.admin_step_manager_career_lab(selected.id,'resume');
    elsif selected.phase='preparation' then
      perform public.admin_step_manager_career_lab(selected.id,'prepare');
      if jsonb_array_length((select state->'currentLineup'->'players' from public.manager_career_lab_sessions where id=selected.id))=11 then
        perform public.admin_step_manager_career_lab(selected.id,'lock');
      end if;
    elsif selected.phase='locked' then
      perform public.admin_step_manager_career_lab(selected.id,'play');
    elsif selected.phase='played' then
      perform public.admin_step_manager_career_lab(selected.id,'close');
    elsif selected.phase='adjustment_pending' then
      perform public.admin_step_manager_career_lab(selected.id,'adjust');
    elsif selected.phase='interlude' then
      -- Solo los recorridos masivos pueden resolverlo automaticamente. El
      -- cierre de una jornada se detiene para que el usuario juegue sus dias.
      if target_until='matchday' then exit; end if;
      perform public.admin_step_manager_career_lab(
        selected.id,'resolve_interlude',
        jsonb_build_object('strategy',coalesce(selected.config->>'interludeStrategy','recovery'))
      );
    else exit;
    end if;
    counter:=counter+1;

    select * into selected from public.manager_career_lab_sessions where id=target_session_id;
    if target_until='matchday' and counter>0 and selected.phase in ('preparation','interlude','adjustment_pending') then exit; end if;
  end loop;
  result:=public.admin_manager_career_lab_state(target_session_id);
  return result||jsonb_build_object('stepsExecuted',counter);
end $$;

-- La decision que ya se estaba mostrando queda registrada como vista y se
-- reemplaza por otra distinta para que la correccion sea comprobable ahora.
update public.manager_career_lab_sessions session
set state=public.manager_career_lab_seed_experience(
  jsonb_set(
    (session.state-'decisionPrompt'),
    '{promptHistory}',
    coalesce(session.state->'promptHistory','[]'::jsonb)
      ||coalesce((select jsonb_agg(jsonb_build_object(
          'matchday',decision.value->'matchday',
          'decisionKey',decision.value->>'decisionKey',
          'title',decision.value->>'choiceTitle'
        )) from jsonb_array_elements(coalesce(session.state->'decisions','[]'::jsonb)) decision(value)),'[]'::jsonb)
      ||case when session.state->'decisionPrompt' is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
          'matchday',session.current_matchday,
          'decisionKey',session.state->'decisionPrompt'->>'key',
          'title',session.state->'decisionPrompt'->>'title'
        )) end
  ),
  session.difficulty,
  session.current_matchday
),updated_at=now()
where session.status='running' and session.phase='preparation'
  and not exists(
    select 1 from jsonb_array_elements(coalesce(session.state->'decisions','[]'::jsonb)) decision
    where coalesce((decision->>'matchday')::integer,0)=session.current_matchday
  );

revoke all on function public.admin_run_manager_career_lab(uuid,text,integer) from public,anon;
grant execute on function public.admin_run_manager_career_lab(uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
