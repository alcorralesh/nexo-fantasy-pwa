-- Ciclo de vida automático de jornadas y fotografías inmutables de alineación.
-- Una sola función periódica atiende todas las competiciones y ligas.

create table if not exists public.matchday_lifecycle_config (
  id boolean primary key default true check (id),
  lock_offset_minutes integer not null default 0 check (lock_offset_minutes between -120 and 120),
  postponed_grace_hours integer not null default 48 check (postponed_grace_hours between 0 and 720),
  postponed_policy text not null default 'wait' check (postponed_policy in ('wait', 'provisional')),
  money_per_point numeric(10,2) not null default 0.10 check (money_per_point >= 0),
  minimum_payout numeric(12,2) not null default 0 check (minimum_payout >= 0),
  maximum_payout numeric(12,2) not null default 15 check (maximum_payout >= minimum_payout),
  captain_multiplier numeric(4,2) not null default 2 check (captain_multiplier between 1 and 5),
  scoring_version integer not null default 1 check (scoring_version > 0),
  updated_at timestamptz not null default now()
);

insert into public.matchday_lifecycle_config (id) values (true) on conflict (id) do nothing;

alter table public.match_fixtures add column if not exists stats_ready boolean not null default false;
alter table public.match_fixtures add column if not exists stats_synced_at timestamptz;

create table if not exists public.competition_matchdays (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null check (matchday between 1 and 50),
  state text not null default 'scheduled' check (state in ('scheduled','open','locked','awaiting_stats','closed')),
  lock_at timestamptz,
  first_kickoff_at timestamptz,
  last_scheduled_kickoff_at timestamptz,
  locked_at timestamptz,
  closed_at timestamptz,
  fixture_count integer not null default 0 check (fixture_count >= 0),
  final_fixture_count integer not null default 0 check (final_fixture_count >= 0),
  stats_ready_count integer not null default 0 check (stats_ready_count >= 0),
  scoring_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_id, season, matchday)
);

create table if not exists public.matchday_lineup_drafts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.league_memberships(id) on delete cascade,
  league_id text not null references public.leagues(id) on delete cascade,
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null check (matchday between 1 and 50),
  formation text not null,
  captain_player_id text not null references public.players(id),
  starter_player_ids text[] not null,
  bench_player_ids text[] not null default '{}',
  total_value numeric(12,2) not null default 0,
  revision integer not null default 1 check (revision > 0),
  saved_at timestamptz not null default now(),
  unique (membership_id, season, matchday)
);

create table if not exists public.matchday_lineup_snapshots (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.competition_matchdays(id) on delete cascade,
  membership_id uuid not null references public.league_memberships(id) on delete cascade,
  league_id text not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  formation text not null,
  captain_player_id text references public.players(id),
  source text not null check (source in ('saved_draft','roster_fallback','empty')),
  valid boolean not null default false,
  starter_count smallint not null default 0,
  scoring_version integer not null,
  frozen_at timestamptz not null default now(),
  unique (matchday_id, membership_id)
);

create table if not exists public.matchday_lineup_snapshot_players (
  snapshot_id uuid not null references public.matchday_lineup_snapshots(id) on delete cascade,
  player_id text not null references public.players(id),
  slot_order smallint not null,
  role text not null check (role in ('starter','bench')),
  is_captain boolean not null default false,
  primary key (snapshot_id, player_id),
  unique (snapshot_id, slot_order)
);

-- La futura sincronización de estadísticas escribirá aquí una sola puntuación
-- definitiva por jugador y jornada. Todas las ligas reutilizan el mismo dato.
create table if not exists public.player_matchday_points (
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null,
  player_id text not null references public.players(id),
  points numeric(10,2) not null,
  scoring_version integer not null,
  source_payload jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  primary key (competition_id, season, matchday, player_id, scoring_version)
);

create table if not exists public.matchday_member_results (
  matchday_id uuid not null references public.competition_matchdays(id) on delete cascade,
  membership_id uuid not null references public.league_memberships(id) on delete cascade,
  league_id text not null references public.leagues(id) on delete cascade,
  points numeric(12,2) not null default 0,
  payout numeric(12,2) not null default 0,
  calculated_at timestamptz not null default now(),
  primary key (matchday_id, membership_id)
);

