-- Laboratorio hermetico de Carrera. No escribe en carreras, calendarios, monedas,
-- logros, notificaciones ni mercados reales.

create table if not exists public.manager_career_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  source_career_id uuid references public.manager_careers(id) on delete set null,
  competition_id text not null references public.competitions(id),
  sports_club_id text not null references public.sports_clubs(id),
  title text not null,
  difficulty text not null check (difficulty in ('relaxed','balanced','elite')),
  manager_profile text not null check (manager_profile in ('conservative','competitive','academy','chaotic','custom')),
  run_mode text not null check (run_mode in ('guided','automatic')),
  seed text not null,
  status text not null default 'draft' check (status in ('draft','running','paused','completed','failed','archived')),
  current_matchday integer not null default 1 check (current_matchday between 1 and 50),
  maximum_matchday integer not null check (maximum_matchday between 1 and 50),
  phase text not null default 'preparation' check (phase in ('preparation','locked','played','adjustment_pending','interlude','completed','failed')),
  state jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  last_report jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

create table if not exists public.manager_career_lab_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.manager_career_lab_sessions(id) on delete cascade,
  matchday integer not null check (matchday between 1 and 50),
  moment text not null default 'before_preparation' check (moment in ('before_preparation','after_lineup','after_lock','before_close','after_close')),
  event_type text not null check (event_type in ('player_exit','player_team_change','player_new','player_correction','fixture_postponed','fixture_advanced','overlapping_matchdays','interlude')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled','applied','cancelled','failed')),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.manager_career_lab_checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.manager_career_lab_sessions(id) on delete cascade,
  sequence integer not null,
  matchday integer not null,
  phase text not null,
  label text not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  unique(session_id,sequence)
);

create table if not exists public.manager_career_lab_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.manager_career_lab_sessions(id) on delete cascade,
  sequence integer not null,
  matchday integer not null,
  phase text not null,
  action text not null,
  title text not null,
  detail text not null default '',
  before_state jsonb,
  after_state jsonb,
  checks jsonb not null default '[]'::jsonb,
  severity text not null default 'info' check (severity in ('info','success','warning','error')),
  created_at timestamptz not null default now(),
  unique(session_id,sequence)
);

create index if not exists manager_career_lab_sessions_admin_idx on public.manager_career_lab_sessions(created_by,updated_at desc);
create index if not exists manager_career_lab_events_due_idx on public.manager_career_lab_events(session_id,status,matchday,moment);
create index if not exists manager_career_lab_logs_idx on public.manager_career_lab_logs(session_id,sequence desc);

alter table public.manager_career_lab_sessions enable row level security;
alter table public.manager_career_lab_events enable row level security;
alter table public.manager_career_lab_checkpoints enable row level security;
alter table public.manager_career_lab_logs enable row level security;

create or replace function public.is_nexo_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;

drop policy if exists manager_career_lab_sessions_admin on public.manager_career_lab_sessions;
drop policy if exists manager_career_lab_events_admin on public.manager_career_lab_events;
drop policy if exists manager_career_lab_checkpoints_admin on public.manager_career_lab_checkpoints;
drop policy if exists manager_career_lab_logs_admin on public.manager_career_lab_logs;
create policy manager_career_lab_sessions_admin on public.manager_career_lab_sessions for select using (created_by=auth.uid() and public.is_nexo_admin());
create policy manager_career_lab_events_admin on public.manager_career_lab_events for select using (exists(select 1 from public.manager_career_lab_sessions s where s.id=session_id and s.created_by=auth.uid()) and public.is_nexo_admin());
create policy manager_career_lab_checkpoints_admin on public.manager_career_lab_checkpoints for select using (exists(select 1 from public.manager_career_lab_sessions s where s.id=session_id and s.created_by=auth.uid()) and public.is_nexo_admin());
create policy manager_career_lab_logs_admin on public.manager_career_lab_logs for select using (exists(select 1 from public.manager_career_lab_sessions s where s.id=session_id and s.created_by=auth.uid()) and public.is_nexo_admin());

create or replace function public.manager_career_lab_assert_admin() returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_nexo_admin() then raise exception 'Solo Administracion puede usar el Laboratorio'; end if;
end $$;

