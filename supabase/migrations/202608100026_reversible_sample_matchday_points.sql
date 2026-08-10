-- Puntos deterministas para probar un cierre completo sin contaminar la temporada.
-- Se insertan dentro de un subbloque que siempre se revierte tras ejecutar el motor oficial.

create or replace function public.admin_simulate_matchday_close_with_points(
  target_competition_id text,
  target_season text,
  target_matchday integer,
  target_scenario text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_round public.competition_matchdays;
  simulation_result jsonb := '{}'::jsonb;
  run_id uuid;
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  if target_scenario not in ('normal','postponed','advanced') then
    raise exception 'Escenario de simulacion no valido';
  end if;

  select * into selected_round from public.competition_matchdays
  where competition_id=target_competition_id and season=target_season and matchday=target_matchday;
  if not found then raise exception 'La jornada no existe en el calendario'; end if;

  begin
    insert into public.player_matchday_points(
      competition_id,season,matchday,player_id,points,scoring_version,source_payload,calculated_at
    )
    select
      selected_round.competition_id,
      selected_round.season,
      selected_round.matchday,
      player.id,
      (2 + mod(abs(hashtextextended(
        player.id||':'||selected_round.season||':'||selected_round.matchday::text,0
      )::numeric),9))::numeric(10,2),
      selected_round.scoring_version,
      jsonb_build_object(
        'simulation',true,
        'temporary',true,
        'reason','Vista previa reversible del cierre'
      ),
      now()
    from public.players player
    where player.competition_id=selected_round.competition_id and player.active
    on conflict(competition_id,season,matchday,player_id,scoring_version) do nothing;

    -- Solo dentro del sandbox se considera que todos los partidos tienen datos.
    update public.competition_matchdays
    set final_fixture_count=fixture_count,stats_ready_count=fixture_count,updated_at=now()
    where id=selected_round.id and target_scenario<>'postponed';

    simulation_result := public.admin_simulate_matchday_close(
      target_competition_id,target_season,target_matchday,target_scenario
    );
    simulation_result := (simulation_result-'runId'-'createdAt') || jsonb_build_object(
      'pointsSource','sample_sandbox',
      'usesSamplePoints',true,
      'officialStatsReadyCount',selected_round.stats_ready_count
    );

    raise exception using errcode='P9004',message='ROLLBACK_SAMPLE_MATCHDAY_POINTS';
  exception when sqlstate 'P9004' then
    null;
  end;

  insert into public.matchday_simulation_runs(
    created_by,competition_id,season,matchday,scenario,result
  ) values(
    auth.uid(),target_competition_id,target_season,target_matchday,target_scenario,simulation_result
  ) returning id into run_id;

  return simulation_result || jsonb_build_object('runId',run_id,'createdAt',now());
end;
$$;

revoke all on function public.admin_simulate_matchday_close_with_points(text,text,integer,text) from public,anon;
grant execute on function public.admin_simulate_matchday_close_with_points(text,text,integer,text) to authenticated;

notify pgrst,'reload schema';
