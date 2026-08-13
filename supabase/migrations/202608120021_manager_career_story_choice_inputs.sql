-- Los requisitos de configuración pertenecen a cada decisión, no al capítulo completo.

do $$ begin
  if to_regprocedure('public.manager_career_interlude_story_choice_inputs_base(text,integer)') is null then
    alter function public.manager_career_interlude_story(text,integer)
      rename to manager_career_interlude_story_choice_inputs_base;
  end if;
end $$;

create or replace function public.manager_career_interlude_story(target_plan text,target_days integer default 18)
returns jsonb language sql immutable set search_path=public as $$
  select coalesce(jsonb_agg(
    chapter || jsonb_build_object(
      'choices',(
        select coalesce(jsonb_agg(
          case choice->>'key'
            when 'manager' then choice || jsonb_build_object('input','none')
            when 'captains' then choice || jsonb_build_object('input','leader')
            else choice
          end
        ),'[]'::jsonb)
        from jsonb_array_elements(chapter->'choices') choice
      )
    )
  ),'[]'::jsonb)
  from jsonb_array_elements(public.manager_career_interlude_story_choice_inputs_base(target_plan,target_days)) chapter;
$$;

revoke all on function public.manager_career_interlude_story(text,integer) from public;
grant execute on function public.manager_career_interlude_story(text,integer) to anon,authenticated,service_role;
notify pgrst,'reload schema';
