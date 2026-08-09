-- Cada competicion puede tener su propio reto destacado.

create unique index if not exists leagues_one_featured_fantasy_per_competition_idx
  on public.leagues(competition_id)
  where mode = 'fantasy' and featured = true and status in ('open', 'live');

create or replace function public.admin_create_fantasy_challenge(
  challenge_name text, challenge_description text, challenge_format text, selected_fixture_ids text[],
  requested_lineup_policy text default 'fixed', requested_max_players_per_club integer default 6,
  requested_capacity integer default 500, requested_featured boolean default false, requested_budget_percentile integer default 60
) returns text language plpgsql security definer set search_path=public as $$
declare fixture_count integer; competition_count integer; season_count integer; selected_competition text;
  first_matchday integer; event_season text; new_league_id text:='challenge_'||replace(gen_random_uuid()::text,'-','');
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Acceso reservado a administradores'; end if;
  if char_length(trim(challenge_name)) not between 3 and 40 then raise exception 'El nombre debe tener entre 3 y 40 caracteres'; end if;
  if challenge_format not in ('partidazo','matches') then raise exception 'Formato no valido'; end if;
  if requested_lineup_policy not in ('fixed','per_matchday') then raise exception 'Politica de alineacion no valida'; end if;
  if requested_capacity not between 2 and 5000 or requested_max_players_per_club not between 1 and 11 then raise exception 'Configuracion no valida'; end if;
  if requested_budget_percentile not between 20 and 90 then raise exception 'Percentil no valido'; end if;
  select count(*),count(distinct competition_id),count(distinct season),min(competition_id),min(matchday),min(season)
  into fixture_count,competition_count,season_count,selected_competition,first_matchday,event_season
  from public.match_fixtures where id=any(selected_fixture_ids) and status<>'cancelled';
  if fixture_count<>cardinality(selected_fixture_ids) then raise exception 'Algun partido no esta disponible'; end if;
  if challenge_format='partidazo' and fixture_count<>1 then raise exception 'Una liga de un partido debe contener exactamente un encuentro'; end if;
  if challenge_format='matches' and fixture_count<2 then raise exception 'Una liga de varios partidos debe contener al menos dos encuentros'; end if;
  if competition_count<>1 or season_count<>1 then raise exception 'Todos los partidos deben pertenecer a la misma competicion y temporada'; end if;
  if requested_featured then
    update public.leagues set featured=false
     where mode='fantasy' and competition_id=selected_competition and featured=true;
  end if;
  insert into public.leagues(id,owner_id,competition_id,name,visibility,mode,roster_policy,accent,capacity,starting_budget,target_squad_value,featured,status,rules)
  values(new_league_id,auth.uid(),selected_competition,trim(challenge_name),'public','fantasy','repeatable','violet',requested_capacity,0,0,requested_featured,'open',jsonb_build_object('fantasyChallenge',true));
  insert into public.fantasy_challenges(league_id,description,format,lineup_policy,max_players_per_club,previous_matchday,budget_percentile,created_by)
  values(new_league_id,trim(challenge_description),challenge_format,case when challenge_format='partidazo' then 'fixed' else requested_lineup_policy end,requested_max_players_per_club,greatest(0,first_matchday-1),requested_budget_percentile,auth.uid());
  insert into public.fantasy_challenge_fixtures(league_id,fixture_id,slot_order)
  select new_league_id,fixture_id,ordinality from unnest(selected_fixture_ids) with ordinality selected(fixture_id,ordinality);
  if first_matchday=1 then
    insert into public.player_market_value_snapshots(competition_id,season,matchday,player_id,price)
    select selected_competition,event_season,0,p.id,p.market_value from public.players p where p.competition_id=selected_competition and p.active
    on conflict(competition_id,season,matchday,player_id) do nothing;
  end if;
  if exists(select 1 from public.player_market_value_snapshots where competition_id=selected_competition and season=event_season and matchday=greatest(0,first_matchday-1)) then
    perform public.rebuild_fantasy_challenge_snapshot(new_league_id);
  end if;
  return new_league_id;
end;
$$;

grant execute on function public.admin_create_fantasy_challenge(text,text,text,text[],text,integer,integer,boolean,integer) to authenticated;
