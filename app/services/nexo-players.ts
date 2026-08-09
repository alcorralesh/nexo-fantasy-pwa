import type { CompetitionName } from "../data";
import type { CompetitionPlayer } from "../data/competition-players";
import { getSupabaseClient } from "../lib/supabase-client";

const competitionNames: Record<string, CompetitionName> = { primera: "Primera", segunda: "Segunda", liga_f: "Liga F" };

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function loadNexoPlayerCatalog(): Promise<Record<CompetitionName, CompetitionPlayer[]>> {
  const client = requireClient();
  const { data, error } = await client.from("players").select("id,competition_id,name,initials,position,market_value,catalog_version,sports_clubs(name)").order("name");
  if (error) throw error;
  const catalog: Record<CompetitionName, CompetitionPlayer[]> = { Primera: [], Segunda: [], "Liga F": [] };
  for (const row of data ?? []) {
    const competition = competitionNames[row.competition_id] ?? "Primera";
    const clubRelation = row.sports_clubs as unknown as { name: string } | null;
    catalog[competition].push({
      id: row.id,
      name: row.name,
      initials: row.initials,
      position: row.position,
      value: Number(row.market_value),
      club: clubRelation?.name ?? "Sin club",
      competition,
      catalogVersion: "2026-08-08",
    });
  }
  return catalog;
}

export async function updateNexoPlayer(player: CompetitionPlayer, active = true): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("update_player_catalog_entry", {
    target_player_id: player.id,
    new_name: player.name,
    new_position: player.position,
    new_market_value: player.value,
    new_active: active,
  });
  if (error) throw new Error(error.message);
}

