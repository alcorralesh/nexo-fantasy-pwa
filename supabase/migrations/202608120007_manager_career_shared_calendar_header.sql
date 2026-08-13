-- Expone la ventana de la jornada actual y la siguiente al observador del laboratorio.
create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  selected public.manager_career_lab_sessions%rowtype;
  safe_state jsonb;
  delegation jsonb;
  active jsonb;
  calendar_window jsonb;
begin
  select * into selected
  from public.manager_career_lab_sessions
  where preview_token=target_token and preview_enabled and status<>'archived' and expires_at>now();
  if not found then raise exception 'Vista de prueba no disponible'; end if;

  safe_state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  delegation:=coalesce(safe_state->'delegation',jsonb_build_object('used',0,'maximum',5,'remaining',5,'cooldownMatchdays',3,'nextAvailableMatchday',1,'current',null));
  active:=safe_state->'activeInterlude';
  if active is not null then
    active:=active||jsonb_build_object(
      'totalDays',greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14)),
      'preparationDays',3,
      'currentDay',greatest(1,coalesce((active->>'currentDay')::integer,1)),
      'activityDays',greatest(2,greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14))-3),
      'actions',coalesce(active->'actions','[]'::jsonb)
    );
  end if;

  with official as (
    select matchday,min(kickoff_at) original_start,max(kickoff_at) original_end
    from public.match_fixtures
    where competition_id=selected.competition_id and kickoff_at is not null and status<>'cancelled'
    group by matchday
  ), rounds as (
    select o.matchday,
      coalesce((x.value->>'startAt')::timestamptz,o.original_start) start_at,
      coalesce((x.value->>'endAt')::timestamptz,o.original_end) end_at,
      x.value is not null edited
    from official o
    left join lateral (
      select value from jsonb_array_elements(coalesce(selected.state->'calendarOverrides','[]'::jsonb)) value
      where (value->>'matchday')::integer=o.matchday limit 1
    ) x on true
  )
  select jsonb_build_object(
    'current',(select jsonb_build_object('matchday',r.matchday,'startAt',r.start_at,'endAt',r.end_at,'edited',r.edited) from rounds r where r.matchday=selected.current_matchday),
    'next',(select jsonb_build_object('matchday',r.matchday,'startAt',r.start_at,'endAt',r.end_at,'edited',r.edited) from rounds r where r.matchday>selected.current_matchday order by r.matchday limit 1)
  ) into calendar_window;

  return jsonb_build_object(
    'session',jsonb_build_object(
      'title',selected.title,
      'userName',(select display_name from public.profiles where id=selected.subject_user_id),
      'competitionId',selected.competition_id,
      'sportsClubName',(select name from public.sports_clubs where id=selected.sports_club_id),
      'difficulty',selected.difficulty,
      'status',selected.status,
      'matchday',selected.current_matchday,
      'maximumMatchday',selected.maximum_matchday,
      'phase',selected.phase,
      'updatedAt',selected.updated_at
    ),
    'state',jsonb_build_object(
      'budget',safe_state->'budget','confidence',safe_state->'confidence','reputation',safe_state->'reputation','sportingPoints',safe_state->'sportingPoints','objectivePoints',safe_state->'objectivePoints',
      'consecutiveFailures',safe_state->'consecutiveFailures','dismissalThreshold',15,'status',safe_state->'status','squad',safe_state->'squad','currentLineup',safe_state->'currentLineup',
      'reports',safe_state->'reports','decisions',safe_state->'decisions','objectives',safe_state->'objectives','decisionPrompt',safe_state->'decisionPrompt','incidents',safe_state->'incidents',
      'interludes',safe_state->'interludes','activeInterlude',active,'delegation',delegation,'calendarExceptions',safe_state->'calendarExceptions','calendar',calendar_window,'realSideEffects',0
    )
  );
end $$;

revoke all on function public.manager_career_lab_public_preview(text) from public;
grant execute on function public.manager_career_lab_public_preview(text) to anon,authenticated;
notify pgrst,'reload schema';
