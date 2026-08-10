-- Contratos reales de jugadores: clausulas, blindajes y venta inmediata.

alter table public.league_market_events drop constraint if exists league_market_events_event_type_check;
alter table public.league_market_events add constraint league_market_events_event_type_check
  check (event_type in ('initialized','renewed','transfer','unsold','clause','clause_raise','blindage','sale'));

create table if not exists public.league_player_contracts (
  league_id text not null references public.leagues(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  owner_membership_id uuid not null references public.league_memberships(id) on delete cascade,
  roster_id uuid not null references public.league_rosters(id) on delete cascade,
  clause_value numeric(12,2) not null check (clause_value >= 0),
  blind_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, player_id)
);

create index if not exists league_player_contracts_owner_idx
  on public.league_player_contracts(owner_membership_id, league_id);

create or replace function public.sync_roster_player_contract()
returns trigger language plpgsql security definer set search_path = public as $contract_body$
declare selected_roster public.league_rosters; selected_league public.leagues; selected_player public.players;
begin
  if tg_op = 'DELETE' then
    delete from public.league_player_contracts
     where league_id=old.league_id and player_id=old.player_id and roster_id=old.roster_id;
    return old;
  end if;
  select * into selected_roster from public.league_rosters where id=new.roster_id;
  select * into selected_league from public.leagues where id=new.league_id;
  select * into selected_player from public.players where id=new.player_id;
  if selected_league.mode='market' then
    insert into public.league_player_contracts(league_id,player_id,owner_membership_id,roster_id,clause_value)
    values(new.league_id,new.player_id,selected_roster.membership_id,new.roster_id,
      round(selected_player.market_value * greatest(1,coalesce((selected_league.rules->>'clauseMultiplier')::numeric,1.5)),2))
    on conflict(league_id,player_id) do update set
      owner_membership_id=excluded.owner_membership_id,roster_id=excluded.roster_id,
      clause_value=excluded.clause_value,blind_until=null,updated_at=now();
  end if;
  return new;
end;
$contract_body$;

drop trigger if exists roster_player_contract_sync on public.league_roster_players;
create trigger roster_player_contract_sync
after insert or update or delete on public.league_roster_players
for each row execute function public.sync_roster_player_contract();

insert into public.league_player_contracts(league_id,player_id,owner_membership_id,roster_id,clause_value)
select rp.league_id,rp.player_id,r.membership_id,rp.roster_id,
       round(p.market_value * greatest(1,coalesce((l.rules->>'clauseMultiplier')::numeric,1.5)),2)
  from public.league_roster_players rp
  join public.league_rosters r on r.id=rp.roster_id
  join public.leagues l on l.id=rp.league_id and l.mode='market'
  join public.players p on p.id=rp.player_id
on conflict(league_id,player_id) do update set
  owner_membership_id=excluded.owner_membership_id,roster_id=excluded.roster_id,updated_at=now();

