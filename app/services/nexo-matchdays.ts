import { getSupabaseClient } from "../lib/supabase-client";

export type NexoLineupDraft = {
  membershipId: string;
  season: string;
  matchday: number;
  formation: string;
  captainId: string;
  starterPlayerIds: string[];
  benchPlayerIds: string[];
  totalValue: number;
  revision: number;
  savedAt: string;
};

export type NexoMatchdayState = {
  id: string;
  competitionId: string;
  season: string;
  matchday: number;
  state: "scheduled" | "open" | "locked" | "awaiting_stats" | "closed";
  lockAt?: string;
  lockedAt?: string;
  closedAt?: string;
  fixtureCount: number;
  finalFixtureCount: number;
  statsReadyCount: number;
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function saveNexoMatchdayLineup(input: {
  membershipId: string;
  season?: string;
  matchday: number;
  formation: string;
  captainId: string;
  starterPlayerIds: string[];
  benchPlayerIds?: string[];
}): Promise<NexoLineupDraft> {
  const client = requireClient();
  const { data, error } = await client.rpc("save_my_matchday_lineup", {
    target_membership_id: input.membershipId,
    target_season: input.season ?? "2026",
    target_matchday: input.matchday,
    target_formation: input.formation,
    target_captain_player_id: input.captainId,
    target_starter_player_ids: input.starterPlayerIds,
    target_bench_player_ids: input.benchPlayerIds ?? [],
  });
  if (error) throw new Error(error.message);
  return mapDraft(data as Record<string, unknown>);
}

export async function loadNexoMatchdayLineups(): Promise<NexoLineupDraft[]> {
  const client = requireClient();
  const { data, error } = await client.rpc("my_matchday_lineup_drafts");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapDraft);
}

export async function loadNexoMatchdayStates(): Promise<NexoMatchdayState[]> {
  const client = requireClient();
  const { data, error } = await client
    .from("competition_matchdays")
    .select("id,competition_id,season,matchday,state,lock_at,locked_at,closed_at,fixture_count,final_fixture_count,stats_ready_count")
    .eq("season", "2026")
    .order("competition_id")
    .order("matchday");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    competitionId: row.competition_id,
    season: row.season,
    matchday: row.matchday,
    state: row.state,
    lockAt: row.lock_at ?? undefined,
    lockedAt: row.locked_at ?? undefined,
    closedAt: row.closed_at ?? undefined,
    fixtureCount: row.fixture_count,
    finalFixtureCount: row.final_fixture_count,
    statsReadyCount: row.stats_ready_count,
  }));
}

function mapDraft(row: Record<string, unknown>): NexoLineupDraft {
  return {
    membershipId: String(row.membership_id),
    season: String(row.season),
    matchday: Number(row.matchday),
    formation: String(row.formation),
    captainId: String(row.captain_player_id),
    starterPlayerIds: (row.starter_player_ids as string[]) ?? [],
    benchPlayerIds: (row.bench_player_ids as string[]) ?? [],
    totalValue: Number(row.total_value),
    revision: Number(row.revision),
    savedAt: String(row.saved_at),
  };
}
