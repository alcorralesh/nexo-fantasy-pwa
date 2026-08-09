-- Historial real de mercado de la participación autenticada.

create or replace function public.my_league_market_history(target_league_id text)
returns table (
  id text,
  event_type text,
  direction text,
  title text,
  detail text,
  player_name text,
  amount numeric,
  status text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select membership.id
      from public.league_memberships membership
     where membership.league_id = target_league_id
       and membership.user_id = auth.uid()
       and membership.left_at is null
  )
  select bid.id::text,
         case when bid.status = 'won' then 'transfer' else 'bid' end,
         'made',
         case bid.status
           when 'active' then 'Puja realizada'
           when 'won' then 'Puja ganada'
           when 'lost' then 'Puja no adjudicada'
           else 'Puja cancelada'
         end,
         case bid.status
           when 'active' then 'Pendiente de la próxima renovación'
           when 'won' then 'Fichaje confirmado en la renovación'
           when 'lost' then 'Otra puja válida resultó ganadora'
           else 'Importe retenido liberado'
         end,
         player.name,
         bid.amount,
         case bid.status
           when 'won' then 'completed'
           when 'lost' then 'rejected'
           when 'cancelled' then 'cancelled'
           else 'active'
         end,
         coalesce(bid.resolved_at, bid.updated_at, bid.created_at)
    from public.league_market_bids bid
    join public.league_market_listings listing on listing.id = bid.listing_id
    join public.players player on player.id = listing.player_id
    join mine on mine.id = bid.bidder_membership_id
   order by coalesce(bid.resolved_at, bid.updated_at, bid.created_at) desc;
$$;

revoke all on function public.my_league_market_history(text) from public, anon;
grant execute on function public.my_league_market_history(text) to authenticated;

-- Actividad publica de una liga. No expone importes ni pujas/ofertas activas.

create or replace function public.my_league_activity(target_league_id text)
returns table (
  id text,
  activity_type text,
  actor text,
  initials text,
  title text,
  detail text,
  occurred_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with accessible as (
    select 1
      from public.league_memberships membership
     where membership.league_id = target_league_id
       and membership.user_id = auth.uid()
       and membership.left_at is null
  ), activity as (
    select event.id::text,
           'transfer'::text as activity_type,
           team.name as actor,
           team.short_name as initials,
           'Fichó a ' || player.name as title,
           'Traspaso confirmado en la renovación del mercado'::text as detail,
           event.created_at as occurred_at
      from public.league_market_events event
      join accessible on true
      join public.league_memberships membership on membership.id = event.membership_id
      join public.teams team on team.id = membership.team_id
      join public.players player on player.id = event.player_id
     where event.league_id = target_league_id
       and event.event_type = 'transfer'
    union all
    select event.id::text,
           'market'::text,
           'Nexo'::text,
           'NX'::text,
           case event.event_type
             when 'initialized' then 'El mercado inicial ya está disponible'
             else 'El mercado se ha renovado'
           end,
           case event.event_type
             when 'initialized' then 'Se ha publicado el primer catálogo de jugadores de la liga'
             else 'Las pujas se han resuelto y hay nuevos jugadores disponibles'
           end,
           event.created_at
      from public.league_market_events event
      join accessible on true
     where event.league_id = target_league_id
       and event.event_type in ('initialized', 'renewed')
    union all
    select membership.id::text,
           'membership'::text,
           team.name,
           team.short_name,
           'Se unió a la liga'::text,
           profile.display_name || ' ya forma parte de la competición',
           membership.joined_at
      from public.league_memberships membership
      join accessible on true
      join public.teams team on team.id = membership.team_id
      join public.profiles profile on profile.id = membership.user_id
     where membership.league_id = target_league_id
       and membership.left_at is null
  )
  select activity.id, activity.activity_type, activity.actor, activity.initials,
         activity.title, activity.detail, activity.occurred_at
    from activity
   order by activity.occurred_at desc
   limit 100;
$$;

revoke all on function public.my_league_activity(text) from public, anon;
grant execute on function public.my_league_activity(text) to authenticated;
