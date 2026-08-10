-- La identidad del modo Carrera exige siete jugadores originales en el once por defecto.
alter table public.manager_career_rules alter column minimum_original_lineup set default 7;
update public.manager_career_rules set minimum_original_lineup=7,updated_at=now() where id;
notify pgrst,'reload schema';
