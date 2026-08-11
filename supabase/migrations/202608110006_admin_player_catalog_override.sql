-- Correcciones manuales del catalogo. Son inmediatas y auditables; los campos
-- oficiales volveran a ser autoritativos en la siguiente sincronizacion.

create table if not exists public.player_catalog_admin_edits (
  id uuid primary key default gen_random_uuid(),
  player_id text not null references public.players(id),
  admin_user_id uuid not null references public.profiles(id),
  previous_data jsonb not null,
  current_data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists player_catalog_admin_edits_player_idx on public.player_catalog_admin_edits(player_id,created_at desc);
alter table public.player_catalog_admin_edits enable row level security;
drop policy if exists player_catalog_admin_edits_admin_read on public.player_catalog_admin_edits;
create policy player_catalog_admin_edits_admin_read on public.player_catalog_admin_edits for select to authenticated
using(exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
grant select on public.player_catalog_admin_edits to authenticated;
grant all on public.player_catalog_admin_edits to service_role;

create or replace function public.update_player_catalog_entry(
  target_player_id text,new_name text,new_position text,new_market_value numeric,new_active boolean,
  new_competition_id text,new_club_name text,new_photo_url text
) returns void language plpgsql security definer set search_path=public as $$
declare selected_player public.players; selected_club public.sports_clubs; previous jsonb; current_value jsonb; becomes_ineligible boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Acceso reservado a administradores'; end if;
  if trim(new_name)='' or new_position not in('POR','DEF','MED','DEL') or new_market_value<=0 then raise exception 'La ficha no es valida'; end if;
  if new_competition_id not in('primera','segunda','liga_f') then raise exception 'La competicion no es valida'; end if;
  select * into selected_player from public.players where id=target_player_id for update;
  if not found then raise exception 'Jugador no encontrado'; end if;
  select * into selected_club from public.sports_clubs where competition_id=new_competition_id and lower(name)=lower(trim(new_club_name)) limit 1;
  if not found then raise exception 'El club no existe en la competicion seleccionada'; end if;
  previous:=jsonb_build_object('name',selected_player.name,'position',selected_player.position,'marketValue',selected_player.market_value,'active',selected_player.active,'competitionId',selected_player.competition_id,'clubId',selected_player.sports_club_id,'photoUrl',selected_player.photo_url);
  becomes_ineligible:=not new_active or selected_player.competition_id<>new_competition_id;

  if becomes_ineligible then
    update public.league_market_bids bid set status='cancelled',resolved_at=now(),updated_at=now()
      where bid.status='active' and exists(select 1 from public.league_market_listings listing join public.leagues league on league.id=listing.league_id where listing.id=bid.listing_id and listing.player_id=target_player_id and (not new_active or league.competition_id<>new_competition_id));
    update public.league_market_listings listing set status='withdrawn',resolved_at=now(),invalidated_at=now(),unavailable_reason='left_competition'
      where listing.status='available' and listing.player_id=target_player_id and exists(select 1 from public.leagues league where league.id=listing.league_id and (not new_active or league.competition_id<>new_competition_id));
    update public.league_user_market_offers offer set status='cancelled',resolved_at=now(),updated_at=now()
      where offer.status='active' and exists(select 1 from public.league_user_market_listings listing join public.leagues league on league.id=listing.league_id where listing.id=offer.listing_id and listing.player_id=target_player_id and (not new_active or league.competition_id<>new_competition_id));
    update public.league_user_market_listings listing set status='withdrawn',closed_at=now(),updated_at=now()
      where listing.status='active' and listing.player_id=target_player_id and exists(select 1 from public.leagues league where league.id=listing.league_id and (not new_active or league.competition_id<>new_competition_id));
    update public.league_direct_player_offers offer set status='cancelled',resolved_at=now(),updated_at=now()
      where offer.status='active' and offer.player_id=target_player_id and exists(select 1 from public.leagues league where league.id=offer.league_id and (not new_active or league.competition_id<>new_competition_id));
    update public.league_roster_players rp set is_starter=false where rp.player_id=target_player_id and rp.is_starter
      and exists(select 1 from public.leagues league where league.id=rp.league_id and league.mode='market' and (not new_active or league.competition_id<>new_competition_id));
  end if;

  update public.players set name=trim(new_name),initials=upper(left(regexp_replace(trim(new_name),'[^[:alnum:]]','','g'),2)),position=new_position,
    market_value=round(new_market_value,2),active=new_active,competition_id=new_competition_id,sports_club_id=selected_club.id,
    photo_url=nullif(trim(coalesce(new_photo_url,'')),''),updated_at=now() where id=target_player_id;
  current_value:=jsonb_build_object('name',trim(new_name),'position',new_position,'marketValue',round(new_market_value,2),'active',new_active,'competitionId',new_competition_id,'clubId',selected_club.id,'photoUrl',nullif(trim(coalesce(new_photo_url,'')),''));
  insert into public.player_catalog_admin_edits(player_id,admin_user_id,previous_data,current_data) values(target_player_id,auth.uid(),previous,current_value);
end $$;

revoke all on function public.update_player_catalog_entry(text,text,text,numeric,boolean,text,text,text) from public,anon;
grant execute on function public.update_player_catalog_entry(text,text,text,numeric,boolean,text,text,text) to authenticated;
notify pgrst,'reload schema';
