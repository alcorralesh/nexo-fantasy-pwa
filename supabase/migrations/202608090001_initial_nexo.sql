-- Nexo Fantasy: núcleo inicial para Supabase (plan gratuito).
-- Ejecutar una sola vez en el proyecto dedicado de Nexo.

create extension if not exists pgcrypto;

create table if not exists public.competitions (
  id text primary key,
  name text not null unique,
  short_name text not null,
  sort_order smallint not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint competitions_id_format check (id ~ '^[a-z0-9_]+$')
);

insert into public.competitions (id, name, short_name, sort_order)
values
  ('primera', 'Primera', 'Primera', 1),
  ('segunda', 'Segunda', 'Segunda', 2),
  ('liga_f', 'Liga F', 'Liga F', 3)
on conflict (id) do update
set name = excluded.name,
    short_name = excluded.short_name,
    sort_order = excluded.sort_order;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique,
  display_name text not null,
  initials text not null,
  country text not null default 'España',
  favorite_competition_id text references public.competitions(id),
  role text not null default 'user',
  coins integer not null default 1000,
  onboarding_version integer not null default 0,
  active_club_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role check (role in ('user', 'admin')),
  constraint profiles_coins_nonnegative check (coins >= 0),
  constraint profiles_username_format check (username ~ '^[a-zA-Z0-9_]{3,32}$')
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  short_name text not null,
  motto text not null default '',
  primary_color text not null default '#b8ff3d',
  secondary_color text not null default '#0a1b10',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clubs_name_length check (char_length(name) between 2 and 48),
  constraint clubs_short_name_length check (char_length(short_name) between 1 and 4),
  constraint clubs_colors check (primary_color ~ '^#[0-9a-fA-F]{6}$' and secondary_color ~ '^#[0-9a-fA-F]{6}$')
);

alter table public.profiles
  drop constraint if exists profiles_active_club_id_fkey;
alter table public.profiles
  add constraint profiles_active_club_id_fkey
  foreign key (active_club_id) references public.clubs(id) on delete set null;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  competition_id text not null references public.competitions(id),
  name text not null,
  short_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_length check (char_length(name) between 2 and 48),
  constraint teams_short_name_length check (char_length(short_name) between 1 and 4)
);

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  version integer not null,
  title text not null,
  change_summary text not null default '',
  content text not null,
  published_at timestamptz not null default now(),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint legal_document_type check (document_type in ('privacy', 'terms')),
  constraint legal_version_positive check (version > 0),
  unique (document_type, version)
);

