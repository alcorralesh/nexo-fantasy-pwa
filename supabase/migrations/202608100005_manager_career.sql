-- Carrera de mánager: modo individual basado en clubes y calendario reales.

create table if not exists public.manager_career_rules (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  free_careers_per_competition integer not null default 1 check (free_careers_per_competition between 0 and 10),
  extra_career_coin_cost integer not null default 500 check (extra_career_coin_cost >= 0),
  initial_budget numeric(12,2) not null default 25 check (initial_budget >= 0),
  minimum_original_squad integer not null default 8 check (minimum_original_squad between 0 and 25),
  minimum_original_lineup integer not null default 7 check (minimum_original_lineup between 0 and 11),
  weekly_decision_enabled boolean not null default true,
  same_club_ranking_enabled boolean not null default true,
  relaxed_reputation_multiplier numeric(5,2) not null default 0.80,
  balanced_reputation_multiplier numeric(5,2) not null default 1.00,
  elite_reputation_multiplier numeric(5,2) not null default 1.35,
  updated_at timestamptz not null default now()
);
alter table public.manager_career_rules add column if not exists weekly_decision_enabled boolean not null default true;
alter table public.manager_career_rules add column if not exists same_club_ranking_enabled boolean not null default true;

insert into public.manager_career_rules(id) values(true) on conflict(id) do nothing;

create table if not exists public.manager_careers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  competition_id text not null references public.competitions(id),
  sports_club_id text not null references public.sports_clubs(id),
  difficulty text not null default 'balanced' check (difficulty in ('relaxed','balanced','elite')),
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  season_label text not null default '26/27',
  current_matchday integer not null default 1 check (current_matchday > 0),
  budget numeric(12,2) not null,
  reputation integer not null default 0 check (reputation between 0 and 100),
  sporting_points integer not null default 0,
  objective_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, club_id, competition_id, sports_club_id, season_label)
);

create table if not exists public.manager_career_players (
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  player_id text not null references public.players(id),
  acquisition_value numeric(12,2) not null,
  is_original boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key(career_id, player_id)
);

create table if not exists public.manager_career_objectives (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  objective_type text not null,
  title text not null,
  description text not null,
  target_value numeric(12,2) not null,
  current_value numeric(12,2) not null default 0,
  reputation_reward integer not null default 5,
  coin_reward integer not null default 0,
  status text not null default 'active' check (status in ('active','completed','failed')),
  expires_matchday integer,
  created_at timestamptz not null default now()
);

create table if not exists public.manager_career_events (
  id uuid primary key default gen_random_uuid(),
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  event_type text not null,
  title text not null,
  detail text not null default '',
  matchday integer,
  reputation_change integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists manager_careers_owner_idx on public.manager_careers(owner_id,status);
create index if not exists manager_career_players_career_idx on public.manager_career_players(career_id);
create index if not exists manager_career_objectives_career_idx on public.manager_career_objectives(career_id,status);
create index if not exists manager_career_events_career_idx on public.manager_career_events(career_id,created_at desc);

alter table public.manager_career_rules enable row level security;
alter table public.manager_careers enable row level security;
alter table public.manager_career_players enable row level security;
alter table public.manager_career_objectives enable row level security;
alter table public.manager_career_events enable row level security;

create policy manager_career_rules_read on public.manager_career_rules for select using (true);
create policy manager_careers_owner on public.manager_careers for select using (owner_id = auth.uid());
create policy manager_career_players_owner on public.manager_career_players for select using (exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid()));
create policy manager_career_objectives_owner on public.manager_career_objectives for select using (exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid()));
create policy manager_career_events_owner on public.manager_career_events for select using (exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid()));

create or replace function public.career_available_clubs(target_competition_id text)
returns table(id text,name text,competition_id text,player_count bigint,squad_value numeric)
language sql stable security definer set search_path=public
as $$
  select sc.id,sc.name,sc.competition_id,count(p.id),coalesce(sum(p.market_value),0)
  from public.sports_clubs sc left join public.players p on p.sports_club_id=sc.id and p.active
  where sc.competition_id=target_competition_id and sc.active
  group by sc.id,sc.name,sc.competition_id having count(p.id)>=11 order by sc.name;
$$;

