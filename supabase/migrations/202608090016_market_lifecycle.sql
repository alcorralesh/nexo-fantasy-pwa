-- Mercado por liga: calendario propio, listados, pujas y renovación automática.
-- El intervalo activo queda congelado durante el ciclo; un cambio de reglas se usa al programar el siguiente.

create table if not exists public.league_market_cycles (
  league_id text primary key references public.leagues(id) on delete cascade,
  cycle_number integer not null default 1 check (cycle_number > 0),
  interval_hours integer not null check (interval_hours between 1 and 168),
  initialized_at timestamptz not null default now(),
  cycle_started_at timestamptz not null default now(),
  last_renewed_at timestamptz,
  next_renewal_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.league_market_listings (
  id uuid primary key default gen_random_uuid(),
  league_id text not null references public.leagues(id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  player_id text not null references public.players(id),
  seller_membership_id uuid references public.league_memberships(id) on delete cascade,
  minimum_price numeric(12,2) not null check (minimum_price >= 0),
  status text not null default 'available' check (status in ('available','sold','expired','withdrawn')),
  winner_membership_id uuid references public.league_memberships(id) on delete set null,
  winning_amount numeric(12,2),
  listed_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (league_id, cycle_number, player_id)
);

create unique index if not exists league_market_player_available
  on public.league_market_listings(league_id, player_id) where status = 'available';
create index if not exists league_market_listings_cycle_idx
  on public.league_market_listings(league_id, cycle_number, status);

create table if not exists public.league_market_bids (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.league_market_listings(id) on delete cascade,
  bidder_membership_id uuid not null references public.league_memberships(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'active' check (status in ('active','won','lost','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (listing_id, bidder_membership_id)
);

create index if not exists league_market_bids_member_idx
  on public.league_market_bids(bidder_membership_id, status);

create table if not exists public.league_market_events (
  id uuid primary key default gen_random_uuid(),
  league_id text not null references public.leagues(id) on delete cascade,
  cycle_number integer not null,
  event_type text not null check (event_type in ('initialized','renewed','transfer','unsold')),
  listing_id uuid references public.league_market_listings(id) on delete set null,
  membership_id uuid references public.league_memberships(id) on delete set null,
  player_id text references public.players(id),
  amount numeric(12,2),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists league_market_events_recent_idx
  on public.league_market_events(league_id, created_at desc);

create or replace function public.market_rule_hours(target_league public.leagues)
returns integer language sql immutable as $$
  select greatest(1, least(168, coalesce((target_league.rules->>'renewalHours')::integer, 24)));
$$;

create or replace function public.market_rule_listing_count(target_league public.leagues)
returns integer language sql immutable as $$
  select greatest(5, least(30, coalesce((target_league.rules->>'marketPlayersPerRenewal')::integer, 10)));
$$;

create or replace function public.seed_league_market_listings(target_league_id text, target_cycle integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare selected_league public.leagues; requested_count integer; inserted_count integer;
begin
  select * into selected_league from public.leagues where id = target_league_id;
  if not found or selected_league.mode <> 'market' then return 0; end if;
  requested_count := public.market_rule_listing_count(selected_league);

  insert into public.league_market_listings(league_id, cycle_number, player_id, minimum_price)
  select selected_league.id, target_cycle, candidate.id, candidate.market_value
  from (
    select player.id, player.market_value,
           row_number() over (partition by player.position order by md5(player.id || ':' || target_cycle::text || ':' || selected_league.id)) as position_rank,
           md5(player.id || ':' || target_cycle::text || ':' || selected_league.id) as random_order
      from public.players player
     where player.competition_id = selected_league.competition_id and player.active
       and not exists (
         select 1 from public.league_roster_players owned
          where owned.league_id = selected_league.id and owned.player_id = player.id
       )
       and not exists (
         select 1 from public.league_market_listings active_listing
          where active_listing.league_id = selected_league.id and active_listing.player_id = player.id
            and active_listing.status = 'available'
       )
  ) candidate
  order by case when candidate.position_rank <= greatest(1, requested_count / 4) then 0 else 1 end, candidate.random_order
  limit requested_count
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.initialize_league_market(target_league_id text, seed_now boolean default true)
returns public.league_market_cycles
language plpgsql security definer set search_path = public
as $$
declare selected_league public.leagues; state public.league_market_cycles; active_hours integer; seeded integer;
begin
  select * into selected_league from public.leagues where id = target_league_id;
  if not found or selected_league.mode <> 'market' then raise exception 'La liga no utiliza mercado renovable'; end if;
  active_hours := public.market_rule_hours(selected_league);
  insert into public.league_market_cycles(league_id, interval_hours, next_renewal_at)
  values (selected_league.id, active_hours, now() + make_interval(hours => active_hours))
  on conflict (league_id) do nothing;
  select * into state from public.league_market_cycles where league_id = selected_league.id;
  if seed_now and not exists (select 1 from public.league_market_listings where league_id = selected_league.id and status = 'available') then
    seeded := public.seed_league_market_listings(selected_league.id, state.cycle_number);
    if seeded > 0 then
      insert into public.league_market_events(league_id, cycle_number, event_type, payload)
      values (selected_league.id, state.cycle_number, 'initialized', jsonb_build_object('listings', seeded));
    end if;
  end if;
  return state;
end;
$$;

create or replace function public.initialize_market_on_league_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mode = 'market' then perform public.initialize_league_market(new.id, false); end if;
  return new;
end;
$$;
drop trigger if exists league_market_initialize on public.leagues;
create trigger league_market_initialize after insert on public.leagues
for each row execute function public.initialize_market_on_league_insert();

create or replace function public.resolve_league_market_cycle(target_league_id text, processed_at timestamptz default now(), force_now boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  selected_league public.leagues; state public.league_market_cycles; listing record; candidate record;
  bidder public.league_memberships; bidder_roster public.league_rosters; winner_found boolean;
  bench_count integer; max_bench integer; debt_percent numeric; next_slot integer;
  transfers integer := 0; unsold integer := 0; seeded integer := 0; next_hours integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id || ':market', 0));
  select * into selected_league from public.leagues where id = target_league_id for update;
  if not found or selected_league.mode <> 'market' then raise exception 'La liga no utiliza mercado renovable'; end if;
  perform public.initialize_league_market(selected_league.id, true);
  select * into state from public.league_market_cycles where league_id = selected_league.id for update;
  if not force_now and state.next_renewal_at > processed_at then
    return jsonb_build_object('renewed', false, 'nextRenewalAt', state.next_renewal_at);
  end if;

  max_bench := greatest(0, least(40, coalesce((selected_league.rules->>'maxBenchPlayers')::integer, 20)));
  debt_percent := greatest(0, least(100, coalesce((selected_league.rules->>'maxDebtPercent')::numeric, 20)));

  for listing in
    select * from public.league_market_listings
     where league_id = selected_league.id and cycle_number = state.cycle_number and status = 'available'
     order by listed_at, id for update
  loop
    winner_found := false;
    for candidate in
      select bid.* from public.league_market_bids bid
       where bid.listing_id = listing.id and bid.status = 'active'
       order by bid.amount desc, bid.created_at, bid.id for update
    loop
      select * into bidder from public.league_memberships
       where id = candidate.bidder_membership_id and league_id = selected_league.id and left_at is null for update;
      if not found then
        update public.league_market_bids set status = 'lost', resolved_at = processed_at where id = candidate.id;
        continue;
      end if;
      select * into bidder_roster from public.league_rosters where membership_id = bidder.id for update;
      if not found then continue; end if;
      select count(*) into bench_count from public.league_roster_players where roster_id = bidder_roster.id and not is_starter;
      if bench_count >= max_bench
         or candidate.amount > bidder.budget + greatest(0, bidder.budget) * debt_percent / 100
         or exists (select 1 from public.league_roster_players where league_id = selected_league.id and player_id = listing.player_id) then
        update public.league_market_bids set status = 'lost', resolved_at = processed_at where id = candidate.id;
        continue;
      end if;

      select coalesce(max(slot_order), 0) + 1 into next_slot from public.league_roster_players where roster_id = bidder_roster.id;
      insert into public.league_roster_players(roster_id, league_id, player_id, slot_order, is_starter)
      values (bidder_roster.id, selected_league.id, listing.player_id, next_slot, false);
      update public.league_rosters set total_value = total_value + listing.minimum_price where id = bidder_roster.id;
      update public.league_memberships set budget = budget - candidate.amount where id = bidder.id;
      update public.league_market_bids set status = case when id = candidate.id then 'won' else 'lost' end, resolved_at = processed_at
       where listing_id = listing.id and status = 'active';
      update public.league_market_listings set status = 'sold', winner_membership_id = bidder.id,
             winning_amount = candidate.amount, resolved_at = processed_at where id = listing.id;
      insert into public.league_market_events(league_id, cycle_number, event_type, listing_id, membership_id, player_id, amount)
      values (selected_league.id, state.cycle_number, 'transfer', listing.id, bidder.id, listing.player_id, candidate.amount);
      transfers := transfers + 1; winner_found := true; exit;
    end loop;
    if not winner_found then
      update public.league_market_bids set status = 'lost', resolved_at = processed_at where listing_id = listing.id and status = 'active';
      update public.league_market_listings set status = 'expired', resolved_at = processed_at where id = listing.id;
      insert into public.league_market_events(league_id, cycle_number, event_type, listing_id, player_id)
      values (selected_league.id, state.cycle_number, 'unsold', listing.id, listing.player_id);
      unsold := unsold + 1;
    end if;
  end loop;

  next_hours := public.market_rule_hours(selected_league);
  update public.league_market_cycles
     set cycle_number = cycle_number + 1, interval_hours = next_hours,
         last_renewed_at = processed_at, cycle_started_at = processed_at,
         next_renewal_at = processed_at + make_interval(hours => next_hours), updated_at = now()
   where league_id = selected_league.id returning * into state;
  seeded := public.seed_league_market_listings(selected_league.id, state.cycle_number);
  insert into public.league_market_events(league_id, cycle_number, event_type, payload)
  values (selected_league.id, state.cycle_number, 'renewed', jsonb_build_object('transfers', transfers, 'unsold', unsold, 'listings', seeded, 'intervalHours', next_hours));
  return jsonb_build_object('renewed', true, 'cycleNumber', state.cycle_number, 'transfers', transfers, 'unsold', unsold, 'listings', seeded, 'nextRenewalAt', state.next_renewal_at, 'intervalHours', next_hours);
end;
$$;

create or replace function public.process_due_league_markets(processed_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare item record; processed integer := 0;
begin
  for item in select league_id from public.league_market_cycles where next_renewal_at <= processed_at order by next_renewal_at
  loop
    perform public.resolve_league_market_cycle(item.league_id, processed_at, false);
    processed := processed + 1;
  end loop;
  return jsonb_build_object('processedAt', processed_at, 'markets', processed);
end;
$$;

create or replace function public.my_league_market(target_league_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare state public.league_market_cycles; selected_league public.leagues; mine public.league_memberships; payload jsonb;
begin
  select * into mine from public.league_memberships where league_id = target_league_id and user_id = auth.uid() and left_at is null;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into selected_league from public.leagues where id = target_league_id;
  perform public.initialize_league_market(target_league_id, true);
  select * into state from public.league_market_cycles where league_id = target_league_id;
  if state.next_renewal_at <= now() then
    perform public.resolve_league_market_cycle(target_league_id, now(), false);
    select * into state from public.league_market_cycles where league_id = target_league_id;
  end if;
  select jsonb_build_object(
    'leagueId', selected_league.id, 'membershipId', mine.id, 'cycleNumber', state.cycle_number,
    'cycleStartedAt', state.cycle_started_at, 'lastRenewedAt', state.last_renewed_at,
    'nextRenewalAt', state.next_renewal_at, 'intervalHours', state.interval_hours,
    'nextIntervalHours', public.market_rule_hours(selected_league),
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
      'listingId', listing.id, 'playerId', player.id, 'name', player.name, 'initials', player.initials,
      'position', player.position, 'club', club.name, 'price', listing.minimum_price,
      'photoUrl', player.photo_url, 'listedAt', listing.listed_at
    ) order by listing.listed_at, player.name)
      from public.league_market_listings listing join public.players player on player.id = listing.player_id
      join public.sports_clubs club on club.id = player.sports_club_id
     where listing.league_id = selected_league.id and listing.status = 'available'), '[]'::jsonb),
    'myBids', coalesce((select jsonb_agg(jsonb_build_object(
      'bidId', bid.id, 'listingId', bid.listing_id, 'playerId', listing.player_id,
      'amount', bid.amount, 'placedAt', bid.created_at
    )) from public.league_market_bids bid join public.league_market_listings listing on listing.id = bid.listing_id
      where bid.bidder_membership_id = mine.id and bid.status = 'active'), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;

create or replace function public.place_my_market_bid(target_listing_id uuid, target_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare listing public.league_market_listings; mine public.league_memberships; selected_league public.leagues;
  retained numeric; debt_percent numeric; result public.league_market_bids;
begin
  select * into listing from public.league_market_listings where id = target_listing_id and status = 'available' for update;
  if not found then raise exception 'El jugador ya no está disponible'; end if;
  select * into mine from public.league_memberships where league_id = listing.league_id and user_id = auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into selected_league from public.leagues where id = listing.league_id;
  if target_amount < listing.minimum_price then raise exception 'No puedes pujar por debajo del valor de mercado'; end if;
  select coalesce(sum(amount), 0) into retained from public.league_market_bids
   where bidder_membership_id = mine.id and status = 'active' and listing_id <> target_listing_id;
  debt_percent := greatest(0, least(100, coalesce((selected_league.rules->>'maxDebtPercent')::numeric, 20)));
  if retained + target_amount > mine.budget + greatest(0, mine.budget) * debt_percent / 100 then
    raise exception 'La puja supera tu saldo y el límite de deuda';
  end if;
  insert into public.league_market_bids(listing_id, bidder_membership_id, amount)
  values (listing.id, mine.id, target_amount)
  on conflict (listing_id, bidder_membership_id) do update set amount = excluded.amount, status = 'active', updated_at = now(), resolved_at = null
  returning * into result;
  return jsonb_build_object('bidId', result.id, 'listingId', listing.id, 'playerId', listing.player_id, 'amount', result.amount, 'placedAt', result.created_at);
end;
$$;

create or replace function public.cancel_my_market_bid(target_listing_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.league_market_bids bid set status = 'cancelled', updated_at = now()
   where bid.listing_id = target_listing_id and bid.status = 'active'
     and exists (select 1 from public.league_memberships mine where mine.id = bid.bidder_membership_id and mine.user_id = auth.uid() and mine.left_at is null);
end;
$$;

create or replace function public.update_my_private_league(target_league_id text, new_name text, new_capacity integer, new_join_locked boolean, new_rules jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare selected_league public.leagues; active_members integer;
begin
  select * into selected_league from public.leagues where id = target_league_id and visibility = 'private' and owner_id = auth.uid() for update;
  if not found then raise exception 'No administras esta liga'; end if;
  select count(*) into active_members from public.league_memberships where league_id = target_league_id and left_at is null;
  if char_length(trim(new_name)) not between 3 and 30 then raise exception 'El nombre debe tener entre 3 y 30 caracteres'; end if;
  if new_capacity < active_members or new_capacity > 100 then raise exception 'La capacidad no es válida'; end if;
  update public.leagues set name = trim(new_name), capacity = new_capacity, join_locked = new_join_locked,
         rules = (new_rules - 'accessCode' - 'updatedAt') || jsonb_build_object('version', coalesce((new_rules->>'version')::integer, 1)), updated_at = now()
   where id = target_league_id;
  -- league_market_cycles.next_renewal_at no se modifica: el nuevo renewalHours se aplicará al renovar.
end;
$$;

create or replace function public.admin_renew_league_market(target_league_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Acceso reservado a administradores';
  end if;
  return public.resolve_league_market_cycle(target_league_id, now(), true);
end;
$$;

-- Reserva los jugadores expuestos para que una nueva plantilla no pueda recibirlos.
create or replace function public.build_market_roster(
  target_membership_id uuid, requested_target_value numeric, requested_squad_size integer, request_key uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare membership public.league_memberships; selected_league public.leagues; existing_roster_id uuid; new_roster_id uuid;
  selected_ids text[]; selected_total numeric; attempt integer; desired_size integer := greatest(11, least(20, requested_squad_size));
  q_por integer := 1; q_def integer := 4; q_med integer := 4; q_del integer := 2;
  extras text[] := array['DEF','MED','DEL','DEF','MED','POR','DEF','MED','DEL']; extra_index integer;
begin
  select * into membership from public.league_memberships where id = target_membership_id and left_at is null for update;
  if not found then raise exception 'La participación no está activa'; end if;
  select * into selected_league from public.leagues where id = membership.league_id for update;
  if selected_league.mode <> 'market' or selected_league.roster_policy <> 'exclusive' then raise exception 'Esta liga no utiliza plantillas exclusivas'; end if;
  perform pg_advisory_xact_lock(hashtextextended(selected_league.id, 0));
  select id into existing_roster_id from public.league_rosters where membership_id = membership.id;
  if found then perform public.initialize_league_market(selected_league.id, true); return public.market_roster_payload(existing_roster_id); end if;
  for extra_index in 1..(desired_size - 11) loop
    case extras[extra_index] when 'POR' then q_por:=q_por+1; when 'DEF' then q_def:=q_def+1; when 'MED' then q_med:=q_med+1; when 'DEL' then q_del:=q_del+1; end case;
  end loop;
  for attempt in 1..300 loop
    select array_agg(candidate.id order by candidate.position_order,candidate.random_order),sum(candidate.market_value) into selected_ids,selected_total
    from (select ranked.*,case ranked.position when 'POR' then 1 when 'DEF' then 2 when 'MED' then 3 else 4 end position_order
      from (select player.id,player.position,player.market_value,md5(player.id||request_key::text||attempt::text) random_order,
        row_number() over(partition by player.position order by md5(player.id||request_key::text||attempt::text)) position_rank
        from public.players player where player.competition_id=selected_league.competition_id and player.active
          and not exists(select 1 from public.league_roster_players used where used.league_id=selected_league.id and used.player_id=player.id)
          and not exists(select 1 from public.league_market_listings offered where offered.league_id=selected_league.id and offered.player_id=player.id and offered.status='available')) ranked
      where ranked.position_rank<=case ranked.position when 'POR' then q_por when 'DEF' then q_def when 'MED' then q_med else q_del end) candidate;
    if coalesce(array_length(selected_ids,1),0)=desired_size and selected_total between requested_target_value*.9 and requested_target_value*1.1 then exit; end if;
    selected_ids:=null;
  end loop;
  if selected_ids is null then raise exception 'No quedan jugadores suficientes para formar una plantilla equilibrada'; end if;
  insert into public.league_rosters(membership_id,league_id,team_id,target_value,total_value,idempotency_key)
  values(membership.id,membership.league_id,membership.team_id,requested_target_value,selected_total,request_key) returning id into new_roster_id;
  insert into public.league_roster_players(roster_id,league_id,player_id,slot_order,is_starter)
  select new_roster_id,membership.league_id,chosen.player_id,chosen.slot_order,
    chosen.position_order<=case chosen.position when 'POR' then 1 when 'DEF' then 4 when 'MED' then 4 else 2 end
  from (select listed.player_id,listed.slot_order,player.position,row_number() over(partition by player.position order by listed.slot_order) position_order
    from unnest(selected_ids) with ordinality listed(player_id,slot_order) join public.players player on player.id=listed.player_id) chosen;
  update public.league_memberships set roster_id=new_roster_id where id=membership.id;
  perform public.initialize_league_market(selected_league.id, true);
  return public.market_roster_payload(new_roster_id);
end;
$$;

select public.initialize_league_market(league.id, true)
from public.leagues league where league.mode = 'market' and league.status = 'open';

alter table public.league_market_cycles enable row level security;
alter table public.league_market_listings enable row level security;
alter table public.league_market_bids enable row level security;
alter table public.league_market_events enable row level security;
revoke all on public.league_market_cycles, public.league_market_listings, public.league_market_bids, public.league_market_events from anon, authenticated;
grant all on public.league_market_cycles, public.league_market_listings, public.league_market_bids, public.league_market_events to service_role;
revoke all on function public.my_league_market(text), public.place_my_market_bid(uuid,numeric), public.cancel_my_market_bid(uuid), public.update_my_private_league(text,text,integer,boolean,jsonb), public.admin_renew_league_market(text) from public, anon;
grant execute on function public.my_league_market(text), public.place_my_market_bid(uuid,numeric), public.cancel_my_market_bid(uuid), public.update_my_private_league(text,text,integer,boolean,jsonb), public.admin_renew_league_market(text) to authenticated;
revoke all on function public.market_rule_hours(public.leagues), public.market_rule_listing_count(public.leagues), public.seed_league_market_listings(text,integer), public.initialize_league_market(text,boolean), public.resolve_league_market_cycle(text,timestamptz,boolean), public.process_due_league_markets(timestamptz) from public,anon,authenticated;
grant execute on function public.market_rule_hours(public.leagues), public.market_rule_listing_count(public.leagues), public.seed_league_market_listings(text,integer), public.initialize_league_market(text,boolean), public.resolve_league_market_cycle(text,timestamptz,boolean), public.process_due_league_markets(timestamptz) to service_role;
revoke all on function public.build_market_roster(uuid,numeric,integer,uuid) from public,anon,authenticated;

create extension if not exists pg_cron with schema pg_catalog;
do $$ declare existing_job bigint; begin
  select jobid into existing_job from cron.job where jobname='nexo-market-renewals' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('nexo-market-renewals','*/5 * * * *','select public.process_due_league_markets();');
end $$;