create or replace function public.manager_career_lab_checks(target_state jsonb) returns jsonb
language plpgsql immutable as $$
declare squad_count integer; lineup_count integer; unique_count integer; captain text; budget numeric; confidence integer; reputation integer; result jsonb:='[]'::jsonb;
begin
  squad_count:=jsonb_array_length(coalesce(target_state->'squad','[]'::jsonb));
  lineup_count:=jsonb_array_length(coalesce(target_state->'currentLineup'->'players','[]'::jsonb));
  select count(distinct value->>'id') into unique_count from jsonb_array_elements(coalesce(target_state->'currentLineup'->'players','[]'::jsonb));
  captain:=target_state->'currentLineup'->>'captainId'; budget:=coalesce((target_state->>'budget')::numeric,0);
  confidence:=coalesce((target_state->>'confidence')::integer,0); reputation:=coalesce((target_state->>'reputation')::integer,0);
  result:=result||jsonb_build_array(jsonb_build_object('key','budget','label','Presupuesto no negativo','passed',budget>=0,'value',budget));
  result:=result||jsonb_build_array(jsonb_build_object('key','confidence','label','Confianza entre 0 y 100','passed',confidence between 0 and 100,'value',confidence));
  result:=result||jsonb_build_array(jsonb_build_object('key','reputation','label','Reputacion entre 0 y 100','passed',reputation between 0 and 100,'value',reputation));
  result:=result||jsonb_build_array(jsonb_build_object('key','squad','label','Plantilla con al menos 11 jugadores','passed',squad_count>=11,'value',squad_count));
  if lineup_count>0 then
    result:=result||jsonb_build_array(jsonb_build_object('key','lineup_count','label','Once con 11 jugadores','passed',lineup_count=11,'value',lineup_count));
    result:=result||jsonb_build_array(jsonb_build_object('key','lineup_unique','label','Once sin duplicados','passed',unique_count=lineup_count,'value',unique_count));
    result:=result||jsonb_build_array(jsonb_build_object('key','captain','label','Capitan incluido en el once','passed',exists(select 1 from jsonb_array_elements(target_state->'currentLineup'->'players') p where p->>'id'=captain),'value',captain));
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('key','isolation','label','Sin monedas, logros ni notificaciones reales','passed',true,'value','laboratory_only'));
  return result;
end $$;

create or replace function public.manager_career_lab_options() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.manager_career_lab_assert_admin();
  return jsonb_build_object(
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'email',p.email,'initials',p.initials) order by p.display_name) from public.profiles p),'[]'::jsonb),
    'careers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'userId',c.owner_id,'competitionId',c.competition_id,'sportsClubId',c.sports_club_id,'sportsClubName',sc.name,'difficulty',c.difficulty,'matchday',c.current_matchday,'status',c.status) order by c.created_at desc) from public.manager_careers c join public.sports_clubs sc on sc.id=c.sports_club_id),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',sc.id,'name',sc.name,'competitionId',sc.competition_id,'playerCount',(select count(*) from public.players p where p.sports_club_id=sc.id and p.active)) order by sc.competition_id,sc.name) from public.sports_clubs sc where sc.active),'[]'::jsonb)
  );
end $$;

create or replace function public.manager_career_lab_log(target_session_id uuid,target_action text,target_title text,target_detail text,target_before jsonb,target_after jsonb,target_severity text default 'info') returns void
language plpgsql security definer set search_path=public as $$
declare next_sequence integer;
begin
  select coalesce(max(sequence),0)+1 into next_sequence from public.manager_career_lab_logs where session_id=target_session_id;
  insert into public.manager_career_lab_logs(session_id,sequence,matchday,phase,action,title,detail,before_state,after_state,checks,severity)
  select target_session_id,next_sequence,current_matchday,phase,target_action,target_title,target_detail,target_before,target_after,public.manager_career_lab_checks(target_after),target_severity from public.manager_career_lab_sessions where id=target_session_id;
end $$;

