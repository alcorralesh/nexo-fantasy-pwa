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
  economicEligible: boolean;
  teamName: string;
  managerName: string;
  source: "saved_draft" | "roster_fallback" | "empty";
  valid: boolean;
  formation: string;
  captainPlayerId?: string;
  starterCount: number;
  points: number;
  payout: number;
  calculatedPayout: number;
  currentBudget: number;
  simulatedBudget: number;
  rank: number;
  playerBreakdown: NexoSimulationPlayerRow[];
  notifications: NexoSimulationNotification[];
  movements: NexoSimulationMovement[];
};

export type NexoSimulationPlayerRow = {
  playerId: string;
  name: string;
  initials: string;
  position: "POR" | "DEF" | "MED" | "DEL";
  club: string;
  photoUrl?: string;
  slotOrder: number;
  rawPoints: number;
  multiplier: number;
  points: number;
  isCaptain: boolean;
};

export type NexoSimulationNotification = {
  type: "matchday" | "market" | "achievement" | "system";
  title: string;
  body: string;
  targetSection: string;
};

export type NexoSimulationMovement = {
  type: "matchday_result" | "matchday_payout";
  title: string;
  detail: string;
  amount: number;
};

export type NexoCareerSimulationObjective = {
  id: string;
  type: string;
  title: string;
  targetValue: number;
  currentValue: number;
  previousStatus: "active" | "completed" | "failed";
  status: "active" | "completed" | "failed";
  changed: boolean;
  reward: number;
  penalty: number;
};

export type NexoCareerSimulationRow = {
  careerId: string;
  managerName: string;
  sportsClubName: string;
  difficulty: "relaxed" | "balanced" | "elite";
  formation?: string;
  lineupPoints: number;
  decisionPoints: number;
  totalPoints: number;
  mission?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  confidenceBefore: number;
  confidenceAfter: number;
  confidenceChange: number;
  reputationBefore: number;
  reputationAfter: number;
  reputationChange: number;
  budgetBefore: number;
  budgetAfter: number;
  consecutiveFailuresBefore: number;
  consecutiveFailuresAfter: number;
  statusBefore: string;
  statusAfter: string;
  wouldBeDismissed: boolean;
  objectives: NexoCareerSimulationObjective[];
  rankingPosition?: number;
  previousRankingPosition?: number;
};

export type NexoCareerSimulation = {
  careerCount: number;
  dismissals: number;
  atRisk: number;
  careers: NexoCareerSimulationRow[];
};

export type NexoChallengeSimulationPlayer = {
  id: string;
  name: string;
  initials: string;
  position: "POR" | "DEF" | "MED" | "DEL";
  club: string;
  photoUrl?: string;
  price: number;
};

export type NexoChallengeSimulationRow = {
  leagueId: string;
  name: string;
  description: string;
  format: "partidazo" | "matches";
  lineupPolicy: "fixed" | "per_matchday";
  maxPlayersPerClub: number;
  budgetPercentile: number;
  budget: number;
  snapshotId: string;
  snapshotAt: string;
  alreadyPublished: boolean;
  playerCount: number;
  minimumPrice: number;
  maximumPrice: number;
  averagePrice: number;
  positionCounts: Record<string, number>;
  clubs: string[];
  fixtures: Array<{ id: string; matchday: number; homeClub: string; awayClub: string; kickoffAt?: string }>;
  players: NexoChallengeSimulationPlayer[];
};