create or replace function public.my_league_player_contracts(target_league_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $contract_body$
declare mine public.league_memberships; selected_league public.leagues; cutoff_at timestamptz; result jsonb;
begin
  select * into mine from public.league_memberships
   where league_id=target_league_id and user_id=auth.uid() and left_at is null;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  select md.first_kickoff_at - make_interval(hours=>greatest(0,coalesce((selected_league.rules->>'clauseCutoffHours')::integer,24)))
    into cutoff_at from public.competition_matchdays md
   where md.competition_id=selected_league.competition_id and md.state='open' and md.first_kickoff_at is not null
   order by md.first_kickoff_at limit 1;
  select jsonb_build_object(
    'leagueId',selected_league.id,'membershipId',mine.id,'budget',mine.budget,
    'rules',jsonb_build_object(
      'clausesEnabled',coalesce((selected_league.rules->>'clausesEnabled')::boolean,true),
      'clauseMultiplier',coalesce((selected_league.rules->>'clauseMultiplier')::numeric,1.5),
      'clauseCutoffHours',coalesce((selected_league.rules->>'clauseCutoffHours')::integer,24),
      'clauseRaiseCostPercent',coalesce((selected_league.rules->>'clauseRaiseCostPercent')::numeric,10),
      'blindagesEnabled',coalesce((selected_league.rules->>'blindagesEnabled')::boolean,true),
      'blindageDurationHours',coalesce((selected_league.rules->>'blindageDurationHours')::integer,24),
      'immediateSaleEnabled',coalesce((selected_league.rules->>'immediateSaleEnabled')::boolean,true),
      'immediateSalePercent',coalesce((selected_league.rules->>'immediateSalePercent')::numeric,50),
      'maxBenchPlayers',coalesce((selected_league.rules->>'maxBenchPlayers')::integer,20)
    ),
    'clauseCutoffAt',cutoff_at,
    'contracts',coalesce((select jsonb_agg(jsonb_build_object(
      'playerId',contract.player_id,'ownerMembershipId',contract.owner_membership_id,
      'ownerTeamName',team.name,'mine',contract.owner_membership_id=mine.id,
      'clause',contract.clause_value,'blindUntil',contract.blind_until,
      'marketValue',player.market_value,'isStarter',rp.is_starter
    ) order by player.name)
      from public.league_player_contracts contract
      join public.players player on player.id=contract.player_id
      join public.league_memberships owner on owner.id=contract.owner_membership_id and owner.left_at is null
      join public.teams team on team.id=owner.team_id
      join public.league_roster_players rp on rp.roster_id=contract.roster_id and rp.player_id=contract.player_id
     where contract.league_id=selected_league.id),'[]'::jsonb)
  ) into result;
  return result;
end;
$contract_body$;

create or replace function public.raise_my_player_clause(target_league_id text,target_player_id text,target_clause numeric)
returns jsonb language plpgsql security definer set search_path = public as $contract_body$
declare mine public.league_memberships; contract public.league_player_contracts; roster_player public.league_roster_players;
  selected_league public.leagues; cost_percent numeric; cost numeric; cycle integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id||':ownership:'||target_player_id,0));
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into contract from public.league_player_contracts where league_id=target_league_id and player_id=target_player_id for update;
  if not found or contract.owner_membership_id<>mine.id then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  select * into roster_player from public.league_roster_players where roster_id=contract.roster_id and player_id=target_player_id for update;
  if roster_player.is_starter then raise exception 'Mueve al jugador al banquillo antes de modificar su contrato'; end if;
  if target_clause<=contract.clause_value then raise exception 'La nueva clausula debe ser superior a la actual'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  cost_percent:=greatest(0,least(100,coalesce((selected_league.rules->>'clauseRaiseCostPercent')::numeric,10)));
  cost:=round((target_clause-contract.clause_value)*cost_percent/100,2);
  if mine.budget<cost then raise exception 'No tienes saldo suficiente para subir la clausula'; end if;
  update public.league_memberships set budget=budget-cost where id=mine.id;
  update public.league_player_contracts set clause_value=round(target_clause,2),updated_at=now() where league_id=target_league_id and player_id=target_player_id;
  select coalesce(cycle_number,1) into cycle from public.league_market_cycles where league_id=target_league_id;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,amount,payload)
  values(target_league_id,coalesce(cycle,1),'clause_raise',mine.id,target_player_id,cost,jsonb_build_object('clause',round(target_clause,2),'cost',cost));
  return jsonb_build_object('clause',round(target_clause,2),'cost',cost,'budget',mine.budget-cost);
end;
$contract_body$;

create or replace function public.set_my_player_blindage(target_league_id text,target_player_id text,enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $contract_body$
declare mine public.league_memberships; contract public.league_player_contracts; roster_player public.league_roster_players;
 selected_league public.leagues; duration integer; until_at timestamptz; cycle integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id||':ownership:'||target_player_id,0));
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into contract from public.league_player_contracts where league_id=target_league_id and player_id=target_player_id for update;
  if not found or contract.owner_membership_id<>mine.id then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  select * into roster_player from public.league_roster_players where roster_id=contract.roster_id and player_id=target_player_id for update;
  if roster_player.is_starter then raise exception 'Mueve al jugador al banquillo antes de blindarlo'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  if enabled and not coalesce((selected_league.rules->>'blindagesEnabled')::boolean,true) then raise exception 'Los blindajes estan desactivados en esta liga'; end if;
  duration:=greatest(1,least(720,coalesce((selected_league.rules->>'blindageDurationHours')::integer,24)));
  until_at:=case when enabled then now()+make_interval(hours=>duration) else null end;
  update public.league_player_contracts set blind_until=until_at,updated_at=now() where league_id=target_league_id and player_id=target_player_id;
  select coalesce(cycle_number,1) into cycle from public.league_market_cycles where league_id=target_league_id;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,payload)
  values(target_league_id,coalesce(cycle,1),'blindage',mine.id,target_player_id,jsonb_build_object('enabled',enabled,'blindUntil',until_at));
  return jsonb_build_object('blindUntil',until_at,'durationHours',duration);