create or replace function public.admin_create_manager_career_lab(
  target_user_id uuid,target_source_career_id uuid,target_competition_id text,target_sports_club_id text,
  target_difficulty text,target_profile text,target_mode text,target_seed text,target_title text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare lab_id uuid; source public.manager_careers%rowtype; maximum_round integer; initial_budget numeric; squad jsonb; state jsonb; club_name text;
begin
  perform public.manager_career_lab_assert_admin();
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Usuario no disponible'; end if;
  if target_difficulty not in ('relaxed','balanced','elite') or target_profile not in ('conservative','competitive','academy','chaotic','custom') or target_mode not in ('guided','automatic') then raise exception 'Configuracion no valida'; end if;
  if target_source_career_id is not null then
    select * into source from public.manager_careers where id=target_source_career_id and owner_id=target_user_id;
    if not found then raise exception 'La Carrera seleccionada no pertenece al usuario'; end if;
    target_competition_id:=source.competition_id; target_sports_club_id:=source.sports_club_id; target_difficulty:=source.difficulty;
  end if;
  select name into club_name from public.sports_clubs where id=target_sports_club_id and competition_id=target_competition_id and active;
  if club_name is null then raise exception 'Equipo no disponible en la competicion'; end if;
  select greatest(coalesce(max(matchday),0),case when target_competition_id='segunda' then 42 else 38 end) into maximum_round from public.match_fixtures where competition_id=target_competition_id;
  select coalesce(case when target_source_career_id is not null then source.budget end,r.initial_budget)
  into initial_budget from public.manager_career_rules r limit 1;
  if target_source_career_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'clubId',p.sports_club_id,'value',p.market_value,'original',cp.is_original,'active',p.active) order by p.position,p.name),'[]'::jsonb) into squad
    from public.manager_career_players cp join public.players p on p.id=cp.player_id join public.sports_clubs sc on sc.id=p.sports_club_id where cp.career_id=target_source_career_id;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',club_name,'clubId',p.sports_club_id,'value',p.market_value,'original',true,'active',true) order by p.position,p.name),'[]'::jsonb) into squad from public.players p where p.sports_club_id=target_sports_club_id and p.active;
  end if;
  if jsonb_array_length(squad)<11 then raise exception 'El equipo no tiene suficientes jugadores para el laboratorio'; end if;
  state:=jsonb_build_object('budget',initial_budget,'confidence',60,'reputation',0,'sportingPoints',0,'objectivePoints',0,'consecutiveFailures',0,'status','active','squad',squad,'currentLineup',null,'lineupHistory','[]'::jsonb,'reports','[]'::jsonb,'decisions','[]'::jsonb,'incidents','[]'::jsonb,'interludes','[]'::jsonb,'calendarExceptions','[]'::jsonb,'delegationsUsed',0,'realSideEffects',0);
  insert into public.manager_career_lab_sessions(created_by,subject_user_id,source_career_id,competition_id,sports_club_id,title,difficulty,manager_profile,run_mode,seed,maximum_matchday,state,config,status)
  values(auth.uid(),target_user_id,target_source_career_id,target_competition_id,target_sports_club_id,coalesce(nullif(trim(target_title),''),'Laboratorio · '||club_name),target_difficulty,target_profile,target_mode,coalesce(nullif(trim(target_seed),''),gen_random_uuid()::text),maximum_round,state,jsonb_build_object('clubName',club_name,'samplePoints',true,'interludeStrategy','recovery','autoResolveIncidents',true),'running') returning id into lab_id;
  insert into public.manager_career_lab_checkpoints(session_id,sequence,matchday,phase,label,state) values(lab_id,1,1,'preparation','Inicio de temporada',state);
  perform public.manager_career_lab_log(lab_id,'create','Laboratorio creado','Copia hermetica preparada para '||club_name,null,state,'success');
  return lab_id;
end $$;

create or replace function public.admin_manager_career_lab_sessions() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.manager_career_lab_assert_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'userId',s.subject_user_id,'userName',p.display_name,'competitionId',s.competition_id,'sportsClubId',s.sports_club_id,'sportsClubName',sc.name,'difficulty',s.difficulty,'profile',s.manager_profile,'mode',s.run_mode,'seed',s.seed,'status',s.status,'matchday',s.current_matchday,'maximumMatchday',s.maximum_matchday,'phase',s.phase,'updatedAt',s.updated_at,'expiresAt',s.expires_at) order by s.updated_at desc) from public.manager_career_lab_sessions s join public.profiles p on p.id=s.subject_user_id join public.sports_clubs sc on sc.id=s.sports_club_id where s.created_by=auth.uid() and s.status<>'archived'),'[]'::jsonb);
end $$;

