-- Catálogo deportivo y asignación transaccional de plantillas exclusivas.

create table if not exists public.sports_clubs (
  id text primary key,
  competition_id text not null references public.competitions(id),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (competition_id, name)
);

create table if not exists public.players (
  id text primary key,
  competition_id text not null references public.competitions(id),
  sports_club_id text not null references public.sports_clubs(id),
  provider_id text,
  name text not null,
  initials text not null,
  position text not null,
  market_value numeric(12,2) not null,
  active boolean not null default true,
  catalog_version text not null default '2026-08-08',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_position check (position in ('POR', 'DEF', 'MED', 'DEL')),
  constraint players_market_value check (market_value >= 0),
  unique (competition_id, provider_id)
);

create table if not exists public.league_rosters (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null unique references public.league_memberships(id) on delete cascade,
  league_id text not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  formation text not null default '4-4-2',
  target_value numeric(12,2) not null,
  total_value numeric(12,2) not null,
  idempotency_key uuid not null,
  confirmed_at timestamptz not null default now(),
  unique (league_id, team_id, idempotency_key)
);

create table if not exists public.league_roster_players (
  roster_id uuid not null references public.league_rosters(id) on delete cascade,
  league_id text not null references public.leagues(id) on delete cascade,
  player_id text not null references public.players(id),
  slot_order smallint not null,
  is_starter boolean not null default false,
  primary key (roster_id, player_id),
  unique (league_id, player_id),
  unique (roster_id, slot_order)
);

create index if not exists players_catalog_idx on public.players(competition_id, active, position, market_value);
create index if not exists roster_players_league_idx on public.league_roster_players(league_id, player_id);
drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at before update on public.players
for each row execute function public.set_updated_at();

create temporary table _nexo_player_seed (
  player_id text, competition_id text, player_name text, position text, club_name text, market_value numeric
) on commit drop;

