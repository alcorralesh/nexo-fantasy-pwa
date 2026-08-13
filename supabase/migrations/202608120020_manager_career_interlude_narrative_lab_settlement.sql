-- Liquida en el laboratorio exactamente las consecuencias de los capítulos narrativos.

do $$ begin
  if to_regprocedure('public.admin_step_manager_career_lab_v6_base(uuid,text,jsonb)') is null then
    alter function public.admin_step_manager_career_lab(uuid,text,jsonb)
      rename to admin_step_manager_career_lab_v6_base;
  end if;
end $$;

create or replace function public.admin_step_manager_career_lab(
  target_session_id uuid,
  target_action text,
  target_options jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
<<narrative_settlement>>
declare
  before_session public.manager_career_lab_sessions%rowtype;
  after_session public.manager_career_lab_sessions%rowtype;
  result jsonb;
  state jsonb;
  completed jsonb;
  choices jsonb;
  report jsonb;
  confidence_delta integer:=0;
  reputation_delta integer:=0;
  budget_delta numeric:=0;
begin
  perform public.manager_career_lab_assert_admin();
  select * into before_session
    from public.manager_career_lab_sessions
    where id=target_session_id and created_by=auth.uid();
  if not found then raise exception 'Laboratorio no disponible'; end if;

  result:=public.admin_step_manager_career_lab_v6_base(target_session_id,target_action,target_options);
  select * into after_session from public.manager_career_lab_sessions where id=target_session_id;

  if before_session.phase='interlude' and after_session.phase='preparation' then
    state:=after_session.state;
    completed:=state->'interludes'->-1;
    choices:=coalesce(completed->'storyChoices','[]'::jsonb);

    select
      coalesce(sum((choice->>'confidenceChange')::integer),0),
      coalesce(sum((choice->>'reputationChange')::integer),0),
      coalesce(sum((choice->>'budgetChange')::numeric),0)
    into confidence_delta,reputation_delta,budget_delta
    from jsonb_array_elements(choices) choice;

    state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,least(100,(state->>'confidence')::integer+confidence_delta))));
    state:=jsonb_set(state,'{reputation}',to_jsonb(greatest(0,least(100,(state->>'reputation')::integer+reputation_delta))));
    state:=jsonb_set(state,'{budget}',to_jsonb(greatest(0,(state->>'budget')::numeric+budget_delta)));

    report:=jsonb_build_object(
      'tier',case when jsonb_array_length(choices)>=4 then 'completed' else 'incomplete' end,
      'title',case when jsonb_array_length(choices)>=4 then 'Historia completada' else 'Historia incompleta' end,
      'description',jsonb_array_length(choices)||' de 4 capítulos decididos.',
      'confidenceChange',confidence_delta,
      'reputationChange',reputation_delta,
      'budgetChange',budget_delta,
      'chapters',choices
    );

    completed:=completed||jsonb_build_object('reward',report,'narrativeResult',report,'rewardedAt',now());
    state:=jsonb_set(state,'{interludes,-1}',completed);
    state:=jsonb_set(state,'{lastInterludeReward}',report);

    update public.manager_career_lab_sessions
      set state=narrative_settlement.state,
          last_report=jsonb_build_object(
            'action','interlude_story_settled',
            'detail',(report->>'title')||': '||(report->>'description'),
            'matchday',after_session.current_matchday,
            'phaseBefore','interlude',
            'phaseAfter','preparation',
            'checks',public.manager_career_lab_checks(narrative_settlement.state)
          ),
          updated_at=now()
      where id=target_session_id;
    return public.admin_manager_career_lab_state(target_session_id);
  end if;

  return result;
end $$;

revoke all on function public.admin_step_manager_career_lab(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_step_manager_career_lab(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