create or replace function public.admin_manager_career_lab_state(target_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype;
begin
  perform public.manager_career_lab_assert_admin(); select * into selected from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid(); if not found then raise exception 'Laboratorio no disponible'; end if;
  return jsonb_build_object('session',jsonb_build_object('id',selected.id,'title',selected.title,'userId',selected.subject_user_id,'competitionId',selected.competition_id,'sportsClubId',selected.sports_club_id,'difficulty',selected.difficulty,'profile',selected.manager_profile,'mode',selected.run_mode,'seed',selected.seed,'status',selected.status,'matchday',selected.current_matchday,'maximumMatchday',selected.maximum_matchday,'phase',selected.phase,'updatedAt',selected.updated_at),'state',selected.state,'lastReport',selected.last_report,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'matchday',e.matchday,'moment',e.moment,'type',e.event_type,'title',e.title,'payload',e.payload,'status',e.status) order by e.matchday,e.created_at) from public.manager_career_lab_events e where e.session_id=selected.id),'[]'::jsonb),
    'logs',coalesce((select jsonb_agg(jsonb_build_object('sequence',l.sequence,'matchday',l.matchday,'phase',l.phase,'action',l.action,'title',l.title,'detail',l.detail,'checks',l.checks,'severity',l.severity,'createdAt',l.created_at) order by l.sequence desc) from public.manager_career_lab_logs l where l.session_id=selected.id),'[]'::jsonb),
    'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'matchday',c.matchday,'phase',c.phase,'label',c.label,'createdAt',c.created_at) order by c.sequence desc) from public.manager_career_lab_checkpoints c where c.session_id=selected.id),'[]'::jsonb));
end $$;

