-- El observador del laboratorio reutiliza el editor y el mercado reales, pero opera solo sobre su estado aislado.
alter function public.manager_career_lab_public_action(text,text,jsonb)
  rename to manager_career_lab_public_action_v3_base;

create or replace function public.manager_career_lab_public_action(target_token text,target_action text,target_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
<<lab_action>>
declare
  selected public.manager_career_lab_sessions%rowtype;
  state jsonb;
  squad jsonb;
  player jsonb;
  player_ids jsonb;
  formation text;
  captain_id text;
  required_por integer; required_def integer; required_med integer; required_del integer;
  total_players integer; distinct_players integer; original_players integer;
  player_value numeric;
begin
  if target_action not in ('save_lineup','buy','sell') then
    return public.manager_career_lab_public_action_v3_base(target_token,target_action,target_payload);
  end if;

  select * into selected from public.manager_career_lab_sessions
  where preview_token=target_token and preview_enabled and status='running' and expires_at>now() for update;
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  if selected.phase<>'preparation' then raise exception 'La jornada está bloqueada hasta que se abra la siguiente'; end if;

  state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  squad:=coalesce(state->'squad','[]'::jsonb);

  if target_action='save_lineup' then
    formation:=coalesce(target_payload->>'formation','4-4-2');
    captain_id:=target_payload->>'captainId';
    player_ids:=coalesce(target_payload->'playerIds','[]'::jsonb);
    if jsonb_typeof(player_ids)<>'array' then raise exception 'La alineación no es válida'; end if;
    select count(*),count(distinct value) into total_players,distinct_players from jsonb_array_elements_text(player_ids);
    if total_players<>11 or distinct_players<>11 then raise exception 'Debes elegir once jugadores distintos'; end if;
    if not player_ids ? captain_id then raise exception 'El capitán debe formar parte del once'; end if;
    if formation='4-4-2' then required_por:=1;required_def:=4;required_med:=4;required_del:=2;
    elsif formation='4-3-3' then required_por:=1;required_def:=4;required_med:=3;required_del:=3;
    elsif formation='3-4-3' then required_por:=1;required_def:=3;required_med:=4;required_del:=3;
    elsif formation='3-5-2' then required_por:=1;required_def:=3;required_med:=5;required_del:=2;
    elsif formation='5-3-2' then required_por:=1;required_def:=5;required_med:=3;required_del:=2;
    else raise exception 'Formación no válida'; end if;
    if exists(select 1 from jsonb_array_elements_text(player_ids) id where not exists(select 1 from jsonb_array_elements(squad) item where item->>'id'=id.value and coalesce((item->>'active')::boolean,true))) then raise exception 'Algún jugador ya no pertenece a tu plantilla'; end if;
    if (select count(*) from jsonb_array_elements(squad) item where player_ids ? (item->>'id') and item->>'position'='POR')<>required_por
      or (select count(*) from jsonb_array_elements(squad) item where player_ids ? (item->>'id') and item->>'position'='DEF')<>required_def
      or (select count(*) from jsonb_array_elements(squad) item where player_ids ? (item->>'id') and item->>'position'='MED')<>required_med
      or (select count(*) from jsonb_array_elements(squad) item where player_ids ? (item->>'id') and item->>'position'='DEL')<>required_del then raise exception 'La alineación no respeta la formación'; end if;
    select count(*) into original_players from jsonb_array_elements(squad) item where player_ids ? (item->>'id') and coalesce((item->>'original')::boolean,false);
    if original_players<7 then raise exception 'Debes alinear al menos 7 jugadores originales'; end if;
    state:=jsonb_set(state,'{currentLineup}',jsonb_build_object(
      'formation',formation,'captainId',captain_id,'originals',original_players,'valid',true,'locked',false,
      'players',(select jsonb_agg(item order by ordinality) from jsonb_array_elements_text(player_ids) with ordinality ids(id,ordinality) join lateral (select value item from jsonb_array_elements(squad) value where value->>'id'=ids.id limit 1) found on true)
    ));
  elsif target_action='buy' then
    select jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'clubId',p.sports_club_id,'value',p.market_value,'photoUrl',p.photo_url,'original',false,'active',p.active)
      into player from public.players p join public.sports_clubs sc on sc.id=p.sports_club_id
      where p.id=target_payload->>'playerId' and p.competition_id=selected.competition_id and p.active;
    if player is null then raise exception 'Jugador no disponible'; end if;
    if exists(select 1 from jsonb_array_elements(squad) item where item->>'id'=player->>'id') then raise exception 'El jugador ya está en tu plantilla'; end if;
    if jsonb_array_length(squad)>=25 then raise exception 'Tu plantilla ya tiene 25 jugadores'; end if;
    player_value:=(player->>'value')::numeric;
    if (state->>'budget')::numeric<player_value then raise exception 'No tienes saldo suficiente'; end if;
    state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric-player_value));
    state:=jsonb_set(state,'{squad}',squad||jsonb_build_array(player));
  else
    select value into player from jsonb_array_elements(squad) value where value->>'id'=target_payload->>'playerId';
    if player is null then raise exception 'El jugador ya no está en tu plantilla'; end if;
    if jsonb_array_length(squad)<=11 then raise exception 'Debes conservar al menos once jugadores'; end if;
    if coalesce(state->'currentLineup'->'players','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id',player->>'id')) then raise exception 'No puedes vender un jugador alineado'; end if;
    select count(*) into original_players from jsonb_array_elements(squad) item where coalesce((item->>'original')::boolean,false);
    if coalesce((player->>'original')::boolean,false) and original_players<=8 then raise exception 'Debes conservar al menos 8 jugadores originales'; end if;
    player_value:=(player->>'value')::numeric;
    state:=jsonb_set(state,'{budget}',to_jsonb((state->>'budget')::numeric+player_value));
    state:=jsonb_set(state,'{squad}',coalesce((select jsonb_agg(item) from jsonb_array_elements(squad) item where item->>'id'<>player->>'id'),'[]'::jsonb));
  end if;

  update public.manager_career_lab_sessions target set state=lab_action.state,updated_at=now() where target.id=selected.id;
  return public.manager_career_lab_public_preview(target_token);
