-- Programa de interludio: plan, puntos de gestión, proyectos, progreso, racha
-- y recompensa única al finalizar. Primera integración: Laboratorio.

create or replace function public.manager_career_interlude_plan_choices() returns jsonb
language sql immutable set search_path=public as $$
  select jsonb_build_array(
    jsonb_build_object('key','recovery','icon','♥','title','Reconstruir el vestuario','summary','Recupera cohesión y reduce el riesgo de destitución.','categories',jsonb_build_array('VESTUARIO','SALUD','EMERGENCIA'),'basic','+4 confianza','advanced','+7 confianza y elimina un fallo','excellent','+10 confianza y elimina un fallo'),
    jsonb_build_object('key','tactical','icon','XI','title','Preparación táctica','summary','Convierte el descanso en una ventaja para la próxima jornada.','categories',jsonb_build_array('TÁCTICA','PREPARACIÓN'),'basic','Protección del 20%','advanced','Protección del 35% y +2 pts condicionales','excellent','Protección del 50% y +4 pts condicionales'),
    jsonb_build_object('key','academy','icon','C','title','Proyecto de cantera','summary','Refuerza la identidad y el peso de los jugadores originales.','categories',jsonb_build_array('CANTERA','IDENTIDAD'),'basic','+3 reputación','advanced','+5 reputación y bonus de originales','excellent','+8 reputación y bonus de originales'),
    jsonb_build_object('key','growth','icon','€','title','Impulso económico','summary','Genera margen para el mercado sin perder el control del vestuario.','categories',jsonb_build_array('RECURSOS','COMUNICACIÓN'),'basic','+0,75 M','advanced','+1,50 M','excellent','+2,50 M y -2 confianza'),
    jsonb_build_object('key','supporters','icon','N','title','Conectar con la afición','summary','Construye reputación y un escudo social para el regreso.','categories',jsonb_build_array('AFICIÓN','COMUNICACIÓN'),'basic','+3 reputación','advanced','+5 reputación y protección del 20%','excellent','+6 reputación, +2 confianza y protección del 30%')
  );
$$;

create or replace function public.manager_career_interlude_project_choices() returns jsonb
language sql immutable set search_path=public as $$
  select jsonb_build_array(
    jsonb_build_object('key','training_agenda','area','EQUIPO','icon','▦','title','Diseñar la agenda','summary','Distribuye recuperación, táctica, físico y cantera.','cost',2,'plans',jsonb_build_array('recovery','tactical'),'input','training'),
    jsonb_build_object('key','mentoring','area','EQUIPO','icon','M','title','Proyecto de mentoría','summary','Une a un veterano y a un joven para desarrollar identidad.','cost',2,'plans',jsonb_build_array('academy','recovery'),'input','players'),
    jsonb_build_object('key','scouting','area','PLANIFICACIÓN','icon','⌕','title','Informe de scouting','summary','Encarga una búsqueda por posición y perfil.','cost',2,'plans',jsonb_build_array('growth','academy'),'input','scouting'),
    jsonb_build_object('key','friendly','area','EQUIPO','icon','⚽','title','Partido amistoso','summary','Prueba un plan con intensidad y riesgo controlados.','cost',2,'plans',jsonb_build_array('tactical','recovery'),'input','friendly'),
    jsonb_build_object('key','board_meeting','area','DIRECCIÓN','icon','◇','title','Reunión con la directiva','summary','Negocia recursos aceptando una exigencia adicional.','cost',1,'plans',jsonb_build_array('growth'),'input','board'),
    jsonb_build_object('key','tactical_lab','area','PLANIFICACIÓN','icon','XI','title','Laboratorio táctico','summary','Deja preparada una formación alternativa.','cost',1,'plans',jsonb_build_array('tactical'),'input','formation'),
    jsonb_build_object('key','press_conference','area','DIRECCIÓN','icon','●','title','Rueda de prensa','summary','Elige el tono con el que hablarás del proyecto.','cost',1,'plans',jsonb_build_array('supporters','recovery'),'input','press'),
    jsonb_build_object('key','matchday_review','area','PLANIFICACIÓN','icon','↺','title','Revisar la jornada anterior','summary','Selecciona el problema que quieres corregir.','cost',1,'plans',jsonb_build_array('tactical','recovery'),'input','review')
  );
$$;