create table if not exists public.membership_balance_ledger (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.league_memberships(id) on delete cascade,
  matchday_id uuid references public.competition_matchdays(id) on delete cascade,
  kind text not null check (kind in ('matchday_payout','adjustment')),
  amount numeric(12,2) not null,
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (membership_id, matchday_id, kind)
);

create index if not exists competition_matchdays_state_idx on public.competition_matchdays(state, lock_at);
create index if not exists lineup_drafts_round_idx on public.matchday_lineup_drafts(league_id, season, matchday);
create index if not exists lineup_snapshots_member_idx on public.matchday_lineup_snapshots(membership_id, matchday_id);
create index if not exists balance_ledger_pending_idx on public.membership_balance_ledger(matchday_id, applied) where not applied;

create or replace function public.refresh_matchday_windows()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.competition_matchdays (
    competition_id, season, matchday, lock_at, first_kickoff_at,
    last_scheduled_kickoff_at, fixture_count, final_fixture_count,
    stats_ready_count, scoring_version
  )
  select
    f.competition_id,
    f.season,
    f.matchday,
    min(f.kickoff_at) + make_interval(mins => config.lock_offset_minutes),
    min(f.kickoff_at),
    max(f.kickoff_at),
    count(*),
    count(*) filter (where f.status in ('final','cancelled')),
    count(*) filter (where f.status = 'cancelled' or (f.status = 'final' and f.stats_ready)),
    config.scoring_version
  from public.match_fixtures f
  cross join public.matchday_lifecycle_config config
  where f.kickoff_at is not null
  group by f.competition_id, f.season, f.matchday, config.lock_offset_minutes, config.scoring_version
  on conflict (competition_id, season, matchday) do update set
    lock_at = case when competition_matchdays.state = 'open' then excluded.lock_at else competition_matchdays.lock_at end,
    first_kickoff_at = case when competition_matchdays.state = 'open' then excluded.first_kickoff_at else competition_matchdays.first_kickoff_at end,
    last_scheduled_kickoff_at = excluded.last_scheduled_kickoff_at,
    fixture_count = excluded.fixture_count,
    final_fixture_count = excluded.final_fixture_count,
    stats_ready_count = excluded.stats_ready_count,
    updated_at = now();
$$;

create or replace function public.refresh_matchday_windows_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$ begin perform public.refresh_matchday_windows(); return null; end; $$;

drop trigger if exists match_fixtures_refresh_matchdays on public.match_fixtures;
create trigger match_fixtures_refresh_matchdays
after insert or update or delete on public.match_fixtures
for each statement execute function public.refresh_matchday_windows_trigger();

create or replace function public.open_next_matchday_after_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state = 'open' and new.state = 'locked' then
    update public.competition_matchdays
       set state = 'open', updated_at = now()
     where id = (
       select id from public.competition_matchdays
        where competition_id = new.competition_id and season = new.season
          and matchday > new.matchday and state = 'scheduled'
        order by matchday limit 1
     );
  end if;
  return new;
end;
$$;

drop trigger if exists competition_matchdays_open_next on public.competition_matchdays;
create trigger competition_matchdays_open_next
after update of state on public.competition_matchdays
for each row execute function public.open_next_matchday_after_lock();

