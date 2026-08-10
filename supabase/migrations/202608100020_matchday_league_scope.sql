-- Cada liga solo participa en las jornadas que le corresponden y solo las
-- ligas de mercado convierten puntos en saldo acumulable.

create or replace function public.league_participates_in_matchday(
  target_league_id text,
  target_competition_id text,
  target_season text,
  target_matchday integer
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1 from public.fantasy_challenges challenge
      where challenge.league_id = target_league_id
    ) then true
    else exists (
      select 1
      from public.fantasy_challenge_fixtures selected
      join public.match_fixtures fixture on fixture.id = selected.fixture_id
      where selected.league_id = target_league_id
        and fixture.competition_id = target_competition_id
        and fixture.season = target_season
        and fixture.matchday = target_matchday
    )
  end;
$$;

create or replace function public.snapshot_matchday_lineups(target_matchday_id uuid)
returns integer
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
  select * into round_record
  from public.competition_matchdays
  where id = target_matchday_id;
  if not found then raise exception 'La jornada indicada no existe'; end if;

  for member_record in
    select membership.*, league.mode
    from public.league_memberships membership
    join public.leagues league on league.id = membership.league_id
    where league.competition_id = round_record.competition_id
      and membership.left_at is null
      and public.league_participates_in_matchday(
        league.id, round_record.competition_id, round_record.season, round_record.matchday
      )
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
      where roster_player.roster_id = roster_record.id and roster_player.is_starter
      order by case when player.position = 'DEL' then 0 else 1 end, roster_player.slot_order
      limit 1;
    end if;

    insert into public.matchday_lineup_snapshots (
      matchday_id, membership_id, league_id, team_id, formation, captain_player_id,
      source, valid, starter_count, scoring_version
    ) values (
      round_record.id, member_record.id, member_record.league_id, member_record.team_id,
      coalesce(draft_record.formation, roster_record.formation, '4-4-2'),
      coalesce(draft_record.captain_player_id, fallback_captain),
      case when draft_record.id is not null then 'saved_draft'
           when roster_record.id is not null then 'roster_fallback' else 'empty' end,
      draft_record.id is not null or roster_record.id is not null,
      case when draft_record.id is not null then cardinality(draft_record.starter_player_ids)
           when roster_record.id is not null then (
             select count(*) from public.league_roster_players
             where roster_id = roster_record.id and is_starter
           ) else 0 end,
      round_record.scoring_version
    ) on conflict (matchday_id, membership_id) do nothing
    returning id into snapshot_id;

    if snapshot_id is not null and draft_record.id is not null then
      insert into public.matchday_lineup_snapshot_players (snapshot_id, player_id, slot_order, role, is_captain)
      select snapshot_id, listed.player_id, listed.slot_order, 'starter', listed.player_id = draft_record.captain_player_id
      from unnest(draft_record.starter_player_ids) with ordinality listed(player_id, slot_order);
      insert into public.matchday_lineup_snapshot_players (snapshot_id, player_id, slot_order, role, is_captain)
      select snapshot_id, listed.player_id, cardinality(draft_record.starter_player_ids) + listed.slot_order, 'bench', false
      from unnest(draft_record.bench_player_ids) with ordinality listed(player_id, slot_order);
    elsif snapshot_id is not null and roster_record.id is not null then
      insert into public.matchday_lineup_snapshot_players (snapshot_id, player_id, slot_order, role, is_captain)
      select snapshot_id, roster_player.player_id, roster_player.slot_order,
        case when roster_player.is_starter then 'starter' else 'bench' end,
        roster_player.player_id = fallback_captain
      from public.league_roster_players roster_player
      where roster_player.roster_id = roster_record.id
      order by roster_player.slot_order;
    end if;

    if snapshot_id is not null then snapshot_count := snapshot_count + 1; end if;
    snapshot_id := null; draft_record := null; roster_record := null;
  end loop;
  return snapshot_count;
