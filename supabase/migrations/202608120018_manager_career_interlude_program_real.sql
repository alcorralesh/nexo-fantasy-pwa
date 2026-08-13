-- Programa de interludio persistente para Carrera real.

create table if not exists public.manager_career_interlude_programs (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  interlude_id uuid not null references public.manager_career_interludes(id) on delete cascade,
  plan text,
  progress integer not null default 0 check(progress>=0),
  streak integer not null default 0 check(streak>=0),
  aligned_actions integer not null default 0 check(aligned_actions>=0),
  project_progress integer not null default 0 check(project_progress between 0 and 3),
  activity_days integer not null default 18 check(activity_days>0),
  last_action_date date,
  management_points integer not null default 6 check(management_points>=0),
  projects jsonb not null default '[]'::jsonb,
  reward jsonb,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(career_id,interlude_id)
);
alter table public.manager_career_interlude_programs add column if not exists aligned_actions integer not null default 0;
alter table public.manager_career_interlude_programs add column if not exists project_progress integer not null default 0;
alter table public.manager_career_interlude_programs add column if not exists activity_days integer not null default 18;

alter table public.manager_career_interlude_programs enable row level security;
drop policy if exists manager_career_interlude_programs_owner on public.manager_career_interlude_programs;
create policy manager_career_interlude_programs_owner on public.manager_career_interlude_programs for select using(
  exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid())
);

create or replace function public.settle_manager_career_interlude_program(target_career_id uuid,target_interlude_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare career public.manager_careers%rowtype; program public.manager_career_interlude_programs%rowtype; interlude public.manager_career_interludes%rowtype; rules public.manager_career_rules%rowtype; result jsonb;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into program from public.manager_career_interlude_programs where career_id=career.id and interlude_id=target_interlude_id for update;
  if not found or program.settled_at is not null then return coalesce(program.reward,'{}'::jsonb); end if;
  select * into interlude from public.manager_career_interludes where id=target_interlude_id; select * into rules from public.manager_career_rules where id;
  if now()<interlude.ends_at-make_interval(days=>rules.interlude_preparation_days) then raise exception 'El interludio todavía no ha terminado'; end if;
  result:=public.manager_career_interlude_reward(program.plan,program.progress,program.activity_days);
  update public.manager_careers set
    budget=budget+coalesce((result->>'budgetChange')::numeric,0),
    board_confidence=greatest(0,least(100,board_confidence+coalesce((result->>'confidenceChange')::integer,0))),
    reputation=greatest(0,least(100,reputation+coalesce((result->>'reputationChange')::integer,0))),
    consecutive_failures=greatest(0,consecutive_failures-coalesce((result->>'failuresReduced')::integer,0)),updated_at=now()
  where id=career.id;
  update public.manager_career_interlude_programs set reward=result,settled_at=now(),updated_at=now() where id=program.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change)
  select career.id,'interlude_reward',result->>'title',result->>'description',i.to_matchday,coalesce((result->>'reputationChange')::integer,0)
  from public.manager_career_interludes i where i.id=target_interlude_id;
  perform public.create_nexo_notification(career.owner_id,'system','Interludio completado',(result->>'title')||'. '||(result->>'description'),null,'inicio','career-interlude-reward:'||program.id);
  return result;
end $$;

do $$ begin
  if to_regprocedure('public.manager_career_interlude_state_v3_base(uuid)') is null then
    alter function public.manager_career_interlude_state(uuid) rename to manager_career_interlude_state_v3_base;
  end if;
end $$;