create or replace function public.manager_career_interlude_reward(target_plan text,target_progress integer,target_activity_days integer default 18) returns jsonb
language plpgsql immutable set search_path=public as $$
declare tier text; basic_target integer:=greatest(4,ceil(greatest(1,target_activity_days)*.35)); advanced_target integer:=greatest(8,ceil(greatest(1,target_activity_days)*.70)); excellent_target integer:=greatest(12,ceil(greatest(1,target_activity_days)*1.10)); confidence_delta integer:=0; reputation_delta integer:=0; budget_delta numeric:=0; failures_reduced integer:=0; next_effect jsonb:='{}'::jsonb; description text;
begin
  tier:=case when target_progress>=excellent_target then 'excellent' when target_progress>=advanced_target then 'advanced' when target_progress>=basic_target then 'basic' else 'failed' end;
  if tier='failed' or target_plan is null then return jsonb_build_object('tier','failed','title','Plan incompleto','description','No alcanzaste el progreso mínimo. La experiencia queda en el diario, sin recompensa permanente.','basicTarget',basic_target,'advancedTarget',advanced_target,'excellentTarget',excellent_target,'confidenceChange',0,'reputationChange',0,'budgetChange',0,'failuresReduced',0,'nextEffect','{}'::jsonb); end if;
  if target_plan='recovery' then
    confidence_delta:=case tier when 'excellent' then 10 when 'advanced' then 7 else 4 end; failures_reduced:=case when tier in ('excellent','advanced') then 1 else 0 end; description:='El vestuario regresa unido y con más margen frente a la directiva.';
  elsif target_plan='tactical' then
    next_effect:=jsonb_build_object('type','interlude_tactical','protection',case tier when 'excellent' then 50 when 'advanced' then 35 else 20 end,'conditionalPoints',case tier when 'excellent' then 4 when 'advanced' then 2 else 0 end); description:='El plan táctico queda preparado para la próxima jornada.';
  elsif target_plan='academy' then
    reputation_delta:=case tier when 'excellent' then 8 when 'advanced' then 5 else 3 end; next_effect:=jsonb_build_object('type','original_bonus','points',case when tier='excellent' then 3 when tier='advanced' then 2 else 0 end); description:='La cantera gana peso real en el proyecto del club.';
  elsif target_plan='growth' then
    budget_delta:=case tier when 'excellent' then 2.50 when 'advanced' then 1.50 else .75 end; confidence_delta:=case when tier='excellent' then -2 else 0 end; description:='El club convierte el descanso en nuevo margen de mercado.';
  else
    reputation_delta:=case tier when 'excellent' then 6 when 'advanced' then 5 else 3 end; confidence_delta:=case when tier='excellent' then 2 else 0 end; next_effect:=jsonb_build_object('type','failure_protection','percent',case tier when 'excellent' then 30 when 'advanced' then 20 else 0 end); description:='La afición protege al proyecto en el regreso a la competición.';
  end if;
  return jsonb_build_object('tier',tier,'title',case tier when 'excellent' then 'Interludio excelente' when 'advanced' then 'Plan completado' else 'Objetivo básico cumplido' end,'description',description,'basicTarget',basic_target,'advancedTarget',advanced_target,'excellentTarget',excellent_target,'confidenceChange',confidence_delta,'reputationChange',reputation_delta,'budgetChange',budget_delta,'failuresReduced',failures_reduced,'nextEffect',next_effect);
end $$;

do $$ begin
  if to_regprocedure('public.manager_career_lab_public_preview_v6_base(text)') is null then
    alter function public.manager_career_lab_public_preview(text) rename to manager_career_lab_public_preview_v6_base;
  end if;
end $$;

create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; active jsonb;
begin
  result:=public.manager_career_lab_public_preview_v6_base(target_token); active:=result->'state'->'activeInterlude';
  if active is not null then
    active:=active||jsonb_build_object(
      'planChoices',public.manager_career_interlude_plan_choices(),
      'projectChoices',public.manager_career_interlude_project_choices(),
      'progress',coalesce((active->>'progress')::integer,0),
      'streak',coalesce((active->>'streak')::integer,0),
      'managementPoints',coalesce((active->>'managementPoints')::integer,6),
      'projects',coalesce(active->'projects','[]'::jsonb),
       'rewardPreview',public.manager_career_interlude_reward(active->>'plan',coalesce((active->>'progress')::integer,0),coalesce((active->>'activityDays')::integer,18))
    );
    result:=jsonb_set(result,'{state,activeInterlude}',active);
  end if;
  return result;
end $$;

