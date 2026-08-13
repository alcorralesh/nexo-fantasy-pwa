-- Compatibilidad entre los efectos numericos del catalogo real y el cierre
-- historico del laboratorio, que espera puntos deportivos enteros.

alter function public.admin_step_manager_career_lab(uuid,text,jsonb)
  rename to admin_step_manager_career_lab_v1_base;

create or replace function public.admin_step_manager_career_lab(
  target_session_id uuid,
  target_action text,
  target_options jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  selected public.manager_career_lab_sessions%rowtype;
  normalized_points integer;
begin
  perform public.manager_career_lab_assert_admin();

  if target_action='close' then
    select * into selected
    from public.manager_career_lab_sessions
    where id=target_session_id and created_by=auth.uid()
    for update;
    if not found then raise exception 'Laboratorio no disponible'; end if;

    normalized_points:=round(coalesce((selected.state->>'sportingPoints')::numeric,0))::integer;
    update public.manager_career_lab_sessions
    set state=jsonb_set(state,'{sportingPoints}',to_jsonb(normalized_points)),updated_at=now()
    where id=selected.id;
  end if;

  return public.admin_step_manager_career_lab_v1_base(target_session_id,target_action,target_options);
end $$;

revoke all on function public.admin_step_manager_career_lab(uuid,text,jsonb) from public,anon;
grant execute on function public.admin_step_manager_career_lab(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
