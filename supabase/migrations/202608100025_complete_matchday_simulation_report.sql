-- Informe por usuario del cierre: once, desglose, saldo, posicion, avisos y movimientos.
-- Conserva el motor compartido; esta funcion solo presenta su salida sin persistirla.

create or replace function public.admin_simulate_matchday_close(
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
  run_id uuid;
  simulation_result jsonb;
  selected_round public.competition_matchdays;
  challenge_count integer;
  settlement_ready boolean;
  simulated_final integer;
  blocked_reason text;
  career_preview jsonb;
  challenge_preview jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  if target_scenario not in ('normal','postponed','advanced') then
    raise exception 'Escenario de simulacion no valido';
  end if;

  select * into selected_round from public.competition_matchdays
  where competition_id=target_competition_id and season=target_season and matchday=target_matchday;
  if not found then raise exception 'La jornada no existe en el calendario'; end if;

  simulated_final := case when target_scenario='postponed'
    then greatest(0,selected_round.fixture_count-1) else selected_round.fixture_count end;
  settlement_ready := selected_round.state='closed' or (
    target_scenario<>'postponed' and selected_round.fixture_count>0
    and selected_round.stats_ready_count=selected_round.fixture_count
  );
  blocked_reason := case
    when settlement_ready then null
    when target_scenario='postponed' then 'Queda un partido aplazado: el cierre oficial esperaria sus estadisticas.'
    when selected_round.fixture_count=0 then 'La jornada no tiene partidos sincronizados.'
    else format('Solo hay estadisticas finales de %s de %s partidos.',selected_round.stats_ready_count,selected_round.fixture_count)
  end;

  career_preview := public.admin_preview_manager_career_settlement(selected_round.id);
  challenge_preview := public.admin_preview_fantasy_challenge_activation(selected_round.id);
  challenge_count := coalesce((challenge_preview->>'challengeCount')::integer,0);

  with result as (
    select * from public.calculate_matchday_settlement(selected_round.id)
  )
  select jsonb_build_object(
    'competitionId',target_competition_id,'season',target_season,'matchday',target_matchday,
    'scenario',target_scenario,'officialState',selected_round.state,
    'productionUntouched',true,'usesOfficialEngine',true,'pointsSource','player_matchday_points',
    'settlementReady',settlement_ready,'blockedReason',blocked_reason,
    'fixtureCount',selected_round.fixture_count,'statsReadyCount',selected_round.stats_ready_count,
    'simulatedFinalFixtures',simulated_final,'memberships',count(*),
    'validLineups',count(*) filter(where valid),'zeroLineups',count(*) filter(where not valid),
    'totalPoints',coalesce(sum(points),0),
    'totalPayout',case when settlement_ready then coalesce(sum(payout) filter(where mode='market'),0) else 0 end,
    'calculatedPayout',coalesce(sum(payout) filter(where mode='market'),0),
    'careerSimulation',career_preview,
    'challengeSimulation',challenge_preview,
    'marketMemberships',count(*) filter(where mode='market'),
    'fantasyMemberships',count(*) filter(where mode<>'market'),
    'challengesToActivate',challenge_count,
    'results',coalesce(jsonb_agg(jsonb_build_object(
      'membershipId',membership_id,'leagueId',league_id,'leagueName',league_name,
      'mode',mode,'economicEligible',mode='market',
      'teamName',team_name,'managerName',manager_name,'source',source,
      'valid',valid,'formation',formation,'captainPlayerId',captain_player_id,
      'starterCount',starter_count,'points',points,
      'payout',case when mode='market' and settlement_ready then payout else 0 end,
      'calculatedPayout',case when mode='market' then payout else 0 end,
      'currentBudget',current_budget,
      'simulatedBudget',current_budget+case when mode='market' and settlement_ready then payout else 0 end,
      'rank',calculated_rank,
      'playerBreakdown',(
        select coalesce(jsonb_agg(
          listed.item || jsonb_build_object(
            'name',coalesce(player.name,'Jugador'),
            'initials',coalesce(player.initials,''),
            'position',coalesce(player.position,'MED'),
            'club',coalesce(sports_club.name,''),
            'photoUrl',player.photo_url,
            'slotOrder',listed.slot_order
          ) order by listed.slot_order
        ),'[]'::jsonb)
        from jsonb_array_elements(player_breakdown) with ordinality listed(item,slot_order)
        left join public.players player on player.id=listed.item->>'playerId'
        left join public.sports_clubs sports_club on sports_club.id=player.sports_club_id
      ),
      'notifications',case when settlement_ready then jsonb_build_array(
        jsonb_build_object(
          'type','matchday','title','Jornada cerrada',
          'body','Los puntos y premios de la Jornada '||target_matchday||' ya estan disponibles.',
          'targetSection','jornada'
        )
      ) else '[]'::jsonb end,
      'movements',case when settlement_ready then
        jsonb_build_array(jsonb_build_object(
          'type','matchday_result','title','Resultado de Jornada '||target_matchday,
          'detail',points||' puntos consolidados','amount',0
        )) || case when mode='market' then jsonb_build_array(jsonb_build_object(
          'type','matchday_payout','title','Premio por puntos',
          'detail','Abono economico de la Jornada '||target_matchday,'amount',payout
        )) else '[]'::jsonb end
      else '[]'::jsonb end
    ) order by league_name,calculated_rank),'[]'::jsonb)
  ) into simulation_result from result;

  insert into public.matchday_simulation_runs(created_by,competition_id,season,matchday,scenario,result)
  values(auth.uid(),target_competition_id,target_season,target_matchday,target_scenario,simulation_result)
  returning id into run_id;
  return simulation_result || jsonb_build_object('runId',run_id,'createdAt',now());
end;
$$;

notify pgrst,'reload schema';
