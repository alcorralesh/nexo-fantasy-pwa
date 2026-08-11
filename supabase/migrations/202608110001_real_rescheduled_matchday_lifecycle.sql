-- Ciclo real de jornadas con aplazamientos, adelantos y ventanas simultaneas.
-- Los cierres provisionales y sus ajustes son idempotentes y auditables.

alter table public.matchday_lifecycle_config
  add column if not exists lineup_open_hours integer not null default 168
    check (lineup_open_hours between 24 and 720),
  add column if not exists advanced_notice_hours integer not null default 24
    check (advanced_notice_hours between 1 and 168);

alter table public.matchday_lifecycle_config
  alter column postponed_policy set default 'provisional';
update public.matchday_lifecycle_config
set postponed_policy='provisional',updated_at=now()
where postponed_policy='wait'
  and not exists(select 1 from public.matchday_member_results);

alter table public.competition_matchdays drop constraint if exists competition_matchdays_state_check;
alter table public.competition_matchdays
  add constraint competition_matchdays_state_check
  check (state in ('scheduled','open','locked','awaiting_stats','provisional','closed'));

alter table public.competition_matchdays
  add column if not exists postponed_fixture_count integer not null default 0
    check (postponed_fixture_count >= 0),
  add column if not exists provisional_deadline_at timestamptz,
  add column if not exists provisional_closed_at timestamptz,
  add column if not exists adjusted_at timestamptz,
  add column if not exists settlement_status text not null default 'pending'
    check (settlement_status in ('pending','provisional','final','adjusted')),
  add column if not exists settlement_revision integer not null default 0
    check (settlement_revision >= 0);

alter table public.matchday_member_results
  add column if not exists settlement_status text not null default 'final'
    check (settlement_status in ('provisional','final','adjusted')),
  add column if not exists revision integer not null default 1
    check (revision > 0);

alter table public.membership_balance_ledger
  add column if not exists revision integer not null default 1
    check (revision > 0);

alter table public.membership_balance_ledger
  drop constraint if exists membership_balance_ledger_membership_id_matchday_id_kind_key;
create unique index if not exists membership_balance_ledger_revision_unique
  on public.membership_balance_ledger(membership_id,matchday_id,kind,revision);

create table if not exists public.matchday_result_revisions (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.competition_matchdays(id) on delete cascade,
  membership_id uuid not null references public.league_memberships(id) on delete cascade,
  league_id text not null references public.leagues(id) on delete cascade,
  revision integer not null check (revision > 0),
  revision_type text not null check (revision_type in ('provisional','final','adjustment')),
  points_before numeric(12,2) not null default 0,
  points_after numeric(12,2) not null default 0,
  payout_before numeric(12,2) not null default 0,
  payout_after numeric(12,2) not null default 0,
  payout_delta numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(matchday_id,membership_id,revision)
);

create table if not exists public.match_fixture_schedule_changes (
  id uuid primary key default gen_random_uuid(),
  fixture_id text not null references public.match_fixtures(id) on delete cascade,
  competition_id text not null references public.competitions(id),
  season text not null,
  matchday smallint not null,
  change_type text not null check (change_type in ('postponed','advanced','rescheduled','restored')),
  previous_kickoff_at timestamptz,
  new_kickoff_at timestamptz,
  previous_status text not null,
  new_status text not null,
  late_notice boolean not null default false,
  source_name text not null default 'LALIGA',
  detected_at timestamptz not null default now()
);
create index if not exists match_fixture_schedule_changes_fixture_idx
  on public.match_fixture_schedule_changes(fixture_id,detected_at desc);
create index if not exists matchday_result_revisions_member_idx
  on public.matchday_result_revisions(membership_id,created_at desc);

create or replace function public.preserve_fixture_sporting_matchday()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  -- Una reprogramacion cambia la fecha, nunca la jornada deportiva original.
  if old.matchday is distinct from new.matchday then new.matchday := old.matchday; end if;
  return new;
end;
$$;

drop trigger if exists match_fixtures_preserve_sporting_matchday on public.match_fixtures;
create trigger match_fixtures_preserve_sporting_matchday
before update on public.match_fixtures
for each row execute function public.preserve_fixture_sporting_matchday();

create or replace function public.audit_fixture_schedule_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  change_id uuid;
  change_kind text;
  warning_hours integer;
  is_late boolean;
  member record;
  title text;
  body text;
