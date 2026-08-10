-- Prueba integral y reversible del cierre de Jornada 1 en Carrera.
-- Ejecuta el motor real dentro de una transacción y termina con rollback.

begin;

do $$
declare
  career_row record;
  selected_player_ids text[];
begin
  for career_row in
    select career.id, career.owner_id
    from public.manager_careers career
    where career.competition_id = 'primera'
      and career.status = 'active'
      and career.current_matchday = 1
    order by career.created_at
  loop
    select array_agg(pool.player_id order by pool.position_order, pool.player_id)
    into selected_player_ids
    from (
      select
        ranked.player_id,
        case ranked.position when 'POR' then 1 when 'DEF' then 2 when 'MED' then 3 else 4 end position_order
      from (
        select
          player.id player_id,
          player.position,
          row_number() over (partition by player.position order by player.id) position_rank
        from public.manager_career_players squad
        join public.players player on player.id = squad.player_id
        where squad.career_id = career_row.id
      ) ranked
      where (ranked.position = 'POR' and ranked.position_rank <= 1)
         or (ranked.position = 'DEF' and ranked.position_rank <= 4)
         or (ranked.position = 'MED' and ranked.position_rank <= 4)
         or (ranked.position = 'DEL' and ranked.position_rank <= 2)
    ) pool;

    if cardinality(selected_player_ids) <> 11 then
      raise exception 'No se pudo formar un 4-4-2 para la Carrera %', career_row.id;
    end if;

    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', career_row.owner_id, 'role', 'authenticated')::text,
      true
    );
    perform public.save_manager_career_lineup(
      career_row.id,
      1,
      '4-4-2',
      selected_player_ids,
      selected_player_ids[11]
    );
  end loop;
end $$;

-- Puntos deterministas de prueba: entre 3 y 10 por jugador.
insert into public.player_matchday_points(
  competition_id,
  season,
  matchday,
  player_id,
  points,
  scoring_version,
  source_payload,
  calculated_at
)
select distinct
  'primera',
  '2026',
  1,
  selected.player_id,
  (3 + mod(abs(hashtext(selected.player_id)::bigint), 8))::numeric,
  round.scoring_version,
  jsonb_build_object('simulation', true),
  now()
from public.manager_career_lineups lineup
cross join lateral unnest(lineup.player_ids) selected(player_id)
cross join public.competition_matchdays round
where lineup.matchday = 1
  and round.competition_id = 'primera'
  and round.season = '2026'
  and round.matchday = 1
on conflict (competition_id, season, matchday, player_id, scoring_version)
do update set
  points = excluded.points,
  source_payload = excluded.source_payload,
  calculated_at = excluded.calculated_at;

-- El bloqueo congela los onces, avanza las Carreras y abre la Jornada 2.
update public.competition_matchdays
set state = 'locked', locked_at = now(), updated_at = now()
where competition_id = 'primera'
  and season = '2026'
  and matchday = 1
  and state = 'open';

-- El cierre liquida puntos, misiones, confianza, eventos y ranking.
update public.competition_matchdays
set state = 'closed', closed_at = now(), updated_at = now()
where competition_id = 'primera'
  and season = '2026'
  and matchday = 1
  and state = 'locked';

-- La RPC de ranking exige el contexto de uno de los propietarios.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', profile.id, 'role', 'authenticated')::text,
  true
)
from public.profiles profile
where profile.display_name = 'Alberto';

select jsonb_build_object(
  'productionUntouched', true,
  'transaction', 'ROLLBACK',
  'roundOneState', (
    select state from public.competition_matchdays
    where competition_id = 'primera' and season = '2026' and matchday = 1
  ),
  'roundTwoState', (
    select state from public.competition_matchdays
    where competition_id = 'primera' and season = '2026' and matchday = 2
  ),
  'careerCount', (
    select count(*) from public.manager_careers where competition_id = 'primera'
  ),
  'lockedLineups', (
    select count(*) from public.manager_career_lineups lineup
    join public.manager_careers career on career.id = lineup.career_id
    where career.competition_id = 'primera' and lineup.matchday = 1 and lineup.locked_at is not null
  ),
  'settledLineups', (
    select count(*) from public.manager_career_lineups lineup
    join public.manager_careers career on career.id = lineup.career_id
    where career.competition_id = 'primera' and lineup.matchday = 1 and lineup.settled_at is not null
  ),
  'resultEvents', (
    select count(*) from public.manager_career_events event
    join public.manager_careers career on career.id = event.career_id
    where career.competition_id = 'primera' and event.event_type = 'matchday_result' and event.matchday = 1
  ),
  'matchdayReports', (
    select count(*) from public.manager_career_matchday_reports report
    join public.manager_careers career on career.id = report.career_id
    where career.competition_id = 'primera' and report.matchday = 1
  ),
  'completeReport', (
    select jsonb_build_object(
      'players', jsonb_array_length(report.player_breakdown),
      'lineupPoints', report.lineup_points,
      'decisionPoints', report.decision_points,
      'totalPoints', report.total_points,
      'missionStatus', report.mission->>'status',
      'confidenceChange', report.confidence_after-report.confidence_before,
      'rankingPosition', report.ranking_position
    )
    from public.manager_career_matchday_reports report
    join public.manager_careers career on career.id=report.career_id
    join public.profiles profile on profile.id=career.owner_id
    where career.competition_id='primera' and report.matchday=1 and profile.display_name='Alberto'
    limit 1
  ),
  'roundTwoMissions', (
    select count(*) from public.manager_career_mission_assignments assignment
    join public.manager_careers career on career.id = assignment.career_id
    where career.competition_id = 'primera' and assignment.matchday = 2
  ),
  'roundTwoEvents', (
    select count(*) from public.manager_career_event_assignments assignment
    join public.manager_careers career on career.id = assignment.career_id
    where career.competition_id = 'primera' and assignment.matchday = 2
  ),
  'careers', (
    select jsonb_agg(jsonb_build_object(
      'manager', profile.display_name,
      'currentMatchday', career.current_matchday,
      'points', career.sporting_points,
      'confidence', career.board_confidence,
      'reputation', career.reputation,
      'failures', career.consecutive_failures,
      'status', career.status,
      'missionStatus', mission.status,
      'missionMetric', mission.metric_key,
      'lineupPoints', lineup.points
    ) order by career.sporting_points desc, profile.display_name)
    from public.manager_careers career
    join public.profiles profile on profile.id = career.owner_id
    left join public.manager_career_lineups lineup on lineup.career_id = career.id and lineup.matchday = 1
    left join public.manager_career_objectives mission
      on mission.career_id = career.id and mission.objective_type = 'matchday' and mission.expires_matchday = 1
    where career.competition_id = 'primera'
  ),
  'ranking', public.manager_career_same_club_ranking((
    select career.id
    from public.manager_careers career
    join public.profiles profile on profile.id = career.owner_id
    where profile.display_name = 'Alberto'
      and career.sports_club_id = 'primera_0587f59e0189'
    limit 1
  ))
) simulation_report;

rollback;
