-- Clasificaciones reales visibles únicamente para participantes de la misma liga.

create or replace function public.my_league_rankings()
returns table (
  membership_id uuid,
  league_id text,
  user_id uuid,
  team_id uuid,
  team_name text,
  team_short_name text,
  manager_name text,
  initials text,
  member_role text,
  total_points numeric,
  matchday_points numeric,
  total_value numeric,
  ranking_position bigint,
  squad jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with accessible_leagues as (
    select distinct mine.league_id
      from public.league_memberships mine
     where mine.user_id = auth.uid() and mine.left_at is null
  ), scored as (
    select membership.id as membership_id, membership.league_id, membership.user_id, membership.team_id,
           team.name as team_name, team.short_name as team_short_name,
           profile.display_name as manager_name, profile.initials, membership.role as member_role,
           coalesce(sum(result.points), 0)::numeric as total_points,
           coalesce((
             select latest.points
               from public.matchday_member_results latest
               join public.competition_matchdays round on round.id = latest.matchday_id
              where latest.membership_id = membership.id
              order by round.season desc, round.matchday desc
              limit 1
           ), 0)::numeric as matchday_points,
           coalesce(roster.total_value, 0)::numeric as total_value,
           case when roster.id is null then null else public.market_roster_payload(roster.id)->'squad' end as squad,
           membership.joined_at
      from public.league_memberships membership
      join accessible_leagues accessible on accessible.league_id = membership.league_id
      join public.teams team on team.id = membership.team_id
      join public.profiles profile on profile.id = membership.user_id
      left join public.matchday_member_results result on result.membership_id = membership.id
      left join public.league_rosters roster on roster.membership_id = membership.id
     where membership.left_at is null
     group by membership.id, team.id, profile.id, roster.id
  )
  select scored.membership_id, scored.league_id, scored.user_id, scored.team_id,
         scored.team_name, scored.team_short_name, scored.manager_name, scored.initials,
         scored.member_role, scored.total_points, scored.matchday_points, scored.total_value,
         row_number() over (partition by scored.league_id order by scored.total_points desc, scored.joined_at, scored.membership_id),
         scored.squad
    from scored
   order by scored.league_id, total_points desc, scored.joined_at;
$$;

revoke all on function public.my_league_rankings() from public, anon;
grant execute on function public.my_league_rankings() to authenticated;

