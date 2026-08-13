-- Interludios jugables: una acción por día y apertura anticipada de la siguiente jornada.

alter table public.manager_career_rules
  add column if not exists interlude_preparation_days integer not null default 3
  check (interlude_preparation_days between 1 and 7);

alter table public.manager_career_interlude_decisions
  add column if not exists action_date date not null default current_date;

alter table public.manager_career_interlude_decisions
  drop constraint if exists manager_career_interlude_decisions_career_id_interlude_id_key;

create unique index if not exists manager_career_interlude_daily_action_key
  on public.manager_career_interlude_decisions(career_id,interlude_id,action_date);

create or replace function public.manager_career_interlude_state(target_career_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public as $$
declare
  interlude public.manager_career_interludes%rowtype; career public.manager_careers%rowtype; rules public.manager_career_rules%rowtype;
  choices jsonb; actions jsonb; today_action jsonb; preparation_opens_at timestamptz; phase text;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  interlude:=public.ensure_manager_career_interlude(target_career_id);
  if interlude.id is null then return null; end if;
  preparation_opens_at:=interlude.ends_at-make_interval(days=>rules.interlude_preparation_days);
  phase:=case when now()<preparation_opens_at then 'activities' else 'preparation' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'plan',decision.plan,'title',decision.title,'consequence',decision.consequence,
    'confidenceChange',decision.confidence_change,'reputationChange',decision.reputation_change,
    'budgetChange',decision.budget_change,'failuresReduced',decision.failures_reduced,
    'nextEffect',decision.next_effect,'decidedAt',decision.decided_at,'actionDate',decision.action_date,
    'appliedAt',decision.applied_at
  ) order by decision.action_date),'[]'::jsonb) into actions
  from public.manager_career_interlude_decisions decision
  where decision.career_id=career.id and decision.interlude_id=interlude.id;

  select jsonb_build_object(
    'plan',decision.plan,'title',decision.title,'consequence',decision.consequence,
    'confidenceChange',decision.confidence_change,'reputationChange',decision.reputation_change,
    'budgetChange',decision.budget_change,'failuresReduced',decision.failures_reduced,
    'nextEffect',decision.next_effect,'decidedAt',decision.decided_at,'actionDate',decision.action_date
  ) into today_action
  from public.manager_career_interlude_decisions decision
  where decision.career_id=career.id and decision.interlude_id=interlude.id and decision.action_date=current_date;

  choices:=jsonb_build_array(
    jsonb_build_object('key','recovery','title','Recuperar al grupo','summary','Una jornada de descarga para rebajar la tensión del vestuario.','immediate','+'||rules.interlude_recovery_confidence||' confianza · reduce un fallo acumulado','returnEffect','El equipo vuelve con menos presión','confidenceChange',rules.interlude_recovery_confidence,'reputationChange',0,'budgetChange',0),
    jsonb_build_object('key','tactical','title','Sesión táctica','summary','Dedica el día a preparar una respuesta para el siguiente rival.','immediate','Sin cambios inmediatos','returnEffect','Reduce un '||rules.interlude_tactical_protection_percent||'% la pérdida de confianza si fallas la misión de la J'||interlude.to_matchday,'confidenceChange',0,'reputationChange',0,'budgetChange',0),
    jsonb_build_object('key','academy','title','Día de cantera','summary','Abre el entrenamiento al filial y refuerza la identidad del proyecto.','immediate','+'||rules.interlude_academy_reputation||' reputación','returnEffect','La apuesta queda registrada en la historia del club','confidenceChange',0,'reputationChange',rules.interlude_academy_reputation,'budgetChange',0),
    jsonb_build_object('key','commercial','title','Compromiso comercial','summary','Genera ingresos, a cambio de perder un día de preparación deportiva.','immediate','+'||rules.interlude_commercial_budget||' M · -'||rules.interlude_commercial_confidence_cost||' confianza','returnEffect','Más presupuesto para el mercado','confidenceChange',-rules.interlude_commercial_confidence_cost,'reputationChange',0,'budgetChange',rules.interlude_commercial_budget)
  );

  return jsonb_build_object(
    'id',interlude.id,'title',interlude.title,'status',interlude.status,
    'fromMatchday',interlude.from_matchday,'toMatchday',interlude.to_matchday,
    'startsAt',interlude.starts_at,'endsAt',interlude.ends_at,'gapDays',interlude.gap_days,
    'preparationOpensAt',preparation_opens_at,'preparationDays',rules.interlude_preparation_days,
    'phase',phase,'remainingActionDays',greatest(0,ceil(extract(epoch from (preparation_opens_at-now()))/86400.0)),
    'canDecide',interlude.status='active' and phase='activities' and now()>=interlude.starts_at and today_action is null,
    'todayDecision',today_action,'decision',case when jsonb_array_length(actions)>0 then actions->-1 else null end,
    'actions',actions,'choices',choices
  );
