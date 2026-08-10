-- Tendencias agregadas de Carrera por competición y equipo real.
-- No devuelve identidades ni decisiones individuales.

create or replace function public.manager_career_trends(target_competition_id text)
returns table(
  sports_club_id text,
  sports_club_name text,
  manager_count bigint,
  active_careers bigint,
  completed_careers bigint,
  dismissed_careers bigint,
  settled_matchdays bigint,
  average_points numeric,
  best_matchday numeric,
  average_reputation numeric,
  average_confidence numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with career_stats as (
    select
      career.id,
      career.sports_club_id,
      career.status,
      career.reputation,
      career.board_confidence,
      coalesce(lineups.settled_matchdays, 0) settled_matchdays,
      coalesce(lineups.total_points, 0) total_points,
      coalesce(lineups.best_matchday, 0) best_matchday
    from public.manager_careers career
    left join lateral (
      select
        count(*) filter (where lineup.settled_at is not null) settled_matchdays,
        coalesce(sum(lineup.points) filter (where lineup.settled_at is not null), 0) total_points,
        coalesce(max(lineup.points) filter (where lineup.settled_at is not null), 0) best_matchday
      from public.manager_career_lineups lineup
      where lineup.career_id = career.id
    ) lineups on true
    where replace(career.competition_id, '-', '_') = replace(target_competition_id, '-', '_')
      and career.status in ('active', 'completed', 'dismissed')
  )
  select
    sports.id,
    sports.name,
    count(*) manager_count,
    count(*) filter (where stats.status = 'active') active_careers,
    count(*) filter (where stats.status = 'completed') completed_careers,
    count(*) filter (where stats.status = 'dismissed') dismissed_careers,
    sum(stats.settled_matchdays) settled_matchdays,
    round(
      coalesce(sum(stats.total_points) / nullif(sum(stats.settled_matchdays), 0), 0),
      1
    ) average_points,
    max(stats.best_matchday) best_matchday,
    round(avg(stats.reputation), 1) average_reputation,
    round(avg(stats.board_confidence), 1) average_confidence
  from career_stats stats
  join public.sports_clubs sports on sports.id = stats.sports_club_id
  group by sports.id, sports.name
  order by
    count(*) desc,
    sum(stats.settled_matchdays) desc,
    average_points desc,
    sports.name;
$$;

revoke all on function public.manager_career_trends(text) from public, anon;
grant execute on function public.manager_career_trends(text) to authenticated;
notify pgrst, 'reload schema';
