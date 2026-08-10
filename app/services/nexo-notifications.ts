import { getSupabaseClient } from "../lib/supabase-client";

export type NexoNotification = {
  id: string;
  type: "achievement" | "market" | "matchday" | "system";
  title: string;
  body: string;
  leagueId?: string;
  targetSection?: "inicio" | "resumen" | "equipo" | "mercado" | "jornada" | "clasificacion" | "perfil";
  createdAt: string;
  readAt?: string;
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase no esta configurado");
  return client;
}

export async function loadNexoNotifications(limit = 100): Promise<NexoNotification[]> {
  const { data, error } = await requireClient().rpc("my_notifications", { requested_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    type: row.notification_type as NexoNotification["type"],
    title: String(row.title),
    body: String(row.body),
    leagueId: row.league_id ? String(row.league_id) : undefined,
    targetSection: row.target_section ? row.target_section as NexoNotification["targetSection"] : undefined,
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : undefined,
  }));
}

export async function markNexoNotificationRead(notificationId: string): Promise<void> {
  const { error } = await requireClient().rpc("mark_my_notification_read", { target_notification_id: notificationId });
  if (error) throw new Error(error.message);
}

export async function markAllNexoNotificationsRead(): Promise<void> {
  const { error } = await requireClient().rpc("mark_all_my_notifications_read");
  if (error) throw new Error(error.message);
}
