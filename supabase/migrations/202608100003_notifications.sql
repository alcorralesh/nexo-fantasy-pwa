-- Centro de notificaciones persistente y ligero.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('market','matchday','achievement','system')),
  title text not null,
  body text not null,
  league_id text references public.leagues(id) on delete cascade,
  target_section text check (target_section in ('inicio','resumen','equipo','mercado','jornada','clasificacion','perfil')),
  source_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists user_notifications_source_unique
  on public.user_notifications(user_id,source_key) where source_key is not null;
create index if not exists user_notifications_inbox_idx
  on public.user_notifications(user_id,read_at,created_at desc);

create or replace function public.create_nexo_notification(
  target_user_id uuid,target_type text,target_title text,target_body text,
  target_league_id text default null,target_destination text default 'inicio',target_source_key text default null
)
returns uuid language plpgsql security definer set search_path=public as $notification_body$
declare result_id uuid;
begin
  if target_type not in('market','matchday','achievement','system') then raise exception 'Tipo de notificacion no valido'; end if;
  insert into public.user_notifications(user_id,notification_type,title,body,league_id,target_section,source_key)
  values(target_user_id,target_type,left(target_title,120),left(target_body,300),target_league_id,target_destination,target_source_key)
  on conflict(user_id,source_key) where source_key is not null do nothing returning id into result_id;
  return result_id;
end;
$notification_body$;

create or replace function public.notify_market_event()
returns trigger language plpgsql security definer set search_path=public as $notification_body$
declare actor_user uuid; seller_user uuid; player_name text; member record;
begin
  select user_id into actor_user from public.league_memberships where id=new.membership_id;
  select name into player_name from public.players where id=new.player_id;
  if new.event_type='renewed' then
    for member in select user_id from public.league_memberships where league_id=new.league_id and left_at is null loop
      perform public.create_nexo_notification(member.user_id,'market','Mercado renovado','Las pujas se han resuelto y ya hay nuevos jugadores disponibles.',new.league_id,'mercado','market-event:'||new.id::text||':'||member.user_id::text);
    end loop;
  elsif new.event_type='transfer' and actor_user is not null then
    perform public.create_nexo_notification(actor_user,'market','Fichaje confirmado',coalesce(player_name,'El jugador')||' ya forma parte de tu plantilla.',new.league_id,'equipo','market-event:'||new.id::text||':buyer');
    if new.payload->>'sellerMembershipId' is not null then
      select user_id into seller_user from public.league_memberships where id=(new.payload->>'sellerMembershipId')::uuid;
      perform public.create_nexo_notification(seller_user,'market','Oferta aceptada',coalesce(player_name,'El jugador')||' ha sido traspasado por '||replace(coalesce(new.amount,0)::text,'.',',')||' M.',new.league_id,'mercado','market-event:'||new.id::text||':seller');
    end if;
  elsif new.event_type='clause' then
    select user_id into seller_user from public.league_memberships where id=(new.payload->>'sellerMembershipId')::uuid;
    perform public.create_nexo_notification(actor_user,'market','Clausulazo completado',coalesce(player_name,'El jugador')||' ya esta en tu banquillo.',new.league_id,'equipo','market-event:'||new.id::text||':buyer');
    perform public.create_nexo_notification(seller_user,'market','Han pagado una clausula',coalesce(player_name,'Tu jugador')||' ha cambiado de propietario por '||replace(coalesce(new.amount,0)::text,'.',',')||' M.',new.league_id,'mercado','market-event:'||new.id::text||':seller');
  elsif new.event_type='sale' and actor_user is not null then
    perform public.create_nexo_notification(actor_user,'market','Venta inmediata confirmada',coalesce(player_name,'El jugador')||' ha sido vendido por '||replace(coalesce(new.amount,0)::text,'.',',')||' M.',new.league_id,'mercado','market-event:'||new.id::text);
  elsif new.event_type='clause_raise' and actor_user is not null then
    perform public.create_nexo_notification(actor_user,'market','Clausula actualizada','La nueva clausula de '||coalesce(player_name,'tu jugador')||' ya esta activa.',new.league_id,'equipo','market-event:'||new.id::text);
  elsif new.event_type='blindage' and actor_user is not null then
    perform public.create_nexo_notification(actor_user,'market',case when coalesce((new.payload->>'enabled')::boolean,false) then 'Blindaje activado' else 'Blindaje retirado' end,
      'La proteccion de '||coalesce(player_name,'tu jugador')||' se ha actualizado.',new.league_id,'equipo','market-event:'||new.id::text);
  end if;
  return new;
end;
$notification_body$;

drop trigger if exists market_event_notifications on public.league_market_events;
create trigger market_event_notifications after insert on public.league_market_events
for each row execute function public.notify_market_event();