begin
  -- Los cambios normales scheduled -> live -> final no son reprogramaciones.
  if old.kickoff_at is not distinct from new.kickoff_at
     and old.status <> 'postponed' and new.status <> 'postponed' then return new; end if;

  select advanced_notice_hours into warning_hours
  from public.matchday_lifecycle_config where id=true;
  change_kind := case
    when new.status='postponed' and old.status<>'postponed' then 'postponed'
    when old.status='postponed' and new.status<>'postponed' then 'restored'
    when old.kickoff_at is not null and new.kickoff_at is not null and new.kickoff_at<old.kickoff_at then 'advanced'
    else 'rescheduled' end;
  is_late := change_kind='advanced' and new.kickoff_at is not null
    and new.kickoff_at <= now()+make_interval(hours=>coalesce(warning_hours,24));

  insert into public.match_fixture_schedule_changes(
    fixture_id,competition_id,season,matchday,change_type,
    previous_kickoff_at,new_kickoff_at,previous_status,new_status,late_notice,source_name
  ) values(
    new.id,new.competition_id,new.season,new.matchday,change_kind,
    old.kickoff_at,new.kickoff_at,old.status,new.status,is_late,new.source_name
  ) returning id into change_id;

  title := case change_kind
    when 'postponed' then 'Partido aplazado'
    when 'advanced' then case when is_late then 'Partido adelantado: revisa tu once' else 'Partido adelantado' end
    when 'restored' then 'Nueva fecha para el partido aplazado'
    else 'Horario actualizado' end;
  body := new.home_short_name||' - '||new.away_short_name||' sigue perteneciendo a la Jornada '
    ||new.matchday||'. '||case
      when change_kind='postponed' then 'Tu alineacion de esa jornada se conservara para cuando se dispute.'
      when change_kind='advanced' then 'La alineacion de esa jornada se bloqueara al comenzar este encuentro.'
      else 'Consulta el calendario para ver la nueva hora.' end;

  for member in
    select membership.user_id,league.id as league_id
    from public.leagues league
    join public.league_memberships membership
      on membership.league_id=league.id and membership.left_at is null
    where league.competition_id=new.competition_id
  loop
    perform public.create_nexo_notification(
      member.user_id,'matchday',title,body,member.league_id,'jornada',
      'fixture-schedule:'||change_id::text||':'||member.user_id::text
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists match_fixtures_schedule_audit on public.match_fixtures;
create trigger match_fixtures_schedule_audit
after update of kickoff_at,status on public.match_fixtures
for each row execute function public.audit_fixture_schedule_change();

create or replace function public.refresh_matchday_windows()
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  open_hours integer;
begin
  select lineup_open_hours into open_hours from public.matchday_lifecycle_config where id=true;
  insert into public.competition_matchdays(
    competition_id,season,matchday,lock_at,first_kickoff_at,last_scheduled_kickoff_at,
    fixture_count,final_fixture_count,stats_ready_count,postponed_fixture_count,
    provisional_deadline_at,scoring_version
  )
  select fixture.competition_id,fixture.season,fixture.matchday,
    min(fixture.kickoff_at)+make_interval(mins=>config.lock_offset_minutes),
    min(fixture.kickoff_at),max(fixture.kickoff_at),count(*),
    count(*) filter(where fixture.status in('final','cancelled')),
    count(*) filter(where fixture.status='cancelled' or (fixture.status='final' and fixture.stats_ready)),
    count(*) filter(where fixture.status='postponed'),
    coalesce(
      max(fixture.kickoff_at) filter(where fixture.status not in('postponed','cancelled')),
      max(fixture.kickoff_at)
    )+make_interval(hours=>config.postponed_grace_hours),
    config.scoring_version
  from public.match_fixtures fixture
  cross join public.matchday_lifecycle_config config
  where fixture.kickoff_at is not null
  group by fixture.competition_id,fixture.season,fixture.matchday,
    config.lock_offset_minutes,config.postponed_grace_hours,config.scoring_version
  on conflict(competition_id,season,matchday) do update set
    lock_at=case when competition_matchdays.state in('scheduled','open') then excluded.lock_at else competition_matchdays.lock_at end,
    first_kickoff_at=case when competition_matchdays.state in('scheduled','open') then excluded.first_kickoff_at else competition_matchdays.first_kickoff_at end,
    last_scheduled_kickoff_at=excluded.last_scheduled_kickoff_at,
    fixture_count=excluded.fixture_count,
    final_fixture_count=excluded.final_fixture_count,
    stats_ready_count=excluded.stats_ready_count,
    postponed_fixture_count=excluded.postponed_fixture_count,
    provisional_deadline_at=excluded.provisional_deadline_at,
    updated_at=now();

  -- Corrige aperturas antiguas que quedaron demasiado adelantadas. Los
  -- borradores no se eliminan: simplemente vuelven a quedar ocultos hasta que
  -- su jornada entre de nuevo en la ventana de preparacion.
  update public.competition_matchdays round
  set state='scheduled',updated_at=now()
  where round.state='open'
    and round.lock_at>now()+make_interval(hours=>coalesce(open_hours,168))
    and exists(
      select 1 from public.competition_matchdays earlier
      where earlier.competition_id=round.competition_id
        and earlier.season=round.season
        and earlier.matchday<round.matchday
        and earlier.state in('scheduled','open')
        and earlier.lock_at>now()
    );

  -- Puede haber varias jornadas editables: la siguiente natural y cualquiera
  -- cuyo primer partido se haya adelantado dentro de la ventana de preparacion.
  update public.competition_matchdays round
  set state='open',updated_at=now()
  where round.state='scheduled' and round.lock_at>now()
    and (
      round.lock_at<=now()+make_interval(hours=>coalesce(open_hours,168))
      or (
        not exists(
          select 1 from public.competition_matchdays earlier_open
          where earlier_open.competition_id=round.competition_id
            and earlier_open.season=round.season
            and earlier_open.matchday<round.matchday
            and earlier_open.state='open'
            and earlier_open.lock_at>now()
        )
        and round.id=(
          select candidate.id from public.competition_matchdays candidate
          where candidate.competition_id=round.competition_id and candidate.season=round.season
            and candidate.state='scheduled' and candidate.lock_at>now()
          order by candidate.matchday limit 1
        )
      )
    );
end;
$$;

create or replace function public.apply_matchday_settlement_revision(
  target_matchday_id uuid,
  target_revision_type text,
  processed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  round_record public.competition_matchdays;
  calculated record;
  previous_result public.matchday_member_results;
  next_revision integer;
  delta numeric(12,2);
  affected integer:=0;
  total_delta numeric(12,2):=0;
  ledger_kind text;
  result_status text;
begin
  if target_revision_type not in('provisional','final','adjustment') then
    raise exception 'Tipo de liquidacion no valido';
  end if;
  select * into round_record from public.competition_matchdays
  where id=target_matchday_id for update;
  if not found then raise exception 'La jornada no existe'; end if;
  perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
  next_revision:=round_record.settlement_revision+1;
  ledger_kind:=case when next_revision=1 then 'matchday_payout' else 'adjustment' end;
  result_status:=case when target_revision_type='adjustment' then 'adjusted' else target_revision_type end;

  for calculated in select * from public.calculate_matchday_settlement(round_record.id)
  loop
    select * into previous_result from public.matchday_member_results
    where matchday_id=round_record.id and membership_id=calculated.membership_id for update;
    delta:=case when calculated.mode='market'
      then calculated.payout-coalesce(previous_result.payout,0) else 0 end;

    insert into public.matchday_result_revisions(
      matchday_id,membership_id,league_id,revision,revision_type,
      points_before,points_after,payout_before,payout_after,payout_delta,created_at
    ) values(
      round_record.id,calculated.membership_id,calculated.league_id,next_revision,target_revision_type,
      coalesce(previous_result.points,0),calculated.points,coalesce(previous_result.payout,0),
      case when calculated.mode='market' then calculated.payout else 0 end,delta,processed_at
    ) on conflict(matchday_id,membership_id,revision) do nothing;

    insert into public.matchday_member_results(
      matchday_id,membership_id,league_id,points,payout,calculated_at,settlement_status,revision
    ) values(
      round_record.id,calculated.membership_id,calculated.league_id,calculated.points,
      case when calculated.mode='market' then calculated.payout else 0 end,
      processed_at,result_status,next_revision
    ) on conflict(matchday_id,membership_id) do update set
      points=excluded.points,payout=excluded.payout,calculated_at=excluded.calculated_at,
      settlement_status=excluded.settlement_status,revision=excluded.revision;

    if calculated.mode='market' and delta<>0 then
      insert into public.membership_balance_ledger(
        membership_id,matchday_id,kind,amount,revision,applied,created_at,applied_at
      ) values(
        calculated.membership_id,round_record.id,ledger_kind,delta,next_revision,true,processed_at,processed_at
      ) on conflict(membership_id,matchday_id,kind,revision) do nothing;
      if found then
        update public.league_memberships set budget=budget+delta where id=calculated.membership_id;
        total_delta:=total_delta+delta;
      end if;
    end if;
    affected:=affected+1;
    previous_result:=null;
  end loop;

  update public.competition_matchdays
  set settlement_revision=next_revision,
    settlement_status=case when target_revision_type='adjustment' then 'adjusted' else target_revision_type end,
    provisional_closed_at=case when target_revision_type='provisional' then processed_at else provisional_closed_at end,
    adjusted_at=case when target_revision_type='adjustment' then processed_at else adjusted_at end,
    updated_at=now()
  where id=round_record.id;
  return jsonb_build_object('revision',next_revision,'type',target_revision_type,
    'memberships',affected,'economicDelta',total_delta);
end;
$$;

create or replace function public.process_matchday_lifecycle(processed_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  round_record record;
  config public.matchday_lifecycle_config;
  locked_count integer:=0;
  provisional_count integer:=0;
  closed_count integer:=0;
  adjusted_count integer:=0;
begin
  select * into config from public.matchday_lifecycle_config where id=true;
  perform public.refresh_matchday_windows();

  for round_record in
    select * from public.competition_matchdays
    where state in('scheduled','open') and lock_at<=processed_at order by lock_at for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(round_record.id::text,0));
    perform public.snapshot_matchday_lineups(round_record.id);
    update public.competition_matchdays set state='locked',locked_at=processed_at,updated_at=now()
    where id=round_record.id and state in('scheduled','open');
    locked_count:=locked_count+1;
  end loop;

  update public.competition_matchdays round set state='awaiting_stats',updated_at=now()
  where round.state='locked' and round.fixture_count>0
    and round.stats_ready_count<round.fixture_count;

  if config.postponed_policy='provisional' then
    for round_record in
      select * from public.competition_matchdays
      where state in('locked','awaiting_stats') and fixture_count>0
        and postponed_fixture_count>0
        and stats_ready_count+postponed_fixture_count=fixture_count
        and provisional_deadline_at<=processed_at
      order by provisional_deadline_at for update skip locked
    loop
      perform public.apply_matchday_settlement_revision(round_record.id,'provisional',processed_at);
      update public.competition_matchdays
      set state='provisional',provisional_closed_at=processed_at,updated_at=now()
      where id=round_record.id and state in('locked','awaiting_stats');
      provisional_count:=provisional_count+1;
    end loop;
  end if;

  for round_record in
    select * from public.competition_matchdays
    where state in('locked','awaiting_stats','provisional') and fixture_count>0
      and stats_ready_count=fixture_count
    order by matchday for update skip locked
  loop
    if round_record.settlement_status='provisional' then
      perform public.apply_matchday_settlement_revision(round_record.id,'adjustment',processed_at);
      adjusted_count:=adjusted_count+1;
    else
      perform public.apply_matchday_settlement_revision(round_record.id,'final',processed_at);
    end if;
    update public.competition_matchdays
    set state='closed',closed_at=processed_at,updated_at=now()
    where id=round_record.id and state in('locked','awaiting_stats','provisional');
    closed_count:=closed_count+1;
  end loop;

  return jsonb_build_object('processedAt',processed_at,'locked',locked_count,
    'provisional',provisional_count,'closed',closed_count,'adjusted',adjusted_count);
end;
$$;

create or replace function public.notify_matchday_state_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare member record; notice_title text; notice_body text; destination text;
begin
  if old.state=new.state or new.state not in('open','locked','provisional','closed') then return new; end if;
  if new.state='open' then
    notice_title:='Jornada disponible';
    notice_body:='Ya puedes preparar una alineacion independiente para la Jornada '||new.matchday||'.'; destination:='equipo';
  elsif new.state='locked' then
    notice_title:='Alineacion bloqueada';
    notice_body:='La foto de la Jornada '||new.matchday||' esta guardada. Otras jornadas abiertas conservan su propio once.'; destination:='jornada';
  elsif new.state='provisional' then
    notice_title:='Cierre provisional de la Jornada '||new.matchday;
    notice_body:='Se han publicado los puntos disponibles. El partido aplazado generara un ajuste posterior automatico.'; destination:='jornada';
  else
    notice_title:=case when new.settlement_status='adjusted' then 'Jornada ajustada' else 'Jornada cerrada' end;
    notice_body:=case when new.settlement_status='adjusted'
      then 'El partido aplazado ya esta incluido y se ha aplicado solo la diferencia de puntos y saldo.'
      else 'Los puntos y premios de la Jornada '||new.matchday||' ya estan disponibles.' end;
    destination:='jornada';
  end if;
  for member in
    select membership.user_id,league.id as league_id from public.leagues league
    join public.league_memberships membership on membership.league_id=league.id and membership.left_at is null
    where league.competition_id=new.competition_id
  loop
    perform public.create_nexo_notification(member.user_id,'matchday',notice_title,notice_body,
      member.league_id,destination,'matchday:'||new.id::text||':'||new.state||':'||new.settlement_revision||':'||member.user_id::text);
  end loop;
  return new;
end;
$$;

drop function if exists public.my_matchday_history();

create function public.my_matchday_history()
returns table(
  membership_id uuid,league_id text,competition_id text,season text,matchday integer,state text,
  formation text,captain_player_id text,source text,valid boolean,starter_count integer,
  points numeric,payout numeric,calculated_at timestamptz,rank integer,league_average numeric,
  best_score numeric,players jsonb,settlement_status text,revision integer,
  provisional_closed_at timestamptz,adjusted_at timestamptz,adjustments jsonb
)
language sql stable security definer set search_path=public
as $$
  select snapshot.membership_id,snapshot.league_id,round.competition_id,round.season,
    round.matchday::integer,round.state,snapshot.formation,snapshot.captain_player_id,
    snapshot.source,snapshot.valid,snapshot.starter_count::integer,coalesce(result.points,0),
    coalesce(result.payout,0),result.calculated_at,
    case when result.membership_id is null then null else(
      select 1+count(*)::integer from public.matchday_member_results rival
      where rival.matchday_id=result.matchday_id and rival.league_id=result.league_id and rival.points>result.points
    ) end,
    coalesce((select round(avg(rival.points),2) from public.matchday_member_results rival
      where rival.matchday_id=snapshot.matchday_id and rival.league_id=snapshot.league_id),0),
    coalesce((select max(rival.points) from public.matchday_member_results rival
      where rival.matchday_id=snapshot.matchday_id and rival.league_id=snapshot.league_id),0),
    coalesce(detail.players,'[]'::jsonb),coalesce(result.settlement_status,'provisional'),
    coalesce(result.revision,0),round.provisional_closed_at,round.adjusted_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'revision',audit.revision,'type',audit.revision_type,'pointsBefore',audit.points_before,
      'pointsAfter',audit.points_after,'payoutBefore',audit.payout_before,
      'payoutAfter',audit.payout_after,'payoutDelta',audit.payout_delta,'createdAt',audit.created_at
    ) order by audit.revision) from public.matchday_result_revisions audit
      where audit.matchday_id=snapshot.matchday_id and audit.membership_id=snapshot.membership_id),'[]'::jsonb)
  from public.matchday_lineup_snapshots snapshot
  join public.league_memberships membership on membership.id=snapshot.membership_id and membership.user_id=auth.uid()
  join public.competition_matchdays round on round.id=snapshot.matchday_id
  left join public.matchday_member_results result on result.matchday_id=snapshot.matchday_id and result.membership_id=snapshot.membership_id
  left join lateral(
    select jsonb_agg(jsonb_build_object(
      'playerId',player.id,'name',player.name,'initials',player.initials,'position',player.position,
      'club',club.name,'photoUrl',player.photo_url,'role',selected.role,'slotOrder',selected.slot_order,
      'isCaptain',selected.is_captain,'rawPoints',coalesce(player_points.points,0),
      'multiplier',case when selected.is_captain then config.captain_multiplier else 1 end,
      'points',coalesce(player_points.points,0)*case when selected.is_captain then config.captain_multiplier else 1 end
    ) order by selected.slot_order) as players
    from public.matchday_lineup_snapshot_players selected
    join public.players player on player.id=selected.player_id
    join public.sports_clubs club on club.id=player.sports_club_id
    cross join public.matchday_lifecycle_config config
    left join public.player_matchday_points player_points
      on player_points.competition_id=round.competition_id and player_points.season=round.season
      and player_points.matchday=round.matchday and player_points.player_id=selected.player_id
      and player_points.scoring_version=snapshot.scoring_version
    where selected.snapshot_id=snapshot.id
  ) detail on true
  where auth.uid() is not null
  order by snapshot.league_id,round.matchday;