create or replace function public.save_my_matchday_lineup(
  target_membership_id uuid,
  target_season text,
  target_matchday integer,
  target_formation text,
  target_captain_player_id text,
  target_starter_player_ids text[],
  target_bench_player_ids text[] default '{}'
)
returns public.matchday_lineup_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_membership public.league_memberships;
  selected_league public.leagues;
  selected_window public.competition_matchdays;
  expected_por integer; expected_def integer; expected_med integer; expected_del integer;
  actual_por integer; actual_def integer; actual_med integer; actual_del integer;
  distinct_count integer; calculated_value numeric(12,2); result public.matchday_lineup_drafts;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  select * into selected_membership from public.league_memberships
   where id = target_membership_id and user_id = auth.uid() and left_at is null for update;
  if not found then raise exception 'La participación no está activa'; end if;
  select * into selected_league from public.leagues where id = selected_membership.league_id;
  select * into selected_window from public.competition_matchdays
   where competition_id = selected_league.competition_id and season = target_season and matchday = target_matchday;
  if not found or selected_window.state <> 'open' or selected_window.lock_at <= now() then
    raise exception 'La jornada ya está bloqueada';
  end if;
  if target_formation not in ('4-4-2','4-3-3','3-4-3','3-5-2','5-3-2') then raise exception 'Formación no válida'; end if;
  if cardinality(target_starter_player_ids) <> 11 then raise exception 'El once debe tener 11 jugadores'; end if;
  select count(distinct id) into distinct_count from unnest(target_starter_player_ids || coalesce(target_bench_player_ids, '{}')) id;
  if distinct_count <> cardinality(target_starter_player_ids) + cardinality(coalesce(target_bench_player_ids, '{}')) then raise exception 'Hay jugadores repetidos'; end if;
  if not target_captain_player_id = any(target_starter_player_ids) then raise exception 'El capitán debe ser titular'; end if;

  select
    count(*) filter (where position = 'POR'), count(*) filter (where position = 'DEF'),
    count(*) filter (where position = 'MED'), count(*) filter (where position = 'DEL'), sum(market_value)
  into actual_por, actual_def, actual_med, actual_del, calculated_value
  from public.players where id = any(target_starter_player_ids) and competition_id = selected_league.competition_id and active;
  expected_por := 1; expected_def := split_part(target_formation, '-', 1)::integer;
  expected_med := split_part(target_formation, '-', 2)::integer; expected_del := split_part(target_formation, '-', 3)::integer;
  if actual_por <> expected_por or actual_def <> expected_def or actual_med <> expected_med or actual_del <> expected_del then
    raise exception 'El once no respeta la formación';
  end if;
  if selected_league.mode = 'market' and exists (
    select 1 from unnest(target_starter_player_ids || coalesce(target_bench_player_ids, '{}')) selected(id)
    where not exists (
      select 1 from public.league_rosters r join public.league_roster_players rp on rp.roster_id = r.id
      where r.membership_id = selected_membership.id and rp.player_id = selected.id
    )
  ) then raise exception 'Solo puedes alinear jugadores de tu plantilla'; end if;
  if selected_league.mode = 'fantasy' and calculated_value > coalesce((selected_league.rules->>'lineupBudget')::numeric, selected_league.starting_budget) then
    raise exception 'El once supera el presupuesto';
  end if;

  insert into public.matchday_lineup_drafts (
    membership_id, league_id, competition_id, season, matchday, formation,
    captain_player_id, starter_player_ids, bench_player_ids, total_value
  ) values (
    selected_membership.id, selected_membership.league_id, selected_league.competition_id,
    target_season, target_matchday, target_formation, target_captain_player_id,
    target_starter_player_ids, coalesce(target_bench_player_ids, '{}'), calculated_value
  )
  on conflict (membership_id, season, matchday) do update set
    formation = excluded.formation, captain_player_id = excluded.captain_player_id,
    starter_player_ids = excluded.starter_player_ids, bench_player_ids = excluded.bench_player_ids,
    total_value = excluded.total_value, revision = matchday_lineup_drafts.revision + 1, saved_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.process_matchday_lifecycle(processed_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  round_record record; member_record record; draft_record public.matchday_lineup_drafts;
  roster_record public.league_rosters; snapshot_id uuid; fallback_captain text;
  locked_count integer := 0; closed_count integer := 0; payout_record record;
begin
  perform public.refresh_matchday_windows();

  for round_record in
    select * from public.competition_matchdays where state = 'open' and lock_at <= processed_at order by lock_at for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text, 0));
    for member_record in
      select m.*, l.competition_id from public.league_memberships m
      join public.leagues l on l.id = m.league_id
      where l.competition_id = round_record.competition_id and m.left_at is null
    loop
      select * into draft_record from public.matchday_lineup_drafts
       where membership_id = member_record.id and season = round_record.season and matchday = round_record.matchday;
      select * into roster_record from public.league_rosters where membership_id = member_record.id;
      fallback_captain := null;
      if draft_record.id is null and roster_record.id is not null then
        select rp.player_id into fallback_captain
        from public.league_roster_players rp join public.players p on p.id = rp.player_id
        where rp.roster_id = roster_record.id and rp.is_starter
        order by case when p.position = 'DEL' then 0 else 1 end, rp.slot_order limit 1;
      end if;

      insert into public.matchday_lineup_snapshots (
        matchday_id, membership_id, league_id, team_id, formation, captain_player_id,
        source, valid, starter_count, scoring_version
      ) values (
        round_record.id, member_record.id, member_record.league_id, member_record.team_id,
        coalesce(draft_record.formation, roster_record.formation, '4-4-2'),
        coalesce(draft_record.captain_player_id, fallback_captain),
        case when draft_record.id is not null then 'saved_draft' when roster_record.id is not null then 'roster_fallback' else 'empty' end,
        draft_record.id is not null or roster_record.id is not null,
        case when draft_record.id is not null then cardinality(draft_record.starter_player_ids)
             when roster_record.id is not null then (select count(*) from public.league_roster_players where roster_id = roster_record.id and is_starter)
             else 0 end,
        round_record.scoring_version
      ) on conflict (matchday_id, membership_id) do nothing returning id into snapshot_id;

      if snapshot_id is not null and draft_record.id is not null then
        insert into public.matchday_lineup_snapshot_players (snapshot_id, player_id, slot_order, role, is_captain)
        select snapshot_id, listed.player_id, listed.slot_order, 'starter', listed.player_id = draft_record.captain_player_id
        from unnest(draft_record.starter_player_ids) with ordinality listed(player_id, slot_order);
        insert into public.matchday_lineup_snapshot_players (snapshot_id, player_id, slot_order, role, is_captain)
        select snapshot_id, listed.player_id, cardinality(draft_record.starter_player_ids) + listed.slot_order, 'bench', false
        from unnest(draft_record.bench_player_ids) with ordinality listed(player_id, slot_order);
      elsif snapshot_id is not null and roster_record.id is not null then
        insert into public.matchday_lineup_snapshot_players (snapshot_id, player_id, slot_order, role, is_captain)
        select snapshot_id, rp.player_id, rp.slot_order, case when rp.is_starter then 'starter' else 'bench' end, rp.player_id = fallback_captain
        from public.league_roster_players rp where rp.roster_id = roster_record.id order by rp.slot_order;
      end if;
      snapshot_id := null; draft_record := null; roster_record := null;
    end loop;
    update public.competition_matchdays set state = 'locked', locked_at = processed_at, updated_at = now() where id = round_record.id and state = 'open';
    locked_count := locked_count + 1;
  end loop;

  update public.competition_matchdays d set state = 'awaiting_stats', updated_at = now()
  where d.state = 'locked' and d.fixture_count > 0 and d.final_fixture_count = d.fixture_count and d.stats_ready_count < d.fixture_count;

  for round_record in
    select * from public.competition_matchdays
    where state in ('locked','awaiting_stats') and fixture_count > 0 and stats_ready_count = fixture_count
    order by matchday for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text, 0));
    insert into public.matchday_member_results (matchday_id, membership_id, league_id, points, payout)
    select
      round_record.id, snapshot.membership_id, snapshot.league_id,
      coalesce(sum(coalesce(points.points, 0) * case when selected.is_captain then config.captain_multiplier else 1 end), 0),
      least(config.maximum_payout, greatest(config.minimum_payout,
        coalesce(sum(coalesce(points.points, 0) * case when selected.is_captain then config.captain_multiplier else 1 end), 0) * config.money_per_point))
    from public.matchday_lineup_snapshots snapshot
    cross join public.matchday_lifecycle_config config
    left join public.matchday_lineup_snapshot_players selected on selected.snapshot_id = snapshot.id and selected.role = 'starter'
    left join public.player_matchday_points points on points.competition_id = round_record.competition_id
      and points.season = round_record.season and points.matchday = round_record.matchday
      and points.player_id = selected.player_id and points.scoring_version = snapshot.scoring_version
    where snapshot.matchday_id = round_record.id
    group by snapshot.id, snapshot.membership_id, snapshot.league_id, config.maximum_payout, config.minimum_payout, config.money_per_point
    on conflict (matchday_id, membership_id) do nothing;

    insert into public.membership_balance_ledger (membership_id, matchday_id, kind, amount)
    select membership_id, matchday_id, 'matchday_payout', payout from public.matchday_member_results where matchday_id = round_record.id
    on conflict (membership_id, matchday_id, kind) do nothing;
    for payout_record in select * from public.membership_balance_ledger where matchday_id = round_record.id and not applied for update
    loop
      update public.league_memberships set budget = budget + payout_record.amount where id = payout_record.membership_id;
      update public.membership_balance_ledger set applied = true, applied_at = now() where id = payout_record.id;
    end loop;
    update public.competition_matchdays set state = 'closed', closed_at = processed_at, updated_at = now() where id = round_record.id;
    closed_count := closed_count + 1;
  end loop;
  return jsonb_build_object('processedAt', processed_at, 'locked', locked_count, 'closed', closed_count);