end;
$contract_body$;

create or replace function public.buy_player_clause(target_league_id text,target_player_id text)
returns jsonb language plpgsql security definer set search_path = public as $contract_body$
declare buyer public.league_memberships; seller public.league_memberships; contract public.league_player_contracts;
  selected_league public.leagues; buyer_roster public.league_rosters; seller_roster public.league_rosters; owned public.league_roster_players;
  player public.players; cutoff_at timestamptz; max_bench integer; bench_count integer; next_slot integer; cycle integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id||':ownership:'||target_player_id,0));
  select * into buyer from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into selected_league from public.leagues where id=target_league_id for update;
  if selected_league.mode<>'market' or not coalesce((selected_league.rules->>'clausesEnabled')::boolean,true) then raise exception 'Los clausulazos no estan disponibles'; end if;
  select * into contract from public.league_player_contracts where league_id=target_league_id and player_id=target_player_id for update;
  if not found then raise exception 'El jugador no tiene un contrato activo'; end if;
  if contract.owner_membership_id=buyer.id then raise exception 'El jugador ya pertenece a tu plantilla'; end if;
  if contract.blind_until is not null and contract.blind_until>now() then raise exception 'El jugador esta blindado'; end if;
  select md.first_kickoff_at-make_interval(hours=>greatest(0,coalesce((selected_league.rules->>'clauseCutoffHours')::integer,24))) into cutoff_at
    from public.competition_matchdays md where md.competition_id=selected_league.competition_id and md.state='open' and md.first_kickoff_at is not null order by md.first_kickoff_at limit 1;
  if cutoff_at is not null and now()>=cutoff_at then raise exception 'El plazo de clausulazos de esta jornada ya ha terminado'; end if;
  if buyer.budget<contract.clause_value then raise exception 'Necesitas saldo real suficiente para pagar la clausula'; end if;
  select * into seller from public.league_memberships where id=contract.owner_membership_id and left_at is null for update;
  if not found then raise exception 'El propietario ya no participa en la liga'; end if;
  select * into buyer_roster from public.league_rosters where membership_id=buyer.id for update;
  select * into seller_roster from public.league_rosters where membership_id=seller.id for update;
  select * into owned from public.league_roster_players where roster_id=seller_roster.id and player_id=target_player_id for update;
  if not found then raise exception 'El jugador acaba de cambiar de propietario'; end if;
  max_bench:=greatest(1,least(40,coalesce((selected_league.rules->>'maxBenchPlayers')::integer,20)));
  select count(*) into bench_count from public.league_roster_players where roster_id=buyer_roster.id and not is_starter;
  if bench_count>=max_bench then raise exception 'No tienes espacio libre en el banquillo'; end if;
  select * into player from public.players where id=target_player_id;
  select coalesce(max(slot_order),0)+1 into next_slot from public.league_roster_players where roster_id=buyer_roster.id;
  update public.league_user_market_offers set status='cancelled',resolved_at=now(),updated_at=now()
   where listing_id in(select id from public.league_user_market_listings where league_id=target_league_id and player_id=target_player_id and status='active') and status='active';
  update public.league_user_market_listings set status='withdrawn',closed_at=now(),updated_at=now()
   where league_id=target_league_id and player_id=target_player_id and status='active';
  delete from public.league_roster_players where roster_id=seller_roster.id and player_id=target_player_id;
  insert into public.league_roster_players(roster_id,league_id,player_id,slot_order,is_starter) values(buyer_roster.id,target_league_id,target_player_id,next_slot,false);
  update public.league_rosters set total_value=greatest(0,total_value-player.market_value) where id=seller_roster.id;
  update public.league_rosters set total_value=total_value+player.market_value where id=buyer_roster.id;
  update public.league_memberships set budget=budget-contract.clause_value where id=buyer.id;
  update public.league_memberships set budget=budget+contract.clause_value where id=seller.id;
  select coalesce(cycle_number,1) into cycle from public.league_market_cycles where league_id=target_league_id;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,amount,payload)
  values(target_league_id,coalesce(cycle,1),'clause',buyer.id,target_player_id,contract.clause_value,jsonb_build_object('sellerMembershipId',seller.id));
  return jsonb_build_object('playerId',target_player_id,'amount',contract.clause_value,'buyerBudget',buyer.budget-contract.clause_value,'sellerMembershipId',seller.id);
end;
$contract_body$;

