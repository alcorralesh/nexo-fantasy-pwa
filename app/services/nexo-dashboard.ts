import type { PlayerTrend } from "../data/market-trends";
import type { CompetitionName } from "../data";
import { getSupabaseClient } from "../lib/supabase-client";

const competitionNames: Record<string, CompetitionName> = { primera: "Primera", segunda: "Segunda", liga_f: "Liga F" };

export type NexoClubActivity = {
  id: string;
  activityType: string;
  title: string;
  detail: string;
  leagueId: string;
  leagueName: string;
  occurredAt: string;
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function loadNexoClubActivity(teamId: string): Promise<NexoClubActivity[]> {
  const { data, error } = await requireClient().rpc("my_club_activity", { target_team_id: teamId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    activityType: String(row.activity_type),
    title: String(row.title),
    detail: String(row.detail),
    leagueId: String(row.league_id),
    leagueName: String(row.league_name),
    occurredAt: String(row.occurred_at),
  }));
}

export async function loadNexoCompetitionTrends(competitionId: string): Promise<PlayerTrend[]> {
  const { data, error } = await requireClient().rpc("competition_player_trends", { target_competition_id: competitionId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    initials: String(row.initials),
    position: row.position as PlayerTrend["position"],
    club: String(row.club),
    value: Number(row.value),
    competition: competitionNames[competitionId] ?? "Primera",
    catalogVersion: "backend",
    changePercent: Number(row.change_percent),
    signings: Number(row.signings),
    performance: Number(row.performance),
    demandIndex: Number(row.demand_index),
    lineupSelections: Number(row.lineup_selections),
    captainSelections: Number(row.captain_selections),
    offersReceived: Number(row.offers_received),
    bidsReceived: Number(row.bids_received),
    protections: Number(row.protections),
    marketListings: Number(row.market_listings),
    transfers: Number(row.transfers),
    history: ((row.history ?? []) as unknown[]).map(Number).filter(Number.isFinite),
  }));
}
