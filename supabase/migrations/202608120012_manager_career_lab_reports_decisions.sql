-- Las actas del laboratorio deben conservar la decision semanal igual que las
-- actas reales: texto, consecuencias, condicion y puntos aportados.

create or replace function public.manager_career_lab_enrich_reports(target_state jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare
  state jsonb:=coalesce(target_state,'{}'::jsonb);
  enriched jsonb;
begin
  select coalesce(jsonb_agg(
    case when decision.value is null then report.value else
      report.value || jsonb_build_object(
        'lineupPoints',coalesce((report.value->>'lineupPoints')::numeric,(report.value->>'points')::numeric,0),
        'decisionPoints',coalesce((decision.value->>'sportingPointsChange')::numeric,0)+case
          when decision.value->>'condition' is null then 0
          when (select count(*) from jsonb_array_elements(coalesce(report.value->'players','[]'::jsonb)) player where coalesce((player->>'original')::boolean,false))
            >=coalesce(nullif(regexp_replace(decision.value->>'condition','[^0-9]','','g'),''),'0')::integer
          then coalesce((decision.value->>'conditionalBonus')::numeric,0) else 0 end,
        'totalPoints',coalesce((report.value->>'lineupPoints')::numeric,(report.value->>'points')::numeric,0)+coalesce((decision.value->>'sportingPointsChange')::numeric,0)+case
          when decision.value->>'condition' is null then 0
          when (select count(*) from jsonb_array_elements(coalesce(report.value->'players','[]'::jsonb)) player where coalesce((player->>'original')::boolean,false))
            >=coalesce(nullif(regexp_replace(decision.value->>'condition','[^0-9]','','g'),''),'0')::integer
          then coalesce((decision.value->>'conditionalBonus')::numeric,0) else 0 end,
        'decision',jsonb_build_object(
          'choiceTitle',decision.value->>'choiceTitle','consequence',decision.value->>'consequence',
          'reputationChange',coalesce((decision.value->>'reputationChange')::numeric,0),
          'confidenceChange',coalesce((decision.value->>'confidenceChange')::numeric,0),
          'budgetChange',coalesce((decision.value->>'budgetChange')::numeric,0),
          'sportingPointsChange',coalesce((decision.value->>'sportingPointsChange')::numeric,0),
          'conditionalOriginalTarget',case when decision.value->>'condition' is null then null else nullif(regexp_replace(decision.value->>'condition','[^0-9]','','g'),'')::integer end,
          'conditionalSportingBonus',coalesce((decision.value->>'conditionalBonus')::numeric,0),
          'conditionMet',decision.value->>'condition' is null or (select count(*) from jsonb_array_elements(coalesce(report.value->'players','[]'::jsonb)) player where coalesce((player->>'original')::boolean,false))>=coalesce(nullif(regexp_replace(decision.value->>'condition','[^0-9]','','g'),''),'0')::integer
        )
      ) end order by report.ordinality
  ),'[]'::jsonb) into enriched
  from jsonb_array_elements(coalesce(state->'reports','[]'::jsonb)) with ordinality report(value,ordinality)
  left join lateral (
    select item.value from jsonb_array_elements(coalesce(state->'decisions','[]'::jsonb)) item(value)
    where coalesce((item.value->>'matchday')::integer,0)=coalesce((report.value->>'matchday')::integer,0)
    limit 1
  ) decision on true;
  return jsonb_set(state,'{reports}',enriched);
end $$;

alter function public.admin_step_manager_career_lab(uuid,text,jsonb)
  rename to admin_step_manager_career_lab_v2_base;

create or replace function public.admin_step_manager_career_lab(
  target_session_id uuid,
  target_action text,
  target_options jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  result:=public.admin_step_manager_career_lab_v2_base(target_session_id,target_action,target_options);
  if target_action='close' then
    update public.manager_career_lab_sessions session
    set state=public.manager_career_lab_enrich_reports(session.state),updated_at=now()
    where session.id=target_session_id and session.created_by=auth.uid();
    return public.admin_manager_career_lab_state(target_session_id);
  end if;
  return result;
end $$;

-- Repara tambien las actas ya cerradas dentro de sesiones existentes.
update public.manager_career_lab_sessions session
set state=public.manager_career_lab_enrich_reports(session.state),updated_at=now()
where jsonb_array_length(coalesce(session.state->'reports','[]'::jsonb))>0;

revoke all on function public.admin_step_manager_career_lab(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_step_manager_career_lab(uuid,text,jsonb) to authenticated;
grant execute on function public.manager_career_lab_enrich_reports(jsonb) to service_role;
notify pgrst,'reload schema';