create or replace function public.my_manager_careers()
returns table(id uuid,club_id uuid,competition_id text,sports_club_id text,sports_club_name text,difficulty text,status text,season_label text,current_matchday integer,budget numeric,reputation integer,sporting_points integer,objective_points integer,original_players bigint,squad_size bigint,created_at timestamptz)
language sql stable security definer set search_path=public
as $$
  select c.id,c.club_id,c.competition_id,c.sports_club_id,sc.name,c.difficulty,c.status,c.season_label,c.current_matchday,c.budget,c.reputation,c.sporting_points,c.objective_points,
    count(cp.player_id) filter(where cp.is_original),count(cp.player_id),c.created_at
  from public.manager_careers c join public.sports_clubs sc on sc.id=c.sports_club_id left join public.manager_career_players cp on cp.career_id=c.id
  where c.owner_id=auth.uid() group by c.id,sc.name order by c.created_at desc;
$$;

create or replace function public.create_manager_career(target_club_id uuid,target_sports_club_id text,target_difficulty text default 'balanced') returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_owner uuid:=auth.uid(); v_competition text; v_career uuid; v_budget numeric; v_count integer;
begin
  if v_owner is null then raise exception 'Debes iniciar sesión'; end if;
  if target_difficulty not in ('relaxed','balanced','elite') then raise exception 'Dificultad no válida'; end if;
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=v_owner and active) then raise exception 'El club no te pertenece'; end if;
  select competition_id into v_competition from public.sports_clubs where id=target_sports_club_id and active;
  if v_competition is null then raise exception 'Equipo real no disponible'; end if;
  select count(*) into v_count from public.players where sports_club_id=target_sports_club_id and active;
  if v_count<11 then raise exception 'El equipo no tiene una plantilla suficiente'; end if;
  select initial_budget into v_budget from public.manager_career_rules where id;
  insert into public.manager_careers(owner_id,club_id,competition_id,sports_club_id,difficulty,budget) values(v_owner,target_club_id,v_competition,target_sports_club_id,target_difficulty,v_budget) returning id into v_career;
  insert into public.manager_career_players(career_id,player_id,acquisition_value) select v_career,id,market_value from public.players where sports_club_id=target_sports_club_id and active;
  insert into public.manager_career_objectives(career_id,objective_type,title,description,target_value,reputation_reward,expires_matchday) values
    (v_career,'identity','Protege la identidad','Mantén al menos ocho jugadores originales en la plantilla.',8,8,null),
    (v_career,'matchday','Debut con carácter','Suma al menos 55 puntos en la primera jornada.',55,6,1),
    (v_career,'season','Objetivo de temporada','Alcanza el objetivo deportivo asignado al club.',40,25,null);
  insert into public.manager_career_events(career_id,event_type,title,detail,reputation_change) values(v_career,'start','Comienza una nueva era','La directiva te entrega el equipo y marca sus primeros objetivos.',0);
  return v_career;
end $$;

create or replace function public.update_manager_career_rules(next_enabled boolean,next_free_careers integer,next_extra_cost integer,next_initial_budget numeric,next_minimum_original_squad integer,next_minimum_original_lineup integer,next_weekly_decisions boolean,next_same_club_ranking boolean) returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administración puede cambiar estas reglas'; end if;
  update public.manager_career_rules set enabled=next_enabled,free_careers_per_competition=next_free_careers,extra_career_coin_cost=next_extra_cost,initial_budget=next_initial_budget,minimum_original_squad=next_minimum_original_squad,minimum_original_lineup=next_minimum_original_lineup,weekly_decision_enabled=next_weekly_decisions,same_club_ranking_enabled=next_same_club_ranking,updated_at=now() where id;
end $$;

revoke all on function public.create_manager_career(uuid,text,text) from public,anon;
grant execute on function public.create_manager_career(uuid,text,text),public.my_manager_careers() to authenticated;
grant execute on function public.update_manager_career_rules(boolean,integer,integer,numeric,integer,integer,boolean,boolean) to authenticated;
grant execute on function public.career_available_clubs(text) to anon,authenticated;
grant select on public.manager_career_rules to anon,authenticated;
grant all on public.manager_careers,public.manager_career_players,public.manager_career_objectives,public.manager_career_events to service_role;
notify pgrst,'reload schema';