create or replace function public.sell_my_player_immediately(target_league_id text,target_player_id text)
returns jsonb language plpgsql security definer set search_path = public as $contract_body$
declare mine public.league_memberships; contract public.league_player_contracts; roster_player public.league_roster_players;
 selected_league public.leagues; player public.players; sale_percent numeric; proceeds numeric; cycle integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_league_id||':ownership:'||target_player_id,0));
  select * into mine from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null for update;
  if not found then raise exception 'No participas en esta liga'; end if;
  select * into contract from public.league_player_contracts where league_id=target_league_id and player_id=target_player_id for update;
  if not found or contract.owner_membership_id<>mine.id then raise exception 'El jugador ya no pertenece a tu plantilla'; end if;
  select * into roster_player from public.league_roster_players where roster_id=contract.roster_id and player_id=target_player_id for update;
  if roster_player.is_starter then raise exception 'Mueve al jugador al banquillo antes de venderlo'; end if;
  select * into selected_league from public.leagues where id=target_league_id;
  if not coalesce((selected_league.rules->>'immediateSaleEnabled')::boolean,true) then raise exception 'La venta inmediata esta desactivada en esta liga'; end if;
  select * into player from public.players where id=target_player_id;
  sale_percent:=greatest(0,least(100,coalesce((selected_league.rules->>'immediateSalePercent')::numeric,50)));
  proceeds:=round(player.market_value*sale_percent/100,2);
  update public.league_user_market_offers set status='cancelled',resolved_at=now(),updated_at=now()
   where listing_id in(select id from public.league_user_market_listings where league_id=target_league_id and player_id=target_player_id and status='active') and status='active';
  update public.league_user_market_listings set status='withdrawn',closed_at=now(),updated_at=now()
   where league_id=target_league_id and player_id=target_player_id and status='active';
  delete from public.league_roster_players where roster_id=contract.roster_id and player_id=target_player_id;
  update public.league_rosters set total_value=greatest(0,total_value-player.market_value) where id=contract.roster_id;
  update public.league_memberships set budget=budget+proceeds where id=mine.id;
  select coalesce(cycle_number,1) into cycle from public.league_market_cycles where league_id=target_league_id;
  insert into public.league_market_events(league_id,cycle_number,event_type,membership_id,player_id,amount,payload)
  values(target_league_id,coalesce(cycle,1),'sale',mine.id,target_player_id,proceeds,jsonb_build_object('marketValue',player.market_value,'salePercent',sale_percent));
  return jsonb_build_object('playerId',target_player_id,'amount',proceeds,'budget',mine.budget+proceeds);
end;
$contract_body$;

alter table public.league_player_contracts enable row level security;
revoke all on public.league_player_contracts from anon,authenticated;
grant all on public.league_player_contracts to service_role;
revoke all on function public.my_league_player_contracts(text),public.raise_my_player_clause(text,text,numeric),public.set_my_player_blindage(text,text,boolean),public.buy_player_clause(text,text),public.sell_my_player_immediately(text,text) from public,anon;
grant execute on function public.my_league_player_contracts(text),public.raise_my_player_clause(text,text,numeric),public.set_my_player_blindage(text,text,boolean),public.buy_player_clause(text,text),public.sell_my_player_immediately(text,text) to authenticated;

