-- Los jugadores que dejan la competicion siguen siendo propiedad del usuario
-- hasta que este solicite una liquidacion protegida por su ultimo valor conocido.

create or replace function public.market_roster_payload(target_roster_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'allocationId',r.id,'membershipId',r.membership_id,'idempotencyKey',r.idempotency_key,'confirmedAt',r.confirmed_at,
    'squad',jsonb_build_object(
      'formation',r.formation,
      'players',jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'value',p.market_value,'club',c.name,'photoUrl',p.photo_url,
        'availabilityStatus',case when not p.active then 'out_of_competition' when p.competition_id<>league.competition_id then 'changed_competition' else 'active' end
      ) order by rp.slot_order),
      'startingPlayerIds',coalesce(jsonb_agg(to_jsonb(p.id) order by rp.slot_order) filter(where rp.is_starter),'[]'::jsonb),
      'benchPlayerIds',coalesce(jsonb_agg(to_jsonb(p.id) order by rp.slot_order) filter(where not rp.is_starter),'[]'::jsonb),
      'totalValue',r.total_value,'targetValue',r.target_value))
  from public.league_rosters r join public.league_memberships member on member.id=r.membership_id
  join public.leagues league on league.id=member.league_id join public.league_roster_players rp on rp.roster_id=r.id
  join public.players p on p.id=rp.player_id join public.sports_clubs c on c.id=p.sports_club_id
  where r.id=target_roster_id group by r.id,league.competition_id;
$$;
revoke all on function public.market_roster_payload(uuid) from public,anon,authenticated;