create or replace function public.manager_career_interlude_state(target_career_id uuid) returns jsonb
language plpgsql volatile security definer set search_path=public as $$
declare result jsonb; career public.manager_careers%rowtype; program public.manager_career_interlude_programs%rowtype; rules public.manager_career_rules%rowtype; interlude public.manager_career_interludes%rowtype; iid uuid; phase text; total_days integer;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  result:=public.manager_career_interlude_state_v3_base(target_career_id);
  if result is null then return null; end if;
  iid:=(result->>'id')::uuid; phase:=result->>'phase';
  select * into rules from public.manager_career_rules where id; select * into interlude from public.manager_career_interludes where id=iid;
  total_days:=greatest(1,ceil(extract(epoch from ((interlude.ends_at-make_interval(days=>rules.interlude_preparation_days))-interlude.starts_at))/86400.0));
  insert into public.manager_career_interlude_programs(career_id,interlude_id,activity_days) values(career.id,iid,total_days) on conflict(career_id,interlude_id) do update set activity_days=excluded.activity_days;
  if phase='preparation' then perform public.settle_manager_career_interlude_program(career.id,iid); end if;
  select * into program from public.manager_career_interlude_programs where career_id=career.id and interlude_id=iid;
  result:=result||jsonb_build_object(
    'planChoices',public.manager_career_interlude_plan_choices(),'projectChoices',public.manager_career_interlude_project_choices(),
    'plan',program.plan,'progress',program.progress,'streak',program.streak,'activityDays',program.activity_days,'managementPoints',program.management_points,
    'projects',program.projects,'reward',program.reward,'rewardPreview',public.manager_career_interlude_reward(program.plan,program.progress,program.activity_days)
  );
  return result;
end $$;

