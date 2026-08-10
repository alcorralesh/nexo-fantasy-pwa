-- Anuncios persistentes entre usuarios. Son independientes del ciclo renovable del juego.

create table if not exists public.league_user_market_listings (
  id uuid primary key default gen_random_uuid(),
  league_id text not null references public.leagues(id) on delete cascade,
  seller_membership_id uuid not null references public.league_memberships(id) on delete cascade,
  roster_id uuid not null references public.league_rosters(id) on delete cascade,
  player_id text not null references public.players(id),
  asking_price numeric(12,2) not null check (asking_price >= 0),
  status text not null default 'active' check (status in ('active','withdrawn','sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists league_user_market_one_active_player_idx
  on public.league_user_market_listings(league_id, player_id) where status = 'active';
create index if not exists league_user_market_active_idx
  on public.league_user_market_listings(league_id, status, created_at desc);

create table if not exists public.league_user_market_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.league_user_market_listings(id) on delete cascade,
  bidder_membership_id uuid not null references public.league_memberships(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'active' check (status in ('active','accepted','rejected','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists league_user_market_one_active_offer_idx
  on public.league_user_market_offers(listing_id, bidder_membership_id) where status = 'active';
create index if not exists league_user_market_offer_listing_idx
  on public.league_user_market_offers(listing_id, status, created_at desc);

create or replace function public.my_league_user_market(target_league_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mine public.league_memberships; payload jsonb;
begin
  select * into mine from public.league_memberships
   where league_id = target_league_id and user_id = auth.uid() and left_at is null;
  if not found then raise exception 'No participas en esta liga'; end if;

  update public.league_user_market_offers offer set status='expired', resolved_at=now(), updated_at=now()
   where offer.status='active' and offer.expires_at<=now()
     and exists(select 1 from public.league_user_market_listings listing where listing.id=offer.listing_id and listing.league_id=target_league_id);

  select jsonb_build_object(
    'leagueId', target_league_id,
    'membershipId', mine.id,
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
      'listingId', listing.id, 'playerId', player.id, 'name', player.name, 'initials', player.initials,
      'position', player.position, 'club', club.name, 'marketValue', player.market_value,
      'askingPrice', listing.asking_price, 'sellerMembershipId', listing.seller_membership_id,
      'sellerTeamName', team.name, 'sellerName', profile.display_name, 'photoUrl', player.photo_url,
      'listedAt', listing.created_at, 'mine', listing.seller_membership_id=mine.id
    ) order by listing.created_at desc)
      from public.league_user_market_listings listing
      join public.players player on player.id=listing.player_id
      join public.sports_clubs club on club.id=player.sports_club_id
      join public.league_memberships seller on seller.id=listing.seller_membership_id and seller.left_at is null
      join public.teams team on team.id=seller.team_id
      join public.profiles profile on profile.id=seller.user_id
     where listing.league_id=target_league_id and listing.status='active'), '[]'::jsonb),
    'receivedOffers', coalesce((select jsonb_agg(jsonb_build_object(
      'offerId', offer.id, 'listingId', listing.id, 'playerId', listing.player_id,
      'playerName', player.name,
      'bidderMembershipId', offer.bidder_membership_id, 'bidderTeamName', team.name,
      'bidderName', profile.display_name, 'bidderInitials', team.short_name,
      'amount', offer.amount, 'status', offer.status, 'createdAt', offer.created_at,
      'expiresAt', offer.expires_at, 'resolvedAt', offer.resolved_at
    ) order by offer.created_at desc)
      from public.league_user_market_offers offer
      join public.league_user_market_listings listing on listing.id=offer.listing_id
      join public.players player on player.id=listing.player_id
      join public.league_memberships bidder on bidder.id=offer.bidder_membership_id
      join public.teams team on team.id=bidder.team_id
      join public.profiles profile on profile.id=bidder.user_id
     where listing.seller_membership_id=mine.id), '[]'::jsonb),
    'sentOffers', coalesce((select jsonb_agg(jsonb_build_object(
      'offerId', offer.id, 'listingId', listing.id, 'playerId', listing.player_id,
      'playerName', player.name, 'sellerMembershipId', listing.seller_membership_id,
      'sellerTeamName', team.name, 'amount', offer.amount, 'status', offer.status,
      'createdAt', offer.created_at, 'expiresAt', offer.expires_at, 'resolvedAt', offer.resolved_at
    ) order by offer.created_at desc)
      from public.league_user_market_offers offer
      join public.league_user_market_listings listing on listing.id=offer.listing_id
      join public.players player on player.id=listing.player_id
      join public.league_memberships seller on seller.id=listing.seller_membership_id
      join public.teams team on team.id=seller.team_id
     where offer.bidder_membership_id=mine.id), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;

create or replace function public.list_my_roster_player(target_league_id text, target_player_id text, target_asking_price numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare mine public.league_memberships; roster public.league_rosters; owned public.league_roster_players;
  player public.players; existing_id uuid; result_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id || ':user-market',0));
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into roster from public.league_rosters where membership_id=mine.id for update;
  if not found then raise exception 'Tu plantilla no esta disponible'; end if;
  select * into owned from public.league_roster_players where roster_id=roster.id and player_id=target_player_id for update;
  if not found then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  if owned.is_starter then raise exception 'Mueve al jugador al banquillo antes de publicarlo'; end if;
  select * into player from public.players where id=target_player_id;
  if target_asking_price < player.market_value then raise exception 'El precio minimo es el valor de mercado actual'; end if;
  select id into existing_id from public.league_user_market_listings
   where league_id=target_league_id and player_id=target_player_id and status='active' for update;
  if existing_id is not null then
    update public.league_user_market_listings set asking_price=target_asking_price, updated_at=now() where id=existing_id;
    return existing_id;
  end if;
  insert into public.league_user_market_listings(league_id,seller_membership_id,roster_id,player_id,asking_price)
  values(target_league_id,mine.id,roster.id,target_player_id,target_asking_price) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.withdraw_my_user_listing(target_listing_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare listing public.league_user_market_listings;
begin
  select * into listing from public.league_user_market_listings where id=target_listing_id and status='active' for update;
  if not found then raise exception 'El anuncio ya no esta activo'; end if;
  if not exists(select 1 from public.league_memberships mine where mine.id=listing.seller_membership_id and mine.user_id=auth.uid() and mine.left_at is null) then
    raise exception 'No puedes retirar este anuncio';
  end if;
  update public.league_user_market_listings set status='withdrawn',closed_at=now(),updated_at=now() where id=listing.id;
  update public.league_user_market_offers set status='cancelled',resolved_at=now(),updated_at=now()
   where listing_id=listing.id and status='active';
end;
$$;

create or replace function public.place_my_user_market_offer(target_listing_id uuid, target_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare listing public.league_user_market_listings; mine public.league_memberships; selected_league public.leagues;
  retained numeric; debt_percent numeric; current_offer public.league_user_market_offers; result_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_listing_id::text,0));
  select * into listing from public.league_user_market_listings where id=target_listing_id and status='active' for update;
  if not found then raise exception 'El anuncio ya no esta activo'; end if;
  select * into mine from public.league_memberships where league_id=listing.league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  if mine.id=listing.seller_membership_id then raise exception 'No puedes ofertar por tu propio jugador'; end if;
  if target_amount<listing.asking_price then raise exception 'La oferta no puede ser inferior al precio solicitado'; end if;
  select * into selected_league from public.leagues where id=listing.league_id;
  select * into current_offer from public.league_user_market_offers
   where listing_id=listing.id and bidder_membership_id=mine.id and status='active' for update;
  select coalesce(sum(amount),0) into retained from (
    select offer.amount from public.league_user_market_offers offer
      join public.league_user_market_listings active_listing on active_listing.id=offer.listing_id
     where offer.bidder_membership_id=mine.id and offer.status='active' and offer.id is distinct from current_offer.id and active_listing.status='active'
    union all
    select bid.amount from public.league_market_bids bid where bid.bidder_membership_id=mine.id and bid.status='active'
  ) commitments;
  debt_percent:=greatest(0,least(100,coalesce((selected_league.rules->>'maxDebtPercent')::numeric,20)));
  if retained+target_amount>mine.budget+greatest(0,mine.budget)*debt_percent/100 then raise exception 'La oferta supera tu saldo y limite de deuda'; end if;
  if current_offer.id is not null then
    update public.league_user_market_offers set amount=target_amount,created_at=now(),updated_at=now(),expires_at=now()+interval '24 hours'
     where id=current_offer.id returning id into result_id;
  else
    insert into public.league_user_market_offers(listing_id,bidder_membership_id,amount,expires_at)
    values(listing.id,mine.id,target_amount,now()+interval '24 hours') returning id into result_id;
  end if;
  return result_id;
end;
$$;

create or replace function public.cancel_my_user_market_offer(target_offer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.league_user_market_offers offer set status='cancelled',resolved_at=now(),updated_at=now()
   where offer.id=target_offer_id and offer.status='active'
     and exists(select 1 from public.league_memberships mine where mine.id=offer.bidder_membership_id and mine.user_id=auth.uid() and mine.left_at is null);
end;
$$;

create or replace function public.respond_to_my_user_market_offer(target_offer_id uuid, accept_offer boolean)
returns void language plpgsql security definer set search_path = public as $$
declare offer public.league_user_market_offers; listing public.league_user_market_listings;
  seller public.league_memberships; bidder public.league_memberships; seller_roster public.league_rosters; bidder_roster public.league_rosters;
  owned public.league_roster_players; player public.players; selected_league public.leagues;
  retained numeric; debt_percent numeric; max_bench integer; bench_count integer; next_slot integer; market_cycle_number integer;
begin
  select * into offer from public.league_user_market_offers where id=target_offer_id and status='active' for update;
  if not found or offer.expires_at<=now() then raise exception 'La oferta ya no esta disponible'; end if;
  select * into listing from public.league_user_market_listings where id=offer.listing_id and status='active' for update;
  if not found then raise exception 'El anuncio ya no esta activo'; end if;
  perform pg_advisory_xact_lock(hashtextextended(listing.league_id || ':user-market',0));
  select * into seller from public.league_memberships where id=listing.seller_membership_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No puedes responder esta oferta'; end if;
  if not accept_offer then
    update public.league_user_market_offers set status='rejected',resolved_at=now(),updated_at=now() where id=offer.id;
    return;
  end if;
  select * into bidder from public.league_memberships where id=offer.bidder_membership_id and left_at is null for update;
  if not found then raise exception 'El usuario que hizo la oferta ya no participa'; end if;
  select * into seller_roster from public.league_rosters where membership_id=seller.id for update;
  select * into bidder_roster from public.league_rosters where membership_id=bidder.id for update;
  select * into owned from public.league_roster_players where roster_id=seller_roster.id and player_id=listing.player_id for update;
  if not found then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  if owned.is_starter then raise exception 'Mueve al jugador al banquillo antes de aceptar la oferta'; end if;
  select * into player from public.players where id=listing.player_id;
  select * into selected_league from public.leagues where id=listing.league_id;
  max_bench:=greatest(0,least(40,coalesce((selected_league.rules->>'maxBenchPlayers')::integer,20)));
  select count(*) into bench_count from public.league_roster_players where roster_id=bidder_roster.id and not is_starter;
  if bench_count>=max_bench then raise exception 'El comprador ya no tiene espacio en el banquillo'; end if;
  select coalesce(sum(amount),0) into retained from (
    select other.amount from public.league_user_market_offers other
      join public.league_user_market_listings active_listing on active_listing.id=other.listing_id
     where other.bidder_membership_id=bidder.id and other.status='active' and other.id<>offer.id and active_listing.status='active'
    union all select bid.amount from public.league_market_bids bid where bid.bidder_membership_id=bidder.id and bid.status='active'
  ) commitments;
  debt_percent:=greatest(0,least(100,coalesce((selected_league.rules->>'maxDebtPercent')::numeric,20)));
  if retained+offer.amount>bidder.budget+greatest(0,bidder.budget)*debt_percent/100 then raise exception 'El comprador ya no dispone de saldo suficiente'; end if;
  select coalesce(max(slot_order),0)+1 into next_slot from public.league_roster_players where roster_id=bidder_roster.id;
  delete from public.league_roster_players where roster_id=seller_roster.id and player_id=listing.player_id;
  insert into public.league_roster_players(roster_id,league_id,player_id,slot_order,is_starter)
  values(bidder_roster.id,listing.league_id,listing.player_id,next_slot,false);
  update public.league_rosters set total_value=greatest(0,total_value-player.market_value) where id=seller_roster.id;
  update public.league_rosters set total_value=total_value+player.market_value where id=bidder_roster.id;
  update public.league_memberships set budget=budget+offer.amount where id=seller.id;
  update public.league_memberships set budget=budget-offer.amount where id=bidder.id;
  update public.league_user_market_listings set status='sold',closed_at=now(),updated_at=now() where id=listing.id;
  update public.league_user_market_offers set status=case when id=offer.id then 'accepted' else 'rejected' end,resolved_at=now(),updated_at=now()
   where listing_id=listing.id and status='active';
  select coalesce((select state.cycle_number from public.league_market_cycles state where state.league_id=listing.league_id),1) into market_cycle_number;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,amount,payload)
  values(listing.league_id,market_cycle_number,'transfer',bidder.id,listing.player_id,offer.amount,jsonb_build_object('source','user_listing','sellerMembershipId',seller.id,'userListingId',listing.id));
end;
$$;

alter table public.league_user_market_listings enable row level security;
alter table public.league_user_market_offers enable row level security;
revoke all on public.league_user_market_listings,public.league_user_market_offers from anon,authenticated;
grant all on public.league_user_market_listings,public.league_user_market_offers to service_role;
revoke all on function public.my_league_user_market(text),public.list_my_roster_player(text,text,numeric),public.withdraw_my_user_listing(uuid),public.place_my_user_market_offer(uuid,numeric),public.cancel_my_user_market_offer(uuid),public.respond_to_my_user_market_offer(uuid,boolean) from public,anon;
grant execute on function public.my_league_user_market(text),public.list_my_roster_player(text,text,numeric),public.withdraw_my_user_listing(uuid),public.place_my_user_market_offer(uuid,numeric),public.cancel_my_user_market_offer(uuid),public.respond_to_my_user_market_offer(uuid,boolean) to authenticated;
