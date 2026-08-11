-- Ciclo de vida seguro del catalogo: conserva historicos y neutraliza operaciones
-- que hayan dejado de ser validas tras una baja o un cambio de competicion.

alter table public.league_market_listings add column if not exists unavailable_reason text;
alter table public.league_market_listings add column if not exists invalidated_at timestamptz;

create table if not exists public.player_catalog_change_events (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid not null references public.player_catalog_sync_jobs(id) on delete cascade,
  player_id text not null references public.players(id),
  change_type text not null check(change_type in('added','reactivated','deactivated','competition','club','position','profile')),
  previous_data jsonb not null default '{}'::jsonb,
  current_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists player_catalog_change_events_job_idx on public.player_catalog_change_events(sync_job_id,change_type);
alter table public.player_catalog_change_events enable row level security;
drop policy if exists player_catalog_change_events_admin_read on public.player_catalog_change_events;
create policy player_catalog_change_events_admin_read on public.player_catalog_change_events for select to authenticated
using(exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
grant select on public.player_catalog_change_events to authenticated;
grant all on public.player_catalog_change_events to service_role;

create or replace function public.player_is_eligible_for_league(target_player_id text,target_league_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select p.active and p.competition_id=l.competition_id
    from public.players p cross join public.leagues l
    where p.id=target_player_id and l.id=target_league_id),false)
$$;
revoke all on function public.player_is_eligible_for_league(text,text) from public,anon;
grant execute on function public.player_is_eligible_for_league(text,text) to authenticated,service_role;

create or replace function public.guard_catalog_market_operation()
returns trigger language plpgsql security definer set search_path=public as $$
declare selected_league_id text; selected_player_id text;
begin
  if tg_table_name='league_user_market_listings' then
    if new.status<>'active' then return new; end if;
    selected_league_id:=new.league_id; selected_player_id:=new.player_id;
  elsif tg_table_name='league_direct_player_offers' then
    if new.status<>'active' then return new; end if;
    selected_league_id:=new.league_id; selected_player_id:=new.player_id;
  elsif tg_table_name='league_user_market_offers' then
    if new.status<>'active' then return new; end if;
    select listing.league_id,listing.player_id into selected_league_id,selected_player_id
      from public.league_user_market_listings listing where listing.id=new.listing_id and listing.status='active';
  elsif tg_table_name='league_market_bids' then
    if new.status<>'active' then return new; end if;
    select listing.league_id,listing.player_id into selected_league_id,selected_player_id
      from public.league_market_listings listing where listing.id=new.listing_id and listing.status='available';
  end if;
  if selected_league_id is null or not public.player_is_eligible_for_league(selected_player_id,selected_league_id) then
    raise exception 'El jugador ya no esta disponible en esta competicion';
  end if;
  return new;
end $$;

drop trigger if exists guard_user_market_listing_catalog on public.league_user_market_listings;
create trigger guard_user_market_listing_catalog before insert or update on public.league_user_market_listings for each row execute function public.guard_catalog_market_operation();
drop trigger if exists guard_user_market_offer_catalog on public.league_user_market_offers;
create trigger guard_user_market_offer_catalog before insert or update on public.league_user_market_offers for each row execute function public.guard_catalog_market_operation();
drop trigger if exists guard_market_bid_catalog on public.league_market_bids;
create trigger guard_market_bid_catalog before insert or update on public.league_market_bids for each row execute function public.guard_catalog_market_operation();
drop trigger if exists guard_direct_offer_catalog on public.league_direct_player_offers;
create trigger guard_direct_offer_catalog before insert or update on public.league_direct_player_offers for each row execute function public.guard_catalog_market_operation();

create or replace function public.apply_player_catalog_snapshot(
  target_job_id uuid,target_catalog_version text,snapshot jsonb,target_summary jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  snapshot_total integer; primera_total integer; segunda_total integer; liga_f_total integer;
  cancelled_system_listings integer:=0; cancelled_system_bids integer:=0;
  cancelled_user_listings integer:=0; cancelled_user_offers integer:=0; cancelled_direct_offers integer:=0;
  affected_drafts integer:=0; result_summary jsonb;
begin
  if not exists(select 1 from public.player_catalog_sync_jobs where id=target_job_id and mode='apply' and status='running') then raise exception 'La sincronizacion no esta activa'; end if;
  create temporary table _nexo_catalog_snapshot(provider_id text primary key,competition_id text not null,player_name text not null,position text not null,club_name text not null,market_value numeric not null,photo_url text,source_name text not null) on commit drop;
  insert into _nexo_catalog_snapshot select provider_id,competition_id,player_name,position,club_name,market_value,photo_url,source_name
  from jsonb_to_recordset(snapshot) as item(provider_id text,competition_id text,player_name text,position text,club_name text,market_value numeric,photo_url text,source_name text);
  select count(*),count(*) filter(where competition_id='primera'),count(*) filter(where competition_id='segunda'),count(*) filter(where competition_id='liga_f') into snapshot_total,primera_total,segunda_total,liga_f_total from _nexo_catalog_snapshot;
  if snapshot_total<900 or primera_total<300 or segunda_total<280 or liga_f_total<280 then raise exception 'La fuente devolvio un catalogo incompleto (% jugadores)',snapshot_total; end if;
  if exists(select 1 from _nexo_catalog_snapshot where position not in('POR','DEF','MED','DEL')) then raise exception 'La fuente contiene posiciones no validas'; end if;
  insert into public.sports_clubs(id,competition_id,name,active)
  select competition_id||'_'||substr(md5(club_name),1,12),competition_id,club_name,true from _nexo_catalog_snapshot group by competition_id,club_name
  on conflict(competition_id,name) do update set active=true;

  create temporary table _nexo_existing_provider_ids on commit drop as
  select id,provider_id from public.players where provider_id is not null;

  create temporary table _nexo_catalog_diff on commit drop as
  select p.id player_id,p.provider_id,p.active old_active,p.competition_id old_competition_id,p.sports_club_id old_club_id,p.position old_position,p.name old_name,
    s.competition_id new_competition_id,club.id new_club_id,s.position new_position,s.player_name new_name,
    case when s.provider_id is null then 'deactivated' when not p.active then 'reactivated' when p.competition_id<>s.competition_id then 'competition'
      when p.sports_club_id<>club.id then 'club' when p.position<>s.position then 'position' else 'profile' end change_type
  from public.players p left join _nexo_catalog_snapshot s on s.provider_id=p.provider_id
  left join public.sports_clubs club on club.competition_id=s.competition_id and club.name=s.club_name
  where (p.provider_id like 'laliga:%' or p.provider_id like 'ligaf:%')
    and (s.provider_id is null or not p.active or p.competition_id<>s.competition_id or p.sports_club_id<>club.id or p.position<>s.position or p.name<>s.player_name or p.photo_url is distinct from s.photo_url);

  insert into public.user_notifications(user_id,notification_type,title,body,league_id,target_section,source_key)
  select distinct member.user_id,'market','Puja cancelada',player.name||' ya no esta disponible en esta competicion. El saldo retenido ha sido liberado.',listing.league_id,'mercado',
    'catalog-sync:'||target_job_id::text||':bid:'||bid.id::text
  from public.league_market_bids bid join public.league_market_listings listing on listing.id=bid.listing_id
  join public.league_memberships member on member.id=bid.bidder_membership_id join public.players player on player.id=listing.player_id
  join public.leagues league on league.id=listing.league_id join _nexo_catalog_diff diff on diff.player_id=listing.player_id
  where bid.status='active' and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id)
  on conflict(user_id,source_key) where source_key is not null do nothing;

  update public.league_roster_players roster_player set is_starter=false
  where roster_player.is_starter and exists(
    select 1 from public.leagues league join _nexo_catalog_diff diff on diff.player_id=roster_player.player_id
    where league.id=roster_player.league_id and league.mode='market'
      and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id));
  insert into public.user_notifications(user_id,notification_type,title,body,league_id,target_section,source_key)
  select distinct member.user_id,'market','Jugador retirado del mercado',player.name||' ya no esta disponible en esta competicion. Sus ofertas pendientes se han cancelado.',listing.league_id,'mercado',
    'catalog-sync:'||target_job_id::text||':listing:'||listing.id::text
  from public.league_user_market_listings listing join public.league_memberships member on member.id=listing.seller_membership_id
  join public.players player on player.id=listing.player_id join public.leagues league on league.id=listing.league_id join _nexo_catalog_diff diff on diff.player_id=listing.player_id
  where listing.status='active' and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id)
  on conflict(user_id,source_key) where source_key is not null do nothing;
  insert into public.user_notifications(user_id,notification_type,title,body,league_id,target_section,source_key)
  select distinct member.user_id,'market','Oferta cancelada',player.name||' ya no esta disponible en esta competicion. El saldo retenido ha sido liberado.',offer.league_id,'mercado',
    'catalog-sync:'||target_job_id::text||':direct-offer:'||offer.id::text
  from public.league_direct_player_offers offer join public.league_memberships member on member.id=offer.bidder_membership_id
  join public.players player on player.id=offer.player_id join public.leagues league on league.id=offer.league_id join _nexo_catalog_diff diff on diff.player_id=offer.player_id
  where offer.status='active' and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id)
  on conflict(user_id,source_key) where source_key is not null do nothing;

  update public.league_market_bids bid set status='cancelled',resolved_at=now()
   where bid.status='active' and exists(select 1 from public.league_market_listings listing join public.leagues league on league.id=listing.league_id join _nexo_catalog_diff diff on diff.player_id=listing.player_id
     where listing.id=bid.listing_id and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id));
  get diagnostics cancelled_system_bids=row_count;
  update public.league_market_listings listing
     set status='withdrawn',resolved_at=now(),invalidated_at=now(),unavailable_reason='left_competition'
   where listing.status='available' and exists(select 1 from public.leagues league join _nexo_catalog_diff diff on diff.player_id=listing.player_id
     where league.id=listing.league_id and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id));
  get diagnostics cancelled_system_listings=row_count;
  update public.league_user_market_offers offer set status='cancelled',resolved_at=now(),updated_at=now()
   where offer.status='active' and exists(select 1 from public.league_user_market_listings listing join public.leagues league on league.id=listing.league_id join _nexo_catalog_diff diff on diff.player_id=listing.player_id
     where listing.id=offer.listing_id and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id));
  get diagnostics cancelled_user_offers=row_count;
  update public.league_user_market_listings listing set status='withdrawn',closed_at=now(),updated_at=now()
   where listing.status='active' and exists(select 1 from public.leagues league join _nexo_catalog_diff diff on diff.player_id=listing.player_id
     where league.id=listing.league_id and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id));
  get diagnostics cancelled_user_listings=row_count;
  update public.league_direct_player_offers offer set status='cancelled',resolved_at=now(),updated_at=now()
   where offer.status='active' and exists(select 1 from public.leagues league join _nexo_catalog_diff diff on diff.player_id=offer.player_id
     where league.id=offer.league_id and (diff.change_type='deactivated' or diff.new_competition_id is distinct from league.competition_id));
  get diagnostics cancelled_direct_offers=row_count;
  select count(distinct draft.id) into affected_drafts from public.matchday_lineup_drafts draft
  join public.competition_matchdays round on round.competition_id=draft.competition_id and round.season=draft.season and round.matchday=draft.matchday and round.state in('scheduled','open')
  join _nexo_catalog_diff diff on diff.player_id=any(draft.starter_player_ids||draft.bench_player_ids)
  where diff.change_type in('deactivated','competition','position');
  insert into public.user_notifications(user_id,notification_type,title,body,league_id,target_section,source_key)
  select distinct member.user_id,'system','Revisa tu alineacion','Un jugador de tu once ha cambiado de estado, competicion o posicion. Debes guardar una alineacion valida antes del cierre.',draft.league_id,'equipo',
    'catalog-sync:'||target_job_id::text||':lineup:'||draft.id::text
  from public.matchday_lineup_drafts draft join public.league_memberships member on member.id=draft.membership_id
  join public.competition_matchdays round on round.competition_id=draft.competition_id and round.season=draft.season and round.matchday=draft.matchday and round.state in('scheduled','open')
  join _nexo_catalog_diff diff on diff.player_id=any(draft.starter_player_ids||draft.bench_player_ids)
  where diff.change_type in('deactivated','competition','position')
  on conflict(user_id,source_key) where source_key is not null do nothing;

  update public.players p set active=false,updated_at=now() where (p.provider_id like 'laliga:%' or p.provider_id like 'ligaf:%') and not exists(select 1 from _nexo_catalog_snapshot s where s.provider_id=p.provider_id);
  insert into public.players(id,competition_id,sports_club_id,provider_id,name,initials,position,market_value,active,catalog_version,photo_url,source_name,source_updated_at)
  select replace(s.provider_id,':','_'),s.competition_id,club.id,s.provider_id,s.player_name,upper(left(regexp_replace(s.player_name,'[^[:alnum:]]','','g'),2)),s.position,s.market_value,true,target_catalog_version,s.photo_url,s.source_name,now()
  from _nexo_catalog_snapshot s join public.sports_clubs club on club.competition_id=s.competition_id and club.name=s.club_name
  on conflict(id) do update set competition_id=excluded.competition_id,sports_club_id=excluded.sports_club_id,provider_id=excluded.provider_id,name=excluded.name,initials=excluded.initials,position=excluded.position,active=true,catalog_version=excluded.catalog_version,photo_url=excluded.photo_url,source_name=excluded.source_name,source_updated_at=now();

  insert into public.player_catalog_change_events(sync_job_id,player_id,change_type,previous_data,current_data)
  select target_job_id,d.player_id,d.change_type,jsonb_build_object('active',d.old_active,'competitionId',d.old_competition_id,'clubId',d.old_club_id,'position',d.old_position,'name',d.old_name),
    jsonb_build_object('active',d.change_type<>'deactivated','competitionId',d.new_competition_id,'clubId',d.new_club_id,'position',d.new_position,'name',d.new_name) from _nexo_catalog_diff d;
  insert into public.player_catalog_change_events(sync_job_id,player_id,change_type,current_data)
  select target_job_id,p.id,'added',jsonb_build_object('active',true,'competitionId',p.competition_id,'clubId',p.sports_club_id,'position',p.position,'name',p.name)
  from public.players p join _nexo_catalog_snapshot s on s.provider_id=p.provider_id
  where not exists(select 1 from _nexo_existing_provider_ids old where old.provider_id=p.provider_id);

  result_summary:=target_summary||jsonb_build_object('total',snapshot_total,'reconciliation',jsonb_build_object(
    'systemListingsCancelled',cancelled_system_listings,'systemBidsCancelled',cancelled_system_bids,'userListingsCancelled',cancelled_user_listings,
    'userOffersCancelled',cancelled_user_offers,'directOffersCancelled',cancelled_direct_offers,'lineupsRequiringReview',affected_drafts));
  update public.player_catalog_sync_jobs set status='succeeded',catalog_version=target_catalog_version,summary=result_summary,finished_at=now() where id=target_job_id;
  return result_summary;
end $$;
revoke all on function public.apply_player_catalog_snapshot(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_player_catalog_snapshot(uuid,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
