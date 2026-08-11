-- Edicion segura de retos y alta idempotente de carreras.

create or replace function public.admin_update_fantasy_challenge(
  target_league_id text,
  challenge_name text,
  challenge_description text,
  selected_fixture_ids text[],
  requested_lineup_policy text,
  requested_max_players_per_club integer,
  requested_capacity integer,
  requested_featured boolean,
  requested_budget_percentile integer
) returns void language plpgsql security definer set search_path=public as $$
declare
  selected_challenge public.fantasy_challenges%rowtype;
  fixture_count integer;
  competition_count integer;
  season_count integer;
  selected_competition text;
  first_matchday integer;
  selected_format text;
  current_members integer;
  has_snapshot boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  select * into selected_challenge from public.fantasy_challenges where league_id=target_league_id for update;
  if not found then raise exception 'El reto ya no existe'; end if;
  has_snapshot:=selected_challenge.snapshot_id is not null;
  select count(*) into current_members from public.league_memberships where league_id=target_league_id and left_at is null;
  if char_length(trim(challenge_name)) not between 3 and 40 then raise exception 'El nombre debe tener entre 3 y 40 caracteres'; end if;
  if requested_capacity<greatest(2,current_members) or requested_capacity>5000 then raise exception 'La capacidad no puede ser inferior a los inscritos'; end if;
  if requested_max_players_per_club not between 1 and 11 then raise exception 'Maximo por club no valido'; end if;
  if requested_budget_percentile not between 20 and 90 then raise exception 'Percentil no valido'; end if;

  if has_snapshot then
    if selected_fixture_ids is distinct from array(select fixture_id from public.fantasy_challenge_fixtures where league_id=target_league_id order by slot_order)
      or requested_budget_percentile<>selected_challenge.budget_percentile then
      raise exception 'Los partidos y precios ya estan congelados; solo puedes editar nombre, descripcion, capacidad y visibilidad';
    end if;
  else
    select count(*),count(distinct competition_id),count(distinct season),min(competition_id),min(matchday)
      into fixture_count,competition_count,season_count,selected_competition,first_matchday
      from public.match_fixtures where id=any(selected_fixture_ids) and status<>'cancelled';
    if fixture_count<>cardinality(selected_fixture_ids) then raise exception 'Algun partido no esta disponible'; end if;
    selected_format:=selected_challenge.format;
    if selected_format='partidazo' and fixture_count<>1 then raise exception 'El Partidazo debe contener exactamente un encuentro'; end if;
    if selected_format='matches' and fixture_count<2 then raise exception 'Selecciona al menos dos encuentros'; end if;
    if competition_count<>1 or season_count<>1 then raise exception 'Todos los partidos deben pertenecer a la misma competicion y temporada'; end if;
    if selected_competition<>(select competition_id from public.leagues where id=target_league_id) then raise exception 'No se puede cambiar la competicion del reto'; end if;
    delete from public.fantasy_challenge_fixtures where league_id=target_league_id;
    insert into public.fantasy_challenge_fixtures(league_id,fixture_id,slot_order)
      select target_league_id,fixture_id,ordinality from unnest(selected_fixture_ids) with ordinality chosen(fixture_id,ordinality);
    update public.fantasy_challenges set
      lineup_policy=case when selected_format='partidazo' then 'fixed' else requested_lineup_policy end,
      max_players_per_club=requested_max_players_per_club,
      previous_matchday=greatest(0,first_matchday-1),
      budget_percentile=requested_budget_percentile
      where league_id=target_league_id;
  end if;

  if requested_featured then
    update public.leagues set featured=false where id<>target_league_id and mode='fantasy'
      and competition_id=(select competition_id from public.leagues where id=target_league_id) and featured;
  end if;
  update public.leagues set name=trim(challenge_name),capacity=requested_capacity,featured=requested_featured where id=target_league_id;
  update public.fantasy_challenges set description=trim(challenge_description),max_players_per_club=requested_max_players_per_club where league_id=target_league_id;
end $$;

revoke all on function public.admin_update_fantasy_challenge(text,text,text,text[],text,integer,integer,boolean,integer) from public,anon;
grant execute on function public.admin_update_fantasy_challenge(text,text,text,text[],text,integer,integer,boolean,integer) to authenticated;

-- Evita que un doble toque o una recarga termine en un error de unicidad.
create or replace function public.create_manager_career(target_club_id uuid,target_sports_club_id text,target_difficulty text default 'balanced') returns uuid
language plpgsql security definer set search_path=public as $$
declare selected_owner_id uuid:=auth.uid(); selected_competition text; new_career_id uuid; existing_career_id uuid; initial_career_budget numeric; player_count integer;
begin
  if selected_owner_id is null then raise exception 'Debes iniciar sesion'; end if;
  if target_difficulty not in ('relaxed','balanced','elite') then raise exception 'Dificultad no valida'; end if;
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=selected_owner_id and active) then raise exception 'El club no te pertenece'; end if;
  select competition_id into selected_competition from public.sports_clubs where id=target_sports_club_id and active;
  if selected_competition is null then raise exception 'Equipo real no disponible'; end if;
  select id into existing_career_id from public.manager_careers
    where owner_id=selected_owner_id and club_id=target_club_id and competition_id=selected_competition
      and sports_club_id=target_sports_club_id and season_label='26/27' and status='active'
    order by created_at desc limit 1;
  if existing_career_id is not null then return existing_career_id; end if;
  select count(*) into player_count from public.players where sports_club_id=target_sports_club_id and active;
  if player_count<11 then raise exception 'El equipo no tiene una plantilla suficiente'; end if;
  select initial_budget into initial_career_budget from public.manager_career_rules where id;
  insert into public.manager_careers(owner_id,club_id,competition_id,sports_club_id,difficulty,budget)
    values(selected_owner_id,target_club_id,selected_competition,target_sports_club_id,target_difficulty,initial_career_budget)
    returning id into new_career_id;
  insert into public.manager_career_players(career_id,player_id,acquisition_value)
    select new_career_id,id,market_value from public.players where sports_club_id=target_sports_club_id and active;
  perform public.build_manager_career_contract(new_career_id,true);
  insert into public.manager_career_events(career_id,event_type,title,detail,reputation_change)
    values(new_career_id,'start','Comienza una nueva era','La directiva te entrega el equipo y un contrato adaptado a su nivel.',0);
  return new_career_id;
exception when unique_violation then
  select id into existing_career_id from public.manager_careers
    where owner_id=selected_owner_id and club_id=target_club_id and competition_id=selected_competition
      and sports_club_id=target_sports_club_id and season_label='26/27' and status='active'
    order by created_at desc limit 1;
  if existing_career_id is not null then return existing_career_id; end if;
  raise;
end $$;
