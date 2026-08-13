-- The catalog Edge Function persists its lifecycle with the service role.
-- Keep authenticated users read-only through RLS while allowing the backend
-- to create, complete and fail synchronization jobs.
grant select, insert, update, delete
  on table public.player_catalog_sync_jobs
  to service_role;

grant select
  on table public.players, public.sports_clubs
  to service_role;
