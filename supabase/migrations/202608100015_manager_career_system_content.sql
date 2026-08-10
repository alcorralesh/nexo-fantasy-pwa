-- Permite que el ciclo automático y Administración preparen la siguiente
-- jornada para todas las Carreras, manteniendo el acceso manual limitado.

create or replace function public.ensure_manager_career_content(
  target_career_id uuid,
  target_matchday integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.manager_careers%rowtype;
  event_key text;
  mission public.manager_career_mission_templates%rowtype;
  objective uuid;
  target numeric;
  difficulty_multiplier numeric;
begin
  select * into c
  from public.manager_careers career
  where career.id = target_career_id
    and (
      career.owner_id = auth.uid()
      or auth.uid() is null
      or exists (
        select 1 from public.profiles profile
        where profile.id = auth.uid() and profile.role = 'admin'
      )
    );
  if not found or c.status <> 'active' then return; end if;

  if not exists (
    select 1 from public.manager_career_event_assignments
    where career_id = c.id and matchday = target_matchday
  ) then
    select template.key into event_key
    from public.manager_career_event_templates template
    where template.active
      and target_matchday between template.min_matchday and template.max_matchday
      and c.board_confidence between template.min_confidence and template.max_confidence
      and c.budget >= template.min_budget
      and c.difficulty = any(template.allowed_difficulties)
      and not exists (
        select 1 from public.manager_career_event_assignments history
        where history.career_id = c.id
          and history.template_key = template.key
          and history.matchday > target_matchday - template.cooldown_matchdays
      )
    order by
      case when template.story_step > 1 and exists (
        select 1
        from public.manager_career_event_assignments previous
        join public.manager_career_event_templates prior on prior.key = previous.template_key
        where previous.career_id = c.id
          and prior.story_key = template.story_key
          and prior.story_step = template.story_step - 1
      ) then 0 else 1 end,
      -ln(greatest(random(), 0.000001)) / greatest(template.weight, 1)
    limit 1;

    if event_key is null then
      select key into event_key
      from public.manager_career_event_templates
      where active and target_matchday between min_matchday and max_matchday
      order by md5(c.id::text || ':' || target_matchday || ':' || key)
      limit 1;
    end if;
    if event_key is not null then
      insert into public.manager_career_event_assignments(career_id, matchday, template_key)
      values(c.id, target_matchday, event_key)
      on conflict do nothing;
    end if;
  end if;

  if not exists (
    select 1 from public.manager_career_mission_assignments
    where career_id = c.id and matchday = target_matchday
  ) then
    select template.* into mission
    from public.manager_career_mission_templates template
    where template.active
      and target_matchday between template.min_matchday and template.max_matchday
      and c.board_confidence between template.min_confidence and template.max_confidence
      and not exists (
        select 1 from public.manager_career_mission_assignments history
        where history.career_id = c.id
          and history.template_key = template.key
          and history.matchday > target_matchday - template.cooldown_matchdays
      )
    order by -ln(greatest(random(), 0.000001)) / greatest(template.weight, 1)
    limit 1;

    if mission.key is null then
      select * into mission
      from public.manager_career_mission_templates
      where active
      order by md5(c.id::text || ':fallback:' || target_matchday || ':' || key)
      limit 1;
    end if;
    if mission.key is not null then
      difficulty_multiplier := case c.difficulty
        when 'relaxed' then .90
        when 'elite' then 1.10
        else 1
      end;
      target := case mission.metric_key
        when 'points' then round(mission.base_target * difficulty_multiplier)
        when 'captain_points' then round(mission.base_target * difficulty_multiplier)
        else mission.base_target
      end;

      insert into public.manager_career_objectives(
        career_id, objective_type, title, description, target_value,
        reputation_reward, failure_penalty, expires_matchday, metric_key
      ) values (
        c.id, 'matchday', mission.title, mission.description, target,
        mission.reputation_reward, mission.confidence_penalty, target_matchday, mission.metric_key
      )
      on conflict(career_id, objective_type, expires_matchday)
        where expires_matchday is not null
      do update set
        title = excluded.title,
        description = excluded.description,
        target_value = excluded.target_value,
        reputation_reward = excluded.reputation_reward,
        failure_penalty = excluded.failure_penalty,
        metric_key = excluded.metric_key
      returning id into objective;

      select id into objective
      from public.manager_career_objectives
      where career_id = c.id
        and objective_type = 'matchday'
        and expires_matchday = target_matchday;

      insert into public.manager_career_mission_assignments(
        career_id, matchday, template_key, objective_id
      ) values(c.id, target_matchday, mission.key, objective)
      on conflict do nothing;
    end if;
  end if;
end $$;

revoke all on function public.ensure_manager_career_content(uuid, integer) from public, anon;
grant execute on function public.ensure_manager_career_content(uuid, integer) to authenticated, service_role;
notify pgrst, 'reload schema';
