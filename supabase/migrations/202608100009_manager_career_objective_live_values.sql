-- Mantiene los progresos del contrato alineados con el estado real de la Carrera.

create or replace function public.initialize_manager_career_objective_value() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.objective_type='identity' then
    select count(*) into new.current_value
    from public.manager_career_players
    where career_id=new.career_id and is_original;
  elsif new.objective_type='confidence' then
    select board_confidence into new.current_value
    from public.manager_careers where id=new.career_id;
  elsif new.objective_type='season' then
    select sporting_points into new.current_value
    from public.manager_careers where id=new.career_id;
  end if;
  return new;
end $$;

drop trigger if exists initialize_manager_career_objective_value_trigger on public.manager_career_objectives;
create trigger initialize_manager_career_objective_value_trigger
before insert on public.manager_career_objectives
for each row execute function public.initialize_manager_career_objective_value();

update public.manager_career_objectives objective
set current_value=case objective.objective_type
  when 'identity' then (
    select count(*) from public.manager_career_players player
    where player.career_id=objective.career_id and player.is_original
  )
  when 'confidence' then (
    select career.board_confidence from public.manager_careers career
    where career.id=objective.career_id
  )
  when 'season' then (
    select career.sporting_points from public.manager_careers career
    where career.id=objective.career_id
  )
  else objective.current_value
end,
updated_at=now()
where objective.status='active'
  and objective.objective_type in ('identity','confidence','season');

revoke all on function public.initialize_manager_career_objective_value() from public,anon,authenticated;