end;
$$;

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
  snapshot_count integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  select * into round_record from public.competition_matchdays
  where competition_id=target_competition_id and season=target_season and matchday=target_matchday
  for update;
  if not found then raise exception 'La jornada indicada no existe'; end if;
  if round_record.state <> 'open' then
    return jsonb_build_object('competitionId',target_competition_id,'season',target_season,
      'matchday',target_matchday,'state',round_record.state,'alreadyLocked',true,
      'snapshots',(select count(*) from public.matchday_lineup_snapshots where matchday_id=round_record.id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
  snapshot_count := public.snapshot_matchday_lineups(round_record.id);
  update public.competition_matchdays set state='locked',locked_at=now(),updated_at=now()
  where id=round_record.id and state='open';
  return jsonb_build_object('competitionId',target_competition_id,'season',target_season,
    'matchday',target_matchday,'state','locked','alreadyLocked',false,'snapshots',snapshot_count);
end;
$$;

create or replace function public.process_matchday_lifecycle(processed_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record record;
  locked_count integer := 0;
  closed_count integer := 0;
  payout_record record;
begin
  perform public.refresh_matchday_windows();
  for round_record in
    select * from public.competition_matchdays
    where state='open' and lock_at<=processed_at order by lock_at for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
    perform public.snapshot_matchday_lineups(round_record.id);
    update public.competition_matchdays set state='locked',locked_at=processed_at,updated_at=now()
    where id=round_record.id and state='open';
    locked_count := locked_count + 1;
  end loop;

  update public.competition_matchdays round set state='awaiting_stats',updated_at=now()
  where round.state='locked' and round.fixture_count>0
    and round.final_fixture_count=round.fixture_count and round.stats_ready_count<round.fixture_count;

  for round_record in
    select * from public.competition_matchdays
    where state in ('locked','awaiting_stats') and fixture_count>0 and stats_ready_count=fixture_count
    order by matchday for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
    insert into public.matchday_member_results (matchday_id,membership_id,league_id,points,payout)
    select round_record.id,snapshot.membership_id,snapshot.league_id,
      coalesce(sum(coalesce(points.points,0)*case when selected.is_captain then config.captain_multiplier else 1 end),0),
      case when league.mode='market' then least(config.maximum_payout,greatest(config.minimum_payout,
        coalesce(sum(coalesce(points.points,0)*case when selected.is_captain then config.captain_multiplier else 1 end),0)*config.money_per_point))
      else 0 end
    from public.matchday_lineup_snapshots snapshot
    join public.leagues league on league.id=snapshot.league_id
    cross join public.matchday_lifecycle_config config
    left join public.matchday_lineup_snapshot_players selected on selected.snapshot_id=snapshot.id and selected.role='starter'
    left join public.player_matchday_points points on points.competition_id=round_record.competition_id
      and points.season=round_record.season and points.matchday=round_record.matchday
      and points.player_id=selected.player_id and points.scoring_version=snapshot.scoring_version
    where snapshot.matchday_id=round_record.id
    group by snapshot.id,snapshot.membership_id,snapshot.league_id,league.mode,
      config.maximum_payout,config.minimum_payout,config.money_per_point
    on conflict (matchday_id,membership_id) do nothing;

    insert into public.membership_balance_ledger (membership_id,matchday_id,kind,amount)
    select result.membership_id,result.matchday_id,'matchday_payout',result.payout
    from public.matchday_member_results result
    join public.league_memberships membership on membership.id=result.membership_id
    join public.leagues league on league.id=membership.league_id
    where result.matchday_id=round_record.id and league.mode='market'
    on conflict (membership_id,matchday_id,kind) do nothing;

    for payout_record in
      select ledger.* from public.membership_balance_ledger ledger
      where ledger.matchday_id=round_record.id and not ledger.applied for update
    loop
      update public.league_memberships set budget=budget+payout_record.amount where id=payout_record.membership_id;
      update public.membership_balance_ledger set applied=true,applied_at=now() where id=payout_record.id;
    end loop;
    update public.competition_matchdays set state='closed',closed_at=processed_at,updated_at=now()
    where id=round_record.id;
    closed_count := closed_count + 1;
  end loop;
  return jsonb_build_object('processedAt',processed_at,'locked',locked_count,'closed',closed_count);
end;
$$;

-- Corrige cualquier pago fantástico creado por la versión anterior sin tocar
-- sus puntos ni su presupuesto congelado original.
with affected as (
  select ledger.id,ledger.membership_id,ledger.amount,ledger.applied
  from public.membership_balance_ledger ledger
  join public.league_memberships membership on membership.id=ledger.membership_id
  join public.leagues league on league.id=membership.league_id
  where ledger.kind='matchday_payout' and league.mode='fantasy'
), restored as (
  update public.league_memberships membership
  set budget=membership.budget-affected.amount
  from affected where affected.applied and membership.id=affected.membership_id
  returning membership.id
)
delete from public.membership_balance_ledger ledger using affected where ledger.id=affected.id;

update public.matchday_member_results result set payout=0
from public.league_memberships membership join public.leagues league on league.id=membership.league_id
where result.membership_id=membership.id and league.mode='fantasy' and result.payout<>0;

-- Elimina instantáneas antiguas de retos que no incluían ningún partido de la jornada.
with invalid as (
  select snapshot.id,snapshot.matchday_id,snapshot.membership_id
  from public.matchday_lineup_snapshots snapshot
  join public.competition_matchdays round on round.id=snapshot.matchday_id
  join public.fantasy_challenges challenge on challenge.league_id=snapshot.league_id
  where not public.league_participates_in_matchday(
    snapshot.league_id,round.competition_id,round.season,round.matchday
  )
), removed_results as (
  delete from public.matchday_member_results result using invalid
  where result.matchday_id=invalid.matchday_id and result.membership_id=invalid.membership_id
  returning result.matchday_id,result.membership_id
)
delete from public.matchday_lineup_snapshots snapshot using invalid where snapshot.id=invalid.id;

revoke all on function public.league_participates_in_matchday(text,text,text,integer),
  public.snapshot_matchday_lineups(uuid) from public,anon,authenticated;
grant execute on function public.league_participates_in_matchday(text,text,text,integer),
  public.snapshot_matchday_lineups(uuid) to service_role;
notify pgrst,'reload schema';