create or replace function public.manager_career_lab_public_action(target_token text,target_action text,target_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<program_action>>
declare selected public.manager_career_lab_sessions%rowtype; state jsonb; active jsonb; choice jsonb; plan_choice jsonb; project jsonb; action jsonb;
  day_no integer; progress integer; streak integer; points integer; management_points integer; cost integer; matches_plan boolean; project_key text; plan_key text;
begin
  if target_action not in ('interlude','interlude_plan','interlude_project') then return public.manager_career_lab_public_action_v4_base(target_token,target_action,target_payload); end if;
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status='running' and expires_at>now() for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  if selected.phase<>'interlude' or selected.state->'activeInterlude' is null then raise exception 'No hay un interludio pendiente'; end if;
  state:=selected.state; active:=state->'activeInterlude'; day_no:=greatest(1,coalesce((active->>'currentDay')::integer,1)); progress:=coalesce((active->>'progress')::integer,0); streak:=coalesce((active->>'streak')::integer,0); management_points:=coalesce((active->>'managementPoints')::integer,6); plan_key:=active->>'plan';

  if target_action='interlude_plan' then
    if plan_key is not null then raise exception 'El plan del interludio ya está elegido'; end if;
    plan_key:=target_payload->>'plan'; select item into plan_choice from jsonb_array_elements(public.manager_career_interlude_plan_choices()) item where item->>'key'=plan_key;
    if plan_choice is null then raise exception 'Plan de interludio no válido'; end if;
    active:=active||jsonb_build_object('plan',plan_key,'planTitle',plan_choice->>'title','progress',0,'streak',0,'alignedActions',0,'projectProgress',0,'managementPoints',6,'projects',coalesce(active->'projects','[]'::jsonb),'planStartedAt',now());
  elsif target_action='interlude' then
    if plan_key is null then raise exception 'Primero debes elegir un plan para el interludio'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(active->'actions','[]'::jsonb)) item where coalesce((item->>'day')::integer,0)=day_no) then raise exception 'La actividad de este día ya está completada'; end if;
    select item into choice from jsonb_array_elements(public.manager_career_interlude_activity_choices(day_no,(state->>'confidence')::integer,(state->>'consecutiveFailures')::integer)) item where item->>'key'=target_payload->>'strategy';
    if choice is null then raise exception 'Esta actividad no está disponible hoy'; end if;
    select exists(select 1 from jsonb_array_elements(public.manager_career_interlude_plan_choices()) p,jsonb_array_elements_text(p->'categories') c where p->>'key'=plan_key and c=choice->>'category') into matches_plan;
    streak:=case when coalesce((active->>'lastActionDay')::integer,0)=day_no-1 then streak+1 else 1 end;
    points:=1; if matches_plan then active:=active||jsonb_build_object('alignedActions',coalesce((active->>'alignedActions')::integer,0)+1); if coalesce((active->>'alignedActions')::integer,0)%2=0 then points:=points+1; end if; end if; if streak%4=0 then points:=points+1; end if; progress:=progress+points;
    action:=choice||jsonb_build_object('day',day_no,'completedAt',now(),'status','completed','earnedProgress',points,'matchesPlan',matches_plan,'detail','+'||points||' progreso del plan');
    active:=jsonb_set(active,'{actions}',coalesce(active->'actions','[]'::jsonb)||jsonb_build_array(action)); active:=active||jsonb_build_object('progress',progress,'streak',streak,'lastActionDay',day_no);
  else
    if plan_key is null then raise exception 'Primero debes elegir un plan para el interludio'; end if;
    project_key:=target_payload->>'project'; select item into project from jsonb_array_elements(public.manager_career_interlude_project_choices()) item where item->>'key'=project_key;
    if project is null then raise exception 'Proyecto no válido'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(active->'projects','[]'::jsonb)) item where item->>'key'=project_key) then raise exception 'Este proyecto ya está completado'; end if;
    cost:=(project->>'cost')::integer; if management_points<cost then raise exception 'No quedan suficientes puntos de gestión'; end if;
    select exists(select 1 from jsonb_array_elements_text(project->'plans') p where p=plan_key) into matches_plan; points:=case when coalesce((active->>'projectProgress')::integer,0)<3 then 1 else 0 end; progress:=progress+points; management_points:=management_points-cost;
    project:=project||jsonb_build_object('completedAt',now(),'earnedProgress',points,'matchesPlan',matches_plan,'configuration',coalesce(target_payload->'configuration','{}'::jsonb));
    active:=jsonb_set(active,'{projects}',coalesce(active->'projects','[]'::jsonb)||jsonb_build_array(project)); active:=active||jsonb_build_object('progress',progress,'projectProgress',coalesce((active->>'projectProgress')::integer,0)+points,'managementPoints',management_points);
  end if;
  state:=jsonb_set(state,'{activeInterlude}',active);
  update public.manager_career_lab_sessions set state=program_action.state,last_report=jsonb_build_object('action',target_action,'detail',case target_action when 'interlude_plan' then 'Plan elegido: '||(active->>'planTitle') when 'interlude_project' then 'Proyecto completado: '||(project->>'title') else 'Actividad diaria completada: '||(choice->>'title') end,'matchday',current_matchday,'phaseBefore','interlude','phaseAfter','interlude','checks',public.manager_career_lab_checks(program_action.state)),updated_at=now() where id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