end $$;

create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype; safe_state jsonb; delegation jsonb; active jsonb; calendar_window jsonb; market_players jsonb;
begin
  select * into selected from public.manager_career_lab_sessions where preview_token=target_token and preview_enabled and status<>'archived' and expires_at>now();
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  safe_state:=public.manager_career_lab_seed_experience(selected.state,selected.difficulty,selected.current_matchday);
  delegation:=coalesce(safe_state->'delegation',jsonb_build_object('used',0,'maximum',5,'remaining',5,'cooldownMatchdays',3,'nextAvailableMatchday',1,'current',null));
  active:=safe_state->'activeInterlude';
  if active is not null then active:=active||jsonb_build_object('totalDays',greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14)),'preparationDays',3,'currentDay',greatest(1,coalesce((active->>'currentDay')::integer,1)),'activityDays',greatest(2,greatest(5,coalesce((active->>'totalDays')::integer,(active->>'days')::integer,14))-3),'actions',coalesce(active->'actions','[]'::jsonb)); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'clubId',p.sports_club_id,'value',p.market_value,'photoUrl',p.photo_url,'original',false,'active',p.active) order by p.position,p.name),'[]'::jsonb)
    into market_players from public.players p join public.sports_clubs sc on sc.id=p.sports_club_id
    where p.competition_id=selected.competition_id and p.active and not exists(select 1 from jsonb_array_elements(coalesce(safe_state->'squad','[]'::jsonb)) item where item->>'id'=p.id);
  with official as (select matchday,min(kickoff_at) original_start,max(kickoff_at) original_end from public.match_fixtures where competition_id=selected.competition_id and kickoff_at is not null and status<>'cancelled' group by matchday), rounds as (
    select o.matchday,coalesce((x.value->>'startAt')::timestamptz,o.original_start) start_at,coalesce((x.value->>'endAt')::timestamptz,o.original_end) end_at,x.value is not null edited from official o left join lateral (select value from jsonb_array_elements(coalesce(selected.state->'calendarOverrides','[]'::jsonb)) value where (value->>'matchday')::integer=o.matchday limit 1) x on true)
  select jsonb_build_object('current',(select jsonb_build_object('matchday',r.matchday,'startAt',r.start_at,'endAt',r.end_at,'edited',r.edited) from rounds r where r.matchday=selected.current_matchday),'next',(select jsonb_build_object('matchday',r.matchday,'startAt',r.start_at,'endAt',r.end_at,'edited',r.edited) from rounds r where r.matchday>selected.current_matchday order by r.matchday limit 1)) into calendar_window;
  return jsonb_build_object('session',jsonb_build_object('title',selected.title,'userName',(select display_name from public.profiles where id=selected.subject_user_id),'competitionId',selected.competition_id,'sportsClubName',(select name from public.sports_clubs where id=selected.sports_club_id),'difficulty',selected.difficulty,'status',selected.status,'matchday',selected.current_matchday,'maximumMatchday',selected.maximum_matchday,'phase',selected.phase,'updatedAt',selected.updated_at),
    'state',jsonb_build_object('budget',safe_state->'budget','confidence',safe_state->'confidence','reputation',safe_state->'reputation','sportingPoints',safe_state->'sportingPoints','objectivePoints',safe_state->'objectivePoints','consecutiveFailures',safe_state->'consecutiveFailures','dismissalThreshold',15,'status',safe_state->'status','squad',safe_state->'squad','market',market_players,'currentLineup',safe_state->'currentLineup','reports',safe_state->'reports','decisions',safe_state->'decisions','objectives',safe_state->'objectives','decisionPrompt',safe_state->'decisionPrompt','incidents',safe_state->'incidents','interludes',safe_state->'interludes','activeInterlude',active,'delegation',delegation,'calendarExceptions',safe_state->'calendarExceptions','calendar',calendar_window,'realSideEffects',0));
end $$;

revoke all on function public.manager_career_lab_public_action_v3_base(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.manager_career_lab_public_action(text,text,jsonb) from public;
grant execute on function public.manager_career_lab_public_action(text,text,jsonb) to anon,authenticated;
revoke all on function public.manager_career_lab_public_preview(text) from public;
grant execute on function public.manager_career_lab_public_preview(text) to anon,authenticated;
notify pgrst,'reload schema';
