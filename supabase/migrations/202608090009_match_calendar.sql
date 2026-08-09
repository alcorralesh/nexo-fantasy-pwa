-- Calendario oficial, versionado y sincronizado desde el backend.

create table if not exists public.match_fixtures (
  id text primary key,
  provider_id text not null unique,
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null,
  home_club_name text not null,
  away_club_name text not null,
  home_short_name text not null default '',
  away_short_name text not null default '',
  home_badge_url text,
  away_badge_url text,
  kickoff_at timestamptz,
  kickoff_confirmed boolean not null default false,
  status text not null default 'scheduled',
  home_score smallint,
  away_score smallint,
  venue text,
  source_name text not null default 'LALIGA',
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_fixtures_matchday check (matchday between 1 and 50),
  constraint match_fixtures_status check (status in ('scheduled','live','final','postponed','cancelled')),
  constraint match_fixtures_teams check (home_club_name <> away_club_name),
  constraint match_fixtures_score check ((home_score is null and away_score is null) or (home_score >= 0 and away_score >= 0))
);

create table if not exists public.calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  mode text not null check (mode in ('preview','apply')),
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  season text not null,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists match_fixtures_round_idx on public.match_fixtures(competition_id, season, matchday, kickoff_at);
create index if not exists match_fixtures_clubs_idx on public.match_fixtures(competition_id, home_club_name, away_club_name);
create unique index if not exists calendar_sync_one_running on public.calendar_sync_jobs ((true)) where status = 'running';
create index if not exists calendar_sync_recent on public.calendar_sync_jobs(started_at desc);

drop trigger if exists match_fixtures_set_updated_at on public.match_fixtures;
create trigger match_fixtures_set_updated_at before update on public.match_fixtures
for each row execute function public.set_updated_at();

create or replace function public.apply_match_calendar_snapshot(
  target_job_id uuid,
  target_season text,
  snapshot jsonb,
  target_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_total integer;
  primera_total integer;
  segunda_total integer;
  liga_f_total integer;
begin
  if not exists (
    select 1 from public.calendar_sync_jobs
    where id = target_job_id and mode = 'apply' and status = 'running'
  ) then raise exception 'La sincronización no está activa'; end if;

  create temporary table _nexo_fixture_snapshot (
    provider_id text primary key, competition_id text, season text, matchday integer,
    home_club_name text, away_club_name text, home_short_name text, away_short_name text,
    home_badge_url text, away_badge_url text, kickoff_at timestamptz,
    kickoff_confirmed boolean, status text, home_score integer, away_score integer,
    venue text, source_name text
  ) on commit drop;

  insert into _nexo_fixture_snapshot
  select * from jsonb_to_recordset(snapshot) as item(
    provider_id text, competition_id text, season text, matchday integer,
    home_club_name text, away_club_name text, home_short_name text, away_short_name text,
    home_badge_url text, away_badge_url text, kickoff_at timestamptz,
    kickoff_confirmed boolean, status text, home_score integer, away_score integer,
    venue text, source_name text
  );

  select count(*), count(*) filter (where competition_id = 'primera'),
    count(*) filter (where competition_id = 'segunda'), count(*) filter (where competition_id = 'liga_f')
  into snapshot_total, primera_total, segunda_total, liga_f_total
  from _nexo_fixture_snapshot;

  if snapshot_total < 950 or primera_total < 360 or segunda_total < 420 or liga_f_total < 220 then
    raise exception 'La fuente devolvió un calendario incompleto (% partidos)', snapshot_total;
  end if;
  if exists (select 1 from _nexo_fixture_snapshot where status not in ('scheduled','live','final','postponed','cancelled')) then
    raise exception 'La fuente contiene estados no válidos';
  end if;

  insert into public.match_fixtures (
    id, provider_id, competition_id, season, matchday, home_club_name, away_club_name,
    home_short_name, away_short_name, home_badge_url, away_badge_url, kickoff_at,
    kickoff_confirmed, status, home_score, away_score, venue, source_name, source_updated_at
  )
  select 'laliga_' || provider_id, provider_id, competition_id, season, matchday,
    home_club_name, away_club_name, home_short_name, away_short_name,
    home_badge_url, away_badge_url, kickoff_at, kickoff_confirmed, status,
    home_score, away_score, venue, source_name, now()
  from _nexo_fixture_snapshot
  on conflict (provider_id) do update set
    competition_id = excluded.competition_id, season = excluded.season, matchday = excluded.matchday,
    home_club_name = excluded.home_club_name, away_club_name = excluded.away_club_name,
    home_short_name = excluded.home_short_name, away_short_name = excluded.away_short_name,
    home_badge_url = excluded.home_badge_url, away_badge_url = excluded.away_badge_url,
    kickoff_at = excluded.kickoff_at, kickoff_confirmed = excluded.kickoff_confirmed,
    status = excluded.status, home_score = excluded.home_score, away_score = excluded.away_score,
    venue = excluded.venue, source_name = excluded.source_name, source_updated_at = now();

  delete from public.match_fixtures fixture
  where fixture.season = target_season
    and fixture.competition_id in ('primera','segunda','liga_f')
    and not exists (select 1 from _nexo_fixture_snapshot fresh where fresh.provider_id = fixture.provider_id);

  update public.calendar_sync_jobs
  set status = 'succeeded', summary = target_summary || jsonb_build_object('total', snapshot_total), finished_at = now()
  where id = target_job_id;
  return target_summary || jsonb_build_object('total', snapshot_total);
end;
$$;

alter table public.match_fixtures enable row level security;
alter table public.calendar_sync_jobs enable row level security;
drop policy if exists match_fixtures_read on public.match_fixtures;
create policy match_fixtures_read on public.match_fixtures for select to anon, authenticated using (true);
drop policy if exists calendar_sync_jobs_admin_read on public.calendar_sync_jobs;
create policy calendar_sync_jobs_admin_read on public.calendar_sync_jobs for select to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

revoke all on public.match_fixtures, public.calendar_sync_jobs from anon, authenticated;
grant select on public.match_fixtures to anon, authenticated;
grant select on public.calendar_sync_jobs to authenticated;
revoke all on function public.apply_match_calendar_snapshot(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_match_calendar_snapshot(uuid, text, jsonb, jsonb) to service_role;