create or replace function public.admin_schedule_manager_career_lab_event(target_session_id uuid,target_matchday integer,target_moment text,target_type text,target_title text,target_payload jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
  perform public.manager_career_lab_assert_admin();
  if not exists(select 1 from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid() and status in ('running','paused')) then raise exception 'Laboratorio no disponible'; end if;
  insert into public.manager_career_lab_events(session_id,matchday,moment,event_type,title,payload) values(target_session_id,target_matchday,target_moment,target_type,target_title,coalesce(target_payload,'{}'::jsonb)) returning id into result; return result;
end $$;

create or replace function public.manager_career_lab_apply_events(target_session_id uuid,target_moment text,target_state jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare event record; state jsonb:=target_state; squad jsonb; lineup jsonb; player_id text; new_club text; incident jsonb;
begin
  for event in select * from public.manager_career_lab_events where session_id=target_session_id and matchday=(select current_matchday from public.manager_career_lab_sessions where id=target_session_id) and moment=target_moment and status='scheduled' order by created_at for update loop
    begin
      player_id:=event.payload->>'playerId'; new_club:=event.payload->>'newClub';
      if event.event_type in ('player_exit','player_team_change') then
        select coalesce(jsonb_agg(case when item->>'id'=player_id then item||jsonb_build_object('active',event.event_type='player_team_change','club',coalesce(new_club,item->>'club'),'status',case when event.event_type='player_exit' then 'outside_competition' else 'team_changed' end) else item end),'[]'::jsonb) into squad from jsonb_array_elements(state->'squad') item;
        state:=jsonb_set(state,'{squad}',squad);
        incident:=jsonb_build_object('id',event.id,'type',event.event_type,'playerId',player_id,'title',event.title,'status','pending','value',event.payload->'value');
        state:=jsonb_set(state,'{incidents}',coalesce(state->'incidents','[]'::jsonb)||jsonb_build_array(incident));
        if target_moment in ('before_preparation','after_lineup') and state->'currentLineup' is not null then
          select coalesce(jsonb_agg(item),'[]'::jsonb) into lineup from jsonb_array_elements(state->'currentLineup'->'players') item where item->>'id'<>player_id;
          state:=jsonb_set(state,'{currentLineup,players}',lineup); state:=jsonb_set(state,'{currentLineup,valid}','false'::jsonb);
        end if;
      elsif event.event_type='player_new' then state:=jsonb_set(state,'{squad}',state->'squad'||jsonb_build_array(event.payload||jsonb_build_object('active',true,'original',false)));
      elsif event.event_type='player_correction' then
        select coalesce(jsonb_agg(case when item->>'id'=player_id then item||jsonb_build_object('active',true,'status','active') else item end),'[]'::jsonb) into squad from jsonb_array_elements(state->'squad') item; state:=jsonb_set(state,'{squad}',squad);
      elsif event.event_type in ('fixture_postponed','fixture_advanced','overlapping_matchdays') then state:=jsonb_set(state,'{calendarExceptions}',state->'calendarExceptions'||jsonb_build_array(jsonb_build_object('id',event.id,'type',event.event_type,'matchday',event.matchday,'payload',event.payload,'status','active')));
      elsif event.event_type='interlude' then state:=jsonb_set(state,'{activeInterlude}',jsonb_build_object('id',event.id,'title',event.title,'status','active','days',coalesce((event.payload->>'days')::integer,14),'strategy',event.payload->>'strategy'));
      end if;
      update public.manager_career_lab_events set status='applied',applied_at=now() where id=event.id;
    exception when others then update public.manager_career_lab_events set status='failed' where id=event.id; raise; end;
  end loop;
  return state;
end $$;

create or replace function public.manager_career_lab_build_lineup(target_state jsonb,target_profile text,target_seed text,target_matchday integer) returns jsonb
language plpgsql immutable as $$
declare players jsonb; captain text; originals integer;
begin
  with candidates as (
    select candidate.item::jsonb as player,
      row_number() over(partition by candidate.item::jsonb->>'position' order by case when target_profile='academy' and coalesce((candidate.item::jsonb->>'original')::boolean,false) then 0 else 1 end,abs(hashtext(target_seed||target_matchday::text||(candidate.item::jsonb->>'id')))) as order_position
    from jsonb_array_elements(target_state->'squad') as candidate(item)
    where coalesce((candidate.item::jsonb->>'active')::boolean,true)
  ), chosen as (
    select candidates.player::jsonb as player from candidates where (candidates.player::jsonb->>'position'='POR' and order_position<=1) or (candidates.player::jsonb->>'position'='DEF' and order_position<=4) or (candidates.player::jsonb->>'position'='MED' and order_position<=4) or (candidates.player::jsonb->>'position'='DEL' and order_position<=2)
  )
  select coalesce(jsonb_agg(chosen.player::jsonb),'[]'::jsonb),min(chosen.player::jsonb->>'id'),count(*) filter(where coalesce((chosen.player::jsonb->>'original')::boolean,false)) into players,captain,originals from chosen;
  return jsonb_build_object('matchday',target_matchday,'formation','4-4-2','captainId',captain,'players',players,'originals',originals,'valid',jsonb_array_length(players)=11,'locked',false);
end $$;

create or replace function public.admin_step_manager_career_lab(target_session_id uuid,target_action text,target_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_step>>
declare session public.manager_career_lab_sessions%rowtype; before_state jsonb; state jsonb; lineup jsonb; points integer:=0; base integer; player jsonb; scored jsonb:='[]'::jsonb; mission_target integer; mission_passed boolean; delta_conf integer:=0; delta_rep integer:=0; detail text; next_phase text; next_matchday integer; sequence_no integer; adjustment boolean; strategy text;
begin
  perform public.manager_career_lab_assert_admin(); select * into session from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid() for update; if not found then raise exception 'Laboratorio no disponible'; end if;
  if session.status not in ('running','paused') then raise exception 'El laboratorio no admite pasos'; end if;
  before_state:=session.state; state:=session.state; next_phase:=session.phase; next_matchday:=session.current_matchday;
  if target_action='prepare' and session.phase='preparation' then
    state:=public.manager_career_lab_apply_events(session.id,'before_preparation',state); lineup:=public.manager_career_lab_build_lineup(state,session.manager_profile,session.seed,session.current_matchday); state:=jsonb_set(state,'{currentLineup}',lineup); state:=public.manager_career_lab_apply_events(session.id,'after_lineup',state); detail:='Once 4-4-2 generado con '||jsonb_array_length(state->'currentLineup'->'players')||' jugadores.';
  elsif target_action='lock' and session.phase='preparation' then
    if not coalesce((state->'currentLineup'->>'valid')::boolean,false) then raise exception 'No existe un once valido para bloquear'; end if; state:=jsonb_set(state,'{currentLineup,locked}','true'::jsonb); state:=public.manager_career_lab_apply_events(session.id,'after_lock',state); next_phase:='locked'; detail:='Instantanea independiente de la Jornada '||session.current_matchday||' bloqueada.';
  elsif target_action='play' and session.phase='locked' then
    for player in select value from jsonb_array_elements(state->'currentLineup'->'players') loop base:=2+abs(hashtext(session.seed||':'||session.current_matchday::text||':'||(player->>'id')))%9; if player->>'id'=state->'currentLineup'->>'captainId' then base:=base*2; end if; points:=points+base; scored:=scored||jsonb_build_array(player||jsonb_build_object('points',base)); end loop;
    state:=jsonb_set(state,'{currentLineup,players}',scored); state:=jsonb_set(state,'{currentLineup,points}',to_jsonb(points)); state:=public.manager_career_lab_apply_events(session.id,'before_close',state); next_phase:='played'; detail:='Partidos simulados con semilla reproducible. Total provisional: '||points||' puntos.';
  elsif target_action='close' and session.phase='played' then
    points:=coalesce((state->'currentLineup'->>'points')::integer,0); mission_target:=case session.difficulty when 'relaxed' then 42 when 'elite' then 62 else 52 end; mission_passed:=points>=mission_target;
    if mission_passed then delta_conf:=4;delta_rep:=3;state:=jsonb_set(state,'{consecutiveFailures}','0'::jsonb); else delta_conf:=-8;state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(coalesce((state->>'consecutiveFailures')::integer,0)+1)); end if;
    if session.manager_profile='chaotic' then delta_conf:=delta_conf-2; end if;
    state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,least(100,(state->>'confidence')::integer+delta_conf)))); state:=jsonb_set(state,'{reputation}',to_jsonb(greatest(0,least(100,(state->>'reputation')::integer+delta_rep)))); state:=jsonb_set(state,'{sportingPoints}',to_jsonb((state->>'sportingPoints')::integer+points));
    if (state->>'consecutiveFailures')::integer>=3 and (state->>'confidence')::integer<=15 then state:=jsonb_set(state,'{status}',to_jsonb('dismissed'::text)); end if;
    state:=jsonb_set(state,'{reports}',state->'reports'||jsonb_build_array(jsonb_build_object('matchday',session.current_matchday,'points',points,'missionTarget',mission_target,'missionPassed',mission_passed,'confidenceChange',delta_conf,'reputationChange',delta_rep,'status',state->>'status','players',state->'currentLineup'->'players')));
    state:=jsonb_set(state,'{lineupHistory}',state->'lineupHistory'||jsonb_build_array(state->'currentLineup')); state:=public.manager_career_lab_apply_events(session.id,'after_close',state);
    adjustment:=exists(select 1 from jsonb_array_elements(state->'calendarExceptions') x where x->>'type'='fixture_postponed' and (x->>'matchday')::integer=session.current_matchday and x->>'status'='active');
    if adjustment then next_phase:='adjustment_pending'; detail:='Cierre provisional: el aplazado conserva el once original y espera un ajuste diferencial.';
    elsif state->'activeInterlude' is not null then next_phase:='interlude'; detail:='Jornada cerrada. Se abre un interludio antes de la siguiente.';
    elsif state->>'status'='dismissed' then next_phase:='failed'; detail:='La directiva destituye al manager tras tres fallos y confianza critica.';
    elsif session.current_matchday>=session.maximum_matchday then next_phase:='completed'; detail:='Temporada completada sin escribir recompensas reales.';
    else next_matchday:=session.current_matchday+1;next_phase:='preparation';state:=jsonb_set(state,'{currentLineup}','null'::jsonb);detail:='Cierre definitivo y apertura independiente de la Jornada '||next_matchday||'.'; end if;
  elsif target_action='adjust' and session.phase='adjustment_pending' then
    state:=jsonb_set(state,'{calendarExceptions}',(select coalesce(jsonb_agg(case when x->>'type'='fixture_postponed' and (x->>'matchday')::integer=session.current_matchday then x||jsonb_build_object('status','adjusted') else x end),'[]'::jsonb) from jsonb_array_elements(state->'calendarExceptions') x));
    if session.current_matchday>=session.maximum_matchday then next_phase:='completed'; else next_matchday:=session.current_matchday+1;next_phase:='preparation';state:=jsonb_set(state,'{currentLineup}','null'::jsonb); end if; detail:='Ajuste posterior aplicado una sola vez; no se repiten pagos ni efectos.';
  elsif target_action='resolve_interlude' and session.phase='interlude' then
    strategy:=coalesce(target_options->>'strategy',state->'activeInterlude'->>'strategy','recovery');
    if strategy='recovery' then state:=jsonb_set(state,'{confidence}',to_jsonb(least(100,(state->>'confidence')::integer+5)));state:=jsonb_set(state,'{consecutiveFailures}',to_jsonb(greatest(0,(state->>'consecutiveFailures')::integer-1)));
    elsif strategy='commercial' then state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+1.5));state:=jsonb_set(state,'{confidence}',to_jsonb(greatest(0,(state->>'confidence')::integer-3)));
    elsif strategy='academy' then state:=jsonb_set(state,'{reputation}',to_jsonb(least(100,(state->>'reputation')::integer+4)));
    else state:=jsonb_set(state,'{tacticalProtection}',to_jsonb(50)); end if;
    state:=jsonb_set(state,'{interludes}',state->'interludes'||jsonb_build_array(state->'activeInterlude'||jsonb_build_object('strategy',strategy,'status','resolved')));state:=state-'activeInterlude';next_matchday:=session.current_matchday+1;next_phase:='preparation';state:=jsonb_set(state,'{currentLineup}','null'::jsonb);detail:='Interludio resuelto con el plan '||strategy||'. No consume jornada ni delegacion.';
  elsif target_action='pause' then update public.manager_career_lab_sessions set status='paused',updated_at=now() where id=session.id; return public.admin_manager_career_lab_state(session.id);
  elsif target_action='resume' then update public.manager_career_lab_sessions set status='running',updated_at=now() where id=session.id; return public.admin_manager_career_lab_state(session.id);
  else raise exception 'Paso % no valido para la fase %',target_action,session.phase; end if;
  update public.manager_career_lab_sessions target set state=lab_step.state,current_matchday=next_matchday,phase=next_phase,status=case when next_phase='completed' then 'completed' when next_phase='failed' then 'failed' else 'running' end,last_report=jsonb_build_object('action',target_action,'detail',detail,'matchday',session.current_matchday,'phaseBefore',session.phase,'phaseAfter',next_phase,'checks',public.manager_career_lab_checks(lab_step.state)),updated_at=now() where target.id=session.id;
  select coalesce(max(sequence),0)+1 into sequence_no from public.manager_career_lab_checkpoints where session_id=session.id; insert into public.manager_career_lab_checkpoints(session_id,sequence,matchday,phase,label,state) values(session.id,sequence_no,next_matchday,next_phase,target_action||' · J'||session.current_matchday,state);
  perform public.manager_career_lab_log(session.id,target_action,case target_action when 'prepare' then 'Once preparado' when 'lock' then 'Jornada bloqueada' when 'play' then 'Partidos simulados' when 'close' then 'Jornada cerrada' when 'adjust' then 'Aplazamiento ajustado' else 'Interludio resuelto' end,detail,before_state,state,case when exists(select 1 from jsonb_array_elements(public.manager_career_lab_checks(state)) c where not (c->>'passed')::boolean) then 'error' else 'success' end);
  return public.admin_manager_career_lab_state(session.id);