end;
$$;

create or replace function public.my_matchday_lineup_drafts()
returns setof public.matchday_lineup_drafts
language sql
stable
security definer
set search_path = public
as $$
  select draft.* from public.matchday_lineup_drafts draft
  join public.league_memberships membership on membership.id = draft.membership_id
  where membership.user_id = auth.uid() and membership.left_at is null
  order by draft.matchday, draft.saved_at;
$$;

create or replace function public.admin_process_matchday_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Acceso reservado a administradores'; end if;
  return public.process_matchday_lifecycle(now());
end;
$$;

select public.refresh_matchday_windows();

update public.competition_matchdays target
set state = 'open', updated_at = now()
where target.id in (
  select distinct on (competition_id, season) id
  from public.competition_matchdays
  where state = 'scheduled'
  order by competition_id, season, matchday
);

alter table public.matchday_lifecycle_config enable row level security;
alter table public.competition_matchdays enable row level security;
alter table public.matchday_lineup_drafts enable row level security;
alter table public.matchday_lineup_snapshots enable row level security;
alter table public.matchday_lineup_snapshot_players enable row level security;
alter table public.player_matchday_points enable row level security;
alter table public.matchday_member_results enable row level security;
alter table public.membership_balance_ledger enable row level security;

create policy competition_matchdays_read on public.competition_matchdays for select to anon, authenticated using (true);
create policy lineup_drafts_read_own on public.matchday_lineup_drafts for select to authenticated using (
  exists (select 1 from public.league_memberships m where m.id = membership_id and m.user_id = auth.uid())
);
create policy lineup_snapshots_read_own on public.matchday_lineup_snapshots for select to authenticated using (
  exists (select 1 from public.league_memberships m where m.id = membership_id and m.user_id = auth.uid())
);
create policy snapshot_players_read_own on public.matchday_lineup_snapshot_players for select to authenticated using (
  exists (select 1 from public.matchday_lineup_snapshots s join public.league_memberships m on m.id = s.membership_id where s.id = snapshot_id and m.user_id = auth.uid())
);
create policy member_results_read_own on public.matchday_member_results for select to authenticated using (
  exists (select 1 from public.league_memberships m where m.id = membership_id and m.user_id = auth.uid())
);
create policy balance_ledger_read_own on public.membership_balance_ledger for select to authenticated using (
  exists (select 1 from public.league_memberships m where m.id = membership_id and m.user_id = auth.uid())
);

