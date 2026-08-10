-- Controles de Administración para activar y ajustar el catálogo sin desplegar código.

create or replace function public.manager_career_content_catalog() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administración puede consultar el catálogo'; end if;
  return jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object('key',key,'title',title,'category',category,'active',active,'weight',weight,'cooldown',cooldown_matchdays,'storyKey',story_key,'storyStep',story_step) order by category,title) from public.manager_career_event_templates),'[]'::jsonb),
    'missions',coalesce((select jsonb_agg(jsonb_build_object('key',key,'title',title,'metricKey',metric_key,'active',active,'weight',weight,'cooldown',cooldown_matchdays,'target',base_target,'reward',reputation_reward,'penalty',confidence_penalty) order by metric_key,title) from public.manager_career_mission_templates),'[]'::jsonb)
  );
end $$;

create or replace function public.update_manager_career_content_item(target_kind text,target_key text,next_active boolean,next_weight integer,next_cooldown integer,next_target numeric default null,next_reward integer default null,next_penalty integer default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Solo Administración puede modificar el catálogo'; end if;
  if next_weight<1 or next_cooldown<0 then raise exception 'Configuración no válida'; end if;
  if target_kind='event' then
    update public.manager_career_event_templates set active=next_active,weight=next_weight,cooldown_matchdays=next_cooldown,updated_at=now() where key=target_key;
  elsif target_kind='mission' then
    update public.manager_career_mission_templates set active=next_active,weight=next_weight,cooldown_matchdays=next_cooldown,base_target=coalesce(next_target,base_target),reputation_reward=coalesce(next_reward,reputation_reward),confidence_penalty=coalesce(next_penalty,confidence_penalty),updated_at=now() where key=target_key;
  else raise exception 'Tipo de contenido no válido'; end if;
  if not found then raise exception 'Contenido no encontrado'; end if;
end $$;

revoke all on function public.manager_career_content_catalog(),public.update_manager_career_content_item(text,text,boolean,integer,integer,numeric,integer,integer) from public,anon;
grant execute on function public.manager_career_content_catalog(),public.update_manager_career_content_item(text,text,boolean,integer,integer,numeric,integer,integer) to authenticated;
notify pgrst,'reload schema';