$$;

do $$
begin
  if to_regprocedure('public.admin_simulate_matchday_close_core(text,text,integer,text)') is null then
    alter function public.admin_simulate_matchday_close(text,text,integer,text)
      rename to admin_simulate_matchday_close_core;
  end if;
end;
$$;

create or replace function public.admin_simulate_matchday_close(
  target_competition_id text,
  target_season text,
  target_matchday integer,
  target_scenario text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  base_result jsonb;
  selected_round public.competition_matchdays;
  config public.matchday_lifecycle_config;
  related_rounds jsonb:='[]'::jsonb;
  lifecycle_preview jsonb;
begin
  base_result:=public.admin_simulate_matchday_close_core(
    target_competition_id,target_season,target_matchday,target_scenario
  );
  select * into selected_round from public.competition_matchdays
  where competition_id=target_competition_id and season=target_season and matchday=target_matchday;
  select * into config from public.matchday_lifecycle_config where id=true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',candidate.id,'matchday',candidate.matchday,'state',candidate.state,
    'lockAt',candidate.lock_at,'firstKickoffAt',candidate.first_kickoff_at,
    'draftCount',(select count(*) from public.matchday_lineup_drafts draft
      where draft.competition_id=candidate.competition_id and draft.season=candidate.season
        and draft.matchday=candidate.matchday),
    'snapshotCount',(select count(*) from public.matchday_lineup_snapshots snapshot
      where snapshot.matchday_id=candidate.id)
  ) order by candidate.lock_at,candidate.matchday),'[]'::jsonb)
  into related_rounds
  from public.competition_matchdays candidate
  where candidate.competition_id=selected_round.competition_id
    and candidate.season=selected_round.season and candidate.id<>selected_round.id
    and candidate.state in('open','locked','awaiting_stats','provisional')
    and (
      candidate.first_kickoff_at::date=selected_round.first_kickoff_at::date
      or (target_scenario='advanced' and candidate.matchday between selected_round.matchday-1 and selected_round.matchday+1)
    );

  lifecycle_preview:=case target_scenario
    when 'postponed' then jsonb_build_object(
      'operation',case when config.postponed_policy='provisional' then 'provisional_close' else 'wait' end,
      'canExecute',config.postponed_policy='provisional',
      'provisional',config.postponed_policy='provisional',
      'adjustmentPending',config.postponed_policy='provisional',
      'graceHours',config.postponed_grace_hours,
      'economicMode',case when config.postponed_policy='provisional' then 'confirmed_points_then_delta' else 'no_payment_until_final' end,
      'steps',case when config.postponed_policy='provisional' then jsonb_build_array(
        'Se cierra provisionalmente con los partidos confirmados.',
        'Solo las ligas de mercado reciben el pago provisional.',
        'El aplazado conserva la foto original de esta jornada.',
        'Al llegar sus estadisticas se recalcula y se aplica solo la diferencia.'
      ) else jsonb_build_array(
        'Se muestran puntos informativos, pero no se liquida saldo.',
        'La jornada espera al partido aplazado.',
        'Cuando llegan todas las estadisticas se realiza un unico cierre final.'
      ) end,
      'overlappingMatchdays',related_rounds
    )
    when 'advanced' then jsonb_build_object(
      'operation','independent_lock','canExecute',true,'provisional',false,'adjustmentPending',false,
      'noticeHours',config.advanced_notice_hours,
      'economicMode','independent_by_sporting_matchday',
      'steps',jsonb_build_array(
        'El encuentro conserva su jornada deportiva aunque cambie de fecha.',
        'Su jornada se abre dentro de la ventana de preparacion.',
        'Al comenzar el encuentro se congela solo el once de esa jornada.',
        'Cualquier otra jornada del mismo dia mantiene su alineacion y cierre independientes.'
      ),
      'overlappingMatchdays',related_rounds
    )
    else jsonb_build_object(
      'operation',case when coalesce((base_result->>'settlementReady')::boolean,false) then 'final_close' else 'blocked' end,
      'canExecute',coalesce((base_result->>'settlementReady')::boolean,false),
      'provisional',false,'adjustmentPending',false,
      'economicMode','final_once',
      'steps',jsonb_build_array(
        'Se usa la foto inmutable de la jornada.',
        'Se consolidan puntos y clasificacion.',
        'Las ligas de mercado reciben un unico pago idempotente.'
      ),
      'overlappingMatchdays',related_rounds
    ) end;
  return base_result||jsonb_build_object('lifecyclePreview',lifecycle_preview);
