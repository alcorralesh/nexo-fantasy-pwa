-- JSON null no es SQL null: evita enriquecer activeInterlude cuando ya terminó.

create or replace function public.manager_career_lab_public_preview_v6_base(target_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; active jsonb; day_no integer;
begin
  result:=public.manager_career_lab_public_preview_v5_base(target_token);
  active:=result->'state'->'activeInterlude';
  if jsonb_typeof(active)='object' then
    day_no:=greatest(1,coalesce((active->>'currentDay')::integer,1));
    active:=jsonb_set(active,'{choices}',public.manager_career_interlude_activity_choices(
      day_no,
      coalesce((result->'state'->>'confidence')::integer,60),
      coalesce((result->'state'->>'consecutiveFailures')::integer,0)
    ));
    result:=jsonb_set(result,'{state,activeInterlude}',active);
  end if;
  return result;
end $$;

create or replace function public.manager_career_lab_public_preview_v7_base(target_token text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; active jsonb;
begin
  result:=public.manager_career_lab_public_preview_v6_base(target_token);
  active:=result->'state'->'activeInterlude';
  if jsonb_typeof(active)='object' then
    active:=active||jsonb_build_object(
      'planChoices',public.manager_career_interlude_plan_choices(),
      'projectChoices',public.manager_career_interlude_project_choices(),
      'progress',coalesce((active->>'progress')::integer,0),
      'streak',coalesce((active->>'streak')::integer,0),
      'managementPoints',coalesce((active->>'managementPoints')::integer,6),
      'projects',coalesce(active->'projects','[]'::jsonb),
      'rewardPreview',public.manager_career_interlude_reward(
        active->>'plan',
        coalesce((active->>'progress')::integer,0),
        coalesce((active->>'activityDays')::integer,18)
      )
    );
    result:=jsonb_set(result,'{state,activeInterlude}',active);
  end if;
  return result;
end $$;

revoke all on function public.manager_career_lab_public_preview_v6_base(text),public.manager_career_lab_public_preview_v7_base(text) from public;
grant execute on function public.manager_career_lab_public_preview_v6_base(text),public.manager_career_lab_public_preview_v7_base(text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