insert into _nexo_player_seed values
('primera_thibaut_courtois','primera','Thibaut Courtois','POR','Real Madrid',6.2),
('primera_joan_garcia','primera','Joan García','POR','FC Barcelona',5.6),
('primera_unai_simon','primera','Unai Simón','POR','Athletic Club',5.1),
('primera_trent_alexander_arnold','primera','Trent Alexander-Arnold','DEF','Real Madrid',7.2),
('primera_dean_huijsen','primera','Dean Huijsen','DEF','Real Madrid',6.8),
('primera_eder_militao','primera','Éder Militão','DEF','Real Madrid',6.4),
('primera_antonio_rudiger','primera','Antonio Rüdiger','DEF','Real Madrid',6.0),
('primera_jules_kounde','primera','Jules Koundé','DEF','FC Barcelona',6.7),
('primera_ronald_araujo','primera','Ronald Araújo','DEF','FC Barcelona',6.3),
('primera_pau_cubarsi','primera','Pau Cubarsí','DEF','FC Barcelona',6.6),
('primera_alejandro_balde','primera','Alejandro Balde','DEF','FC Barcelona',5.9),
('primera_jude_bellingham','primera','Jude Bellingham','MED','Real Madrid',8.0),
('primera_federico_valverde','primera','Federico Valverde','MED','Real Madrid',7.7),
('primera_eduardo_camavinga','primera','Eduardo Camavinga','MED','Real Madrid',6.8),
('primera_aurelien_tchouameni','primera','Aurélien Tchouaméni','MED','Real Madrid',6.9),
('primera_arda_guler','primera','Arda Güler','MED','Real Madrid',7.3),
('primera_pedri','primera','Pedri','MED','FC Barcelona',8.1),
('primera_frenkie_de_jong','primera','Frenkie de Jong','MED','FC Barcelona',7.0),
('primera_gavi','primera','Gavi','MED','FC Barcelona',6.9),
('primera_kylian_mbappe','primera','Kylian Mbappé','DEL','Real Madrid',9.4),
('primera_vinicius_junior','primera','Vinícius Júnior','DEL','Real Madrid',8.8),
('primera_lamine_yamal','primera','Lamine Yamal','DEL','FC Barcelona',9.3),
('primera_raphinha','primera','Raphinha','DEL','FC Barcelona',8.1),
('primera_ferran_torres','primera','Ferran Torres','DEL','FC Barcelona',6.8),
('primera_robert_lewandowski','primera','Robert Lewandowski','DEL','FC Barcelona',7.3),
('segunda_dinko_horkas','segunda','Dinko Horkaš','POR','UD Las Palmas',4.9),
('segunda_fernando_martinez','segunda','Fernando Martínez','POR','UD Almería',4.8),
('segunda_ruben_yanez','segunda','Rubén Yáñez','POR','Real Sporting',4.7),
('segunda_alex_munoz','segunda','Álex Muñoz','DEF','UD Las Palmas',5.4),
('segunda_mika_marmol','segunda','Mika Mármol','DEF','UD Las Palmas',5.8),
('segunda_marvin_park','segunda','Marvin Park','DEF','UD Las Palmas',5.3),
('segunda_chumi','segunda','Chumi','DEF','UD Almería',5.5),
('segunda_edgar_gonzalez','segunda','Edgar González','DEF','UD Almería',5.7),
('segunda_guille_rosas','segunda','Guille Rosas','DEF','Real Sporting',5.4),
('segunda_javi_sanchez','segunda','Javi Sánchez','DEF','Real Valladolid',5.6),
('segunda_lucas_rosa','segunda','Lucas Rosa','DEF','Real Valladolid',5.3),
('segunda_kirian_rodriguez','segunda','Kirian Rodríguez','MED','UD Las Palmas',6.9),
('segunda_manu_fuster','segunda','Manu Fuster','MED','UD Las Palmas',6.6),
('segunda_sergio_arribas','segunda','Sergio Arribas','MED','UD Almería',7.1),
('segunda_gonzalo_melero','segunda','Gonzalo Melero','MED','UD Almería',6.1),
('segunda_victor_meseguer','segunda','Víctor Meseguer','MED','Real Valladolid',6.2),
('segunda_mario_martin','segunda','Mario Martín','MED','Real Valladolid',6.0),
('segunda_nacho_martin','segunda','Nacho Martín','MED','Real Sporting',5.9),
('segunda_gaspar_campos','segunda','Gaspar Campos','MED','Real Sporting',6.2),
('segunda_jese_rodriguez','segunda','Jesé Rodríguez','DEL','UD Las Palmas',6.4),
('segunda_leo_baptistao','segunda','Leo Baptistao','DEL','UD Almería',6.7),
('segunda_jonathan_dubasin','segunda','Jonathan Dubasin','DEL','Real Sporting',6.5),
('segunda_juan_otero','segunda','Juan Otero','DEL','Real Sporting',6.2),
('segunda_marcos_andre','segunda','Marcos André','DEL','Real Valladolid',6.1),
('segunda_alex_calatrava','segunda','Álex Calatrava','DEL','CD Castellón',6.3),
('liga_f_cata_coll','liga_f','Cata Coll','POR','FC Barcelona',5.7),
('liga_f_gemma_font','liga_f','Gemma Font','POR','FC Barcelona',4.8),
('liga_f_merle_frohms','liga_f','Merle Frohms','POR','Real Madrid CF',5.4),
('liga_f_irene_paredes','liga_f','Irene Paredes','DEF','FC Barcelona',6.5),
('liga_f_marta_torrejon','liga_f','Marta Torrejón','DEF','FC Barcelona',6.1),
('liga_f_mapi_leon','liga_f','Mapi León','DEF','FC Barcelona',6.8),
('liga_f_ona_batlle','liga_f','Ona Batlle','DEF','FC Barcelona',6.7),
('liga_f_laia_aleixandri','liga_f','Laia Aleixandri','DEF','FC Barcelona',6.4),
('liga_f_esmee_brugts','liga_f','Esmee Brugts','DEF','FC Barcelona',6.2),
('liga_f_maelle_lakrar','liga_f','Maëlle Lakrar','DEF','Real Madrid CF',6.3),
('liga_f_maria_mendez','liga_f','María Méndez','DEF','Real Madrid CF',6.0),
('liga_f_alexia_putellas','liga_f','Alexia Putellas','MED','FC Barcelona',8.2),
('liga_f_patri_guijarro','liga_f','Patri Guijarro','MED','FC Barcelona',7.5),
('liga_f_aitana_bonmati','liga_f','Aitana Bonmatí','MED','FC Barcelona',8.8),
('liga_f_vicky_lopez','liga_f','Vicky López','MED','FC Barcelona',7.0),
('liga_f_sydney_schertenleib','liga_f','Sydney Schertenleib','MED','FC Barcelona',6.2),
('liga_f_andreia_jacinto','liga_f','Andreia Jacinto','MED','Real Madrid CF',6.4),
('liga_f_sara_dabritz','liga_f','Sara Däbritz','MED','Real Madrid CF',6.7),
('liga_f_sandie_toletti','liga_f','Sandie Toletti','MED','Real Madrid CF',6.6),
('liga_f_ewa_pajor','liga_f','Ewa Pajor','DEL','FC Barcelona',8.5),
('liga_f_caroline_graham_hansen','liga_f','Caroline Graham Hansen','DEL','FC Barcelona',8.4),
('liga_f_claudia_pina','liga_f','Claudia Pina','DEL','FC Barcelona',7.6),
('liga_f_salma_paralluelo','liga_f','Salma Paralluelo','DEL','FC Barcelona',7.8),
('liga_f_linda_caicedo','liga_f','Linda Caicedo','DEL','Real Madrid CF',7.9),
('liga_f_athenea_del_castillo','liga_f','Athenea del Castillo','DEL','Real Madrid CF',7.2);

