-- Juego persistente de Carrera: alineaciones, mercado individual y decisiones.

create table if not exists public.manager_career_lineups (
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  matchday integer not null check (matchday > 0),
  formation text not null check (formation in ('4-4-2','4-3-3','3-4-3','3-5-2','5-3-2')),
  captain_id text not null references public.players(id),
  player_ids text[] not null,
  saved_at timestamptz not null default now(),
  primary key (career_id, matchday)
);

create table if not exists public.manager_career_decisions (
  career_id uuid not null references public.manager_careers(id) on delete cascade,
  matchday integer not null check (matchday > 0),
  decision_key text not null,
  choice_key text not null,
  choice_title text not null,
  consequence text not null,
  reputation_change integer not null default 0,
  budget_change numeric(12,2) not null default 0,
  decided_at timestamptz not null default now(),
  primary key (career_id, matchday, decision_key)
);

create index if not exists manager_career_lineups_idx on public.manager_career_lineups(career_id,matchday desc);
create index if not exists manager_career_decisions_idx on public.manager_career_decisions(career_id,matchday desc);

alter table public.manager_career_lineups enable row level security;
alter table public.manager_career_decisions enable row level security;

drop policy if exists manager_career_lineups_owner on public.manager_career_lineups;
create policy manager_career_lineups_owner on public.manager_career_lineups for select using (
  exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid())
);
drop policy if exists manager_career_decisions_owner on public.manager_career_decisions;
create policy manager_career_decisions_owner on public.manager_career_decisions for select using (
  exists(select 1 from public.manager_careers c where c.id=career_id and c.owner_id=auth.uid())
);

create or replace function public.manager_career_workspace(target_career_id uuid) returns jsonb
as $career_workspace$
declare v_owner uuid:=auth.uid(); v_career public.manager_careers%rowtype; v_result jsonb;
begin
  select * into v_career from public.manager_careers where id=target_career_id and owner_id=v_owner;
  if not found then raise exception 'Carrera no disponible'; end if;
  select jsonb_build_object(
    'career',jsonb_build_object('id',v_career.id,'matchday',v_career.current_matchday,'budget',v_career.budget),
    'squad',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,
      'value',p.market_value,'photoUrl',p.photo_url,'isOriginal',cp.is_original,'acquisitionValue',cp.acquisition_value
    ) order by p.position,p.name) from public.manager_career_players cp join public.players p on p.id=cp.player_id join public.sports_clubs sc on sc.id=p.sports_club_id where cp.career_id=v_career.id),'[]'::jsonb),
    'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchday',l.matchday,'formation',l.formation,'captainId',l.captain_id,'playerIds',l.player_ids,'savedAt',l.saved_at) order by l.matchday desc) from public.manager_career_lineups l where l.career_id=v_career.id),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(jsonb_build_object('matchday',d.matchday,'decisionKey',d.decision_key,'choiceKey',d.choice_key,'choiceTitle',d.choice_title,'consequence',d.consequence,'reputationChange',d.reputation_change,'budgetChange',d.budget_change,'decidedAt',d.decided_at) order by d.matchday desc) from public.manager_career_decisions d where d.career_id=v_career.id),'[]'::jsonb),
    'market',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'initials',p.initials,'position',p.position,'club',sc.name,'value',p.market_value,'photoUrl',p.photo_url) order by p.market_value desc,p.name) from public.players p join public.sports_clubs sc on sc.id=p.sports_club_id where p.competition_id=v_career.competition_id and p.active and not exists(select 1 from public.manager_career_players cp where cp.career_id=v_career.id and cp.player_id=p.id)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$career_workspace$ language plpgsql stable security definer set search_path=public;