create or replace function public.notify_user_market_offer()
returns trigger language plpgsql security definer set search_path=public as $notification_body$
declare listing public.league_user_market_listings; bidder_user uuid; seller_user uuid; player_name text;
begin
  select * into listing from public.league_user_market_listings where id=new.listing_id;
  select user_id into bidder_user from public.league_memberships where id=new.bidder_membership_id;
  select user_id into seller_user from public.league_memberships where id=listing.seller_membership_id;
  select name into player_name from public.players where id=listing.player_id;
  if tg_op='INSERT' then
    perform public.create_nexo_notification(seller_user,'market','Nueva oferta recibida','Has recibido una oferta de '||replace(new.amount::text,'.',',')||' M por '||player_name||'.',listing.league_id,'mercado','user-offer:'||new.id::text||':received');
  elsif old.status='active' and new.status<>'active' then
    perform public.create_nexo_notification(bidder_user,'market',case new.status when 'accepted' then 'Oferta aceptada' when 'rejected' then 'Oferta rechazada' else 'Oferta cancelada' end,
      case new.status when 'accepted' then player_name||' ya forma parte de tu plantilla.' when 'rejected' then 'Tu oferta por '||player_name||' no ha sido aceptada.' else 'La oferta por '||player_name||' ya no esta activa.' end,
      listing.league_id,case when new.status='accepted' then 'equipo' else 'mercado' end,'user-offer:'||new.id::text||':'||new.status);
  end if;
  return new;
end;
$notification_body$;

drop trigger if exists user_market_offer_notifications on public.league_user_market_offers;
create trigger user_market_offer_notifications after insert or update of status on public.league_user_market_offers
for each row execute function public.notify_user_market_offer();

create or replace function public.notify_matchday_state_change()
returns trigger language plpgsql security definer set search_path=public as $notification_body$
declare member record; notice_title text; notice_body text; destination text;
begin
  if old.state=new.state or new.state not in('open','locked','closed') then return new; end if;
  if new.state='open' then notice_title:='Nueva jornada disponible'; notice_body:='Ya puedes preparar la alineacion de la Jornada '||new.matchday||'.'; destination:='equipo';
  elsif new.state='locked' then notice_title:='Alineaciones bloqueadas'; notice_body:='La foto de la Jornada '||new.matchday||' ya esta guardada para puntuar.'; destination:='jornada';
  else notice_title:='Jornada cerrada'; notice_body:='Los puntos y premios de la Jornada '||new.matchday||' ya estan disponibles.'; destination:='jornada'; end if;
  for member in
    select membership.user_id,league.id as league_id from public.leagues league
    join public.league_memberships membership on membership.league_id=league.id and membership.left_at is null
    where league.competition_id=new.competition_id
  loop
    perform public.create_nexo_notification(member.user_id,'matchday',notice_title,notice_body,member.league_id,destination,'matchday:'||new.id::text||':'||new.state||':'||member.user_id::text);
  end loop;
  return new;
end;
$notification_body$;

drop trigger if exists matchday_state_notifications on public.competition_matchdays;
create trigger matchday_state_notifications after update of state on public.competition_matchdays
for each row execute function public.notify_matchday_state_change();

create or replace function public.my_notifications(requested_limit integer default 100)
returns table(id uuid,notification_type text,title text,body text,league_id text,target_section text,read_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path=public as $notification_body$
  select notice.id,notice.notification_type,notice.title,notice.body,notice.league_id,notice.target_section,notice.read_at,notice.created_at
  from public.user_notifications notice where notice.user_id=auth.uid()
  order by notice.created_at desc limit greatest(1,least(requested_limit,200));
$notification_body$;

create or replace function public.mark_my_notification_read(target_notification_id uuid)
returns void language sql security definer set search_path=public as $notification_body$
  update public.user_notifications set read_at=coalesce(read_at,now()) where id=target_notification_id and user_id=auth.uid();
$notification_body$;

create or replace function public.mark_all_my_notifications_read()
returns void language sql security definer set search_path=public as $notification_body$
  update public.user_notifications set read_at=now() where user_id=auth.uid() and read_at is null;
$notification_body$;

insert into public.user_notifications(user_id,notification_type,title,body,target_section,source_key)
select profile.id,'system','Notificaciones activadas','Desde ahora recibiras aqui los avisos importantes de mercado y jornadas.','inicio','notifications-v1'
from public.profiles profile on conflict(user_id,source_key) where source_key is not null do nothing;

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon,authenticated;
grant all on public.user_notifications to service_role;
revoke all on function public.my_notifications(integer),public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() from public,anon;
grant execute on function public.my_notifications(integer),public.mark_my_notification_read(uuid),public.mark_all_my_notifications_read() to authenticated;
