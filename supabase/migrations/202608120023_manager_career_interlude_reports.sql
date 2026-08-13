-- Archivo permanente de los interludios completados de una Carrera.

create or replace function public.manager_career_interlude_reports(target_career_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare result jsonb;
begin
  if not exists(
    select 1 from public.manager_careers
    where id=target_career_id and owner_id=auth.uid()
  ) then
    raise exception 'Carrera no disponible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,
    'title',i.title,
    'fromMatchday',i.from_matchday,
    'toMatchday',i.to_matchday,
    'plan',p.plan,
    'planTitle',case p.plan
      when 'identity' then 'Proteger la identidad'
      when 'sporting' then 'Preparar el regreso'
      when 'resources' then 'Reforzar el proyecto'
      else 'Plan del club'
    end,
    'progress',p.progress,
    'activityDays',p.activity_days,
    'storyChoices',p.story_choices,
    'reward',p.reward,
    'settledAt',p.settled_at
  ) order by i.from_matchday),'[]'::jsonb)
  into result
  from public.manager_career_interlude_programs p
  join public.manager_career_interludes i on i.id=p.interlude_id
  where p.career_id=target_career_id and p.settled_at is not null;

  return result;
end $$;

revoke all on function public.manager_career_interlude_reports(uuid) from public,anon;
grant execute on function public.manager_career_interlude_reports(uuid) to authenticated;