create or replace function public.save_manager_career_lineup(target_career_id uuid,target_matchday integer,target_formation text,target_player_ids text[],target_captain_id text) returns void
as $career_lineup$
declare v_career public.manager_careers%rowtype; v_min_original integer; v_por integer; v_def integer; v_med integer; v_del integer;
begin
  select * into v_career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  if target_matchday<>v_career.current_matchday then raise exception 'Solo puedes editar la jornada abierta'; end if;
  if target_formation not in ('4-4-2','4-3-3','3-4-3','3-5-2','5-3-2') then raise exception 'Formación no válida'; end if;
  if coalesce(array_length(target_player_ids,1),0)<>11 or (select count(distinct x) from unnest(target_player_ids) x)<>11 then raise exception 'El once debe contener once jugadores distintos'; end if;
  if not target_captain_id=any(target_player_ids) then raise exception 'El capitán debe estar en el once'; end if;
  if (select count(*) from public.manager_career_players cp where cp.career_id=v_career.id and cp.player_id=any(target_player_ids))<>11 then raise exception 'Solo puedes alinear jugadores de tu plantilla'; end if;
  select count(*) filter(where p.position='POR'),count(*) filter(where p.position='DEF'),count(*) filter(where p.position='MED'),count(*) filter(where p.position='DEL') into v_por,v_def,v_med,v_del from public.players p where p.id=any(target_player_ids);
  if v_por<>1 or v_def<>split_part(target_formation,'-',1)::integer or v_med<>split_part(target_formation,'-',2)::integer or v_del<>split_part(target_formation,'-',3)::integer then raise exception 'El once no respeta la formación elegida'; end if;
  select minimum_original_lineup into v_min_original from public.manager_career_rules where id;
  if (select count(*) from public.manager_career_players cp where cp.career_id=v_career.id and cp.player_id=any(target_player_ids) and cp.is_original)<v_min_original then raise exception 'No cumples el mínimo de jugadores originales en el once'; end if;
  insert into public.manager_career_lineups(career_id,matchday,formation,captain_id,player_ids,saved_at) values(v_career.id,target_matchday,target_formation,target_captain_id,target_player_ids,now())
  on conflict(career_id,matchday) do update set formation=excluded.formation,captain_id=excluded.captain_id,player_ids=excluded.player_ids,saved_at=now();
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday) values(v_career.id,'lineup','Once confirmado','Alineación '||target_formation||' guardada para la Jornada '||target_matchday,target_matchday);
end;
$career_lineup$ language plpgsql security definer set search_path=public;

create or replace function public.buy_manager_career_player(target_career_id uuid,target_player_id text) returns jsonb
as $career_buy$
declare v_career public.manager_careers%rowtype; v_player public.players%rowtype; v_squad integer;
begin
  select * into v_career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into v_player from public.players where id=target_player_id and active for share;
  if not found or v_player.competition_id<>v_career.competition_id then raise exception 'Jugador no disponible en este mercado'; end if;
  if exists(select 1 from public.manager_career_players where career_id=v_career.id and player_id=v_player.id) then raise exception 'El jugador ya pertenece a tu plantilla'; end if;
  select count(*) into v_squad from public.manager_career_players where career_id=v_career.id;
  if v_squad>=25 then raise exception 'La plantilla ya tiene el máximo de 25 jugadores'; end if;
  if v_career.budget<v_player.market_value then raise exception 'Saldo insuficiente'; end if;
  update public.manager_careers set budget=budget-v_player.market_value,updated_at=now() where id=v_career.id;
  insert into public.manager_career_players(career_id,player_id,acquisition_value,is_original) values(v_career.id,v_player.id,v_player.market_value,false);
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday) values(v_career.id,'market_buy','Fichaje completado',v_player.name||' llega por '||v_player.market_value||' M',v_career.current_matchday);
  return jsonb_build_object('budget',v_career.budget-v_player.market_value,'playerId',v_player.id,'amount',v_player.market_value);
end;
$career_buy$ language plpgsql security definer set search_path=public;

