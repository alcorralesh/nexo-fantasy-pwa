-- Detalles privados recuperables por el administrador de cada liga.
-- El código de invitación no es una contraseña: se conserva para poder compartirlo,
-- mientras su hash sigue siendo la única referencia usada para validar una entrada.

alter table public.leagues add column if not exists access_code text;

create or replace function public.my_private_league_admin_details()
returns table (
  league_id text,
  access_code text,
  rules jsonb,
  join_locked boolean,
  capacity integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare item record; generated_code text;
begin
  for item in
    select l.id
      from public.leagues l
     where l.visibility = 'private' and l.status = 'open' and l.owner_id = auth.uid()
  loop
    if (select l.access_code is null from public.leagues l where l.id = item.id) then
      generated_code := 'NX-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
      update public.leagues
         set access_code = generated_code,
             access_code_hash = encode(digest(generated_code, 'sha256'), 'hex'),
             updated_at = now()
       where id = item.id;
    end if;
  end loop;

  return query
  select l.id, l.access_code, l.rules, l.join_locked, l.capacity
    from public.leagues l
   where l.visibility = 'private' and l.status = 'open' and l.owner_id = auth.uid()
   order by l.created_at;
end;
$$;

create or replace function public.regenerate_my_private_league_code(target_league_id text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare generated_code text;
begin
  if not exists (
    select 1 from public.leagues
     where id = target_league_id and visibility = 'private' and status = 'open' and owner_id = auth.uid()
  ) then
    raise exception 'No administras esta liga';
  end if;
  generated_code := 'NX-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
  update public.leagues
     set access_code = generated_code,
         access_code_hash = encode(digest(generated_code, 'sha256'), 'hex'),
         updated_at = now()
   where id = target_league_id;
  delete from public.league_join_reservations where league_id = target_league_id;
  return generated_code;
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
begin
  if char_length(trim(league_name)) not between 3 and 30 then raise exception 'El nombre debe tener entre 3 y 30 caracteres'; end if;
  if requested_capacity not between 2 and 100 then raise exception 'La capacidad no es válida'; end if;
  select * into selected_team from public.teams where id = selected_team_id and owner_id = auth.uid() and active;
  if not found then raise exception 'El equipo no es válido'; end if;
  insert into public.leagues (id, owner_id, competition_id, name, visibility, mode, roster_policy, accent, capacity, starting_budget, target_squad_value, access_code, access_code_hash, rules)
  values (new_league_id, auth.uid(), selected_team.competition_id, trim(league_name), 'private', 'market', 'exclusive', 'lime', requested_capacity,
          coalesce((requested_rules->>'startingBudget')::numeric, 100), 104, access_code,
          encode(digest(access_code, 'sha256'), 'hex'), requested_rules);
  insert into public.league_memberships (league_id, user_id, team_id, role, budget)
  values (new_league_id, auth.uid(), selected_team.id, 'admin', coalesce((requested_rules->>'startingBudget')::numeric, 100))
  returning id into new_membership_id;
  return jsonb_build_object('leagueId', new_league_id, 'membershipId', new_membership_id, 'accessCode', access_code);
end;
$$;

revoke all on function public.my_private_league_admin_details(), public.regenerate_my_private_league_code(text) from public, anon;
grant execute on function public.my_private_league_admin_details(), public.regenerate_my_private_league_code(text) to authenticated;

