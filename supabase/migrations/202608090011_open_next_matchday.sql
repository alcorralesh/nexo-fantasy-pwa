-- Solo una jornada editable por competición. Al congelarla se abre la siguiente.

alter table public.competition_matchdays drop constraint if exists competition_matchdays_state_check;
alter table public.competition_matchdays
  add constraint competition_matchdays_state_check
  check (state in ('scheduled','open','locked','awaiting_stats','closed'));

-- En instalaciones que ya ejecutaron 010, conserva abierta únicamente la primera
-- jornada pendiente de cada competición y programa el resto.
with ordered as (
  select id, row_number() over (partition by competition_id, season order by matchday) as sequence
  from public.competition_matchdays
  where state = 'open'
)
update public.competition_matchdays target
set state = case when ordered.sequence = 1 then 'open' else 'scheduled' end,
    updated_at = now()
from ordered where target.id = ordered.id;

create or replace function public.open_next_matchday_after_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state = 'open' and new.state = 'locked' then
    update public.competition_matchdays
       set state = 'open', updated_at = now()
     where id = (
       select id from public.competition_matchdays
        where competition_id = new.competition_id and season = new.season
          and matchday > new.matchday and state = 'scheduled'
        order by matchday limit 1
     );
  end if;
  return new;
end;
$$;

drop trigger if exists competition_matchdays_open_next on public.competition_matchdays;
create trigger competition_matchdays_open_next
after update of state on public.competition_matchdays
for each row execute function public.open_next_matchday_after_lock();

revoke all on function public.open_next_matchday_after_lock() from public, anon, authenticated;