create or replace function public.sell_manager_career_player(target_career_id uuid,target_player_id text) returns jsonb
as $career_sell$
declare v_career public.manager_careers%rowtype; v_player public.players%rowtype; v_owned public.manager_career_players%rowtype; v_squad integer; v_originals integer; v_min_original integer;
begin
  select * into v_career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select * into v_owned from public.manager_career_players where career_id=v_career.id and player_id=target_player_id for update;
  if not found then raise exception 'El jugador no pertenece a tu plantilla'; end if;
  select * into v_player from public.players where id=target_player_id;
  select count(*),count(*) filter(where is_original) into v_squad,v_originals from public.manager_career_players where career_id=v_career.id;
  select minimum_original_squad into v_min_original from public.manager_career_rules where id;
  if v_squad<=11 then raise exception 'Debes conservar al menos once jugadores'; end if;
  if v_owned.is_original and v_originals<=v_min_original then raise exception 'La directiva exige conservar más jugadores originales'; end if;
  if exists(select 1 from public.manager_career_lineups where career_id=v_career.id and matchday=v_career.current_matchday and target_player_id=any(player_ids)) then raise exception 'Quita al jugador del once guardado antes de venderlo'; end if;
  delete from public.manager_career_players where career_id=v_career.id and player_id=v_player.id;
  update public.manager_careers set budget=budget+v_player.market_value,updated_at=now() where id=v_career.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday) values(v_career.id,'market_sell','Venta completada',v_player.name||' sale por '||v_player.market_value||' M',v_career.current_matchday);
  return jsonb_build_object('budget',v_career.budget+v_player.market_value,'playerId',v_player.id,'amount',v_player.market_value);
end;
$career_sell$ language plpgsql security definer set search_path=public;

create or replace function public.save_manager_career_decision(target_career_id uuid,target_decision_key text,target_choice_key text) returns jsonb
as $career_decision$
declare v_career public.manager_careers%rowtype; v_enabled boolean; v_multiplier numeric; v_title text; v_consequence text; v_base_rep integer; v_rep integer;
begin
  select * into v_career from public.manager_careers where id=target_career_id and owner_id=auth.uid() and status='active' for update;
  if not found then raise exception 'Carrera no disponible'; end if;
  select weekly_decision_enabled,case v_career.difficulty when 'relaxed' then relaxed_reputation_multiplier when 'elite' then elite_reputation_multiplier else balanced_reputation_multiplier end into v_enabled,v_multiplier from public.manager_career_rules where id;
  if not v_enabled then raise exception 'Las decisiones semanales están desactivadas'; end if;
  if target_decision_key<>'youth_minutes' or target_choice_key not in ('academy','experience') then raise exception 'Decisión no válida'; end if;
  if exists(select 1 from public.manager_career_decisions where career_id=v_career.id and matchday=v_career.current_matchday and decision_key=target_decision_key) then raise exception 'Ya has tomado esta decisión en la jornada'; end if;
  if target_choice_key='academy' then v_title:='Apostar por la cantera'; v_consequence:='La afición valora tu valentía. Aumenta la presión deportiva de esta jornada.'; v_base_rep:=3;
  else v_title:='Proteger el resultado'; v_consequence:='El vestuario gana estabilidad, aunque la afición esperaba una apuesta más valiente.'; v_base_rep:=1; end if;
  v_rep:=greatest(0,round(v_base_rep*v_multiplier));
  insert into public.manager_career_decisions(career_id,matchday,decision_key,choice_key,choice_title,consequence,reputation_change) values(v_career.id,v_career.current_matchday,target_decision_key,target_choice_key,v_title,v_consequence,v_rep);
  update public.manager_careers set reputation=least(100,reputation+v_rep),updated_at=now() where id=v_career.id;
  insert into public.manager_career_events(career_id,event_type,title,detail,matchday,reputation_change) values(v_career.id,'decision',v_title,v_consequence,v_career.current_matchday,v_rep);
  return jsonb_build_object('choiceTitle',v_title,'consequence',v_consequence,'reputationChange',v_rep);
end;
$career_decision$ language plpgsql security definer set search_path=public;

revoke all on function public.manager_career_workspace(uuid),public.save_manager_career_lineup(uuid,integer,text,text[],text),public.buy_manager_career_player(uuid,text),public.sell_manager_career_player(uuid,text),public.save_manager_career_decision(uuid,text,text) from public,anon;
grant execute on function public.manager_career_workspace(uuid),public.save_manager_career_lineup(uuid,integer,text,text[],text),public.buy_manager_career_player(uuid,text),public.sell_manager_career_player(uuid,text),public.save_manager_career_decision(uuid,text,text) to authenticated;
grant all on public.manager_career_lineups,public.manager_career_decisions to service_role;
notify pgrst,'reload schema';