end;
$$;

create or replace function public.get_matchday_lifecycle_config()
returns jsonb
language sql stable security definer set search_path=public
as $$
  select jsonb_build_object(
    'moneyPerPoint',money_per_point,'minimumPayout',minimum_payout,
    'maximumPayout',maximum_payout,'postponedGraceHours',postponed_grace_hours,
    'postponedPolicy',postponed_policy,'advanceNoticeHours',advanced_notice_hours,
    'lineupOpenHours',lineup_open_hours
  ) from public.matchday_lifecycle_config where id=true;
$$;

create or replace function public.admin_save_matchday_lifecycle_config(
  target_money_per_point numeric,
  target_minimum_payout numeric,
  target_maximum_payout numeric,
  target_postponed_grace_hours integer,
  target_postponed_policy text,
  target_advance_notice_hours integer,
  target_lineup_open_hours integer
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  if target_postponed_policy not in('wait','provisional') then
    raise exception 'Politica de aplazados no valida';
  end if;
  if target_money_per_point<0 or target_minimum_payout<0
    or target_maximum_payout<target_minimum_payout then
    raise exception 'Configuracion economica no valida';
  end if;
  update public.matchday_lifecycle_config set
    money_per_point=target_money_per_point,minimum_payout=target_minimum_payout,
    maximum_payout=target_maximum_payout,postponed_grace_hours=target_postponed_grace_hours,
    postponed_policy=target_postponed_policy,advanced_notice_hours=target_advance_notice_hours,
    lineup_open_hours=target_lineup_open_hours,updated_at=now()
  where id=true;
  perform public.refresh_matchday_windows();
  return public.get_matchday_lifecycle_config();
end;
$$;

alter table public.matchday_result_revisions enable row level security;
alter table public.match_fixture_schedule_changes enable row level security;
drop policy if exists matchday_result_revisions_read_own on public.matchday_result_revisions;
create policy matchday_result_revisions_read_own on public.matchday_result_revisions
for select to authenticated using(exists(
  select 1 from public.league_memberships membership
  where membership.id=membership_id and membership.user_id=auth.uid()
));
drop policy if exists match_fixture_schedule_changes_read on public.match_fixture_schedule_changes;
create policy match_fixture_schedule_changes_read on public.match_fixture_schedule_changes
for select to anon,authenticated using(true);

revoke all on public.matchday_result_revisions,public.match_fixture_schedule_changes from anon,authenticated;
grant select on public.matchday_result_revisions to authenticated;
grant select on public.match_fixture_schedule_changes to anon,authenticated;
grant all on public.matchday_result_revisions,public.match_fixture_schedule_changes to service_role;
revoke all on function public.apply_matchday_settlement_revision(uuid,text,timestamptz),
  public.preserve_fixture_sporting_matchday(),public.audit_fixture_schedule_change() from public,anon,authenticated;
grant execute on function public.apply_matchday_settlement_revision(uuid,text,timestamptz),
  public.preserve_fixture_sporting_matchday(),public.audit_fixture_schedule_change() to service_role;
revoke all on function public.admin_simulate_matchday_close_core(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.admin_simulate_matchday_close_core(text,text,integer,text) to service_role;
revoke all on function public.admin_simulate_matchday_close(text,text,integer,text) from public,anon;
grant execute on function public.admin_simulate_matchday_close(text,text,integer,text) to authenticated,service_role;
revoke all on function public.get_matchday_lifecycle_config() from public,anon;
grant execute on function public.get_matchday_lifecycle_config() to authenticated,service_role;
revoke all on function public.admin_save_matchday_lifecycle_config(numeric,numeric,numeric,integer,text,integer,integer) from public,anon;
grant execute on function public.admin_save_matchday_lifecycle_config(numeric,numeric,numeric,integer,text,integer,integer) to authenticated,service_role;
revoke all on function public.my_matchday_history() from public,anon;
grant execute on function public.my_matchday_history() to authenticated,service_role;

select public.refresh_matchday_windows();
notify pgrst,'reload schema';