end $$;

create or replace function public.admin_run_manager_career_lab(target_session_id uuid,target_until text default 'season_end',target_limit integer default 200) returns jsonb
language plpgsql security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype; counter integer:=0; result jsonb;
begin
  perform public.manager_career_lab_assert_admin();
  loop
    select * into selected from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid(); exit when not found or selected.status not in ('running','paused') or selected.phase in ('completed','failed') or counter>=least(target_limit,500);
    if target_until='next_interlude' and counter>0 and selected.phase='interlude' then exit; end if;
    if target_until='next_failure' and counter>0 and (selected.state->>'consecutiveFailures')::integer>0 then exit; end if;
    if selected.status='paused' then perform public.admin_step_manager_career_lab(selected.id,'resume');
    elsif selected.phase='preparation' then perform public.admin_step_manager_career_lab(selected.id,'prepare'); if jsonb_array_length((select state->'currentLineup'->'players' from public.manager_career_lab_sessions where id=selected.id))=11 then perform public.admin_step_manager_career_lab(selected.id,'lock'); end if;
    elsif selected.phase='locked' then perform public.admin_step_manager_career_lab(selected.id,'play');
    elsif selected.phase='played' then perform public.admin_step_manager_career_lab(selected.id,'close');
    elsif selected.phase='adjustment_pending' then perform public.admin_step_manager_career_lab(selected.id,'adjust');
    elsif selected.phase='interlude' then perform public.admin_step_manager_career_lab(selected.id,'resolve_interlude',jsonb_build_object('strategy',coalesce(selected.config->>'interludeStrategy','recovery')));
    else exit; end if; counter:=counter+1;
    if target_until='matchday' and counter>0 and (select phase from public.manager_career_lab_sessions where id=selected.id)='preparation' then exit; end if;
  end loop;
  result:=public.admin_manager_career_lab_state(target_session_id); return result||jsonb_build_object('stepsExecuted',counter);
