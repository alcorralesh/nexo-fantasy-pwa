-- Lectura administrativa de los puntos definitivos por jornada.

create or replace function public.admin_player_matchday_points(target_competition_id text,target_matchday integer)
returns table(player_id text,points numeric,calculated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administración puede consultar este desglose'; end if;
  return query
  select distinct on (score.player_id) score.player_id,score.points,score.calculated_at
  from public.player_matchday_points score
  join public.competition_matchdays round on round.competition_id=score.competition_id and round.season=score.season and round.matchday=score.matchday and round.scoring_version=score.scoring_version
  where score.competition_id=target_competition_id and score.matchday=target_matchday
  order by score.player_id,score.calculated_at desc;
end $$;

revoke all on function public.admin_player_matchday_points(text,integer) from public,anon;
grant execute on function public.admin_player_matchday_points(text,integer) to authenticated;
notify pgrst,'reload schema';
