-- Datos persistentes de ensayo para comprobar el primer cierre completo.
-- Solo completa titulares que no tenian puntuacion y recalcula ligas de mercado.

create temporary table visible_j1_round on commit drop as
select *
from public.competition_matchdays
where competition_id = 'primera' and season = '2026' and matchday = 1
limit 1;

insert into public.player_matchday_points (
  competition_id, season, matchday, player_id, points,
  scoring_version, source_payload, calculated_at
)
select
  round.competition_id,
  round.season,
  round.matchday,
  selected.player_id,
  (3 + mod(
    get_byte(decode(substr(md5(selected.player_id || ':2026:1'), 1, 2), 'hex'), 0),
    8
  ))::numeric(10,2),
  snapshot.scoring_version,
  jsonb_build_object(
    'simulationBatch', 'visible_league_close_20260810',
    'visibleTest', true,
    'reason', 'Prueba persistente del cierre de Jornada 1'
  ),
  now()
from visible_j1_round round
join public.matchday_lineup_snapshots snapshot on snapshot.matchday_id = round.id
join public.leagues league on league.id = snapshot.league_id and league.mode = 'market'
join public.matchday_lineup_snapshot_players selected
  on selected.snapshot_id = snapshot.id and selected.role = 'starter'
where snapshot.valid
on conflict (competition_id, season, matchday, player_id, scoring_version) do nothing;

create temporary table visible_j1_market_recalculation on commit drop as
select
  result.matchday_id,
  result.membership_id,
  result.league_id,
  result.payout as old_payout,
  coalesce(sum(
    coalesce(points.points, 0)
    * case when selected.is_captain then config.captain_multiplier else 1 end
  ), 0)::numeric(12,2) as new_points,
  least(
    config.maximum_payout,
    greatest(
      config.minimum_payout,
      coalesce(sum(
        coalesce(points.points, 0)
        * case when selected.is_captain then config.captain_multiplier else 1 end
      ), 0) * config.money_per_point
    )
  )::numeric(12,2) as new_payout
from visible_j1_round round
join public.matchday_lineup_snapshots snapshot on snapshot.matchday_id = round.id
join public.leagues league on league.id = snapshot.league_id and league.mode = 'market'
join public.matchday_member_results result
  on result.matchday_id = snapshot.matchday_id and result.membership_id = snapshot.membership_id
cross join public.matchday_lifecycle_config config
left join public.matchday_lineup_snapshot_players selected
  on selected.snapshot_id = snapshot.id and selected.role = 'starter'
left join public.player_matchday_points points
  on points.competition_id = round.competition_id
  and points.season = round.season
  and points.matchday = round.matchday
  and points.player_id = selected.player_id
  and points.scoring_version = snapshot.scoring_version
group by
  result.matchday_id, result.membership_id, result.league_id, result.payout,
  config.maximum_payout, config.minimum_payout, config.money_per_point;

update public.league_memberships membership
set budget = membership.budget + recalculation.new_payout - recalculation.old_payout
from visible_j1_market_recalculation recalculation
where membership.id = recalculation.membership_id;

update public.matchday_member_results result
set
  points = recalculation.new_points,
  payout = recalculation.new_payout,
  calculated_at = now()
from visible_j1_market_recalculation recalculation
where result.matchday_id = recalculation.matchday_id
  and result.membership_id = recalculation.membership_id;

insert into public.membership_balance_ledger (
  membership_id, matchday_id, kind, amount, applied, applied_at
)
select membership_id, matchday_id, 'matchday_payout', new_payout, true, now()
from visible_j1_market_recalculation
on conflict (membership_id, matchday_id, kind) do update
set amount = excluded.amount, applied = true, applied_at = now();

select
  league.name,
  league.mode,
  result.points,
  result.payout,
  membership.budget
from visible_j1_market_recalculation recalculation
join public.leagues league on league.id = recalculation.league_id
join public.league_memberships membership on membership.id = recalculation.membership_id
join public.matchday_member_results result
  on result.matchday_id = recalculation.matchday_id
  and result.membership_id = recalculation.membership_id
where membership.user_id = 'f5027839-8aa1-450a-aa52-dc6893515153'
order by league.name;
