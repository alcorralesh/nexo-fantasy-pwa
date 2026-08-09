-- Ajusta el banquillo de 16 para que el catálogo oficial permita 16 participantes exclusivos.

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
  extras text[] := array['DEF','MED','DEL','DEF','MED','POR','DEF','MED','DEL'];
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

revoke all on function public.build_market_roster(uuid, numeric, integer, uuid) from public, anon, authenticated;
