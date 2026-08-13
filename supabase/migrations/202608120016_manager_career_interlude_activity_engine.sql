-- Catálogo compartido y rotatorio para que los interludios no repitan siempre
-- las mismas cuatro actividades. Carrera real y laboratorio usan este motor.

create or replace function public.manager_career_interlude_activity_choices(
  target_day integer,
  target_confidence integer default 60,
  target_failures integer default 0
) returns jsonb
language plpgsql immutable set search_path=public as $$
declare
  day_no integer:=greatest(1,target_day);
  vestuario jsonb;
  tactica jsonb;
  identidad jsonb;
  club jsonb;
  first_choice jsonb;
begin
  vestuario:=jsonb_build_array(
    jsonb_build_object('key','recovery','category','VESTUARIO','icon','♥','title','Recuperar al grupo','summary','Descarga física y mental para rebajar la tensión.','immediate','+5 confianza · reduce un fallo','returnEffect','El equipo vuelve con menos presión','confidenceChange',5,'reputationChange',0,'budgetChange',0,'failuresReduced',1,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','team_meal','category','VESTUARIO','icon','◎','title','Comida de equipo','summary','Junta al vestuario fuera del campo para recomponer vínculos.','immediate','+3 confianza · +1 reputación · -0,20 M','returnEffect','Mejora la cohesión del grupo','confidenceChange',3,'reputationChange',1,'budgetChange',-0.20,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','psychology','category','VESTUARIO','icon','+','title','Sesión de psicología','summary','Intervención profesional para cortar una dinámica negativa.','immediate','+7 confianza · -0,50 M','returnEffect','Protege frente a una crisis de resultados','confidenceChange',7,'reputationChange',0,'budgetChange',-0.50,'failuresReduced',1,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','captains_meeting','category','VESTUARIO','icon','C','title','Pacto con los capitanes','summary','Cede influencia para recuperar el compromiso del grupo.','immediate','+4 confianza · -1 reputación','returnEffect','El vestuario asume más responsabilidad','confidenceChange',4,'reputationChange',-1,'budgetChange',0,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','full_rest','category','SALUD','icon','◷','title','Día libre completo','summary','Renuncia a entrenar para que la plantilla llegue fresca.','immediate','+3 confianza','returnEffect','Reduce un 25% una posible penalización en la próxima misión','confidenceChange',3,'reputationChange',0,'budgetChange',0,'failuresReduced',0,'nextEffect',jsonb_build_object('type','failure_protection','percent',25))
  );
  tactica:=jsonb_build_array(
    jsonb_build_object('key','tactical','category','TÁCTICA','icon','XI','title','Sesión táctica','summary','Prepara una respuesta específica para el siguiente rival.','immediate','Sin cambios inmediatos','returnEffect','Reduce un 50% la pérdida de confianza si fallas','confidenceChange',0,'reputationChange',0,'budgetChange',0,'failuresReduced',0,'nextEffect',jsonb_build_object('type','failure_protection','percent',50)),
    jsonb_build_object('key','video_analysis','category','TÁCTICA','icon','▶','title','Análisis de vídeo','summary','Estudia al próximo rival con todo el cuerpo técnico.','immediate','-0,15 M','returnEffect','+2 puntos si presentas un once válido','confidenceChange',0,'reputationChange',0,'budgetChange',-0.15,'failuresReduced',0,'nextEffect',jsonb_build_object('type','sporting_bonus','points',2)),
    jsonb_build_object('key','set_pieces','category','TÁCTICA','icon','↗','title','Laboratorio a balón parado','summary','Dedica el día completo a ensayar acciones decisivas.','immediate','-1 confianza','returnEffect','+3 puntos en la próxima jornada','confidenceChange',-1,'reputationChange',0,'budgetChange',0,'failuresReduced',0,'nextEffect',jsonb_build_object('type','sporting_bonus','points',3)),
    jsonb_build_object('key','physical_load','category','PREPARACIÓN','icon','⚡','title','Carga física intensa','summary','Asume tensión hoy para buscar un pico de rendimiento.','immediate','-3 confianza','returnEffect','+5 puntos si la misión de la próxima jornada se completa','confidenceChange',-3,'reputationChange',0,'budgetChange',0,'failuresReduced',0,'nextEffect',jsonb_build_object('type','conditional_bonus','points',5)),
    jsonb_build_object('key','closed_training','category','TÁCTICA','icon','□','title','Entrenamiento a puerta cerrada','summary','Aísla al grupo y trabaja sin ruido externo.','immediate','-2 reputación','returnEffect','Protección del 35% ante un objetivo fallido','confidenceChange',0,'reputationChange',-2,'budgetChange',0,'failuresReduced',0,'nextEffect',jsonb_build_object('type','failure_protection','percent',35))
  );
  identidad:=jsonb_build_array(
    jsonb_build_object('key','academy','category','CANTERA','icon','C','title','Día de cantera','summary','Abre el entrenamiento al filial y refuerza el proyecto.','immediate','+4 reputación','returnEffect','La apuesta queda en la historia del club','confidenceChange',0,'reputationChange',4,'budgetChange',0,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','mentoring','category','CANTERA','icon','M','title','Mentores del primer equipo','summary','Los veteranos acompañan a los jóvenes durante el día.','immediate','+2 confianza · +3 reputación','returnEffect','Refuerza la identidad del vestuario','confidenceChange',2,'reputationChange',3,'budgetChange',0,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','academy_trials','category','CANTERA','icon','U','title','Pruebas de la academia','summary','Amplía la captación y busca talento para el futuro.','immediate','+5 reputación · -0,35 M','returnEffect','Mejora la valoración de los originales','confidenceChange',0,'reputationChange',5,'budgetChange',-0.35,'failuresReduced',0,'nextEffect',jsonb_build_object('type','original_bonus','points',2)),
    jsonb_build_object('key','identity_workshop','category','IDENTIDAD','icon','ID','title','Taller de identidad','summary','Recuerda al grupo qué representa el escudo.','immediate','+2 confianza · +2 reputación','returnEffect','Protege el objetivo de jugadores originales','confidenceChange',2,'reputationChange',2,'budgetChange',0,'failuresReduced',0,'nextEffect',jsonb_build_object('type','identity_protection')),
    jsonb_build_object('key','community_day','category','AFICIÓN','icon','N','title','Día con la comunidad','summary','Acerca el equipo a su barrio y a su afición.','immediate','+5 reputación · +1 confianza · -0,25 M','returnEffect','Fortalece el legado del mánager','confidenceChange',1,'reputationChange',5,'budgetChange',-0.25,'failuresReduced',0,'nextEffect','{}'::jsonb)
  );
  club:=jsonb_build_array(
    jsonb_build_object('key','commercial','category','RECURSOS','icon','€','title','Compromiso comercial','summary','Genera ingresos a cambio de perder foco deportivo.','immediate','+1,50 M · -3 confianza','returnEffect','Más presupuesto para el mercado','confidenceChange',-3,'reputationChange',0,'budgetChange',1.50,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','sponsor_event','category','RECURSOS','icon','€+','title','Acto con patrocinadores','summary','Una jornada rentable pero exigente para la plantilla.','immediate','+2,20 M · -5 confianza · -1 reputación','returnEffect','Financia una futura incorporación','confidenceChange',-5,'reputationChange',-1,'budgetChange',2.20,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','open_training','category','AFICIÓN','icon','○','title','Entrenamiento abierto','summary','Comparte el trabajo del equipo con la afición.','immediate','+0,50 M · +2 reputación · -1 confianza','returnEffect','Mejora la conexión con el entorno','confidenceChange',-1,'reputationChange',2,'budgetChange',0.50,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','media_day','category','COMUNICACIÓN','icon','●','title','Día de medios','summary','Da visibilidad al proyecto y acepta el desgaste.','immediate','+0,80 M · +1 reputación · -2 confianza','returnEffect','Aumenta el alcance del club','confidenceChange',-2,'reputationChange',1,'budgetChange',0.80,'failuresReduced',0,'nextEffect','{}'::jsonb),
    jsonb_build_object('key','media_silence','category','COMUNICACIÓN','icon','—','title','Silencio mediático','summary','Protege al vestuario aunque la imagen pública se resienta.','immediate','+3 confianza · -2 reputación','returnEffect','Reduce la presión antes de volver a competir','confidenceChange',3,'reputationChange',-2,'budgetChange',0,'failuresReduced',0,'nextEffect','{}'::jsonb)
  );

  first_choice:=case when target_confidence<=25 or target_failures>=2
    then jsonb_build_object('key','crisis_meeting','category','EMERGENCIA','icon','!','title','Reunión de crisis','summary','La directiva y los capitanes afrontan el riesgo de destitución.','immediate','+9 confianza · -0,75 M · -1 reputación · reduce un fallo','returnEffect','Ganas margen inmediato para conservar el puesto','confidenceChange',9,'reputationChange',-1,'budgetChange',-0.75,'failuresReduced',1,'nextEffect','{}'::jsonb)
    else vestuario->((day_no-1)%5) end;

  return jsonb_build_array(
    first_choice,
    tactica->(((day_no-1)*2)%5),
    identidad->(((day_no-1)*3)%5),
    club->(((day_no-1)*4)%5)
  );
end $$;

-- Añade las opciones del día a la vista segura del laboratorio.
do $$ begin
  if to_regprocedure('public.manager_career_lab_public_preview_v5_base(text)') is null then
    alter function public.manager_career_lab_public_preview(text)
      rename to manager_career_lab_public_preview_v5_base;
  end if;
end $$;

create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; active jsonb; day_no integer;
begin
  result:=public.manager_career_lab_public_preview_v5_base(target_token);
  active:=result->'state'->'activeInterlude';
  if active is not null then
    day_no:=greatest(1,coalesce((active->>'currentDay')::integer,1));
    active:=jsonb_set(active,'{choices}',public.manager_career_interlude_activity_choices(
      day_no,coalesce((result->'state'->>'confidence')::integer,60),coalesce((result->'state'->>'consecutiveFailures')::integer,0)
    ));
    result:=jsonb_set(result,'{state,activeInterlude}',active);
  end if;
  return result;
end $$;

-- Acción genérica del laboratorio: valida que la actividad pertenezca al día.
create or replace function public.manager_career_lab_public_action(target_token text,target_action text,target_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_action>>
declare selected public.manager_career_lab_sessions%rowtype; state jsonb; active jsonb; choice jsonb; action jsonb;
  strategy text; day_no integer; confidence_delta integer; reputation_delta integer; budget_delta numeric; failures_delta integer;
begin
  if target_action<>'interlude' then return public.manager_career_lab_public_action_v4_base(target_token,target_action,target_payload); end if;
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status='running' and expires_at>now() for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  if selected.phase<>'interlude' or selected.state->'activeInterlude' is null then raise exception 'No hay un interludio pendiente'; end if;
  state:=selected.state; active:=state->'activeInterlude'; day_no:=greatest(1,coalesce((active->>'currentDay')::integer,1));
  if exists(select 1 from jsonb_array_elements(coalesce(active->'actions','[]'::jsonb)) item where coalesce((item->>'day')::integer,0)=day_no) then raise exception 'La actividad de este día ya está completada'; end if;
  strategy:=target_payload->>'strategy';
  select item into choice from jsonb_array_elements(public.manager_career_interlude_activity_choices(day_no,(state->>'confidence')::integer,(state->>'consecutiveFailures')::integer)) item where item->>'key'=strategy;
  if choice is null then raise exception 'Esta actividad no está disponible hoy'; end if;
  confidence_delta:=coalesce((choice->>'confidenceChange')::integer,0); reputation_delta:=coalesce((choice->>'reputationChange')::integer,0); budget_delta:=coalesce((choice->>'budgetChange')::numeric,0); failures_delta:=coalesce((choice->>'failuresReduced')::integer,0);
  if (state->>'budget')::numeric+budget_delta<0 then raise exception 'No hay presupuesto suficiente para esta actividad'; end if;
  state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,least(100,(state->>'confidence')::integer+confidence_delta))));
  state:=jsonb_set(state,'{reputation}',to_jsonb(greatest(0,least(100,(state->>'reputation')::integer+reputation_delta))));
  state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+budget_delta));
  state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-failures_delta)));
  if choice->'nextEffect'<>'{}'::jsonb then state:=jsonb_set(state,'{interludeNextEffect}',choice->'nextEffect'); end if;
  action:=choice||jsonb_build_object('day',day_no,'completedAt',now(),'status','completed','detail',choice->>'immediate');
  active:=jsonb_set(active,'{actions}',coalesce(active->'actions','[]'::jsonb)||jsonb_build_array(action)); state:=jsonb_set(state,'{activeInterlude}',active);
  update public.manager_career_lab_sessions set state=lab_action.state,last_report=jsonb_build_object('action','interlude_activity','detail','Actividad del día '||day_no||' completada: '||(choice->>'title')||'.','matchday',current_matchday,'phaseBefore','interlude','phaseAfter','interlude','checks',public.manager_career_lab_checks(lab_action.state)),updated_at=now() where id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