revoke all on public.matchday_lifecycle_config, public.matchday_lineup_drafts,
  public.matchday_lineup_snapshots, public.matchday_lineup_snapshot_players,
  public.player_matchday_points, public.matchday_member_results, public.membership_balance_ledger
  from anon, authenticated;
grant select on public.competition_matchdays to anon, authenticated;
grant select on public.matchday_lineup_drafts, public.matchday_lineup_snapshots,
  public.matchday_lineup_snapshot_players, public.matchday_member_results,
  public.membership_balance_ledger to authenticated;
grant execute on function public.save_my_matchday_lineup(uuid,text,integer,text,text,text[],text[]) to authenticated;
grant execute on function public.my_matchday_lineup_drafts() to authenticated;
grant execute on function public.admin_process_matchday_lifecycle() to authenticated;
revoke all on function public.process_matchday_lifecycle(timestamptz), public.refresh_matchday_windows() from public, anon, authenticated;
grant execute on function public.process_matchday_lifecycle(timestamptz), public.refresh_matchday_windows() to service_role;
grant all on public.matchday_lifecycle_config, public.competition_matchdays,
  public.matchday_lineup_drafts, public.matchday_lineup_snapshots,
  public.matchday_lineup_snapshot_players, public.player_matchday_points,
  public.matchday_member_results, public.membership_balance_ledger to service_role;

-- pg_cron ejecuta solo lógica local. La API deportiva se consulta por separado
-- únicamente cuando el calendario indica que hay algo que sincronizar.
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'nexo-matchday-lifecycle' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('nexo-matchday-lifecycle', '*/5 * * * *', 'select public.process_matchday_lifecycle();');
end $$;
