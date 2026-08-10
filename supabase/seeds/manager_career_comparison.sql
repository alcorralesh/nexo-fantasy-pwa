-- Datos controlados para probar la comparación de Carrera con cuentas reales.
-- Es repetible: conserva las carreras existentes y solo crea las que falten.
-- Las carreras creadas quedan identificadas por un evento comparison_seed.

do $$
declare
  selected_user record;
  selected_team record;
  new_career_id uuid;
  prompt jsonb;
  choice jsonb;
  created_counter integer := 0;
begin
  for selected_user in
    select p.id, p.display_name, c.id club_id
    from public.profiles p
    join lateral (
      select club.id
      from public.clubs club
      where club.owner_id = p.id and club.active
      order by club.created_at
      limit 1
    ) c on true
    order by p.created_at
  loop
    for selected_team in
      select sc.id, sc.name
      from public.sports_clubs sc
      where sc.id in ('primera_0587f59e0189', 'segunda_f7d872661fd4')
        and sc.active
      order by sc.competition_id, sc.name
    loop
      if not exists (
        select 1
        from public.manager_careers career
        where career.owner_id = selected_user.id
          and career.club_id = selected_user.club_id
          and career.sports_club_id = selected_team.id
          and career.difficulty = 'balanced'
          and career.season_label = '26/27'
      ) then
        perform set_config(
          'request.jwt.claims',
          jsonb_build_object('sub', selected_user.id, 'role', 'authenticated')::text,
          true
        );

        new_career_id := public.create_manager_career(
          selected_user.club_id,
          selected_team.id,
          'balanced'
        );
        created_counter := created_counter + 1;

        insert into public.manager_career_events(
          career_id,
          event_type,
          title,
          detail,
          matchday,
          reputation_change
        ) values (
          new_career_id,
          'comparison_seed',
          'Carrera de comparación',
          'Creada para validar la clasificación entre mánagers del mismo equipo.',
          1,
          0
        );

        -- Dos de cada tres carreras toman una decisión real de la J1.
        -- Esto permite ver desempates sin inventar jornadas cerradas ni puntos.
        if mod(created_counter, 3) <> 0 then
          prompt := public.manager_career_decision_prompt(new_career_id);
          choice := prompt -> 'choices' -> case when mod(created_counter, 2) = 0 then 1 else 0 end;
          if prompt is not null and choice is not null then
            perform public.save_manager_career_decision(
              new_career_id,
              prompt ->> 'key',
              choice ->> 'key'
            );
          end if;
        end if;
      end if;
    end loop;
  end loop;
end $$;

select
  sports.name equipo,
  career.competition_id competicion,
  count(*) managers,
  count(*) filter (where marker.career_id is not null) creadas_para_comparacion,
  min(career.board_confidence) confianza_minima,
  max(career.board_confidence) confianza_maxima,
  count(lineup.career_id) filter (where lineup.settled_at is not null) jornadas_cerradas
from public.manager_careers career
join public.sports_clubs sports on sports.id = career.sports_club_id
left join lateral (
  select event.career_id
  from public.manager_career_events event
  where event.career_id = career.id and event.event_type = 'comparison_seed'
  limit 1
) marker on true
left join public.manager_career_lineups lineup on lineup.career_id = career.id
where career.sports_club_id in ('primera_0587f59e0189', 'segunda_f7d872661fd4')
  and career.difficulty = 'balanced'
  and career.season_label = '26/27'
  and career.status in ('active', 'completed', 'dismissed')
group by sports.name, career.competition_id
order by career.competition_id, sports.name;

-- Limpieza opcional (no ejecutar salvo que se quiera retirar este escenario):
-- delete from public.manager_careers career
-- where exists (
--   select 1 from public.manager_career_events event
--   where event.career_id = career.id and event.event_type = 'comparison_seed'
-- );
