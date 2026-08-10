-- Historial cerrado de jornada para el usuario autenticado.
-- Devuelve la instantanea, el resultado y el desglose real sin exponer datos privados ajenos.

create or replace function public.my_matchday_history()
returns table (
  membership_id uuid,
  league_id text,
  competition_id text,
  season text,
  matchday integer,
  state text,
  formation text,
  captain_player_id text,
  source text,
  valid boolean,
  starter_count integer,
  points numeric,
  payout numeric,
  calculated_at timestamptz,
  rank integer,
  league_average numeric,
  best_score numeric,
  players jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    snapshot.membership_id,
    snapshot.league_id,
    round.competition_id,
    round.season,
    round.matchday::integer,
    round.state,
    snapshot.formation,
    snapshot.captain_player_id,
    snapshot.source,
    snapshot.valid,
    snapshot.starter_count::integer,
    coalesce(result.points, 0),
    coalesce(result.payout, 0),
    result.calculated_at,
    case when result.membership_id is null then null else (
      select 1 + count(*)::integer
      from public.matchday_member_results rival
      where rival.matchday_id = result.matchday_id
        and rival.league_id = result.league_id
        and rival.points > result.points
    ) end,
    coalesce((
      select round(avg(rival.points), 2)
      from public.matchday_member_results rival
      where rival.matchday_id = snapshot.matchday_id
        and rival.league_id = snapshot.league_id
    ), 0),
    coalesce((
      select max(rival.points)
      from public.matchday_member_results rival
      where rival.matchday_id = snapshot.matchday_id
        and rival.league_id = snapshot.league_id
    ), 0),
    coalesce(detail.players, '[]'::jsonb)
  from public.matchday_lineup_snapshots snapshot
  join public.league_memberships membership
    on membership.id = snapshot.membership_id and membership.user_id = auth.uid()
  join public.competition_matchdays round on round.id = snapshot.matchday_id
  left join public.matchday_member_results result
    on result.matchday_id = snapshot.matchday_id
    and result.membership_id = snapshot.membership_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'playerId', player.id,
        'name', player.name,
        'initials', player.initials,
        'position', player.position,
        'club', club.name,
        'photoUrl', player.photo_url,
        'role', selected.role,
        'slotOrder', selected.slot_order,
        'isCaptain', selected.is_captain,
        'rawPoints', coalesce(player_points.points, 0),
        'multiplier', case when selected.is_captain then config.captain_multiplier else 1 end,
        'points', coalesce(player_points.points, 0)
          * case when selected.is_captain then config.captain_multiplier else 1 end
      ) order by selected.slot_order
    ) as players
    from public.matchday_lineup_snapshot_players selected
    join public.players player on player.id = selected.player_id
    join public.sports_clubs club on club.id = player.sports_club_id
    cross join public.matchday_lifecycle_config config
    left join public.player_matchday_points player_points
      on player_points.competition_id = round.competition_id
      and player_points.season = round.season
      and player_points.matchday = round.matchday
      and player_points.player_id = selected.player_id
      and player_points.scoring_version = snapshot.scoring_version
    where selected.snapshot_id = snapshot.id
  ) detail on true
  where auth.uid() is not null
  order by snapshot.league_id, round.matchday;
$$;

revoke all on function public.my_matchday_history() from public, anon;
grant execute on function public.my_matchday_history() to authenticated, service_role;
notify pgrst, 'reload schema';