create or replace function public.my_league_player_contracts(target_league_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare mine public.league_memberships; selected_league public.leagues; cutoff_at timestamptz; result jsonb;
begin
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  select md.first_kickoff_at-make_interval(hours=>greatest(0,coalesce((selected_league.rules->>'clauseCutoffHours')::integer,24))) into cutoff_at
  from public.competition_matchdays md where md.competition_id=selected_league.competition_id and md.state='open' and md.first_kickoff_at is not null order by md.first_kickoff_at limit 1;
  select jsonb_build_object('leagueId',selected_league.id,'membershipId',mine.id,'budget',mine.budget,
    'rules',jsonb_build_object(
      'clausesEnabled',coalesce((selected_league.rules->>'clausesEnabled')::boolean,true),'clauseMultiplier',coalesce((selected_league.rules->>'clauseMultiplier')::numeric,1.5),
      'clauseCutoffHours',coalesce((selected_league.rules->>'clauseCutoffHours')::integer,24),'clauseRaiseCostPercent',coalesce((selected_league.rules->>'clauseRaiseCostPercent')::numeric,10),
      'blindagesEnabled',coalesce((selected_league.rules->>'blindagesEnabled')::boolean,true),'blindageDurationHours',coalesce((selected_league.rules->>'blindageDurationHours')::integer,24),
      'immediateSaleEnabled',coalesce((selected_league.rules->>'immediateSaleEnabled')::boolean,true),'immediateSalePercent',coalesce((selected_league.rules->>'immediateSalePercent')::numeric,50),
      'realExitSalePercent',coalesce((selected_league.rules->>'realExitSalePercent')::numeric,100),'maxBenchPlayers',coalesce((selected_league.rules->>'maxBenchPlayers')::integer,20)),
    'clauseCutoffAt',cutoff_at,
    'contracts',coalesce((select jsonb_agg(jsonb_build_object(
      'playerId',contract.player_id,'ownerMembershipId',contract.owner_membership_id,'ownerTeamName',team.name,'mine',contract.owner_membership_id=mine.id,
      'clause',contract.clause_value,'blindUntil',contract.blind_until,'marketValue',player.market_value,'isStarter',rp.is_starter,
      'availabilityStatus',case when not player.active then 'out_of_competition' when player.competition_id<>selected_league.competition_id then 'changed_competition' else 'active' end
    ) order by player.name) from public.league_player_contracts contract join public.players player on player.id=contract.player_id
      join public.league_memberships owner on owner.id=contract.owner_membership_id and owner.left_at is null join public.teams team on team.id=owner.team_id
      join public.league_roster_players rp on rp.roster_id=contract.roster_id and rp.player_id=contract.player_id where contract.league_id=selected_league.id),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- Un jugador invalidado durante el ciclo sigue visible como aviso hasta la
-- siguiente renovacion, pero nunca vuelve a ser pujable.
create or replace function public.my_league_market(target_league_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare state public.league_market_cycles; selected_league public.leagues; mine public.league_memberships; payload jsonb;
begin
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  perform public.initialize_league_market(target_league_id,true);
  select * into state from public.league_market_cycles where league_id=target_league_id;
  if state.next_renewal_at<=now() then
    perform public.resolve_league_market_cycle(target_league_id,now(),false);
    select * into state from public.league_market_cycles where league_id=target_league_id;
  end if;
  select jsonb_build_object(
    'leagueId',selected_league.id,'membershipId',mine.id,'cycleNumber',state.cycle_number,
    'cycleStartedAt',state.cycle_started_at,'lastRenewedAt',state.last_renewed_at,
    'nextRenewalAt',state.next_renewal_at,'intervalHours',state.interval_hours,
    'nextIntervalHours',public.market_rule_hours(selected_league),
    'listings',coalesce((select jsonb_agg(jsonb_build_object(
      'listingId',listing.id,'playerId',player.id,'name',player.name,'initials',player.initials,
      'position',player.position,'club',club.name,'price',listing.minimum_price,
      'photoUrl',player.photo_url,'listedAt',listing.listed_at,
      'availabilityStatus',case when listing.status='available' and player.active and player.competition_id=selected_league.competition_id then 'active' else 'out_of_competition' end,
      'unavailableReason',listing.unavailable_reason
    ) order by listing.listed_at,player.name)
      from public.league_market_listings listing join public.players player on player.id=listing.player_id
      join public.sports_clubs club on club.id=player.sports_club_id
      where listing.league_id=selected_league.id and (
        listing.status='available' or
        (listing.status='withdrawn' and listing.cycle_number=state.cycle_number and listing.unavailable_reason='left_competition')
      )), '[]'::jsonb),
    'myBids',coalesce((select jsonb_agg(jsonb_build_object(
      'bidId',bid.id,'listingId',bid.listing_id,'playerId',listing.player_id,
      'amount',bid.amount,'placedAt',bid.created_at
    )) from public.league_market_bids bid join public.league_market_listings listing on listing.id=bid.listing_id
      where bid.bidder_membership_id=mine.id and bid.status='active'), '[]'::jsonb)
  ) into payload;
  return payload;
end $$;

create or replace function public.sell_my_player_immediately(target_league_id text,target_player_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare mine public.league_memberships; contract public.league_player_contracts; roster_player public.league_roster_players;
 selected_league public.leagues; player public.players; sale_percent numeric; proceeds numeric; cycle integer; unavailable boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id||':ownership:'||target_player_id,0));
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into contract from public.league_player_contracts where league_id=target_league_id and player_id=target_player_id for update;
  if not found or contract.owner_membership_id<>mine.id then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  select * into roster_player from public.league_roster_players where roster_id=contract.roster_id and player_id=target_player_id for update;
  select * into selected_league from public.leagues where id=target_league_id;
  select * into player from public.players where id=target_player_id;
  unavailable:=not player.active or player.competition_id<>selected_league.competition_id;
  if roster_player.is_starter and not unavailable then raise exception 'Mueve al jugador al banquillo antes de venderlo'; end if;
  if not unavailable and not coalesce((selected_league.rules->>'immediateSaleEnabled')::boolean,true) then raise exception 'La venta inmediata esta desactivada en esta liga'; end if;
  sale_percent:=greatest(0,least(100,case when unavailable then coalesce((selected_league.rules->>'realExitSalePercent')::numeric,100) else coalesce((selected_league.rules->>'immediateSalePercent')::numeric,50) end));
  proceeds:=round(player.market_value*sale_percent/100,2);
  update public.league_user_market_offers set status='cancelled',resolved_at=now(),updated_at=now()
   where listing_id in(select id from public.league_user_market_listings where league_id=target_league_id and player_id=target_player_id and status='active') and status='active';
  update public.league_user_market_listings set status='withdrawn',closed_at=now(),updated_at=now() where league_id=target_league_id and player_id=target_player_id and status='active';
  update public.league_direct_player_offers set status='cancelled',resolved_at=now(),updated_at=now() where league_id=target_league_id and player_id=target_player_id and status='active';
  delete from public.league_roster_players where roster_id=contract.roster_id and player_id=target_player_id;
  update public.league_rosters set total_value=greatest(0,total_value-player.market_value) where id=contract.roster_id;
  update public.league_memberships set budget=budget+proceeds where id=mine.id;
  select coalesce(cycle_number,1) into cycle from public.league_market_cycles where league_id=target_league_id;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,amount,payload)
  values(target_league_id,coalesce(cycle,1),'sale',mine.id,target_player_id,proceeds,jsonb_build_object('marketValue',player.market_value,'salePercent',sale_percent,'reason',case when unavailable then 'real_competition_exit' else 'immediate_sale' end));
  return jsonb_build_object('playerId',target_player_id,'amount',proceeds,'budget',mine.budget+proceeds,'protectedExit',unavailable);
end $$;
revoke all on function public.my_league_player_contracts(text),public.sell_my_player_immediately(text,text),public.my_league_market(text) from public,anon;
grant execute on function public.my_league_player_contracts(text),public.sell_my_player_immediately(text,text),public.my_league_market(text) to authenticated;
notify pgrst,'reload schema';
