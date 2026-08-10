-- Presentación del cierre: cada acta se revela una sola vez al propietario.

alter table public.manager_career_matchday_reports add column if not exists viewed_at timestamptz;

create or replace function public.manager_career_matchday_reports(target_career_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'matchday',report.matchday,'formation',report.formation,'captainId',report.captain_id,'players',report.player_breakdown,
    'lineupPoints',report.lineup_points,'decisionPoints',report.decision_points,'totalPoints',report.total_points,
    'mission',report.mission,'decision',report.decision,'confidenceBefore',report.confidence_before,'confidenceAfter',report.confidence_after,
    'reputationBefore',report.reputation_before,'reputationAfter',report.reputation_after,'budgetBefore',report.budget_before,'budgetAfter',report.budget_after,
    'consecutiveFailuresAfter',report.consecutive_failures_after,'statusAfter',report.status_after,'rankingPosition',report.ranking_position,
    'previousRankingPosition',report.previous_ranking_position,'createdAt',report.created_at,'viewedAt',report.viewed_at
  ) order by report.matchday desc),'[]'::jsonb)
  from public.manager_career_matchday_reports report join public.manager_careers career on career.id=report.career_id
  where report.career_id=target_career_id and career.owner_id=auth.uid();
$$;

create or replace function public.mark_manager_career_report_viewed(target_career_id uuid,target_matchday integer) returns timestamptz
language plpgsql security definer set search_path=public as $$
declare result timestamptz;
begin
  if not exists(select 1 from public.manager_careers where id=target_career_id and owner_id=auth.uid()) then raise exception 'Carrera no disponible'; end if;
  update public.manager_career_matchday_reports set viewed_at=coalesce(viewed_at,now())
  where career_id=target_career_id and matchday<=target_matchday;
  select viewed_at into result from public.manager_career_matchday_reports where career_id=target_career_id and matchday=target_matchday;
  if result is null then raise exception 'Informe no disponible'; end if;
  return result;
end $$;

revoke all on function public.manager_career_matchday_reports(uuid),public.mark_manager_career_report_viewed(uuid,integer) from public,anon;
grant execute on function public.manager_career_matchday_reports(uuid),public.mark_manager_career_report_viewed(uuid,integer) to authenticated;
notify pgrst,'reload schema';
