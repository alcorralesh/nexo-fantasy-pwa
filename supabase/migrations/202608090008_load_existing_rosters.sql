create or replace function public.my_market_rosters()
returns table (
  membership_id uuid,
  roster_id uuid,
  squad jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    roster.membership_id,
    roster.id,
    public.market_roster_payload(roster.id) -> 'squad'
  from public.league_rosters roster
  join public.league_memberships membership on membership.id = roster.membership_id
  where membership.user_id = auth.uid()
  order by roster.confirmed_at;
$$;

revoke all on function public.my_market_rosters() from public, anon;
grant execute on function public.my_market_rosters() to authenticated;
