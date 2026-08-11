-- Ofertas directas desde la plantilla de un rival, sin exigir que el jugador este anunciado.

create table if not exists public.league_direct_player_offers (
  id uuid primary key default gen_random_uuid(),
  league_id text not null references public.leagues(id) on delete cascade,
  seller_membership_id uuid not null references public.league_memberships(id) on delete cascade,
  bidder_membership_id uuid not null references public.league_memberships(id) on delete cascade,
  player_id text not null references public.players(id),
  amount numeric(12,2) not null check(amount>0),
  status text not null default 'active' check(status in('active','accepted','rejected','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists league_direct_offer_active_idx on public.league_direct_player_offers(league_id,seller_membership_id,bidder_membership_id,player_id) where status='active';
create index if not exists league_direct_offer_participants_idx on public.league_direct_player_offers(league_id,status,created_at desc);

create or replace function public.my_league_direct_player_offers(target_league_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare mine public.league_memberships%rowtype;
begin
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null;
  if not found then raise exception 'No participas en esta liga'; end if;
  update public.league_direct_player_offers set status='expired',resolved_at=now(),updated_at=now()
    where league_id=target_league_id and status='active' and expires_at<=now();
  return jsonb_build_object(
    'receivedOffers',coalesce((select jsonb_agg(jsonb_build_object(
      'offerId',offer.id,'playerId',offer.player_id,'playerName',player.name,'playerInitials',player.initials,
      'position',player.position,'club',sports.name,'amount',offer.amount,'status',offer.status,
      'createdAt',offer.created_at,'expiresAt',offer.expires_at,'resolvedAt',offer.resolved_at,
      'bidderMembershipId',offer.bidder_membership_id,'bidderName',profile.display_name,
      'bidderTeamName',team.name,'bidderInitials',team.short_name,'sellerMembershipId',offer.seller_membership_id,'direct',true
    ) order by offer.created_at desc) from public.league_direct_player_offers offer
      join public.players player on player.id=offer.player_id join public.sports_clubs sports on sports.id=player.sports_club_id
      join public.league_memberships bidder on bidder.id=offer.bidder_membership_id join public.profiles profile on profile.id=bidder.user_id
      join public.teams team on team.id=bidder.team_id where offer.seller_membership_id=mine.id),'[]'::jsonb),
    'sentOffers',coalesce((select jsonb_agg(jsonb_build_object(
      'offerId',offer.id,'playerId',offer.player_id,'playerName',player.name,'playerInitials',player.initials,
      'position',player.position,'club',sports.name,'amount',offer.amount,'status',offer.status,
      'createdAt',offer.created_at,'expiresAt',offer.expires_at,'resolvedAt',offer.resolved_at,
      'sellerMembershipId',offer.seller_membership_id,'sellerTeamName',team.name,'direct',true
    ) order by offer.created_at desc) from public.league_direct_player_offers offer
      join public.players player on player.id=offer.player_id join public.sports_clubs sports on sports.id=player.sports_club_id
      join public.league_memberships seller on seller.id=offer.seller_membership_id join public.teams team on team.id=seller.team_id
      where offer.bidder_membership_id=mine.id),'[]'::jsonb)
  );
end $$;

create or replace function public.place_my_direct_player_offer(target_league_id text,target_seller_membership_id uuid,target_player_id text,target_amount numeric) returns uuid
language plpgsql security definer set search_path=public as $$
declare mine public.league_memberships%rowtype; seller public.league_memberships%rowtype; seller_roster_id uuid; selected_league public.leagues%rowtype; retained numeric; debt_percent numeric; current_offer public.league_direct_player_offers%rowtype; result_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id||':direct-offer:'||target_player_id,0));
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into seller from public.league_memberships where id=target_seller_membership_id and league_id=target_league_id and left_at is null for update;
  if not found or seller.id=mine.id then raise exception 'El rival ya no esta disponible'; end if;
  select id into seller_roster_id from public.league_rosters where membership_id=seller.id;
  if not exists(select 1 from public.league_roster_players where roster_id=seller_roster_id and player_id=target_player_id) then raise exception 'El jugador ya no pertenece a ese rival'; end if;
  if target_amount<=0 then raise exception 'La oferta debe ser superior a cero'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  select * into current_offer from public.league_direct_player_offers where league_id=target_league_id and seller_membership_id=seller.id and bidder_membership_id=mine.id and player_id=target_player_id and status='active' for update;
  select coalesce(sum(value),0) into retained from (
    select amount value from public.league_direct_player_offers where bidder_membership_id=mine.id and status='active' and id is distinct from current_offer.id
    union all select offer.amount from public.league_user_market_offers offer where offer.bidder_membership_id=mine.id and offer.status='active'
    union all select bid.amount from public.league_market_bids bid where bid.bidder_membership_id=mine.id and bid.status='active'
  ) commitments;
  debt_percent:=greatest(0,least(100,coalesce((selected_league.rules->>'maxDebtPercent')::numeric,20)));
  if retained+target_amount>mine.budget+greatest(0,mine.budget)*debt_percent/100 then raise exception 'La oferta supera tu saldo y limite de deuda'; end if;
  if current_offer.id is null then
    insert into public.league_direct_player_offers(league_id,seller_membership_id,bidder_membership_id,player_id,amount,expires_at)
      values(target_league_id,seller.id,mine.id,target_player_id,target_amount,now()+interval '24 hours') returning id into result_id;
  else
    update public.league_direct_player_offers set amount=target_amount,created_at=now(),updated_at=now(),expires_at=now()+interval '24 hours'
      where id=current_offer.id returning id into result_id;
  end if;
  return result_id;
end $$;

create or replace function public.cancel_my_direct_player_offer(target_offer_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.league_direct_player_offers offer set status='cancelled',resolved_at=now(),updated_at=now()
    where id=target_offer_id and status='active' and exists(select 1 from public.league_memberships mine where mine.id=offer.bidder_membership_id and mine.user_id=auth.uid() and mine.left_at is null);
end $$;

create or replace function public.respond_to_my_direct_player_offer(target_offer_id uuid,accept_offer boolean) returns void
language plpgsql security definer set search_path=public as $$
declare offer public.league_direct_player_offers%rowtype; seller public.league_memberships%rowtype; bidder public.league_memberships%rowtype; seller_roster public.league_rosters%rowtype; bidder_roster public.league_rosters%rowtype; owned public.league_roster_players%rowtype; player public.players%rowtype; selected_league public.leagues%rowtype; retained numeric; debt_percent numeric; max_bench integer; bench_count integer; next_slot integer; market_cycle_number integer;
begin
  select * into offer from public.league_direct_player_offers where id=target_offer_id and status='active' for update;
  if not found or offer.expires_at<=now() then raise exception 'La oferta ya no esta disponible'; end if;
  perform pg_advisory_xact_lock(hashtextextended(offer.league_id||':ownership:'||offer.player_id,0));
  select * into seller from public.league_memberships where id=offer.seller_membership_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No puedes responder esta oferta'; end if;
  if not accept_offer then update public.league_direct_player_offers set status='rejected',resolved_at=now(),updated_at=now() where id=offer.id; return; end if;
  select * into bidder from public.league_memberships where id=offer.bidder_membership_id and left_at is null for update;
  if not found then raise exception 'El comprador ya no participa'; end if;
  select * into seller_roster from public.league_rosters where membership_id=seller.id for update;
  select * into bidder_roster from public.league_rosters where membership_id=bidder.id for update;
  select * into owned from public.league_roster_players where roster_id=seller_roster.id and player_id=offer.player_id for update;
  if not found then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  if owned.is_starter then raise exception 'Mueve al jugador al banquillo antes de aceptar la oferta'; end if;
  select * into player from public.players where id=offer.player_id;
  select * into selected_league from public.leagues where id=offer.league_id;
  max_bench:=greatest(0,least(40,coalesce((selected_league.rules->>'maxBenchPlayers')::integer,20)));
  select count(*) into bench_count from public.league_roster_players where roster_id=bidder_roster.id and not is_starter;
  if bench_count>=max_bench then raise exception 'El comprador ya no tiene espacio en el banquillo'; end if;
  select coalesce(sum(value),0) into retained from (
    select amount value from public.league_direct_player_offers where bidder_membership_id=bidder.id and status='active' and id<>offer.id
    union all select other.amount from public.league_user_market_offers other where other.bidder_membership_id=bidder.id and other.status='active'
    union all select bid.amount from public.league_market_bids bid where bid.bidder_membership_id=bidder.id and bid.status='active'
  ) commitments;
  debt_percent:=greatest(0,least(100,coalesce((selected_league.rules->>'maxDebtPercent')::numeric,20)));
  if retained+offer.amount>bidder.budget+greatest(0,bidder.budget)*debt_percent/100 then raise exception 'El comprador ya no dispone de saldo suficiente'; end if;
  select coalesce(max(slot_order),0)+1 into next_slot from public.league_roster_players where roster_id=bidder_roster.id;
  delete from public.league_roster_players where roster_id=seller_roster.id and player_id=offer.player_id;
  insert into public.league_roster_players(roster_id,league_id,player_id,slot_order,is_starter) values(bidder_roster.id,offer.league_id,offer.player_id,next_slot,false);
  update public.league_rosters set total_value=greatest(0,total_value-player.market_value) where id=seller_roster.id;
  update public.league_rosters set total_value=total_value+player.market_value where id=bidder_roster.id;
  update public.league_memberships set budget=budget+offer.amount where id=seller.id;
  update public.league_memberships set budget=budget-offer.amount where id=bidder.id;
  update public.league_direct_player_offers set status=case when id=offer.id then 'accepted' else 'rejected' end,resolved_at=now(),updated_at=now()
    where league_id=offer.league_id and seller_membership_id=seller.id and player_id=offer.player_id and status='active';
  select coalesce((select cycle_number from public.league_market_cycles where league_id=offer.league_id),1) into market_cycle_number;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,amount,payload)
    values(offer.league_id,market_cycle_number,'transfer',bidder.id,offer.player_id,offer.amount,jsonb_build_object('source','direct_offer','sellerMembershipId',seller.id,'directOfferId',offer.id));
end $$;

alter table public.league_direct_player_offers enable row level security;
revoke all on public.league_direct_player_offers from anon,authenticated;
grant all on public.league_direct_player_offers to service_role;
revoke all on function public.my_league_direct_player_offers(text),public.place_my_direct_player_offer(text,uuid,text,numeric),public.cancel_my_direct_player_offer(uuid),public.respond_to_my_direct_player_offer(uuid,boolean) from public,anon;
grant execute on function public.my_league_direct_player_offers(text),public.place_my_direct_player_offer(text,uuid,text,numeric),public.cancel_my_direct_player_offer(uuid),public.respond_to_my_direct_player_offer(uuid,boolean) to authenticated;