create or replace function public.my_league_market_history(target_league_id text)
returns table(id text,event_type text,direction text,title text,detail text,player_name text,amount numeric,status text,occurred_at timestamptz)
language sql stable security definer set search_path = public as $contract_body$
  with mine as (
    select membership.id from public.league_memberships membership
     where membership.league_id=target_league_id and membership.user_id=auth.uid() and membership.left_at is null
  ), history(id,event_type,direction,title,detail,player_name,amount,status,occurred_at) as (
    select bid.id::text,case when bid.status='won' then 'transfer' else 'bid' end,'made'::text,
      case bid.status when 'active' then 'Puja realizada' when 'won' then 'Puja ganada' when 'lost' then 'Puja no adjudicada' else 'Puja cancelada' end,
      case bid.status when 'active' then 'Pendiente de la proxima renovacion' when 'won' then 'Fichaje confirmado' when 'lost' then 'Otra puja valida resulto ganadora' else 'Importe retenido liberado' end,
      player.name,bid.amount,case bid.status when 'won' then 'completed' when 'lost' then 'rejected' when 'cancelled' then 'cancelled' else 'active' end,
      coalesce(bid.resolved_at,bid.updated_at,bid.created_at)
    from public.league_market_bids bid join public.league_market_listings listing on listing.id=bid.listing_id
    join public.players player on player.id=listing.player_id join mine on mine.id=bid.bidder_membership_id
    union all
    select offer.id::text,'offer',case when offer.bidder_membership_id=mine.id then 'made' else 'received' end,
      case offer.status when 'active' then 'Oferta activa' when 'accepted' then 'Oferta aceptada' when 'rejected' then 'Oferta rechazada' else 'Oferta cancelada' end,
      case when offer.bidder_membership_id=mine.id then 'Oferta enviada por '||player.name else 'Oferta recibida por '||player.name end,
      player.name,offer.amount,case offer.status when 'accepted' then 'completed' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled' else 'active' end,
      coalesce(offer.resolved_at,offer.updated_at,offer.created_at)
    from public.league_user_market_offers offer join public.league_user_market_listings listing on listing.id=offer.listing_id
    join public.players player on player.id=listing.player_id join mine on mine.id in(offer.bidder_membership_id,listing.seller_membership_id)
    union all
    select event.id::text,event.event_type,
      case when event.event_type='clause' and event.membership_id=mine.id then 'made' when event.event_type='clause' then 'received' else 'made' end,
      case event.event_type when 'clause' then case when event.membership_id=mine.id then 'Clausulazo ejecutado' else 'Clausulazo recibido' end
        when 'clause_raise' then 'Clausula elevada' when 'blindage' then 'Blindaje actualizado' when 'sale' then 'Venta inmediata' else 'Operacion de mercado' end,
      case event.event_type when 'clause' then 'Cambio de propietario confirmado de forma inmediata' when 'clause_raise' then 'Proteccion contractual actualizada'
        when 'blindage' then case when coalesce((event.payload->>'enabled')::boolean,false) then 'Jugador blindado' else 'Blindaje retirado' end
        when 'sale' then 'Venta al juego completada' else 'Operacion confirmada' end,
      player.name,event.amount,'completed',event.created_at
    from public.league_market_events event join public.players player on player.id=event.player_id join mine on
      event.membership_id=mine.id or event.payload->>'sellerMembershipId'=mine.id::text
    where event.league_id=target_league_id and event.event_type in('clause','clause_raise','blindage','sale')
  )
  select * from history order by occurred_at desc limit 200;
$contract_body$;

create or replace function public.my_league_activity(target_league_id text)
returns table(id text,activity_type text,actor text,initials text,title text,detail text,occurred_at timestamptz)
language sql stable security definer set search_path = public as $contract_body$
  with accessible as (select 1 from public.league_memberships where league_id=target_league_id and user_id=auth.uid() and left_at is null), activity(id,activity_type,actor,initials,title,detail,occurred_at) as (
    select event.id::text,event.event_type,coalesce(team.name,'Nexo'),coalesce(team.short_name,'NX'),
      case event.event_type when 'transfer' then 'Ficho a '||player.name when 'clause' then 'Pago la clausula de '||player.name
        when 'sale' then 'Vendio inmediatamente a '||player.name when 'blindage' then case when coalesce((event.payload->>'enabled')::boolean,false) then 'Blindo a '||player.name else 'Retiro el blindaje de '||player.name end
        when 'clause_raise' then 'Subio la clausula de '||player.name when 'initialized' then 'El mercado inicial ya esta disponible' else 'El mercado se ha renovado' end,
      case event.event_type when 'transfer' then 'Traspaso confirmado' when 'clause' then 'Cambio de propietario inmediato' when 'sale' then 'Venta al juego confirmada'
        when 'blindage' then 'Proteccion contractual actualizada' when 'clause_raise' then 'Contrato actualizado' when 'initialized' then 'Primer catalogo publicado' else 'Pujas resueltas y nuevos jugadores disponibles' end,
      event.created_at
    from public.league_market_events event join accessible on true
    left join public.league_memberships membership on membership.id=event.membership_id left join public.teams team on team.id=membership.team_id
    left join public.players player on player.id=event.player_id
    where event.league_id=target_league_id and event.event_type in('transfer','clause','sale','blindage','clause_raise','initialized','renewed')
    union all
    select membership.id::text,'membership',team.name,team.short_name,'Se unio a la liga',profile.display_name||' ya forma parte de la competicion',membership.joined_at
    from public.league_memberships membership join accessible on true join public.teams team on team.id=membership.team_id join public.profiles profile on profile.id=membership.user_id
    where membership.league_id=target_league_id and membership.left_at is null
  ) select * from activity order by occurred_at desc limit 100;
$contract_body$;