end $$;

create or replace function public.admin_restore_manager_career_lab_checkpoint(target_session_id uuid,target_checkpoint_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare checkpoint public.manager_career_lab_checkpoints%rowtype;
begin
  perform public.manager_career_lab_assert_admin(); select c.* into checkpoint from public.manager_career_lab_checkpoints c join public.manager_career_lab_sessions s on s.id=c.session_id where c.id=target_checkpoint_id and c.session_id=target_session_id and s.created_by=auth.uid(); if not found then raise exception 'Punto de control no disponible'; end if;
  update public.manager_career_lab_sessions set state=checkpoint.state,current_matchday=checkpoint.matchday,phase=checkpoint.phase,status='running',error_message=null,updated_at=now() where id=target_session_id; perform public.manager_career_lab_log(target_session_id,'restore','Punto de control restaurado',checkpoint.label,null,checkpoint.state,'warning'); return public.admin_manager_career_lab_state(target_session_id);
end $$;

create or replace function public.admin_delete_manager_career_lab(target_session_id uuid) returns void
language plpgsql security definer set search_path=public as $$ begin perform public.manager_career_lab_assert_admin(); delete from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid(); end $$;

revoke all on public.manager_career_lab_sessions,public.manager_career_lab_events,public.manager_career_lab_checkpoints,public.manager_career_lab_logs from public,anon,authenticated;
grant all on public.manager_career_lab_sessions,public.manager_career_lab_events,public.manager_career_lab_checkpoints,public.manager_career_lab_logs to service_role;
revoke all on function public.manager_career_lab_options(),public.admin_create_manager_career_lab(uuid,uuid,text,text,text,text,text,text,text),public.admin_manager_career_lab_sessions(),public.admin_manager_career_lab_state(uuid),public.admin_schedule_manager_career_lab_event(uuid,integer,text,text,text,jsonb),public.admin_step_manager_career_lab(uuid,text,jsonb),public.admin_run_manager_career_lab(uuid,text,integer),public.admin_restore_manager_career_lab_checkpoint(uuid,uuid),public.admin_delete_manager_career_lab(uuid) from public,anon;
grant execute on function public.manager_career_lab_options(),public.admin_create_manager_career_lab(uuid,uuid,text,text,text,text,text,text,text),public.admin_manager_career_lab_sessions(),public.admin_manager_career_lab_state(uuid),public.admin_schedule_manager_career_lab_event(uuid,integer,text,text,text,jsonb),public.admin_step_manager_career_lab(uuid,text,jsonb),public.admin_run_manager_career_lab(uuid,text,integer),public.admin_restore_manager_career_lab_checkpoint(uuid,uuid),public.admin_delete_manager_career_lab(uuid) to authenticated;
grant execute on function public.manager_career_lab_checks(jsonb),public.manager_career_lab_apply_events(uuid,text,jsonb),public.manager_career_lab_build_lineup(jsonb,text,text,integer),public.manager_career_lab_log(uuid,text,text,text,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';