export type NexoChallengeSimulation = {
  challengeCount: number;
  totalPlayers: number;
  challenges: NexoChallengeSimulationRow[];
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
  usesOfficialEngine: boolean;
  pointsSource: "player_matchday_points" | "sample_sandbox";
  usesSamplePoints: boolean;
  settlementReady: boolean;
  blockedReason?: string;
  fixtureCount: number;
  statsReadyCount: number;
  simulatedFinalFixtures: number;
  memberships: number;
  validLineups: number;
  zeroLineups: number;
  totalPoints: number;
  totalPayout: number;
  calculatedPayout: number;
  marketMemberships: number;
  fantasyMemberships: number;
  challengesToActivate: number;
  results: NexoSimulationResultRow[];
  careerSimulation: NexoCareerSimulation;
  challengeSimulation: NexoChallengeSimulation;
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

export async function simulateNexoMatchdayClose(input: { competitionId: string; season?: string; matchday: number; scenario: NexoSimulationScenario; useSamplePoints?: boolean }): Promise<NexoMatchdaySimulation> {
  const client = requireClient();
  const { data, error } = await client.rpc(input.useSamplePoints ? "admin_simulate_matchday_close_with_points" : "admin_simulate_matchday_close", {
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
    usesOfficialEngine: Boolean(result.usesOfficialEngine),
    pointsSource: result.pointsSource === "sample_sandbox" ? "sample_sandbox" : "player_matchday_points",
    usesSamplePoints: Boolean(result.usesSamplePoints),
    settlementReady: Boolean(result.settlementReady),
    blockedReason: result.blockedReason ? String(result.blockedReason) : undefined,
    fixtureCount: Number(result.fixtureCount),
    statsReadyCount: Number(result.statsReadyCount),
    simulatedFinalFixtures: Number(result.simulatedFinalFixtures),
    memberships: Number(result.memberships),
    validLineups: Number(result.validLineups),
    zeroLineups: Number(result.zeroLineups),
    totalPoints: Number(result.totalPoints),
    totalPayout: Number(result.totalPayout),
    calculatedPayout: Number(result.calculatedPayout),
    marketMemberships: Number(result.marketMemberships),
    fantasyMemberships: Number(result.fantasyMemberships),
    challengesToActivate: Number(result.challengesToActivate),
    careerSimulation: mapCareerSimulation(result.careerSimulation),
    challengeSimulation: mapChallengeSimulation(result.challengeSimulation),
    results: ((result.results ?? []) as Record<string, unknown>[]).map((row) => ({
      membershipId: String(row.membershipId),
      leagueId: String(row.leagueId),
      leagueName: String(row.leagueName),
      mode: row.mode as "market" | "fantasy",
      economicEligible: row.mode === "market" && Boolean(row.economicEligible),
      teamName: String(row.teamName),
      managerName: String(row.managerName),
      source: row.source as NexoSimulationResultRow["source"],
      valid: Boolean(row.valid),
      formation: String(row.formation),
      captainPlayerId: row.captainPlayerId ? String(row.captainPlayerId) : undefined,
      starterCount: Number(row.starterCount),
      points: Number(row.points),
      payout: row.mode === "market" ? Number(row.payout) : 0,
      calculatedPayout: row.mode === "market" ? Number(row.calculatedPayout) : 0,
      currentBudget: Number(row.currentBudget),
      simulatedBudget: row.mode === "market" ? Number(row.simulatedBudget) : Number(row.currentBudget),
      rank: Number(row.rank),
      playerBreakdown: ((row.playerBreakdown ?? []) as Record<string, unknown>[]).map((player) => ({
        playerId: String(player.playerId),
        name: String(player.name ?? "Jugador"),
        initials: String(player.initials ?? ""),
        position: player.position as NexoSimulationPlayerRow["position"],
        club: String(player.club ?? ""),
        photoUrl: player.photoUrl ? String(player.photoUrl) : undefined,
        slotOrder: Number(player.slotOrder ?? 0),
        rawPoints: Number(player.rawPoints),
        multiplier: Number(player.multiplier),
        points: Number(player.points),
        isCaptain: Boolean(player.isCaptain),
      })),
      notifications: ((row.notifications ?? []) as Record<string, unknown>[]).map((notice) => ({
        type: notice.type as NexoSimulationNotification["type"],
        title: String(notice.title),
        body: String(notice.body),
        targetSection: String(notice.targetSection),
      })),
      movements: ((row.movements ?? []) as Record<string, unknown>[]).map((movement) => ({
        type: movement.type as NexoSimulationMovement["type"],
        title: String(movement.title),
        detail: String(movement.detail),
        amount: Number(movement.amount ?? 0),
      })),
    })),
  };
}

function mapCareerSimulation(value: unknown): NexoCareerSimulation {
  const simulation = (value ?? {}) as Record<string, unknown>;
  return {
    careerCount: Number(simulation.careerCount ?? 0),
    dismissals: Number(simulation.dismissals ?? 0),
    atRisk: Number(simulation.atRisk ?? 0),
    careers: ((simulation.careers ?? []) as Record<string, unknown>[]).map((career) => ({
      careerId: String(career.careerId),
      managerName: String(career.managerName),
      sportsClubName: String(career.sportsClubName),
      difficulty: career.difficulty as NexoCareerSimulationRow["difficulty"],
      formation: career.formation ? String(career.formation) : undefined,
      lineupPoints: Number(career.lineupPoints),
      decisionPoints: Number(career.decisionPoints),
      totalPoints: Number(career.totalPoints),
      mission: career.mission ? career.mission as Record<string, unknown> : undefined,
      decision: career.decision ? career.decision as Record<string, unknown> : undefined,
      confidenceBefore: Number(career.confidenceBefore),
      confidenceAfter: Number(career.confidenceAfter),
      confidenceChange: Number(career.confidenceChange),
      reputationBefore: Number(career.reputationBefore),
      reputationAfter: Number(career.reputationAfter),
      reputationChange: Number(career.reputationChange),
      budgetBefore: Number(career.budgetBefore),
      budgetAfter: Number(career.budgetAfter),
      consecutiveFailuresBefore: Number(career.consecutiveFailuresBefore),
      consecutiveFailuresAfter: Number(career.consecutiveFailuresAfter),
      statusBefore: String(career.statusBefore),
      statusAfter: String(career.statusAfter),
      wouldBeDismissed: Boolean(career.wouldBeDismissed),
      objectives: ((career.objectives ?? []) as Record<string, unknown>[]).map((objective) => ({
        id: String(objective.id),
        type: String(objective.type),
        title: String(objective.title),
        targetValue: Number(objective.targetValue),
        currentValue: Number(objective.currentValue),
        previousStatus: objective.previousStatus as NexoCareerSimulationObjective["previousStatus"],
        status: objective.status as NexoCareerSimulationObjective["status"],
        changed: Boolean(objective.changed),
        reward: Number(objective.reward),
        penalty: Number(objective.penalty),
      })),
      rankingPosition: career.rankingPosition == null ? undefined : Number(career.rankingPosition),
      previousRankingPosition: career.previousRankingPosition == null ? undefined : Number(career.previousRankingPosition),
    })),
  };
}

function mapChallengeSimulation(value: unknown): NexoChallengeSimulation {
  const simulation = (value ?? {}) as Record<string, unknown>;
  return {
    challengeCount: Number(simulation.challengeCount ?? 0),
    totalPlayers: Number(simulation.totalPlayers ?? 0),
    challenges: ((simulation.challenges ?? []) as Record<string, unknown>[]).map((challenge) => ({
      leagueId: String(challenge.leagueId),
      name: String(challenge.name),
      description: String(challenge.description ?? ""),
      format: challenge.format as NexoChallengeSimulationRow["format"],
      lineupPolicy: challenge.lineupPolicy as NexoChallengeSimulationRow["lineupPolicy"],
      maxPlayersPerClub: Number(challenge.maxPlayersPerClub),
      budgetPercentile: Number(challenge.budgetPercentile),
      budget: Number(challenge.budget),
      snapshotId: String(challenge.snapshotId),
      snapshotAt: String(challenge.snapshotAt),
      alreadyPublished: Boolean(challenge.alreadyPublished),
      playerCount: Number(challenge.playerCount),
      minimumPrice: Number(challenge.minimumPrice),
      maximumPrice: Number(challenge.maximumPrice),
      averagePrice: Number(challenge.averagePrice),
      positionCounts: Object.fromEntries(Object.entries((challenge.positionCounts ?? {}) as Record<string, unknown>).map(([key, amount]) => [key, Number(amount)])),
      clubs: ((challenge.clubs ?? []) as unknown[]).map(String),
      fixtures: ((challenge.fixtures ?? []) as Record<string, unknown>[]).map((fixture) => ({
        id: String(fixture.id), matchday: Number(fixture.matchday), homeClub: String(fixture.homeClub), awayClub: String(fixture.awayClub), kickoffAt: fixture.kickoffAt ? String(fixture.kickoffAt) : undefined,
      })),
      players: ((challenge.players ?? []) as Record<string, unknown>[]).map((player) => ({
        id: String(player.id), name: String(player.name), initials: String(player.initials), position: player.position as NexoChallengeSimulationPlayer["position"], club: String(player.club), photoUrl: player.photoUrl ? String(player.photoUrl) : undefined, price: Number(player.price),
      })),
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