end $$;

create or replace function public.save_manager_career_interlude_decision(target_career_id uuid,target_interlude_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  career public.manager_careers%rowtype; interlude public.manager_career_interludes%rowtype; rules public.manager_career_rules%rowtype;
  preparation_opens_at timestamptz; title text; consequence text; confidence_delta integer:=0;
  reputation_delta integer:=0; budget_delta numeric:=0; failures_delta integer:=0; next_effect jsonb:='{}';
begin
  if target_plan not in ('recovery','tactical','academy','commercial') then raise exception 'Acción de interludio no válida'; end if;
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into interlude from public.manager_career_interludes where id=target_interlude_id and competition_id=career.competition_id and to_matchday=career.current_matchday and status='active' for update;
  if not found then raise exception 'El interludio ya no está disponible'; end if;
  select * into rules from public.manager_career_rules where id;
  preparation_opens_at:=interlude.ends_at-make_interval(days=>rules.interlude_preparation_days);
  if now()<interlude.starts_at or now()>=preparation_opens_at then raise exception 'La ventana de actividades del interludio está cerrada'; end if;
  if exists(select 1 from public.manager_career_interlude_decisions where career_id=career.id and interlude_id=interlude.id and action_date=current_date) then raise exception 'La acción de hoy ya está realizada. Mañana tendrás una nueva oportunidad'; end if;

  if target_plan='recovery' then
    title:='Recuperar al grupo';confidence_delta:=rules.interlude_recovery_confidence;failures_delta:=least(1,career.consecutive_failures);
    consequence:='La plantilla completa una descarga y el vestuario recupera confianza.';
  elsif target_plan='tactical' then
    title:='Sesión táctica';next_effect:=jsonb_build_object('type','failure_protection','percent',rules.interlude_tactical_protection_percent);
    consequence:='El cuerpo técnico prepara una protección para la próxima misión.';
  elsif target_plan='academy' then
    title:='Día de cantera';reputation_delta:=rules.interlude_academy_reputation;
    consequence:='La cantera gana protagonismo y refuerza la identidad del proyecto.';
  else
    title:='Compromiso comercial';budget_delta:=rules.interlude_commercial_budget;confidence_delta:=-rules.interlude_commercial_confidence_cost;
    consequence:='El club obtiene recursos, aunque el vestuario pierde foco deportivo.';
  end if;

  insert into public.manager_career_interlude_decisions(career_id,interlude_id,target_matchday,plan,title,consequence,confidence_change,reputation_change,budget_change,failures_reduced,next_effect,action_date)
  values(career.id,interlude.id,interlude.to_matchday,target_plan,title,consequence,confidence_delta,reputation_delta,budget_delta,failures_delta,next_effect,current_date);
  update public.manager_careers set budget=budget+budget_delta,board_confidence=greatest(0,least(100,board_confidence+confidence_delta)),reputation=greatest(0,least(100,reputation+reputation_delta)),consecutive_failures=greatest(0,consecutive_failures-failures_delta),updated_at=now() where id=career.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(career.id,'interlude',title,consequence,interlude.to_matchday,reputation_delta);
  perform public.create_nexo_notification(career.owner_id,'system','Actividad de interludio completada',title||'. Mañana podrás elegir una nueva actividad.',null,'inicio','career-interlude:'||career.id||':'||interlude.id||':'||current_date);
  return public.manager_career_interlude_state(career.id);
end $$;

notify pgrst,'reload schema';