do $$ begin
  if to_regprocedure('public.admin_step_manager_career_lab_v5_base(uuid,text,jsonb)') is null then
    alter function public.admin_step_manager_career_lab(uuid,text,jsonb) rename to admin_step_manager_career_lab_v5_base;
  end if;
end $$;

create or replace function public.admin_step_manager_career_lab(target_session_id uuid,target_action text,target_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<settle_lab>>
declare before_session public.manager_career_lab_sessions%rowtype; after_session public.manager_career_lab_sessions%rowtype; result jsonb; state jsonb; completed jsonb; reward jsonb; active jsonb;
begin
  perform public.manager_career_lab_assert_admin(); select * into before_session from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid(); if not found then raise exception 'Laboratorio no disponible'; end if;
  if target_action='resolve_interlude' and before_session.phase='interlude' then
    loop
      result:=public.admin_step_manager_career_lab_v5_base(target_session_id,'advance_interlude_day',target_options);
      select * into after_session from public.manager_career_lab_sessions where id=target_session_id;
      exit when after_session.phase<>'interlude';
    end loop;
  else result:=public.admin_step_manager_career_lab_v5_base(target_session_id,target_action,target_options); select * into after_session from public.manager_career_lab_sessions where id=target_session_id; end if;
  if before_session.phase='interlude' and after_session.phase='preparation' then
    state:=after_session.state; completed:=state->'interludes'->-1; reward:=public.manager_career_interlude_reward(completed->>'plan',coalesce((completed->>'progress')::integer,0),coalesce((completed->>'activityDays')::integer,18));
    state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,least(100,(state->>'confidence')::integer+coalesce((reward->>'confidenceChange')::integer,0)))));
    state:=jsonb_set(state,'{reputation}',to_jsonb(greatest(0,least(100,(state->>'reputation')::integer+coalesce((reward->>'reputationChange')::integer,0)))));
    state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+coalesce((reward->>'budgetChange')::numeric,0)));
    state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-coalesce((reward->>'failuresReduced')::integer,0))));
    if reward->'nextEffect'<>'{}'::jsonb then state:=jsonb_set(state,'{interludeNextEffect}',reward->'nextEffect'); end if;
    completed:=completed||jsonb_build_object('reward',reward,'rewardedAt',now()); state:=jsonb_set(state,'{interludes,-1}',completed); state:=jsonb_set(state,'{lastInterludeReward}',reward);
    update public.manager_career_lab_sessions set state=settle_lab.state,last_report=jsonb_build_object('action','interlude_settled','detail',(reward->>'title')||': '||(reward->>'description'),'matchday',after_session.current_matchday,'phaseBefore','interlude','phaseAfter','preparation','checks',public.manager_career_lab_checks(settle_lab.state)),updated_at=now() where id=target_session_id;
    return public.admin_manager_career_lab_state(target_session_id);
  end if;
  return result;
end $$;

revoke all on function public.manager_career_interlude_plan_choices() from public;
grant execute on function public.manager_career_interlude_plan_choices() to anon,authenticated,service_role;
revoke all on function public.manager_career_interlude_project_choices() from public;
grant execute on function public.manager_career_interlude_project_choices() to anon,authenticated,service_role;
revoke all on function public.manager_career_interlude_reward(text,integer,integer) from public;
grant execute on function public.manager_career_interlude_reward(text,integer,integer) to authenticated,service_role;
revoke all on function public.manager_career_lab_public_preview(text) from public;
grant execute on function public.manager_career_lab_public_preview(text) to anon,authenticated;
revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
revoke all on function public.admin_step_manager_career_lab(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_step_manager_career_lab(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