-- Carrera real: conserva toda la lógica existente y sustituye solo el catálogo.
do $$ begin
  if to_regprocedure('public.manager_career_interlude_state_v2_base(uuid)') is null then
    alter function public.manager_career_interlude_state(uuid)
      rename to manager_career_interlude_state_v2_base;
  end if;
end $$;

create or replace function public.manager_career_interlude_state(target_career_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public as $$
declare result jsonb; career public.manager_careers%rowtype; day_no integer;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  result:=public.manager_career_interlude_state_v2_base(target_career_id);
  if result is null then return null; end if;
  day_no:=greatest(1,(timezone('Europe/Madrid',now())::date-timezone('Europe/Madrid',(result->>'startsAt')::timestamptz)::date)+1);
  result:=jsonb_set(result,'{dayNumber}',to_jsonb(day_no));
  result:=jsonb_set(result,'{choices}',public.manager_career_interlude_activity_choices(day_no,career.board_confidence,career.consecutive_failures));
  return result;
end $$;

-- Guardado real genérico con una actividad por fecha española.
create or replace function public.save_manager_career_interlude_decision(target_career_id uuid,target_interlude_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare career public.manager_careers%rowtype; interlude public.manager_career_interludes%rowtype; rules public.manager_career_rules%rowtype;
  preparation_opens_at timestamptz; day_no integer; choice jsonb; confidence_delta integer; reputation_delta integer; budget_delta numeric; failures_delta integer; madrid_date date;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into interlude from public.manager_career_interludes where id=target_interlude_id and competition_id=career.competition_id and to_matchday=career.current_matchday and status='active' for update;
  if not found then raise exception 'El interludio ya no está disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  preparation_opens_at:=interlude.ends_at-make_interval(days=>rules.interlude_preparation_days);
  if now()<interlude.starts_at or now()>=preparation_opens_at then raise exception 'La ventana de actividades del interludio está cerrada'; end if;
  madrid_date:=timezone('Europe/Madrid',now())::date;
  if exists(select 1 from public.manager_career_interlude_decisions where career_id=career.id and interlude_id=interlude.id and action_date=madrid_date) then raise exception 'La actividad de hoy ya está realizada'; end if;
  day_no:=greatest(1,(madrid_date-timezone('Europe/Madrid',interlude.starts_at)::date)+1);
  select item into choice from jsonb_array_elements(public.manager_career_interlude_activity_choices(day_no,career.board_confidence,career.consecutive_failures)) item where item->>'key'=target_plan;
  if choice is null then raise exception 'Esta actividad no está disponible hoy'; end if;
  confidence_delta:=coalesce((choice->>'confidenceChange')::integer,0); reputation_delta:=coalesce((choice->>'reputationChange')::integer,0); budget_delta:=coalesce((choice->>'budgetChange')::numeric,0); failures_delta:=coalesce((choice->>'failuresReduced')::integer,0);
  if career.budget+budget_delta<0 then raise exception 'No hay presupuesto suficiente'; end if;
  insert into public.manager_career_interlude_decisions(career_id,interlude_id,target_matchday,plan,title,consequence,confidence_change,reputation_change,budget_change,failures_reduced,next_effect,action_date)
  values(career.id,interlude.id,interlude.to_matchday,target_plan,choice->>'title',choice->>'immediate',confidence_delta,reputation_delta,budget_delta,failures_delta,coalesce(choice->'nextEffect','{}'::jsonb),madrid_date);
  update public.manager_careers set budget=budget+budget_delta,board_confidence=greatest(0,least(100,board_confidence+confidence_delta)),reputation=greatest(0,least(100,reputation+reputation_delta)),consecutive_failures=greatest(0,consecutive_failures-failures_delta),updated_at=now() where id=career.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(career.id,'interlude',choice->>'title',choice->>'immediate',interlude.to_matchday,reputation_delta);
  perform public.create_nexo_notification(career.owner_id,'system','Actividad de interludio completada',choice->>'title'||'. Mañana tendrás opciones diferentes.',null,'inicio','career-interlude:'||career.id||':'||interlude.id||':'||madrid_date);
  return public.manager_career_interlude_state(career.id);
end $$;

revoke all on function public.manager_career_interlude_activity_choices(integer,integer,integer) from public;
grant execute on function public.manager_career_interlude_activity_choices(integer,integer,integer) to anon,authenticated,service_role;
revoke all on function public.manager_career_lab_public_preview(text) from public;
grant execute on function public.manager_career_lab_public_preview(text) to anon,authenticated;
revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
revoke all on function public.manager_career_interlude_state(uuid) from public;
grant execute on function public.manager_career_interlude_state(uuid) to authenticated;
revoke all on function public.save_manager_career_interlude_decision(uuid,uuid,text) from public;
grant execute on function public.save_manager_career_interlude_decision(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
