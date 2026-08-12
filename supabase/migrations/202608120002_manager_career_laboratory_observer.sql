-- Observador temporal y de solo lectura para seguir una simulacion desde otro navegador.
alter table public.manager_career_lab_sessions add column if not exists preview_token text;
alter table public.manager_career_lab_sessions add column if not exists preview_enabled boolean not null default true;
update public.manager_career_lab_sessions set preview_token=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','') where preview_token is null;
alter table public.manager_career_lab_sessions alter column preview_token set not null;
alter table public.manager_career_lab_sessions alter column preview_token set default (replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
create unique index if not exists manager_career_lab_sessions_preview_token_idx on public.manager_career_lab_sessions(preview_token);

create or replace function public.admin_manager_career_lab_state(target_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype;
begin
  perform public.manager_career_lab_assert_admin(); select * into selected from public.manager_career_lab_sessions where id=target_session_id and created_by=auth.uid(); if not found then raise exception 'Laboratorio no disponible'; end if;
  return jsonb_build_object('session',jsonb_build_object('id',selected.id,'title',selected.title,'userId',selected.subject_user_id,'userName',(select display_name from public.profiles where id=selected.subject_user_id),'competitionId',selected.competition_id,'sportsClubId',selected.sports_club_id,'sportsClubName',(select name from public.sports_clubs where id=selected.sports_club_id),'difficulty',selected.difficulty,'profile',selected.manager_profile,'mode',selected.run_mode,'seed',selected.seed,'status',selected.status,'matchday',selected.current_matchday,'maximumMatchday',selected.maximum_matchday,'phase',selected.phase,'updatedAt',selected.updated_at,'previewToken',selected.preview_token,'previewEnabled',selected.preview_enabled),'state',selected.state,'lastReport',selected.last_report,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'matchday',e.matchday,'moment',e.moment,'type',e.event_type,'title',e.title,'payload',e.payload,'status',e.status) order by e.matchday,e.created_at) from public.manager_career_lab_events e where e.session_id=selected.id),'[]'::jsonb),
    'logs',coalesce((select jsonb_agg(jsonb_build_object('sequence',l.sequence,'matchday',l.matchday,'phase',l.phase,'action',l.action,'title',l.title,'detail',l.detail,'checks',l.checks,'severity',l.severity,'createdAt',l.created_at) order by l.sequence desc) from public.manager_career_lab_logs l where l.session_id=selected.id),'[]'::jsonb),
    'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'matchday',c.matchday,'phase',c.phase,'label',c.label,'createdAt',c.created_at) order by c.sequence desc) from public.manager_career_lab_checkpoints c where c.session_id=selected.id),'[]'::jsonb));
end $$;

create or replace function public.manager_career_lab_public_preview(target_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare selected public.manager_career_lab_sessions%rowtype;
begin
  select * into selected from public.manager_career_lab_sessions
  where preview_token=target_token and preview_enabled and status<>'archived' and expires_at>now();
  if not found then raise exception 'Vista de prueba no disponible'; end if;
  return jsonb_build_object(
    'session',jsonb_build_object('title',selected.title,'userName',(select display_name from public.profiles where id=selected.subject_user_id),'competitionId',selected.competition_id,'sportsClubName',(select name from public.sports_clubs where id=selected.sports_club_id),'status',selected.status,'matchday',selected.current_matchday,'maximumMatchday',selected.maximum_matchday,'phase',selected.phase,'updatedAt',selected.updated_at),
    'state',jsonb_build_object('budget',selected.state->'budget','confidence',selected.state->'confidence','reputation',selected.state->'reputation','sportingPoints',selected.state->'sportingPoints','consecutiveFailures',selected.state->'consecutiveFailures','status',selected.state->'status','currentLineup',selected.state->'currentLineup','reports',selected.state->'reports','incidents',selected.state->'incidents','activeInterlude',selected.state->'activeInterlude')
  );
end $$;

revoke all on function public.manager_career_lab_public_preview(text) from public;
grant execute on function public.manager_career_lab_public_preview(text) to anon,authenticated;
notify pgrst,'reload schema';
