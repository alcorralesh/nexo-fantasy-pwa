-- Ranking asíncrono y comparable entre mánagers del mismo equipo real.

create or replace function public.manager_career_same_club_ranking(target_career_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare target public.manager_careers%rowtype; completed integer; result jsonb;
begin
  select * into target from public.manager_careers where id=target_career_id and owner_id=auth.uid();
  if not found then raise exception 'Carrera no disponible'; end if;
  if not (select same_club_ranking_enabled from public.manager_career_rules where id) then return jsonb_build_object('enabled',false,'rows','[]'::jsonb); end if;
  select count(*) into completed from public.manager_career_lineups where career_id=target.id and settled_at is not null;
  with comparable as (
    select c.id,c.owner_id,c.status,c.reputation,c.board_confidence,c.objective_points,c.budget,
      stats.completed_matchdays,stats.total_points,stats.average_points,stats.best_matchday,objectives.completed_objectives
    from public.manager_careers c
    cross join lateral (select count(*)::integer completed_matchdays,coalesce(sum(points),0)::numeric total_points,coalesce(avg(points),0)::numeric average_points,coalesce(max(points),0)::numeric best_matchday from public.manager_career_lineups where career_id=c.id and settled_at is not null) stats
    cross join lateral (select count(*)::integer completed_objectives from public.manager_career_objectives where career_id=c.id and status='completed') objectives
    where c.sports_club_id=target.sports_club_id and c.competition_id=target.competition_id and c.season_label=target.season_label and c.difficulty=target.difficulty and c.status in ('active','completed','dismissed')
      and stats.completed_matchdays=completed
  ), ranked as (
    select comparable.*,dense_rank() over(order by total_points desc,completed_objectives desc,board_confidence desc) position
    from comparable
  )
  select jsonb_build_object(
    'enabled',true,'completedMatchdays',completed,'totalManagers',(select count(*) from ranked),
    'rows',coalesce(jsonb_agg(jsonb_build_object('careerId',ranked.id,'position',ranked.position,'managerName',profile.display_name,'initials',profile.initials,'status',ranked.status,'totalPoints',ranked.total_points,'averagePoints',round(ranked.average_points,1),'bestMatchday',ranked.best_matchday,'reputation',ranked.reputation,'confidence',ranked.board_confidence,'completedObjectives',ranked.completed_objectives,'budget',ranked.budget,'isCurrent',ranked.id=target.id) order by ranked.position,profile.display_name),'[]'::jsonb)
  ) into result from ranked join public.profiles profile on profile.id=ranked.owner_id;
  return coalesce(result,jsonb_build_object('enabled',true,'completedMatchdays',completed,'totalManagers',0,'rows','[]'::jsonb));
end $$;

revoke all on function public.manager_career_same_club_ranking(uuid) from public,anon;
grant execute on function public.manager_career_same_club_ranking(uuid) to authenticated;
notify pgrst,'reload schema';