insert into public.sports_clubs (id, competition_id, name)
select competition_id || '_' || substr(md5(club_name), 1, 12), competition_id, club_name
from _nexo_player_seed group by competition_id, club_name
on conflict (competition_id, name) do update set active = true;

insert into public.players (id, competition_id, sports_club_id, name, initials, position, market_value)
select seed.player_id, seed.competition_id, club.id, seed.player_name,
       upper(left(regexp_replace(seed.player_name, '[^[:alnum:]]', '', 'g'), 2)),
       seed.position, seed.market_value
from _nexo_player_seed seed
join public.sports_clubs club on club.competition_id = seed.competition_id and club.name = seed.club_name
on conflict (id) do update set sports_club_id = excluded.sports_club_id, name = excluded.name,
  position = excluded.position, market_value = excluded.market_value, active = true;

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
        'id', p.id, 'name', p.name, 'initials', p.initials, 'position', p.position,
        'value', p.market_value, 'club', c.name
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

create or replace function public.build_market_roster(
  target_membership_id uuid, requested_target_value numeric, requested_squad_size integer, request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  membership public.league_memberships;
  selected_league public.leagues;
  existing_roster_id uuid;
  new_roster_id uuid;
  selected_ids text[];
  selected_total numeric;
  attempt integer;
  desired_size integer := greatest(11, least(20, requested_squad_size));
  q_por integer := 1; q_def integer := 4; q_med integer := 4; q_del integer := 2;
  extras text[] := array['POR','DEF','MED','DEL','DEF','MED','DEL','POR','DEF'];
  extra_index integer;
begin
  select * into membership from public.league_memberships where id = target_membership_id and left_at is null for update;
  if not found then raise exception 'La participación no está activa'; end if;
  select * into selected_league from public.leagues where id = membership.league_id for update;
  if selected_league.mode <> 'market' or selected_league.roster_policy <> 'exclusive' then raise exception 'Esta liga no utiliza plantillas exclusivas'; end if;
  perform pg_advisory_xact_lock(hashtextextended(selected_league.id, 0));

  select id into existing_roster_id from public.league_rosters where membership_id = membership.id;
  if found then return public.market_roster_payload(existing_roster_id); end if;

  for extra_index in 1..(desired_size - 11) loop
    case extras[extra_index]
      when 'POR' then q_por := q_por + 1;
      when 'DEF' then q_def := q_def + 1;
      when 'MED' then q_med := q_med + 1;
      when 'DEL' then q_del := q_del + 1;
    end case;
  end loop;

  for attempt in 1..300 loop
    select array_agg(candidate.id order by candidate.position_order, candidate.random_order), sum(candidate.market_value)
      into selected_ids, selected_total
    from (
      select ranked.*, case ranked.position when 'POR' then 1 when 'DEF' then 2 when 'MED' then 3 else 4 end position_order
      from (
        select p.id, p.position, p.market_value,
               md5(p.id || request_key::text || attempt::text) random_order,
               row_number() over (partition by p.position order by md5(p.id || request_key::text || attempt::text)) position_rank
        from public.players p
        where p.competition_id = selected_league.competition_id and p.active
          and not exists (select 1 from public.league_roster_players used where used.league_id = selected_league.id and used.player_id = p.id)
      ) ranked
      where ranked.position_rank <= case ranked.position when 'POR' then q_por when 'DEF' then q_def when 'MED' then q_med else q_del end
    ) candidate;
    if coalesce(array_length(selected_ids, 1), 0) = desired_size
       and selected_total between requested_target_value * 0.9 and requested_target_value * 1.1 then exit; end if;
    selected_ids := null;
  end loop;
  if selected_ids is null then raise exception 'No quedan jugadores suficientes para formar una plantilla equilibrada'; end if;

  insert into public.league_rosters (membership_id, league_id, team_id, target_value, total_value, idempotency_key)
  values (membership.id, membership.league_id, membership.team_id, requested_target_value, selected_total, request_key)
  returning id into new_roster_id;

  insert into public.league_roster_players (roster_id, league_id, player_id, slot_order, is_starter)
  select new_roster_id, membership.league_id, chosen.player_id, chosen.slot_order,
         chosen.position_order <= case chosen.position when 'POR' then 1 when 'DEF' then 4 when 'MED' then 4 else 2 end
  from (
    select listed.player_id, listed.slot_order, p.position,
           row_number() over (partition by p.position order by listed.slot_order) position_order
    from unnest(selected_ids) with ordinality listed(player_id, slot_order)
    join public.players p on p.id = listed.player_id
  ) chosen;
  update public.league_memberships set roster_id = new_roster_id where id = membership.id;
  return public.market_roster_payload(new_roster_id);
end;
$$;

create or replace function public.confirm_market_league_join(
  reservation_id uuid, selected_team_id uuid, request_key uuid, requested_squad_size integer default 16
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reservation public.league_join_reservations;
  selected_league public.leagues;
  selected_team public.teams;
  membership_id uuid;
  active_members bigint;
  payload jsonb;
begin
  select * into reservation from public.league_join_reservations r where r.id = reservation_id and r.user_id = auth.uid() for update;
  if not found or reservation.expires_at <= now() then raise exception 'La reserva ha caducado'; end if;
  select * into selected_league from public.leagues where id = reservation.league_id for update;
  if selected_league.mode <> 'market' or selected_league.roster_policy <> 'exclusive' then raise exception 'La modalidad no es válida'; end if;
  select * into selected_team from public.teams where id = selected_team_id and owner_id = auth.uid() and active for update;
  if not found then raise exception 'El equipo no es válido'; end if;
  if selected_team.competition_id <> selected_league.competition_id then raise exception 'El equipo pertenece a otra competición'; end if;
  select count(*) into active_members from public.league_memberships where league_id = selected_league.id and left_at is null;
  if active_members >= selected_league.capacity then raise exception 'La liga ya está completa'; end if;

  insert into public.league_memberships (league_id, user_id, team_id, role, budget, joined_at, left_at)
  values (selected_league.id, auth.uid(), selected_team.id, 'member', selected_league.starting_budget, now(), null)
  on conflict (league_id, user_id) do update set team_id = excluded.team_id, role = 'member', budget = excluded.budget, joined_at = now(), left_at = null
  returning id into membership_id;
  payload := public.build_market_roster(membership_id, selected_league.target_squad_value, requested_squad_size, request_key);
  delete from public.league_join_reservations where id = reservation.id;
  return payload;
end;
$$;

create or replace function public.allocate_my_market_roster(
  membership_id uuid, requested_target_value numeric, requested_squad_size integer, request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.league_memberships m where m.id = membership_id and m.user_id = auth.uid() and m.left_at is null) then
    raise exception 'La participación no te pertenece';
  end if;
  return public.build_market_roster(membership_id, requested_target_value, requested_squad_size, request_key);
end;
$$;

create or replace function public.create_private_league(
  league_name text, selected_team_id uuid, requested_capacity integer, requested_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  selected_team public.teams;
  new_league_id text := 'private_' || replace(gen_random_uuid()::text, '-', '');
  access_code text := 'NX-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
  new_membership_id uuid;
  allocation jsonb;
  squad_size integer := greatest(11, least(20, coalesce((requested_rules->>'initialSquadSize')::integer, 16)));
begin
  if char_length(trim(league_name)) not between 3 and 30 then raise exception 'El nombre debe tener entre 3 y 30 caracteres'; end if;
  if requested_capacity not between 2 and 100 then raise exception 'La capacidad no es válida'; end if;
  select * into selected_team from public.teams where id = selected_team_id and owner_id = auth.uid() and active;
  if not found then raise exception 'El equipo no es válido'; end if;
  insert into public.leagues (id, owner_id, competition_id, name, visibility, mode, roster_policy, accent, capacity, starting_budget, target_squad_value, access_code_hash, rules)
  values (new_league_id, auth.uid(), selected_team.competition_id, trim(league_name), 'private', 'market', 'exclusive', 'lime', requested_capacity,
          coalesce((requested_rules->>'startingBudget')::numeric, 100), 104,
          encode(digest(access_code, 'sha256'), 'hex'), requested_rules);
  insert into public.league_memberships (league_id, user_id, team_id, role, budget)
  values (new_league_id, auth.uid(), selected_team.id, 'admin', coalesce((requested_rules->>'startingBudget')::numeric, 100))
  returning id into new_membership_id;
  allocation := public.build_market_roster(new_membership_id, 104, squad_size, gen_random_uuid());
  return jsonb_build_object('leagueId', new_league_id, 'membershipId', new_membership_id, 'accessCode', access_code, 'squad', allocation->'squad');
end;
$$;

create or replace function public.update_player_catalog_entry(
  target_player_id text, new_name text, new_position text, new_market_value numeric, new_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Acceso reservado a administradores'; end if;
  update public.players set name = trim(new_name), position = new_position, market_value = new_market_value, active = new_active where id = target_player_id;
  if not found then raise exception 'Jugador no encontrado'; end if;
end;
$$;

alter table public.sports_clubs enable row level security;
alter table public.players enable row level security;
alter table public.league_rosters enable row level security;
alter table public.league_roster_players enable row level security;
drop policy if exists sports_clubs_read on public.sports_clubs;
create policy sports_clubs_read on public.sports_clubs for select to anon, authenticated using (active);
drop policy if exists players_read on public.players;
create policy players_read on public.players for select to anon, authenticated using (active or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
drop policy if exists rosters_read_own on public.league_rosters;
create policy rosters_read_own on public.league_rosters for select to authenticated using (exists (select 1 from public.league_memberships m where m.id = membership_id and m.user_id = auth.uid()));
drop policy if exists roster_players_read_own on public.league_roster_players;
create policy roster_players_read_own on public.league_roster_players for select to authenticated using (exists (select 1 from public.league_rosters r join public.league_memberships m on m.id = r.membership_id where r.id = roster_id and m.user_id = auth.uid()));

revoke all on public.sports_clubs, public.players, public.league_rosters, public.league_roster_players from anon, authenticated;
grant select on public.sports_clubs, public.players to anon, authenticated;
grant select on public.league_rosters, public.league_roster_players to authenticated;
grant execute on function public.confirm_market_league_join(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.allocate_my_market_roster(uuid, numeric, integer, uuid) to authenticated;
grant execute on function public.update_player_catalog_entry(text, text, text, numeric, boolean) to authenticated;
grant execute on function public.create_private_league(text, uuid, integer, jsonb) to authenticated;
revoke all on function public.market_roster_payload(uuid) from public, anon, authenticated;
revoke all on function public.build_market_roster(uuid, numeric, integer, uuid) from public, anon, authenticated;