create table if not exists public.legal_acceptances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.legal_documents(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

insert into public.legal_documents (document_type, version, title, change_summary, content)
values
  ('privacy', 1, 'Política de privacidad', 'Primera política de privacidad de Nexo.', 'Versión inicial de desarrollo. El administrador podrá sustituir este contenido antes de publicar el juego.'),
  ('terms', 1, 'Condiciones generales', 'Primeras condiciones generales del juego.', 'Versión inicial de desarrollo. Las monedas y los pagos mostrados durante el desarrollo son simulados.')
on conflict (document_type, version) do nothing;

create index if not exists clubs_owner_id_idx on public.clubs(owner_id);
create index if not exists teams_owner_id_idx on public.teams(owner_id);
create index if not exists teams_club_id_idx on public.teams(club_id);
create index if not exists teams_competition_id_idx on public.teams(competition_id);
create index if not exists legal_documents_active_idx on public.legal_documents(document_type, active, version desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists clubs_set_updated_at on public.clubs;
create trigger clubs_set_updated_at before update on public.clubs
for each row execute function public.set_updated_at();
drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at before update on public.teams
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  requested_name text;
  requested_username text;
  safe_username text;
  requested_competition text;
  new_club_id uuid;
  generated_initials text;
begin
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Jugador'));
  requested_username := regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'jugador'), '[^a-zA-Z0-9_]', '', 'g');
  if char_length(requested_username) < 3 then requested_username := 'jugador'; end if;
  safe_username := left(requested_username, 24) || '_' || left(replace(new.id::text, '-', ''), 7);
  requested_competition := coalesce(new.raw_user_meta_data ->> 'favorite_competition_id', 'primera');
  if not exists (select 1 from public.competitions where id = requested_competition and active) then requested_competition := 'primera'; end if;
  generated_initials := upper(left(regexp_replace(requested_name, '[^[:alnum:]]', '', 'g'), 2));
  if generated_initials = '' then generated_initials := 'NX'; end if;

  insert into public.profiles (id, email, username, display_name, initials, country, favorite_competition_id)
  values (new.id, coalesce(new.email, ''), safe_username, requested_name, generated_initials,
          coalesce(new.raw_user_meta_data ->> 'country', 'España'), requested_competition);

  insert into public.clubs (owner_id, name, short_name)
  values (new.id, 'Club de ' || requested_name, left(generated_initials, 4))
  returning id into new_club_id;

  insert into public.teams (club_id, owner_id, competition_id, name, short_name)
  values (new_club_id, new.id, requested_competition, 'Equipo de ' || requested_name, left(generated_initials, 4));

  update public.profiles set active_club_id = new_club_id where id = new.id;

  if coalesce((new.raw_user_meta_data ->> 'accepted_legal')::boolean, false) then
    insert into public.legal_acceptances (user_id, document_id)
    select new.id, id from public.legal_documents where active
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.update_my_profile(
  new_display_name text,
  new_country text,
  new_favorite_competition_id text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if char_length(trim(new_display_name)) < 2 then raise exception 'El nombre es demasiado corto'; end if;
  if not exists (select 1 from public.competitions where id = new_favorite_competition_id and active) then raise exception 'Competición no válida'; end if;
  update public.profiles
     set display_name = trim(new_display_name),
         initials = upper(left(regexp_replace(trim(new_display_name), '[^[:alnum:]]', '', 'g'), 2)),
         country = trim(new_country),
         favorite_competition_id = new_favorite_competition_id
   where id = auth.uid()
   returning * into result;
  return result;
end;
$$;

create or replace function public.complete_my_onboarding(new_version integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set onboarding_version = greatest(onboarding_version, new_version)
   where id = auth.uid();
$$;

create or replace function public.accept_current_legal()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.legal_acceptances (user_id, document_id)
  select auth.uid(), id from public.legal_documents where active
  on conflict do nothing;
$$;

alter table public.competitions enable row level security;
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.teams enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;

drop policy if exists competitions_read on public.competitions;
create policy competitions_read on public.competitions for select to anon, authenticated using (active);
drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
drop policy if exists clubs_read_authenticated on public.clubs;
create policy clubs_read_authenticated on public.clubs for select to authenticated using (true);
drop policy if exists clubs_insert_own on public.clubs;
create policy clubs_insert_own on public.clubs for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists clubs_update_own on public.clubs;
create policy clubs_update_own on public.clubs for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists clubs_delete_own on public.clubs;
create policy clubs_delete_own on public.clubs for delete to authenticated using (owner_id = auth.uid());
drop policy if exists teams_read_authenticated on public.teams;
create policy teams_read_authenticated on public.teams for select to authenticated using (true);
drop policy if exists teams_insert_own on public.teams;
create policy teams_insert_own on public.teams for insert to authenticated with check (
  owner_id = auth.uid() and exists (select 1 from public.clubs where id = club_id and owner_id = auth.uid())
);
drop policy if exists teams_update_own on public.teams;
create policy teams_update_own on public.teams for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists teams_delete_own on public.teams;
create policy teams_delete_own on public.teams for delete to authenticated using (owner_id = auth.uid());
drop policy if exists legal_documents_read on public.legal_documents;
create policy legal_documents_read on public.legal_documents for select to anon, authenticated using (active);
drop policy if exists legal_acceptances_read_own on public.legal_acceptances;
create policy legal_acceptances_read_own on public.legal_acceptances for select to authenticated using (user_id = auth.uid());
drop policy if exists legal_acceptances_insert_own on public.legal_acceptances;
create policy legal_acceptances_insert_own on public.legal_acceptances for insert to authenticated with check (user_id = auth.uid());

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.competitions, public.legal_documents to anon, authenticated;
grant select on public.profiles, public.clubs, public.teams, public.legal_acceptances to authenticated;
grant insert, update, delete on public.clubs, public.teams to authenticated;
grant insert on public.legal_acceptances to authenticated;
grant execute on function public.update_my_profile(text, text, text) to authenticated;
grant execute on function public.complete_my_onboarding(integer) to authenticated;
grant execute on function public.accept_current_legal() to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