create or replace function public.save_manager_career_interlude_plan(target_career_id uuid,target_interlude_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare career public.manager_careers%rowtype; interlude public.manager_career_interludes%rowtype; chosen jsonb;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active';
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into interlude from public.manager_career_interludes where id=target_interlude_id and competition_id=career.competition_id and to_matchday=career.current_matchday and status='active';
  if not found then raise exception 'Interludio no disponible'; end if;
  select item into chosen from jsonb_array_elements(public.manager_career_interlude_plan_choices()) item where item->>'key'=target_plan;
  if chosen is null then raise exception 'Plan no válido'; end if;
  insert into public.manager_career_interlude_programs(career_id,interlude_id,plan) values(career.id,target_interlude_id,target_plan)
  on conflict(career_id,interlude_id) do update set plan=excluded.plan,updated_at=now() where manager_career_interlude_programs.plan is null;
  if not found then raise exception 'El plan ya está elegido'; end if;
  return public.manager_career_interlude_state(career.id);
end $$;

create or replace function public.save_manager_career_interlude_project(target_career_id uuid,target_interlude_id uuid,target_project text,target_configuration jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare career public.manager_careers%rowtype; program public.manager_career_interlude_programs%rowtype; project jsonb; matches_plan boolean; earned integer; cost integer;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active';
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into program from public.manager_career_interlude_programs where career_id=career.id and interlude_id=target_interlude_id for update;
  if not found or program.plan is null then raise exception 'Primero debes elegir un plan'; end if;
  if program.settled_at is not null then raise exception 'El interludio ya está cerrado'; end if;
  select item into project from jsonb_array_elements(public.manager_career_interlude_project_choices()) item where item->>'key'=target_project;
  if project is null then raise exception 'Proyecto no válido'; end if;
  if exists(select 1 from jsonb_array_elements(program.projects) p where p->>'key'=target_project) then raise exception 'Este proyecto ya está completado'; end if;
  cost:=(project->>'cost')::integer; if program.management_points<cost then raise exception 'No quedan puntos de gestión suficientes'; end if;
  select exists(select 1 from jsonb_array_elements_text(project->'plans') p where p=program.plan) into matches_plan;
  earned:=case when program.project_progress<3 then 1 else 0 end;
  project:=project||jsonb_build_object('configuration',target_configuration,'completedAt',now(),'earnedProgress',earned,'matchesPlan',matches_plan);
  update public.manager_career_interlude_programs set projects=projects||jsonb_build_array(project),progress=progress+earned,project_progress=least(3,project_progress+earned),management_points=management_points-cost,updated_at=now() where id=program.id;
  return public.manager_career_interlude_state(career.id);
end $$;

create or replace function public.save_manager_career_interlude_decision(target_career_id uuid,target_interlude_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare career public.manager_careers%rowtype; interlude public.manager_career_interludes%rowtype; program public.manager_career_interlude_programs%rowtype; rules public.manager_career_rules%rowtype;
  madrid_date date; day_no integer; choice jsonb; matches_plan boolean; earned integer; next_streak integer; preparation_opens_at timestamptz;
begin
  select * into career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active';
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into interlude from public.manager_career_interludes where id=target_interlude_id and status='active';
  if not found then raise exception 'Interludio no disponible'; end if;
  select * into program from public.manager_career_interlude_programs where career_id=career.id and interlude_id=interlude.id for update;
  if not found or program.plan is null then raise exception 'Primero debes elegir un plan'; end if;
  select * into rules from public.manager_career_rules where id;
  preparation_opens_at:=interlude.ends_at-make_interval(days=>rules.interlude_preparation_days);
  if now()<interlude.starts_at or now()>=preparation_opens_at then raise exception 'La ventana de actividades está cerrada'; end if;
  madrid_date:=timezone('Europe/Madrid',now())::date;
  if exists(select 1 from public.manager_career_interlude_decisions where career_id=career.id and interlude_id=interlude.id and action_date=madrid_date) then raise exception 'La actividad de hoy ya está realizada'; end if;
  day_no:=greatest(1,(madrid_date-timezone('Europe/Madrid',interlude.starts_at)::date)+1);
  select item into choice from jsonb_array_elements(public.manager_career_interlude_activity_choices(day_no,career.board_confidence,career.consecutive_failures)) item where item->>'key'=target_plan;
  if choice is null then raise exception 'Esta actividad no está disponible hoy'; end if;
  select exists(select 1 from jsonb_array_elements(public.manager_career_interlude_plan_choices()) p,jsonb_array_elements_text(p->'categories') c where p->>'key'=program.plan and c=choice->>'category') into matches_plan;
  next_streak:=case when program.last_action_date=madrid_date-1 then program.streak+1 else 1 end;
  earned:=1+case when matches_plan and (program.aligned_actions+1)%2=0 then 1 else 0 end+case when next_streak%4=0 then 1 else 0 end;
  insert into public.manager_career_interlude_decisions(career_id,interlude_id,target_matchday,plan,title,consequence,confidence_change,reputation_change,budget_change,failures_reduced,next_effect,action_date)
  values(career.id,interlude.id,interlude.to_matchday,'program:'||target_plan,choice->>'title','+'||earned||' progreso del plan',0,0,0,0,'{}'::jsonb,madrid_date);
  update public.manager_career_interlude_programs set progress=progress+earned,streak=next_streak,aligned_actions=aligned_actions+case when matches_plan then 1 else 0 end,last_action_date=madrid_date,updated_at=now() where id=program.id;
  return public.manager_career_interlude_state(career.id);
end $$;

revoke all on public.manager_career_interlude_programs from anon;
grant select on public.manager_career_interlude_programs to authenticated;
grant all on public.manager_career_interlude_programs to service_role;
revoke all on function public.manager_career_interlude_state(uuid),public.save_manager_career_interlude_plan(uuid,uuid,text),public.save_manager_career_interlude_project(uuid,uuid,text,jsonb),public.save_manager_career_interlude_decision(uuid,uuid,text),public.settle_manager_career_interlude_program(uuid,uuid) from public,anon;
grant execute on function public.manager_career_interlude_state(uuid),public.save_manager_career_interlude_plan(uuid,uuid,text),public.save_manager_career_interlude_project(uuid,uuid,text,jsonb),public.save_manager_career_interlude_decision(uuid,uuid,text),public.settle_manager_career_interlude_program(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
