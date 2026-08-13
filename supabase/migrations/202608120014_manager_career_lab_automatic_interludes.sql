-- Convierte automaticamente los huecos reales del calendario en interludios
-- jugables. Los partidos aislados adelantados o aplazados no deforman la
-- ventana principal de una jornada: se usa el bloque de fechas de la mediana.

create or replace function public.manager_career_lab_open_calendar_interlude(
  target_session_id uuid,
  closed_matchday integer
) returns boolean
language plpgsql security definer set search_path=public as $$
declare
  selected public.manager_career_lab_sessions%rowtype;
  current_end timestamptz;
  next_start timestamptz;
  current_override jsonb;
  next_override jsonb;
  current_median timestamptz;
  next_median timestamptz;
  next_matchday integer:=closed_matchday+1;
  gap_days integer;
  next_state jsonb;
  active jsonb;
  filtered_history jsonb;
begin
  select * into selected from public.manager_career_lab_sessions
  where id=target_session_id for update;
  if not found or closed_matchday>=selected.maximum_matchday then return false; end if;
  if selected.state->'activeInterlude' is not null then return true; end if;

  select value into current_override
  from jsonb_array_elements(coalesce(selected.state->'calendarOverrides','[]'::jsonb)) value
  where coalesce((value->>'matchday')::integer,0)=closed_matchday limit 1;
  select value into next_override
  from jsonb_array_elements(coalesce(selected.state->'calendarOverrides','[]'::jsonb)) value
  where coalesce((value->>'matchday')::integer,0)=next_matchday limit 1;

  if current_override is not null then current_end:=(current_override->>'endAt')::timestamptz;
  else
    select percentile_disc(.5) within group(order by kickoff_at) into current_median
    from public.match_fixtures where competition_id=selected.competition_id
      and matchday=closed_matchday and kickoff_at is not null and status<>'cancelled';
    select max(kickoff_at) into current_end from public.match_fixtures
    where competition_id=selected.competition_id and matchday=closed_matchday
      and kickoff_at between current_median-interval '3 days' and current_median+interval '3 days'
      and status<>'cancelled';
  end if;
  if next_override is not null then next_start:=(next_override->>'startAt')::timestamptz;
  else
    select percentile_disc(.5) within group(order by kickoff_at) into next_median
    from public.match_fixtures where competition_id=selected.competition_id
      and matchday=next_matchday and kickoff_at is not null and status<>'cancelled';
    select min(kickoff_at) into next_start from public.match_fixtures
    where competition_id=selected.competition_id and matchday=next_matchday
      and kickoff_at between next_median-interval '3 days' and next_median+interval '3 days'
      and status<>'cancelled';
  end if;

  if current_end is null or next_start is null then return false; end if;
  gap_days:=floor(extract(epoch from(next_start-current_end))/86400);
  if gap_days<=10 then return false; end if;

  active:=jsonb_build_object(
    'id','calendar-'||closed_matchday||'-'||next_matchday,
    'title','Tiempo para reconstruir',
    'fromMatchday',closed_matchday,
    'toMatchday',next_matchday,
    'startsAt',current_end,
    'endsAt',next_start,
    'days',gap_days,
    'totalDays',gap_days,
    'preparationDays',least(3,gap_days-1),
    'activityDays',greatest(1,gap_days-least(3,gap_days-1)),
    'currentDay',1,
    'actions','[]'::jsonb,
    'source','calendar',
    'status','active'
  );
  next_state:=selected.state;
  next_state:=jsonb_set(next_state,'{activeInterlude}',active);
  next_state:=jsonb_set(next_state,'{currentLineup}','null'::jsonb);
  next_state:=next_state-'decisionPrompt';
  select coalesce(jsonb_agg(item),'[]'::jsonb) into filtered_history
  from jsonb_array_elements(coalesce(next_state->'promptHistory','[]'::jsonb)) item
  where coalesce((item->>'matchday')::integer,0)<>next_matchday;
  next_state:=jsonb_set(next_state,'{promptHistory}',filtered_history);

  update public.manager_career_lab_sessions
  set state=next_state,current_matchday=closed_matchday,phase='interlude',status='running',
      last_report=jsonb_build_object(
        'action','interlude','detail','Interludio automatico entre J'||closed_matchday||' y J'||next_matchday||' ('||gap_days||' dias).',
        'matchday',closed_matchday,'phaseBefore','played','phaseAfter','interlude',
        'checks',public.manager_career_lab_checks(next_state)
      ),updated_at=now()
  where id=selected.id;
  return true;
end $$;

alter function public.admin_step_manager_career_lab(uuid,text,jsonb)
  rename to admin_step_manager_career_lab_v3_base;

create or replace function public.admin_step_manager_career_lab(
  target_session_id uuid,
  target_action text,
  target_options jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  before_step public.manager_career_lab_sessions%rowtype;
  result jsonb;
begin
  perform public.manager_career_lab_assert_admin();
  select * into before_step from public.manager_career_lab_sessions
  where id=target_session_id and created_by=auth.uid();
  if not found then raise exception 'Laboratorio no disponible'; end if;

  result:=public.admin_step_manager_career_lab_v3_base(target_session_id,target_action,target_options);
  if target_action='close' and before_step.phase='played' then
    perform public.manager_career_lab_open_calendar_interlude(target_session_id,before_step.current_matchday);
    result:=public.admin_manager_career_lab_state(target_session_id);
  end if;
  return result;
end $$;

-- Repara cierres que acababan de avanzar a la siguiente jornada sin mostrar
-- el interludio. Solo se retrocede si el usuario aun no ha preparado el once ni
-- ha tomado una decision en esa nueva jornada.
do $$
declare session record; last_closed integer;
begin
  for session in select * from public.manager_career_lab_sessions
    where status='running' and phase='preparation' and current_matchday>1
      and state->'currentLineup' is null
      and not exists(
        select 1 from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) decision
        where coalesce((decision->>'matchday')::integer,0)=current_matchday
      )
  loop
    last_closed:=coalesce((session.state->'reports'->-1->>'matchday')::integer,session.current_matchday-1);
    if last_closed=session.current_matchday-1 then
      perform public.manager_career_lab_open_calendar_interlude(session.id,last_closed);
    end if;
  end loop;
end $$;

revoke all on function public.manager_career_lab_open_calendar_interlude(uuid,integer) from public,anon,authenticated;
grant execute on function public.manager_career_lab_open_calendar_interlude(uuid,integer) to service_role;
revoke all on function public.admin_step_manager_career_lab(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_step_manager_career_lab(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
