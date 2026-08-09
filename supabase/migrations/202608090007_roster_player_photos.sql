create or replace function public.market_roster_payload(target_roster_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'allocationId', r.id,
    'membershipId', r.membership_id,
    'idempotencyKey', r.idempotency_key,
    'confirmedAt', r.confirmed_at,
    'squad', jsonb_build_object(
      'formation', r.formation,
      'players', jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'initials', p.initials,
        'position', p.position,
        'value', p.market_value,
        'club', c.name,
        'photoUrl', p.photo_url
      ) order by rp.slot_order),
      'startingPlayerIds', coalesce(jsonb_agg(to_jsonb(p.id) order by rp.slot_order) filter (where rp.is_starter), '[]'::jsonb),
      'benchPlayerIds', coalesce(jsonb_agg(to_jsonb(p.id) order by rp.slot_order) filter (where not rp.is_starter), '[]'::jsonb),
      'totalValue', r.total_value,
      'targetValue', r.target_value
    )
  )
  from public.league_rosters r
  join public.league_roster_players rp on rp.roster_id = r.id
  join public.players p on p.id = rp.player_id
  join public.sports_clubs c on c.id = p.sports_club_id
  where r.id = target_roster_id
  group by r.id;
$$;

revoke all on function public.market_roster_payload(uuid) from public, anon, authenticated;
