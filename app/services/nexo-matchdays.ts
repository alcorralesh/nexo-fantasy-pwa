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

export type NexoMatchdayHistoryPlayer = {
  playerId: string;
  name: string;
  initials: string;
  position: "POR" | "DEF" | "MED" | "DEL";
  club: string;
  photoUrl?: string;
  role: "starter" | "bench";
  slotOrder: number;
  isCaptain: boolean;
  rawPoints: number;
  multiplier: number;
  points: number;
};

export type NexoMatchdayHistory = {
  membershipId: string;
  leagueId: string;
  competitionId: string;
  season: string;
  matchday: number;
  state: NexoMatchdayState["state"];
  formation: string;
  captainPlayerId?: string;
  source: "saved_draft" | "roster_fallback" | "empty";
  valid: boolean;
  starterCount: number;
  points: number;
  payout: number;
  calculatedAt?: string;
  rank?: number;
  leagueAverage: number;
  bestScore: number;
  players: NexoMatchdayHistoryPlayer[];
};

export type NexoSimulationScenario = "normal" | "postponed" | "advanced";

export type NexoSimulationResultRow = {
  membershipId: string;
  leagueId: string;
  leagueName: string;
  mode: "market" | "fantasy";
  teamName: string;
  managerName: string;
  source: "saved_draft" | "roster_fallback" | "empty";
  points: number;
  payout: number;
  currentBudget: number;
  simulatedBudget: number;
  rank: number;
};

export type NexoMatchdaySimulation = {
  runId: string;
  createdAt: string;
  competitionId: string;
  season: string;
  matchday: number;
  scenario: NexoSimulationScenario;
  officialState: NexoMatchdayState["state"];
  productionUntouched: boolean;
  fixtureCount: number;
  simulatedFinalFixtures: number;
  memberships: number;
  validLineups: number;
  zeroLineups: number;
  totalPoints: number;
  totalPayout: number;
  challengesToActivate: number;
  results: NexoSimulationResultRow[];
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

export async function loadNexoMatchdayHistory(): Promise<NexoMatchdayHistory[]> {
  const { data, error } = await requireClient().rpc("my_matchday_history");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    membershipId: String(row.membership_id),
    leagueId: String(row.league_id),
    competitionId: String(row.competition_id),
    season: String(row.season),
    matchday: Number(row.matchday),
    state: row.state as NexoMatchdayState["state"],
    formation: String(row.formation),
    captainPlayerId: row.captain_player_id ? String(row.captain_player_id) : undefined,
    source: row.source as NexoMatchdayHistory["source"],
    valid: Boolean(row.valid),
    starterCount: Number(row.starter_count),
    points: Number(row.points),
    payout: Number(row.payout),
    calculatedAt: row.calculated_at ? String(row.calculated_at) : undefined,
    rank: row.rank == null ? undefined : Number(row.rank),
    leagueAverage: Number(row.league_average),
    bestScore: Number(row.best_score),
    players: ((row.players ?? []) as Record<string, unknown>[]).map((player) => ({
      playerId: String(player.playerId),
      name: String(player.name),
      initials: String(player.initials),
      position: player.position as NexoMatchdayHistoryPlayer["position"],
      club: String(player.club),
      photoUrl: player.photoUrl ? String(player.photoUrl) : undefined,
      role: player.role as NexoMatchdayHistoryPlayer["role"],
      slotOrder: Number(player.slotOrder),
      isCaptain: Boolean(player.isCaptain),
      rawPoints: Number(player.rawPoints),
      multiplier: Number(player.multiplier),
      points: Number(player.points),
    })),
  }));
}

export async function simulateNexoMatchdayClose(input: { competitionId: string; season?: string; matchday: number; scenario: NexoSimulationScenario }): Promise<NexoMatchdaySimulation> {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_simulate_matchday_close", {
    target_competition_id: input.competitionId,
    target_season: input.season ?? "2026",
    target_matchday: input.matchday,
    target_scenario: input.scenario,
  });
  if (error) throw new Error(error.message);
  const result = data as Record<string, unknown>;
  return {
    runId: String(result.runId),
    createdAt: String(result.createdAt),
    competitionId: String(result.competitionId),
    season: String(result.season),
    matchday: Number(result.matchday),
    scenario: result.scenario as NexoSimulationScenario,
    officialState: result.officialState as NexoMatchdayState["state"],
    productionUntouched: Boolean(result.productionUntouched),
    fixtureCount: Number(result.fixtureCount),
    simulatedFinalFixtures: Number(result.simulatedFinalFixtures),
    memberships: Number(result.memberships),
    validLineups: Number(result.validLineups),
    zeroLineups: Number(result.zeroLineups),
    totalPoints: Number(result.totalPoints),
    totalPayout: Number(result.totalPayout),
    challengesToActivate: Number(result.challengesToActivate),
    results: ((result.results ?? []) as Record<string, unknown>[]).map((row) => ({
      membershipId: String(row.membershipId),
      leagueId: String(row.leagueId),
      leagueName: String(row.leagueName),
      mode: row.mode as "market" | "fantasy",
      teamName: String(row.teamName),
      managerName: String(row.managerName),
      source: row.source as NexoSimulationResultRow["source"],
      points: Number(row.points),
      payout: Number(row.payout),
      currentBudget: Number(row.currentBudget),
      simulatedBudget: Number(row.simulatedBudget),
      rank: Number(row.rank),
    })),
  };
}

export async function deleteNexoMatchdaySimulation(runId: string): Promise<void> {
  const { error } = await requireClient().rpc("admin_delete_matchday_simulation", { target_run_id: runId });
  if (error) throw new Error(error.message);
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
