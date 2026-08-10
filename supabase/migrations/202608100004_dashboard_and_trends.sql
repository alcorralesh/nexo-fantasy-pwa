-- Inicio y Tendencias alimentados exclusivamente con actividad consolidada real.

create or replace function public.my_club_activity(target_team_id uuid)
returns table (
  id text,
  activity_type text,
  title text,
  detail text,
  league_id text,
  league_name text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with selected_club as (
    select team.club_id
      from public.teams team
     where team.id = target_team_id
       and team.owner_id = auth.uid()
  ), club_memberships as (
    select membership.id, membership.league_id
      from public.league_memberships membership
      join public.teams team on team.id = membership.team_id
      join selected_club club on club.club_id = team.club_id
     where membership.user_id = auth.uid()
       and membership.left_at is null
  ), event_rows as (
    select distinct on (event.id)
           event.id::text as id,
           event.event_type as activity_type,
           case
             when event.event_type = 'transfer' and event.payload->>'sellerMembershipId' = membership.id::text then 'Vendiste a ' || player.name
             when event.event_type = 'transfer' then 'Fichaste a ' || player.name
             when event.event_type = 'clause' and event.payload->>'sellerMembershipId' = membership.id::text then 'Recibiste un clausulazo por ' || player.name
             when event.event_type = 'clause' then 'Pagaste la cláusula de ' || player.name
             when event.event_type = 'sale' then 'Vendiste inmediatamente a ' || player.name
             when event.event_type = 'blindage' and coalesce((event.payload->>'enabled')::boolean, false) then 'Blindaste a ' || player.name
             when event.event_type = 'blindage' then 'Retiraste el blindaje de ' || player.name
             when event.event_type = 'clause_raise' then 'Subiste la cláusula de ' || player.name
             when event.event_type = 'initialized' then 'Mercado inicial disponible'
             else 'Mercado renovado'
           end as title,
           case
             when event.event_type in ('transfer','clause') then 'Operación confirmada en ' || league.name
             when event.event_type = 'sale' then 'Venta al juego confirmada en ' || league.name
             when event.event_type in ('blindage','clause_raise') then 'Contrato actualizado en ' || league.name
             else 'Nuevo ciclo de mercado en ' || league.name
           end as detail,
           league.id as league_id,
           league.name as league_name,
           event.created_at as occurred_at
      from public.league_market_events event
      join public.leagues league on league.id = event.league_id
      join club_memberships membership
        on membership.league_id = event.league_id
       and (event.membership_id = membership.id or event.payload->>'sellerMembershipId' = membership.id::text
            or event.event_type in ('initialized','renewed'))
      left join public.players player on player.id = event.player_id
     where event.event_type in ('transfer','clause','sale','blindage','clause_raise','initialized','renewed')
     order by event.id, event.created_at desc
  ), membership_rows as (
    select membership.id::text,
           'membership'::text,
           'Te uniste a ' || league.name,
           'El equipo del club ya participa en esta competición',
           league.id,
           league.name,
           membership.joined_at
      from club_memberships club_membership
      join public.league_memberships membership on membership.id = club_membership.id
      join public.leagues league on league.id = membership.league_id
  )
  select * from event_rows
  union all
  select * from membership_rows
  order by occurred_at desc
  limit 30;
$$;

create or replace function public.competition_player_trends(target_competition_id text)
returns table (
  id text,
  name text,
  initials text,
  "position" text,
  club text,
  value numeric,
  change_percent numeric,
  signings bigint,
  performance numeric,
  demand_index integer,
  lineup_selections bigint,
  captain_selections bigint,
  offers_received bigint,
  bids_received bigint,
  protections bigint,
  market_listings bigint,
  transfers bigint,
  history jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with lineup_stats as (
    select selected.player_id,
           count(*) filter (where selected.role = 'starter') as lineup_selections,
           count(*) filter (where selected.role = 'starter' and selected.is_captain) as captain_selections
      from public.matchday_lineup_snapshot_players selected
      join public.matchday_lineup_snapshots snapshot on snapshot.id = selected.snapshot_id
      join public.competition_matchdays matchday on matchday.id = snapshot.matchday_id
     where matchday.competition_id = target_competition_id
     group by selected.player_id
  ), point_stats as (
    select points.player_id, sum(points.points) as performance, max(points.calculated_at) as updated_at
      from public.player_matchday_points points
     where points.competition_id = target_competition_id
     group by points.player_id
  ), offer_stats as (
    select listing.player_id, count(offer.id) as offers_received
      from public.league_user_market_offers offer
      join public.league_user_market_listings listing on listing.id = offer.listing_id
      join public.leagues league on league.id = listing.league_id
     where league.competition_id = target_competition_id
     group by listing.player_id
  ), bid_stats as (
    select listing.player_id, count(bid.id) as bids_received
      from public.league_market_bids bid
      join public.league_market_listings listing on listing.id = bid.listing_id
      join public.leagues league on league.id = listing.league_id
     where league.competition_id = target_competition_id
     group by listing.player_id
  ), listing_stats as (
    select listing.player_id, count(*) as market_listings
      from public.league_user_market_listings listing
      join public.leagues league on league.id = listing.league_id
     where league.competition_id = target_competition_id
     group by listing.player_id
  ), event_stats as (
    select event.player_id,
           count(*) filter (where event.event_type = 'transfer') as transfers,
           count(*) filter (where event.event_type = 'blindage' and coalesce((event.payload->>'enabled')::boolean, false)) as protections,
           max(event.created_at) as updated_at
      from public.league_market_events event
      join public.leagues league on league.id = event.league_id
     where league.competition_id = target_competition_id
       and event.player_id is not null
     group by event.player_id
  ), price_history as (
    select snapshot.player_id,
           jsonb_agg(snapshot.price order by snapshot.captured_at, snapshot.matchday) as history,
           (array_agg(snapshot.price order by snapshot.captured_at desc, snapshot.matchday desc))[1] as previous_price,
           max(snapshot.captured_at) as updated_at
      from public.player_market_value_snapshots snapshot
     where snapshot.competition_id = target_competition_id
     group by snapshot.player_id
  ), metrics as (
    select player.id, player.name, player.initials, player.position, sports_club.name as club,
           player.market_value as value,
           case when coalesce(price.previous_price, 0) > 0
                then round(((player.market_value - price.previous_price) / price.previous_price) * 100, 1)
                else 0 end as change_percent,
           coalesce(event.transfers, 0) as signings,
           coalesce(points.performance, 0) as performance,
           coalesce(lineup.lineup_selections, 0) as lineup_selections,
           coalesce(lineup.captain_selections, 0) as captain_selections,
           coalesce(offers.offers_received, 0) as offers_received,
           coalesce(bids.bids_received, 0) as bids_received,
           coalesce(event.protections, 0) as protections,
           coalesce(listings.market_listings, 0) as market_listings,
           coalesce(event.transfers, 0) as transfers,
           coalesce(price.history, '[]'::jsonb) || jsonb_build_array(player.market_value) as history,
           greatest(player.updated_at, coalesce(points.updated_at, player.updated_at), coalesce(event.updated_at, player.updated_at), coalesce(price.updated_at, player.updated_at)) as updated_at,
           coalesce(lineup.lineup_selections, 0) + coalesce(lineup.captain_selections, 0) * 3
             + coalesce(offers.offers_received, 0) * 2 + coalesce(bids.bids_received, 0) * 2
             + coalesce(event.protections, 0) * 2 + coalesce(listings.market_listings, 0)
             + coalesce(event.transfers, 0) * 4 as demand_raw
      from public.players player
      join public.sports_clubs sports_club on sports_club.id = player.sports_club_id
      left join lineup_stats lineup on lineup.player_id = player.id
      left join point_stats points on points.player_id = player.id
      left join offer_stats offers on offers.player_id = player.id
      left join bid_stats bids on bids.player_id = player.id
      left join listing_stats listings on listings.player_id = player.id
      left join event_stats event on event.player_id = player.id
      left join price_history price on price.player_id = player.id
     where player.competition_id = target_competition_id and player.active
  )
  select metrics.id, metrics.name, metrics.initials, metrics.position, metrics.club, metrics.value,
         metrics.change_percent, metrics.signings, metrics.performance,
         case when max(metrics.demand_raw) over () > 0
              then round(metrics.demand_raw * 100.0 / max(metrics.demand_raw) over ())::integer
              else 0 end as demand_index,
         metrics.lineup_selections, metrics.captain_selections, metrics.offers_received,
         metrics.bids_received, metrics.protections, metrics.market_listings, metrics.transfers,
         metrics.history, metrics.updated_at
    from metrics
   order by metrics.value desc, metrics.name;
$$;

revoke all on function public.my_club_activity(uuid), public.competition_player_trends(text) from public, anon;
grant execute on function public.my_club_activity(uuid) to authenticated;
grant execute on function public.competition_player_trends(text) to anon, authenticated;
