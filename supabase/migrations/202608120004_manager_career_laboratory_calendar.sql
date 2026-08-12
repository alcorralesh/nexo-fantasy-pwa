-- Calendario editable y deteccion de interludios, solo dentro del laboratorio.
create or replace function public.admin_manager_career_lab_calendar(target_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype;
begin
  perform public.manager_career_lab_assert_admin(); select * into selected from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid(); if not found then raise exception 'Laboratorio no disponible'; end if;
  return coalesce((with official as (
    select matchday,min(kickoff_at) original_start,max(kickoff_at) original_end from public.match_fixtures where competition_id=selected.competition_id and kickoff_at is not null group by matchday
  ), rounds as (
    select o.*,coalesce((x.value->>'startAt')::timestamptz,o.original_start) start_at,coalesce((x.value->>'endAt')::timestamptz,o.original_end) end_at,x.value is not null edited
    from official o left join lateral (select value from jsonb_array_elements(coalesce(selected.state->'calendarOverrides','[]'::jsonb)) value where (value->>'matchday')::integer=o.matchday limit 1) x on true
  ), gaps as (
    select r.*,extract(epoch from(r.start_at-lag(r.end_at) over(order by r.matchday)))/86400 gap_before from rounds r
  ) select jsonb_agg(jsonb_build_object('matchday',matchday,'originalStart',original_start,'originalEnd',original_end,'startAt',start_at,'endAt',end_at,'edited',edited,'gapBeforeDays',round(gap_before::numeric,1),'interludeDetected',gap_before>10) order by matchday) from gaps),'[]'::jsonb);
end $$;

create or replace function public.admin_update_manager_career_lab_calendar(target_session_id uuid,target_matchday integer,target_start_at timestamptz,target_end_at timestamptz,target_interlude_days integer default 10) returns jsonb
language plpgsql security definer set search_path=public as $$
<<calendar_update>>
declare selected public.manager_career_lab_sessions%rowtype; state jsonb; overrides jsonb; calendar jsonb; row jsonb; gap numeric; previous_end timestamptz;
begin
  perform public.manager_career_lab_assert_admin(); select * into selected from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid() for update; if not found then raise exception 'Laboratorio no disponible'; end if;
  if target_start_at is null or target_end_at is null or target_end_at<target_start_at then raise exception 'Fechas no validas'; end if;
  state:=selected.state; select coalesce(jsonb_agg(item),'[]'::jsonb) into overrides from jsonb_array_elements(coalesce(state->'calendarOverrides','[]'::jsonb)) item where (item->>'matchday')::integer<>target_matchday;
  overrides:=overrides||jsonb_build_array(jsonb_build_object('matchday',target_matchday,'startAt',target_start_at,'endAt',target_end_at,'editedAt',now())); state:=jsonb_set(state,'{calendarOverrides}',overrides);
  update public.manager_career_lab_sessions target set state=calendar_update.state,updated_at=now() where target.id=selected.id;
  delete from public.manager_career_lab_events where session_id=selected.id and event_type='interlude' and payload->>'source'='calendar_lab' and status='scheduled';
  calendar:=public.admin_manager_career_lab_calendar(selected.id);
  for row in select value from jsonb_array_elements(calendar) loop
    gap:=coalesce((row->>'gapBeforeDays')::numeric,0);
    if gap>target_interlude_days then
      insert into public.manager_career_lab_events(session_id,matchday,moment,event_type,title,payload) values(selected.id,(row->>'matchday')::integer,'before_preparation','interlude','Descanso prolongado de '||floor(gap)||' dias',jsonb_build_object('days',floor(gap),'strategy','recovery','source','calendar_lab'));
    end if;
  end loop;
  perform public.manager_career_lab_log(selected.id,'calendar','Calendario de laboratorio actualizado','Jornada '||target_matchday||' movida. Los interludios se han recalculado.',selected.state,state,'success');
  return public.admin_manager_career_lab_state(selected.id);
end $$;

grant execute on function public.admin_manager_career_lab_calendar(uuid) to authenticated;
grant execute on function public.admin_update_manager_career_lab_calendar(uuid,integer,timestamptz,timestamptz,integer) to authenticated;
notify pgrst,'reload schema';
