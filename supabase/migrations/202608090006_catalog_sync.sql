-- Sincronización auditable del catálogo oficial de jugadores.

create table if not exists public.player_catalog_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  mode text not null check (mode in ('preview', 'apply')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  catalog_version text,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists player_catalog_sync_one_running
  on public.player_catalog_sync_jobs ((true)) where status = 'running';
create index if not exists player_catalog_sync_recent
  on public.player_catalog_sync_jobs (started_at desc);

alter table public.player_catalog_sync_jobs enable row level security;
drop policy if exists catalog_sync_jobs_admin_read on public.player_catalog_sync_jobs;
create policy catalog_sync_jobs_admin_read on public.player_catalog_sync_jobs
  for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

grant select on public.player_catalog_sync_jobs to authenticated;
revoke insert, update, delete on public.player_catalog_sync_jobs from anon, authenticated;

create or replace function public.apply_player_catalog_snapshot(
  target_job_id uuid,
  target_catalog_version text,
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
    select 1 from public.player_catalog_sync_jobs
    where id = target_job_id and mode = 'apply' and status = 'running'
  ) then
    raise exception 'La sincronización no está activa';
  end if;

  create temporary table _nexo_catalog_snapshot (
    provider_id text primary key,
    competition_id text not null,
    player_name text not null,
    position text not null,
    club_name text not null,
    market_value numeric not null,
    photo_url text,
    source_name text not null
  ) on commit drop;

  insert into _nexo_catalog_snapshot
  select provider_id, competition_id, player_name, position, club_name, market_value, photo_url, source_name
  from jsonb_to_recordset(snapshot) as item(
    provider_id text, competition_id text, player_name text, position text,
    club_name text, market_value numeric, photo_url text, source_name text
  );

  select count(*), count(*) filter (where competition_id = 'primera'),
    count(*) filter (where competition_id = 'segunda'), count(*) filter (where competition_id = 'liga_f')
  into snapshot_total, primera_total, segunda_total, liga_f_total
  from _nexo_catalog_snapshot;

  if snapshot_total < 900 or primera_total < 300 or segunda_total < 280 or liga_f_total < 280 then
    raise exception 'La fuente devolvió un catálogo incompleto (% jugadores)', snapshot_total;
  end if;
  if exists (select 1 from _nexo_catalog_snapshot where position not in ('POR','DEF','MED','DEL')) then
    raise exception 'La fuente contiene posiciones no válidas';
  end if;

  insert into public.sports_clubs (id, competition_id, name, active)
  select competition_id || '_' || substr(md5(club_name), 1, 12), competition_id, club_name, true
  from _nexo_catalog_snapshot group by competition_id, club_name
  on conflict (competition_id, name) do update set active = true;

  update public.players player
  set active = false, updated_at = now()
  where (player.provider_id like 'laliga:%' or player.provider_id like 'ligaf:%')
    and not exists (select 1 from _nexo_catalog_snapshot fresh where fresh.provider_id = player.provider_id);

  insert into public.players (
    id, competition_id, sports_club_id, provider_id, name, initials, position, market_value,
    active, catalog_version, photo_url, source_name, source_updated_at
  )
  select replace(seed.provider_id, ':', '_'), seed.competition_id, club.id, seed.provider_id,
    seed.player_name, upper(left(regexp_replace(seed.player_name, '[^[:alnum:]]', '', 'g'), 2)),
    seed.position, seed.market_value, true, target_catalog_version, seed.photo_url, seed.source_name, now()
  from _nexo_catalog_snapshot seed
  join public.sports_clubs club
    on club.competition_id = seed.competition_id and club.name = seed.club_name
  on conflict (id) do update set
    competition_id = excluded.competition_id,
    sports_club_id = excluded.sports_club_id,
    provider_id = excluded.provider_id,
    name = excluded.name,
    initials = excluded.initials,
    position = excluded.position,
    active = true,
    catalog_version = excluded.catalog_version,
    photo_url = excluded.photo_url,
    source_name = excluded.source_name,
    source_updated_at = now();

  update public.player_catalog_sync_jobs
  set status = 'succeeded', catalog_version = target_catalog_version,
    summary = target_summary || jsonb_build_object('total', snapshot_total), finished_at = now()
  where id = target_job_id;

  return target_summary || jsonb_build_object('total', snapshot_total);
end;
$$;

revoke all on function public.apply_player_catalog_snapshot(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_player_catalog_snapshot(uuid, text, jsonb, jsonb) to service_role;
