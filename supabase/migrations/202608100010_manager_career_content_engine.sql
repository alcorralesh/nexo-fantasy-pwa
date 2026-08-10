-- Motor de contenido de Carrera: catálogo administrable, selección contextual,
-- cadenas narrativas, misiones variadas y ventana antirrepetición.

alter table public.manager_career_objectives add column if not exists metric_key text not null default 'points';

create table if not exists public.manager_career_event_templates (
  key text primary key,
  title text not null,
  description text not null,
  category text not null,
  min_matchday integer not null default 1,
  max_matchday integer not null default 99,
  min_confidence integer not null default 0,
  max_confidence integer not null default 100,
  min_budget numeric(12,2) not null default 0,
  allowed_difficulties text[] not null default array['relaxed','balanced','elite'],
  cooldown_matchdays integer not null default 8,
  story_key text,
  story_step integer,
  weight integer not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_career_event_choices (
  template_key text not null references public.manager_career_event_templates(key) on delete cascade,
  choice_key text not null,
  title text not null,
  summary text not null,
  reputation_change integer not null default 0,
  confidence_change integer not null default 0,
  budget_change numeric(12,2) not null default 0,
  sporting_points_change numeric(12,2) not null default 0,
  conditional_original_target integer,
  conditional_sporting_bonus numeric(12,2) not null default 0,
  sort_order integer not null default 0,
  primary key(template_key,choice_key)
);

create table if not exists public.manager_career_event_assignments (
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  matchday integer not null,
  template_key text not null references public.manager_career_event_templates(key),
  created_at timestamptz not null default now(),
  primary key(career_id,matchday)
);

create table if not exists public.manager_career_mission_templates (
  key text primary key,
  title text not null,
  description text not null,
  metric_key text not null check(metric_key in ('points','originals','captain_points','new_signings','budget_floor')),
  base_target numeric(12,2) not null,
  reputation_reward integer not null default 6,
  confidence_penalty integer not null default 8,
  min_matchday integer not null default 1,
  max_matchday integer not null default 99,
  min_confidence integer not null default 0,
  max_confidence integer not null default 100,
  cooldown_matchdays integer not null default 6,
  weight integer not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_career_mission_assignments (
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  matchday integer not null,
  template_key text not null references public.manager_career_mission_templates(key),
  objective_id uuid not null references public.manager_career_objectives(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(career_id,matchday)
);

create index if not exists manager_career_event_history_idx on public.manager_career_event_assignments(career_id,template_key,matchday desc);
create index if not exists manager_career_mission_history_idx on public.manager_career_mission_assignments(career_id,template_key,matchday desc);

alter table public.manager_career_event_templates enable row level security;
alter table public.manager_career_event_choices enable row level security;
alter table public.manager_career_event_assignments enable row level security;
alter table public.manager_career_mission_templates enable row level security;
alter table public.manager_career_mission_assignments enable row level security;

drop policy if exists career_event_templates_read on public.manager_career_event_templates;
create policy career_event_templates_read on public.manager_career_event_templates for select using (auth.uid() is not null);
drop policy if exists career_event_choices_read on public.manager_career_event_choices;
create policy career_event_choices_read on public.manager_career_event_choices for select using (auth.uid() is not null);
drop policy if exists career_event_assignments_owner on public.manager_career_event_assignments;
create policy career_event_assignments_owner on public.manager_career_event_assignments for select using (exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid()));
drop policy if exists career_mission_templates_read on public.manager_career_mission_templates;
create policy career_mission_templates_read on public.manager_career_mission_templates for select using (auth.uid() is not null);
drop policy if exists career_mission_assignments_owner on public.manager_career_mission_assignments;
create policy career_mission_assignments_owner on public.manager_career_mission_assignments for select using (exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid()));

insert into public.manager_career_event_templates(key,title,description,category,min_matchday,max_matchday,min_confidence,max_confidence,min_budget,cooldown_matchdays,story_key,story_step,weight) values
('youth_minutes','El vestuario pide una señal','Un joven reclama protagonismo antes de un partido importante.','cantera',1,38,0,100,0,10,'academy_path',1,120),
('transfer_plan','La dirección deportiva espera una respuesta','Debes decidir cuánto arriesgar en el próximo movimiento.','mercado',2,38,0,100,1,9,null,null,100),
('training_load','El cuerpo técnico divide al vestuario','La carga de trabajo puede darte ventaja o proteger la moral.','entrenamiento',1,38,0,100,0,8,null,null,100),
('press_pressure','La prensa cuestiona tu proyecto','Una semana difícil obliga a elegir entre proteger al grupo o exigir una reacción.','prensa',3,38,0,65,0,9,null,null,120),
('star_contract','Tu estrella exige una mejora','El jugador más mediático quiere un gesto antes de comprometerse.','vestuario',4,34,0,100,1.5,12,'captain_saga',1,90),
('rotation_doubt','El once pide aire','Los suplentes reclaman oportunidades mientras la directiva exige resultados.','vestuario',2,38,0,100,0,8,null,null,105),
('captain_conflict','El brazalete provoca tensión','Dos líderes del vestuario compiten por el mando del equipo.','vestuario',5,36,0,100,0,12,'captain_saga',2,90),
('supporters_demand','La grada quiere ambición','Los aficionados piden una señal ofensiva en la próxima jornada.','aficion',3,38,0,70,0,9,null,null,100),
('academy_breakthrough','La cantera llama a la puerta','Un talento del club ha destacado y pide un plan real.','cantera',4,36,0,100,0,12,'academy_path',2,100),
('academy_sale','Llega una oferta por una promesa','Una venta aliviaría las cuentas, pero rompería el relato de cantera.','cantera',7,34,0,100,0,14,'academy_path',3,80),
('sponsor_event','El patrocinador pide protagonismo','Una acción comercial aporta dinero, aunque distrae al equipo.','economia',3,38,0,100,0,10,null,null,80),
('tactical_revolt','Los veteranos discuten el sistema','Parte de la plantilla no cree en el plan para esta jornada.','tactica',4,38,0,100,0,10,null,null,100),
('board_ultimatum','La directiva exige una respuesta','La confianza está baja y cada gesto será evaluado.','directiva',4,38,0,40,0,6,'crisis',1,180),
('crisis_meeting','Reunión de emergencia','Tras semanas de tensión, el consejo reclama un compromiso concreto.','directiva',5,38,0,45,0,7,'crisis',2,160),
('winning_run','El éxito también crea problemas','La buena dinámica eleva las expectativas y multiplica la presión.','directiva',5,38,75,100,0,10,null,null,100),
('transfer_windfall','Aparece una oportunidad inesperada','Puedes aceptar liquidez inmediata o proteger tu planificación.','economia',3,38,0,100,0,9,null,null,90),
('media_leak','Se filtra una conversación privada','El vestuario espera que decidas cómo responder públicamente.','prensa',6,38,0,100,0,13,null,null,85),
('club_identity','El club pide recordar quién es','La directiva quiere que el próximo once represente su identidad.','identidad',2,38,0,100,0,10,null,null,110)
on conflict(key) do update set title=excluded.title,description=excluded.description,category=excluded.category,min_matchday=excluded.min_matchday,max_matchday=excluded.max_matchday,min_confidence=excluded.min_confidence,max_confidence=excluded.max_confidence,min_budget=excluded.min_budget,cooldown_matchdays=excluded.cooldown_matchdays,story_key=excluded.story_key,story_step=excluded.story_step,weight=excluded.weight,updated_at=now();

insert into public.manager_career_event_choices(template_key,choice_key,title,summary,reputation_change,confidence_change,budget_change,sporting_points_change,conditional_original_target,conditional_sporting_bonus,sort_order) values
('youth_minutes','academy','Apostar por la cantera','Inviertes en el futuro y debes demostrarlo en el once.',3,2,-0.50,0,8,3,1),('youth_minutes','experience','Proteger el resultado','Priorizas experiencia y obtienes una ayuda deportiva segura.',1,1,0,1,null,0,2),
('transfer_plan','invest','Invertir en el proyecto','Refuerzas la ambición del club a cambio de presupuesto.',4,3,-1.00,0,null,0,1),('transfer_plan','prudence','Guardar margen salarial','Mejoras las cuentas, pero la directiva lo interpreta como falta de ambición.',-1,-3,0.50,0,null,0,2),
('training_load','intense','Subir la intensidad','Buscas puntos inmediatos aunque el consejo teme el desgaste.',1,-2,-0.25,3,null,0,1),('training_load','recovery','Priorizar la recuperación','Proteges al grupo y refuerzas la confianza interna.',2,1,0,0,null,0,2),
('press_pressure','shield','Proteger al vestuario','Ganas apoyo público, pero la directiva esperaba mayor exigencia.',3,-2,0,0,null,0,1),('press_pressure','demand','Exigir una reacción','El consejo respalda tu dureza, aunque la afición se distancia.',-2,3,0,2,null,0,2),
('star_contract','renew','Premiar a la estrella','El gesto fortalece el proyecto, pero reduce tu margen de mercado.',2,3,-1.50,1,null,0,1),('star_contract','hold','Mantener la escala salarial','Proteges las cuentas, pero desafías a vestuario y directiva.',-2,-3,0.50,0,null,0,2),
('rotation_doubt','rotate','Dar oportunidades','La plantilla responde; el premio deportivo exige mantener identidad.',2,-1,0,0,8,3,1),('rotation_doubt','strongest','Jugar con los mejores','La directiva valora la seguridad del plan.',0,2,0,2,null,0,2),
('captain_conflict','change','Cambiar el liderazgo','Renuevas energías, aunque la directiva teme inestabilidad.',3,-2,0,0,null,0,1),('captain_conflict','support','Respaldar al capitán','Refuerzas la jerarquía y la confianza del consejo.',-1,3,0,1,null,0,2),
('supporters_demand','attack','Prometer valentía','Subes la expectativa y asumes el riesgo deportivo.',3,-1,0,3,null,0,1),('supporters_demand','balance','No cambiar el plan','La directiva aprecia la serenidad, la grada no tanto.',-2,2,0,1,null,0,2),
('academy_breakthrough','promote','Abrirle la puerta','La identidad se refuerza si cumples con el once.',3,2,-0.25,0,8,4,1),('academy_breakthrough','wait','Pedir paciencia','Evitas precipitarte, pero pierdes algo de confianza.',-1,-2,0,1,null,0,2),
('academy_sale','sell','Aceptar la operación','Obtienes margen económico sacrificando identidad y confianza.',-3,-4,1.50,0,null,0,1),('academy_sale','keep','Rechazar la oferta','El club celebra tu fidelidad al proyecto.',3,2,0,0,null,0,2),
('sponsor_event','accept','Aceptar el acto','Ingresas dinero, pero el consejo teme distracciones.',1,-1,0.75,0,null,0,1),('sponsor_event','decline','Centrarse en fútbol','Renuncias al ingreso para proteger el rendimiento.',0,2,0,2,null,0,2),
('tactical_revolt','listen','Adaptar el sistema','Escuchas al grupo y ganas reputación, pero pareces dudar.',3,-2,0,1,null,0,1),('tactical_revolt','insist','Mantener tu idea','La directiva respalda tu autoridad.',-1,3,0,2,null,0,2),
('board_ultimatum','promise','Prometer resultados','Recuperas confianza, pero el objetivo será exigente.',1,4,0,2,null,0,1),('board_ultimatum','confront','Defender tu trabajo','La afición valora el carácter; la directiva no.',3,-5,0,0,null,0,2),
('crisis_meeting','rebuild','Pedir tiempo','Proteges el proyecto a cambio de presupuesto y una última oportunidad.',1,3,-0.75,0,null,0,1),('crisis_meeting','pressure','Aceptar el ultimátum','Asumes el riesgo y una bonificación deportiva inmediata.',0,-3,0,4,null,0,2),
('winning_run','ambition','Elevar el objetivo','La directiva premia tu ambición, pero aumentas la presión.',2,3,0,2,null,0,1),('winning_run','calm','Rebajar la euforia','Proteges al grupo, aunque el consejo esperaba más.',1,-2,0,0,null,0,2),
('transfer_windfall','cash','Asegurar liquidez','El presupuesto mejora, pero baja la confianza deportiva.',0,-2,1.00,0,null,0,1),('transfer_windfall','plan','Mantener el plan','La coherencia refuerza al consejo.',1,2,0,1,null,0,2),
('media_leak','transparent','Dar explicaciones','La afición agradece la transparencia, no la directiva.',3,-2,0,0,null,0,1),('media_leak','silence','Cerrar filas','El consejo respalda el control del mensaje.',-1,2,0,1,null,0,2),
('club_identity','roots','Alinear las raíces','Recibes un bonus si el once conserva ocho originales.',3,2,0,0,8,4,1),('club_identity','freedom','Elegir sin restricciones','Priorizas rendimiento y pierdes confianza institucional.',1,-3,0,2,null,0,2)
on conflict(template_key,choice_key) do update set title=excluded.title,summary=excluded.summary,reputation_change=excluded.reputation_change,confidence_change=excluded.confidence_change,budget_change=excluded.budget_change,sporting_points_change=excluded.sporting_points_change,conditional_original_target=excluded.conditional_original_target,conditional_sporting_bonus=excluded.conditional_sporting_bonus,sort_order=excluded.sort_order;

insert into public.manager_career_mission_templates(key,title,description,metric_key,base_target,reputation_reward,confidence_penalty,min_matchday,max_matchday,min_confidence,max_confidence,cooldown_matchdays,weight) values
('solid_score','Cumplir con lo esperado','Alcanza la puntuación marcada con tu once.','points',50,6,8,1,38,0,100,5,120),
('statement_score','Dar un golpe sobre la mesa','Firma una jornada de puntuación sobresaliente.','points',62,9,10,2,38,0,100,8,80),
('recovery_score','Recuperar sensaciones','La directiva necesita una reacción deportiva asumible.','points',44,5,7,2,38,0,50,6,150),
('identity_seven','Once con identidad','Alinea al menos siete jugadores originales.','originals',7,7,8,1,38,0,100,7,120),
('identity_eight','Las raíces primero','Alinea al menos ocho jugadores originales.','originals',8,9,10,3,36,0,100,10,80),
('captain_leads','El capitán debe responder','Consigue al menos diez puntos con tu capitán.','captain_points',10,7,8,2,38,0,100,7,110),
('captain_hero','Una jornada para liderar','Consigue al menos quince puntos con tu capitán.','captain_points',15,10,10,5,36,0,100,10,70),
('new_blood','Integrar los fichajes','Alinea al menos tres jugadores que hayas incorporado.','new_signings',3,7,7,3,38,0,100,8,90),
('market_balance','Cuidar las cuentas','Llega al cierre conservando al menos cinco millones.','budget_floor',5,6,8,2,38,0,100,8,90),
('crisis_buffer','Demostrar estabilidad','Conserva un colchón económico en un momento de baja confianza.','budget_floor',8,8,9,4,38,0,45,9,120)
on conflict(key) do update set title=excluded.title,description=excluded.description,metric_key=excluded.metric_key,base_target=excluded.base_target,reputation_reward=excluded.reputation_reward,confidence_penalty=excluded.confidence_penalty,min_matchday=excluded.min_matchday,max_matchday=excluded.max_matchday,min_confidence=excluded.min_confidence,max_confidence=excluded.max_confidence,cooldown_matchdays=excluded.cooldown_matchdays,weight=excluded.weight,updated_at=now();

create or replace function public.ensure_manager_career_content(target_career_id uuid,target_matchday integer) returns void
language plpgsql security definer set search_path=public as $$
declare c public.manager_careers%rowtype; event_key text; mission public.manager_career_mission_templates%rowtype; objective uuid; target numeric; difficulty_multiplier numeric;
begin
  select * into c from public.manager_careers where id=target_career_id and (owner_id=auth.uid() or auth.uid() is null);
  if not found or c.status<>'active' then return; end if;
  if not exists(select 1 from public.manager_career_event_assignments where career_id=c.id and matchday=target_matchday) then
    select template.key into event_key from public.manager_career_event_templates template
    where template.active and target_matchday between template.min_matchday and template.max_matchday
      and c.board_confidence between template.min_confidence and template.max_confidence and c.budget>=template.min_budget
      and c.difficulty=any(template.allowed_difficulties)
      and not exists(select 1 from public.manager_career_event_assignments history where history.career_id=c.id and history.template_key=template.key and history.matchday>target_matchday-template.cooldown_matchdays)
    order by case when template.story_step>1 and exists(select 1 from public.manager_career_event_assignments previous join public.manager_career_event_templates prior on prior.key=previous.template_key where previous.career_id=c.id and prior.story_key=template.story_key and prior.story_step=template.story_step-1) then 0 else 1 end,
      -ln(greatest(random(),0.000001))/greatest(template.weight,1) limit 1;
    if event_key is null then select key into event_key from public.manager_career_event_templates where active and target_matchday between min_matchday and max_matchday order by md5(c.id::text||':'||target_matchday||':'||key) limit 1; end if;
    if event_key is not null then insert into public.manager_career_event_assignments(career_id,matchday,template_key) values(c.id,target_matchday,event_key) on conflict do nothing; end if;
  end if;
  if not exists(select 1 from public.manager_career_mission_assignments where career_id=c.id and matchday=target_matchday) then
    select template.* into mission from public.manager_career_mission_templates template
    where template.active and target_matchday between template.min_matchday and template.max_matchday and c.board_confidence between template.min_confidence and template.max_confidence
      and not exists(select 1 from public.manager_career_mission_assignments history where history.career_id=c.id and history.template_key=template.key and history.matchday>target_matchday-template.cooldown_matchdays)
    order by -ln(greatest(random(),0.000001))/greatest(template.weight,1) limit 1;
    if mission.key is null then select * into mission from public.manager_career_mission_templates where active order by md5(c.id::text||':fallback:'||target_matchday||':'||key) limit 1; end if;
    if mission.key is not null then
      difficulty_multiplier:=case c.difficulty when 'relaxed' then .90 when 'elite' then 1.10 else 1 end;
      target:=case mission.metric_key when 'points' then round(mission.base_target*difficulty_multiplier) when 'captain_points' then round(mission.base_target*difficulty_multiplier) else mission.base_target end;
      insert into public.manager_career_objectives(career_id,objective_type,title,description,target_value,reputation_reward,failure_penalty,expires_matchday,metric_key)
      values(c.id,'matchday',mission.title,mission.description,target,mission.reputation_reward,mission.confidence_penalty,target_matchday,mission.metric_key)
      on conflict(career_id,objective_type,expires_matchday) where expires_matchday is not null do update set title=excluded.title,description=excluded.description,target_value=excluded.target_value,reputation_reward=excluded.reputation_reward,failure_penalty=excluded.failure_penalty,metric_key=excluded.metric_key
      returning id into objective;
      select id into objective from public.manager_career_objectives where career_id=c.id and objective_type='matchday' and expires_matchday=target_matchday;
      insert into public.manager_career_mission_assignments(career_id,matchday,template_key,objective_id) values(c.id,target_matchday,mission.key,objective) on conflict do nothing;
    end if;
  end if;
end $$;

create or replace function public.manager_career_decision_prompt(target_career_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public as $$
declare c public.manager_careers%rowtype; template public.manager_career_event_templates%rowtype; choices jsonb;
begin
  select * into c from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active';
  if not found then raise exception 'Carrera no disponible'; end if;
  if not (select weekly_decision_enabled from public.manager_career_rules where id) then return null; end if;
  perform public.ensure_manager_career_content(c.id,c.current_matchday);
  select catalog.* into template from public.manager_career_event_assignments assigned join public.manager_career_event_templates catalog on catalog.key=assigned.template_key where assigned.career_id=c.id and assigned.matchday=c.current_matchday;
  select jsonb_agg(jsonb_build_object('key',choice.choice_key,'title',choice.title,'summary',choice.summary,'reputationChange',choice.reputation_change,'confidenceChange',choice.confidence_change,'budgetChange',choice.budget_change,'sportingPointsChange',choice.sporting_points_change,'condition',case when choice.conditional_original_target is not null then 'Alinea al menos '||choice.conditional_original_target||' originales' else null end,'conditionalBonus',choice.conditional_sporting_bonus) order by choice.sort_order) into choices from public.manager_career_event_choices choice where choice.template_key=template.key;
  return jsonb_build_object('key',template.key,'title',template.title,'description',template.description,'category',template.category,'storyKey',template.story_key,'storyStep',template.story_step,'choices',coalesce(choices,'[]'::jsonb));
end $$;

create or replace function public.save_manager_career_decision(target_career_id uuid,target_decision_key text,target_choice_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.manager_careers%rowtype; prompt jsonb; choice jsonb; rep_delta integer; confidence_delta integer; budget_delta numeric; points_delta numeric; conditional_target integer; conditional_bonus numeric; consequence text;
begin
  select * into c from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  prompt:=public.manager_career_decision_prompt(target_career_id);
  if prompt is null or prompt->>'key'<>target_decision_key then raise exception 'Esta decisión no está disponible'; end if;
  select value into choice from jsonb_array_elements(prompt->'choices') where value->>'key'=target_choice_key;
  if choice is null then raise exception 'Opción no válida'; end if;
  if exists(select 1 from public.manager_career_decisions where career_id=c.id and matchday=c.current_matchday) then raise exception 'Ya has tomado una decisión en esta jornada'; end if;
  rep_delta:=(choice->>'reputationChange')::integer; confidence_delta:=(choice->>'confidenceChange')::integer; budget_delta:=(choice->>'budgetChange')::numeric; points_delta:=(choice->>'sportingPointsChange')::numeric; conditional_bonus:=(choice->>'conditionalBonus')::numeric;
  if choice->>'condition' is not null then conditional_target:=nullif(regexp_replace(choice->>'condition','[^0-9]','','g'),'')::integer; end if;
  if c.budget+budget_delta<0 then raise exception 'No tienes presupuesto para asumir esta decisión'; end if;
  consequence:=choice->>'summary';
  insert into public.manager_career_decisions(career_id,matchday,decision_key,choice_key,choice_title,consequence,reputation_change,budget_change,sporting_points_change,confidence_change,conditional_original_target,conditional_sporting_bonus)
  values(c.id,c.current_matchday,target_decision_key,target_choice_key,choice->>'title',consequence,rep_delta,budget_delta,points_delta,confidence_delta,conditional_target,conditional_bonus);
  update public.manager_careers set budget=budget+budget_delta,reputation=greatest(0,least(100,reputation+rep_delta)),board_confidence=greatest(0,least(100,board_confidence+confidence_delta)),updated_at=now() where id=c.id;
  update public.manager_career_objectives set current_value=greatest(0,least(100,c.board_confidence+confidence_delta)),updated_at=now() where career_id=c.id and objective_type='confidence' and status='active';
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(c.id,'decision',choice->>'title',consequence||' · confianza '||case when confidence_delta>=0 then '+' else '' end||confidence_delta,c.current_matchday,rep_delta);
  return choice;
end $$;

-- La función de cierre completa se redefine en la siguiente migración de ciclo de jornada;
-- mientras tanto, las misiones de puntos y originales son compatibles con el cierre actual.

revoke all on function public.ensure_manager_career_content(uuid,integer) from public,anon;
grant execute on function public.ensure_manager_career_content(uuid,integer) to authenticated,service_role;
revoke all on function public.manager_career_decision_prompt(uuid) from public,anon;
grant execute on function public.manager_career_decision_prompt(uuid) to authenticated;
notify pgrst,'reload schema';
