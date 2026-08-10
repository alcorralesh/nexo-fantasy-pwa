create or replace function public.admin_lock_matchday(
  target_competition_id text,
  target_season text,
  target_matchday integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record public.competition_matchdays;
  member_record record;
  draft_record public.matchday_lineup_drafts;
  roster_record public.league_rosters;
  snapshot_id uuid;
  fallback_captain text;
  snapshot_count integer := 0;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Acceso reservado a administradores';
  end if;

  select * into round_record
  from public.competition_matchdays
  where competition_id = target_competition_id
    and season = target_season
    and matchday = target_matchday
  for update;

  if round_record.id is null then
    raise exception 'La jornada indicada no existe';
  end if;

  if round_record.state <> 'open' then
    return jsonb_build_object(
      'competitionId', target_competition_id,
      'season', target_season,
      'matchday', target_matchday,
      'state', round_record.state,
      'alreadyLocked', true,
      'snapshots', (
        select count(*) from public.matchday_lineup_snapshots
        where matchday_id = round_record.id
      )
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(round_record.id::text, 0));

  for member_record in
    select membership.*, league.competition_id
    from public.league_memberships membership
    join public.leagues league on league.id = membership.league_id
    where league.competition_id = round_record.competition_id
      and membership.left_at is null
  loop
    select * into draft_record
    from public.matchday_lineup_drafts
    where membership_id = member_record.id
      and season = round_record.season
      and matchday = round_record.matchday;

    select * into roster_record
    from public.league_rosters
    where membership_id = member_record.id;

    fallback_captain := null;
    if draft_record.id is null and roster_record.id is not null then
      select roster_player.player_id into fallback_captain
      from public.league_roster_players roster_player
      join public.players player on player.id = roster_player.player_id
      where roster_player.roster_id = roster_record.id
        and roster_player.is_starter
      order by case when player.position = 'DEL' then 0 else 1 end,
        roster_player.slot_order
      limit 1;
    end if;

    insert into public.matchday_lineup_snapshots (
      matchday_id,
      membership_id,
      league_id,
      team_id,
      formation,
      captain_player_id,
      source,
      valid,
      starter_count,
      scoring_version
    ) values (
      round_record.id,
      member_record.id,
      member_record.league_id,
      member_record.team_id,
      coalesce(draft_record.formation, roster_record.formation, '4-4-2'),
      coalesce(draft_record.captain_player_id, fallback_captain),
      case
        when draft_record.id is not null then 'saved_draft'
        when roster_record.id is not null then 'roster_fallback'
        else 'empty'
      end,
      draft_record.id is not null or roster_record.id is not null,
      case
        when draft_record.id is not null then cardinality(draft_record.starter_player_ids)
        when roster_record.id is not null then (
          select count(*)
          from public.league_roster_players
          where roster_id = roster_record.id and is_starter
        )
        else 0
      end,
      round_record.scoring_version
    )
    on conflict (matchday_id, membership_id) do nothing
    returning id into snapshot_id;

    if snapshot_id is not null and draft_record.id is not null then
      insert into public.matchday_lineup_snapshot_players (
        snapshot_id, player_id, slot_order, role, is_captain
      )
      select
        snapshot_id,
        listed.player_id,
        listed.slot_order,
        'starter',
        listed.player_id = draft_record.captain_player_id
      from unnest(draft_record.starter_player_ids)
        with ordinality listed(player_id, slot_order);

      insert into public.matchday_lineup_snapshot_players (
        snapshot_id, player_id, slot_order, role, is_captain
      )
      select
        snapshot_id,
        listed.player_id,
        cardinality(draft_record.starter_player_ids) + listed.slot_order,
        'bench',
        false
      from unnest(draft_record.bench_player_ids)
        with ordinality listed(player_id, slot_order);
    elsif snapshot_id is not null and roster_record.id is not null then
      insert into public.matchday_lineup_snapshot_players (
        snapshot_id, player_id, slot_order, role, is_captain
      )
      select
        snapshot_id,
        roster_player.player_id,
        roster_player.slot_order,
        case when roster_player.is_starter then 'starter' else 'bench' end,
        roster_player.player_id = fallback_captain
      from public.league_roster_players roster_player
      where roster_player.roster_id = roster_record.id
      order by roster_player.slot_order;
    end if;

    if snapshot_id is not null then
      snapshot_count := snapshot_count + 1;
    end if;
    snapshot_id := null;
    draft_record := null;
    roster_record := null;
  end loop;

  update public.competition_matchdays
  set state = 'locked', locked_at = now(), updated_at = now()
  where id = round_record.id and state = 'open';

  return jsonb_build_object(
    'competitionId', target_competition_id,
    'season', target_season,
    'matchday', target_matchday,
    'state', 'locked',
    'alreadyLocked', false,
    'snapshots', snapshot_count
  );
end;
$$;

revoke all on function public.admin_lock_matchday(text, text, integer)
from public, anon, authenticated;
grant execute on function public.admin_lock_matchday(text, text, integer)
to authenticated;
