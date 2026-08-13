-- El laboratorio utiliza el mismo catalogo narrativo y las mismas consecuencias
-- que Carrera real. La seleccion es determinista dentro de la copia aislada y
-- respeta requisitos y ventanas de repeticion.

create or replace function public.manager_career_lab_seed_experience(
  target_state jsonb,
  target_difficulty text,
  target_matchday integer
) returns jsonb
language plpgsql volatile set search_path=public as $$
declare
  state jsonb:=coalesce(target_state,'{}'::jsonb);
  season_target integer;
  mission_target integer;
  original_count integer;
  current_confidence integer:=coalesce((state->>'confidence')::integer,60);
  current_budget numeric:=coalesce((state->>'budget')::numeric,0);
  selected_event public.manager_career_event_templates%rowtype;
  choices jsonb;
  selection_salt text;
begin
  season_target:=case target_difficulty when 'relaxed' then 1800 when 'elite' then 2700 else 2300 end;
  mission_target:=case target_difficulty when 'relaxed' then 42 when 'elite' then 62 else 52 end;
  select count(*) into original_count
  from jsonb_array_elements(coalesce(state->'squad','[]'::jsonb)) item
  where coalesce((item->>'original')::boolean,false);

  if state->'objectives' is null then
    state:=jsonb_set(state,'{objectives}',jsonb_build_array(
      jsonb_build_object('id','season','type','season','title','Objetivo deportivo','description','Acumula los puntos fantasy exigidos durante toda la temporada.','targetValue',season_target,'currentValue',coalesce((state->>'sportingPoints')::integer,0),'reputationReward',25,'failurePenalty',10,'status','active'),
      jsonb_build_object('id','identity','type','identity','title','Protege la identidad','description','Mantén al menos 8 jugadores originales y 7 en el once.','targetValue',8,'currentValue',original_count,'reputationReward',8,'failurePenalty',8,'status','active'),
      jsonb_build_object('id','matchday-'||target_matchday,'type','matchday','title','Reto de la Jornada '||target_matchday,'description','Supera el objetivo fantasy de esta jornada.','targetValue',mission_target,'currentValue',0,'reputationReward',6,'failurePenalty',8,'status','active','expiresMatchday',target_matchday),
      jsonb_build_object('id','confidence','type','confidence','title','Respaldo de la directiva','description','Termina la temporada con al menos 70 de confianza.','targetValue',70,'currentValue',current_confidence,'reputationReward',10,'failurePenalty',10,'status','active')
    ));
  end if;

  if state->'decisionPrompt' is null then
    selection_salt:=coalesce(state->'squad'->0->>'id','laboratory')||':'||target_difficulty||':'||target_matchday;

    select template.* into selected_event
    from public.manager_career_event_templates template
    where template.active
      and target_matchday between template.min_matchday and template.max_matchday
      and current_confidence between template.min_confidence and template.max_confidence
      and current_budget>=template.min_budget
      and target_difficulty=any(template.allowed_difficulties)
      and not exists(
        select 1 from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) history
        where history->>'decisionKey'=template.key
          and coalesce((history->>'matchday')::integer,0)>target_matchday-template.cooldown_matchdays
      )
    order by
      case when template.story_step>1 and exists(
        select 1
        from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) history
        join public.manager_career_event_templates prior on prior.key=history->>'decisionKey'
        where prior.story_key=template.story_key and prior.story_step=template.story_step-1
      ) then 0 else 1 end,
      md5(selection_salt||':'||template.key)
    limit 1;

    -- Si el historial deja temporalmente el catalogo sin candidatos, conserva
    -- las reglas contextuales y evita al menos repetir la decision inmediatamente anterior.
    if selected_event.key is null then
      select template.* into selected_event
      from public.manager_career_event_templates template
      where template.active
        and target_matchday between template.min_matchday and template.max_matchday
        and current_confidence between template.min_confidence and template.max_confidence
        and current_budget>=template.min_budget
        and target_difficulty=any(template.allowed_difficulties)
        and template.key<>coalesce((
          select history->>'decisionKey'
          from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) history
          order by coalesce((history->>'matchday')::integer,0) desc limit 1
        ),'')
      order by md5(selection_salt||':fallback:'||template.key)
      limit 1;
    end if;

    if selected_event.key is not null then
      select jsonb_agg(jsonb_build_object(
        'key',choice.choice_key,
        'title',choice.title,
        'summary',choice.summary,
        'reputationChange',choice.reputation_change,
        'confidenceChange',choice.confidence_change,
        'budgetChange',choice.budget_change,
        'sportingPointsChange',choice.sporting_points_change,
        'condition',case when choice.conditional_original_target is not null then 'Alinea al menos '||choice.conditional_original_target||' originales' else null end,
        'conditionalBonus',choice.conditional_sporting_bonus
      ) order by choice.sort_order) into choices
      from public.manager_career_event_choices choice
      where choice.template_key=selected_event.key;

      state:=jsonb_set(state,'{decisionPrompt}',jsonb_build_object(
        'key',selected_event.key,
        'title',selected_event.title,
        'description',selected_event.description,
        'category',selected_event.category,
        'storyKey',selected_event.story_key,
        'storyStep',selected_event.story_step,
        'choices',coalesce(choices,'[]'::jsonb)
      ));
    end if;
  end if;

  return state;
end $$;

-- Las sesiones de prueba que aun no han decidido en su jornada reciben ya un
-- dilema del catalogo real. Las decisiones confirmadas se conservan intactas.
update public.manager_career_lab_sessions session
set state=public.manager_career_lab_seed_experience(session.state-'decisionPrompt',session.difficulty,session.current_matchday),
    updated_at=now()
where session.status='running'
  and not exists(
    select 1 from jsonb_array_elements(coalesce(session.state->'decisions','[]'::jsonb)) decision
    where coalesce((decision->>'matchday')::integer,0)=session.current_matchday
  );

notify pgrst,'reload schema';
