-- Corrige la confirmacion de decisiones del catalogo real dentro del laboratorio.
-- Los efectos deportivos se almacenan como numeric (por ejemplo 0.00), por lo
-- que no deben convertirse directamente desde texto a integer.

alter function public.manager_career_lab_public_action(text,text,jsonb)
  rename to manager_career_lab_public_action_v4_base;

create or replace function public.manager_career_lab_public_action(
  target_token text,
  target_action text,
  target_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_action>>
declare
  selected public.manager_career_lab_sessions%rowtype;
  state jsonb;
  prompt jsonb;
  choice jsonb;
  confidence_delta integer;
  reputation_delta integer;
  budget_delta numeric;
  sporting_delta numeric;
begin
  if target_action<>'decision' then
    return public.manager_career_lab_public_action_v4_base(target_token,target_action,target_payload);
  end if;

  select * into selected
  from public.manager_career_lab_sessions
  where preview_token=target_token and preview_enabled and status='running' and expires_at>now()
  for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  if selected.phase<>'preparation' then raise exception 'La decisión solo puede tomarse antes de bloquear la jornada'; end if;

  state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  if exists(
    select 1 from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) decision
    where coalesce((decision->>'matchday')::integer,0)=selected.current_matchday
  ) then raise exception 'La decisión de esta jornada ya está confirmada'; end if;

  prompt:=state->'decisionPrompt';
  if prompt is null then raise exception 'No hay una decisión disponible para esta jornada'; end if;
  select value into choice
  from jsonb_array_elements(coalesce(prompt->'choices','[]'::jsonb)) value
  where value->>'key'=target_payload->>'choiceKey';
  if choice is null then raise exception 'Decisión no válida'; end if;

  confidence_delta:=coalesce((choice->>'confidenceChange')::numeric,0)::integer;
  reputation_delta:=coalesce((choice->>'reputationChange')::numeric,0)::integer;
  budget_delta:=coalesce((choice->>'budgetChange')::numeric,0);
  sporting_delta:=coalesce((choice->>'sportingPointsChange')::numeric,0);
  if (state->>'budget')::numeric+budget_delta<0 then raise exception 'No tienes presupuesto para asumir esta decisión'; end if;

  state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,least(100,(state->>'confidence')::integer+confidence_delta))));
  state:=jsonb_set(state,'{reputation}',to_jsonb(greatest(0,least(100,(state->>'reputation')::integer+reputation_delta))));
  state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+budget_delta));
  state:=jsonb_set(state,'{sportingPoints}',to_jsonb((state->>'sportingPoints')::numeric+sporting_delta));
  state:=jsonb_set(state,'{decisions}',coalesce(state->'decisions','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'matchday',selected.current_matchday,
    'decisionKey',prompt->>'key',
    'choiceKey',choice->>'key',
    'choiceTitle',choice->>'title',
    'consequence',choice->>'summary',
    'reputationChange',reputation_delta,
    'confidenceChange',confidence_delta,
    'budgetChange',budget_delta,
    'sportingPointsChange',sporting_delta,
    'condition',choice->'condition',
    'conditionalBonus',choice->'conditionalBonus',
    'decidedAt',now()
  )));

  update public.manager_career_lab_sessions target
  set state=lab_action.state,updated_at=now()
  where target.id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
