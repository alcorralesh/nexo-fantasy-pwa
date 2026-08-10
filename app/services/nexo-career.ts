import type { CompetitionName } from "../data";
import { getSupabaseClient } from "../lib/supabase-client";

export type NexoCareerDifficulty = "relaxed" | "balanced" | "elite";

export type NexoCareer = {
  id: string;
  clubId: string;
  competition: CompetitionName;
  competitionId: string;
  sportsClubId: string;
  sportsClubName: string;
  difficulty: NexoCareerDifficulty;
  status: "active" | "completed" | "abandoned" | "dismissed";
  seasonLabel: string;
  matchday: number;
  budget: number;
  reputation: number;
  sportingPoints: number;
  objectivePoints: number;
  originalPlayers: number;
  squadSize: number;
  createdAt: string;
};

export type NexoCareerClub = {
  id: string;
  name: string;
  competitionId: string;
  playerCount: number;
  squadValue: number;
};

export type NexoCareerRules = {
  enabled: boolean;
  freeCareersPerCompetition: number;
  extraCareerCoinCost: number;
  initialBudget: number;
  minimumOriginalSquad: number;
  minimumOriginalLineup: number;
  weeklyDecisionEnabled: boolean;
  sameClubRankingEnabled: boolean;
  academyDecisionCost: number;
  failureConfidencePenalty: number;
  dismissalConfidenceThreshold: number;
  relaxedTargetMultiplier: number;
  balancedTargetMultiplier: number;
  eliteTargetMultiplier: number;
};

export type NexoCareerPlayer = {
  id: string;
  name: string;
  initials: string;
  position: "POR" | "DEF" | "MED" | "DEL";
  club: string;
  value: number;
  photoUrl?: string;
  isOriginal: boolean;
  acquisitionValue: number;
};

export type NexoCareerLineup = { matchday: number; formation: string; captainId: string; playerIds: string[]; savedAt: string; lockedAt?: string; points?: number };
export type NexoCareerDecision = { matchday: number; decisionKey: string; choiceKey: string; choiceTitle: string; consequence: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; conditionalOriginalTarget?: number; conditionalSportingBonus: number; decidedAt: string };
export type NexoCareerObjective = { id: string; type: "identity" | "matchday" | "season" | "confidence"; title: string; description: string; targetValue: number; currentValue: number; reputationReward: number; failurePenalty: number; status: "active" | "completed" | "failed"; expiresMatchday?: number; metricKey?: "points" | "originals" | "captain_points" | "new_signings" | "budget_floor" };
export type NexoCareerDecisionChoice = { key: string; title: string; summary: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; condition?: string; conditionalBonus: number };
export type NexoCareerDecisionPrompt = { key: string; title: string; description: string; choices: NexoCareerDecisionChoice[] };
export type NexoCareerEvent = { type: string; title: string; detail: string; matchday?: number; reputationChange: number; createdAt: string };
export type NexoCareerReportPlayer = { playerId: string; name: string; initials: string; position: NexoCareerPlayer["position"]; photoUrl?: string; isCaptain: boolean; basePoints: number; multiplier: number; finalPoints: number };
export type NexoCareerReportMission = { id: string; title: string; description: string; metricKey?: string; targetValue: number; currentValue: number; status: "completed" | "failed"; reward: number; penalty: number };
export type NexoCareerReportDecision = { choiceTitle: string; consequence: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; conditionalOriginalTarget?: number; conditionalSportingBonus: number; conditionMet: boolean };
export type NexoCareerMatchdayReport = { matchday: number; formation?: string; captainId?: string; players: NexoCareerReportPlayer[]; lineupPoints: number; decisionPoints: number; totalPoints: number; mission?: NexoCareerReportMission; decision?: NexoCareerReportDecision; confidenceBefore: number; confidenceAfter: number; reputationBefore: number; reputationAfter: number; budgetBefore: number; budgetAfter: number; consecutiveFailuresAfter: number; statusAfter: NexoCareer["status"]; rankingPosition?: number; previousRankingPosition?: number; createdAt: string; viewedAt?: string };
export type NexoCareerWorkspace = { budget: number; matchday: number; boardConfidence: number; consecutiveFailures: number; contractTier: "title" | "europe" | "stability"; status: NexoCareer["status"]; squad: NexoCareerPlayer[]; market: NexoCareerPlayer[]; lineups: NexoCareerLineup[]; decisions: NexoCareerDecision[]; objectives: NexoCareerObjective[]; events: NexoCareerEvent[]; reports: NexoCareerMatchdayReport[]; decisionPrompt?: NexoCareerDecisionPrompt };
export type NexoCareerContentItem = { key: string; title: string; kind: "event" | "mission"; category?: string; metricKey?: string; active: boolean; weight: number; cooldown: number; storyKey?: string; storyStep?: number; target?: number; reward?: number; penalty?: number };
export type NexoCareerRankingRow = { careerId: string; position: number; managerName: string; initials: string; status: NexoCareer["status"]; totalPoints: number; averagePoints: number; bestMatchday: number; reputation: number; confidence: number; completedObjectives: number; budget: number; isCurrent: boolean };
export type NexoCareerRanking = { enabled: boolean; completedMatchdays: number; totalManagers: number; rows: NexoCareerRankingRow[] };

const competitionNames: Record<string, CompetitionName> = { primera: "Primera", segunda: "Segunda", liga_f: "Liga F" };

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function loadNexoCareerClubs(competitionId: string): Promise<NexoCareerClub[]> {
  const { data, error } = await requireClient().rpc("career_available_clubs", { target_competition_id: competitionId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    competitionId: String(row.competition_id),
    playerCount: Number(row.player_count),
    squadValue: Number(row.squad_value),
  }));
}

export async function loadNexoCareers(): Promise<NexoCareer[]> {
  const { data, error } = await requireClient().rpc("my_manager_careers");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    clubId: String(row.club_id),
    competition: competitionNames[String(row.competition_id)] ?? "Primera",
    competitionId: String(row.competition_id),
    sportsClubId: String(row.sports_club_id),
    sportsClubName: String(row.sports_club_name),
    difficulty: row.difficulty as NexoCareerDifficulty,
    status: row.status as NexoCareer["status"],
    seasonLabel: String(row.season_label),
    matchday: Number(row.current_matchday),
    budget: Number(row.budget),
    reputation: Number(row.reputation),
    sportingPoints: Number(row.sporting_points),
    objectivePoints: Number(row.objective_points),
    originalPlayers: Number(row.original_players),
    squadSize: Number(row.squad_size),
    createdAt: String(row.created_at),
  }));
}

export async function createNexoCareer(input: { clubId: string; sportsClubId: string; difficulty: NexoCareerDifficulty }): Promise<string> {
  const { data, error } = await requireClient().rpc("create_manager_career", {
    target_club_id: input.clubId,
    target_sports_club_id: input.sportsClubId,
    target_difficulty: input.difficulty,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function loadNexoCareerRules(): Promise<NexoCareerRules> {
  const { data, error } = await requireClient().from("manager_career_rules").select("enabled,free_careers_per_competition,extra_career_coin_cost,initial_budget,minimum_original_squad,minimum_original_lineup,weekly_decision_enabled,same_club_ranking_enabled,academy_decision_cost,failure_confidence_penalty,dismissal_confidence_threshold,relaxed_target_multiplier,balanced_target_multiplier,elite_target_multiplier").single();
  if (error) throw new Error(error.message);
  return {
    enabled: data.enabled,
    freeCareersPerCompetition: Number(data.free_careers_per_competition),
    extraCareerCoinCost: Number(data.extra_career_coin_cost),
    initialBudget: Number(data.initial_budget),
    minimumOriginalSquad: Number(data.minimum_original_squad),
    minimumOriginalLineup: Number(data.minimum_original_lineup),
    weeklyDecisionEnabled: data.weekly_decision_enabled,
    sameClubRankingEnabled: data.same_club_ranking_enabled,
    academyDecisionCost: Number(data.academy_decision_cost),
    failureConfidencePenalty: Number(data.failure_confidence_penalty),
    dismissalConfidenceThreshold: Number(data.dismissal_confidence_threshold),
    relaxedTargetMultiplier: Number(data.relaxed_target_multiplier),
    balancedTargetMultiplier: Number(data.balanced_target_multiplier),
    eliteTargetMultiplier: Number(data.elite_target_multiplier),
  };
}

export async function saveNexoCareerRules(rules: NexoCareerRules): Promise<void> {
  const { error } = await requireClient().rpc("update_manager_career_rules", {
    next_enabled: rules.enabled,
    next_free_careers: rules.freeCareersPerCompetition,
    next_extra_cost: rules.extraCareerCoinCost,
    next_initial_budget: rules.initialBudget,
    next_minimum_original_squad: rules.minimumOriginalSquad,
    next_minimum_original_lineup: rules.minimumOriginalLineup,
    next_weekly_decisions: rules.weeklyDecisionEnabled,
    next_same_club_ranking: rules.sameClubRankingEnabled,
    next_academy_cost: rules.academyDecisionCost,
    next_failure_penalty: rules.failureConfidencePenalty,
    next_dismissal_threshold: rules.dismissalConfidenceThreshold,
    next_relaxed_multiplier: rules.relaxedTargetMultiplier,
    next_balanced_multiplier: rules.balancedTargetMultiplier,
    next_elite_multiplier: rules.eliteTargetMultiplier,
  });
  if (error) throw new Error(error.message);
}

export async function loadNexoCareerContentCatalog(): Promise<NexoCareerContentItem[]> {
  const { data, error } = await requireClient().rpc("manager_career_content_catalog");
  if (error) throw new Error(error.message);
  const catalog = (data ?? {}) as Record<string, Record<string, unknown>[]>;
  const mapItem = (row: Record<string, unknown>, kind: "event" | "mission"): NexoCareerContentItem => ({
    key: String(row.key), title: String(row.title), kind, category: row.category ? String(row.category) : undefined,
    metricKey: row.metricKey ? String(row.metricKey) : undefined, active: Boolean(row.active), weight: Number(row.weight), cooldown: Number(row.cooldown),
    storyKey: row.storyKey ? String(row.storyKey) : undefined, storyStep: row.storyStep == null ? undefined : Number(row.storyStep),
    target: row.target == null ? undefined : Number(row.target), reward: row.reward == null ? undefined : Number(row.reward), penalty: row.penalty == null ? undefined : Number(row.penalty),
  });
  return [...(catalog.events ?? []).map((row) => mapItem(row,"event")),...(catalog.missions ?? []).map((row) => mapItem(row,"mission"))];
}

export async function saveNexoCareerContentItem(item: NexoCareerContentItem): Promise<void> {
  const { error } = await requireClient().rpc("update_manager_career_content_item", { target_kind: item.kind, target_key: item.key, next_active: item.active, next_weight: item.weight, next_cooldown: item.cooldown, next_target: item.target ?? null, next_reward: item.reward ?? null, next_penalty: item.penalty ?? null });
  if (error) throw new Error(error.message);
}

export async function loadNexoCareerRanking(careerId: string): Promise<NexoCareerRanking> {
  const { data, error } = await requireClient().rpc("manager_career_same_club_ranking", { target_career_id: careerId });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    enabled: result.enabled !== false,
    completedMatchdays: Number(result.completedMatchdays ?? 0),
    totalManagers: Number(result.totalManagers ?? 0),
    rows: ((result.rows ?? []) as Record<string,unknown>[]).map((row)=>({ careerId:String(row.careerId),position:Number(row.position),managerName:String(row.managerName),initials:String(row.initials),status:row.status as NexoCareer["status"],totalPoints:Number(row.totalPoints),averagePoints:Number(row.averagePoints),bestMatchday:Number(row.bestMatchday),reputation:Number(row.reputation),confidence:Number(row.confidence),completedObjectives:Number(row.completedObjectives),budget:Number(row.budget),isCurrent:Boolean(row.isCurrent) })),
  };
}

function mapCareerPlayer(row: Record<string, unknown>, owned: boolean): NexoCareerPlayer {
  return {
    id: String(row.id), name: String(row.name), initials: String(row.initials),
    position: row.position as NexoCareerPlayer["position"], club: String(row.club), value: Number(row.value),
    photoUrl: row.photoUrl ? String(row.photoUrl) : undefined,
    isOriginal: owned ? Boolean(row.isOriginal) : false,
    acquisitionValue: owned ? Number(row.acquisitionValue) : Number(row.value),
  };
}

export async function loadNexoCareerWorkspace(careerId: string): Promise<NexoCareerWorkspace> {
  const client=requireClient();
  const [{ data, error },{data:reportData,error:reportError}] = await Promise.all([
    client.rpc("manager_career_workspace", { target_career_id: careerId }),
    client.rpc("manager_career_matchday_reports", { target_career_id: careerId }),
  ]);
  if (error) throw new Error(error.message);
  if (reportError) throw new Error(reportError.message);
  const result = (data ?? {}) as Record<string, unknown>;
  const career = (result.career ?? {}) as Record<string, unknown>;
  return {
    budget: Number(career.budget ?? 0), matchday: Number(career.matchday ?? 1), boardConfidence: Number(career.boardConfidence ?? 60), consecutiveFailures: Number(career.consecutiveFailures ?? 0), contractTier: (career.contractTier as NexoCareerWorkspace["contractTier"]) ?? "stability", status: (career.status as NexoCareer["status"]) ?? "active",
    squad: ((result.squad ?? []) as Record<string, unknown>[]).map((row) => mapCareerPlayer(row, true)),
    market: ((result.market ?? []) as Record<string, unknown>[]).map((row) => mapCareerPlayer(row, false)),
    lineups: ((result.lineups ?? []) as Record<string, unknown>[]).map((row) => ({ matchday: Number(row.matchday), formation: String(row.formation), captainId: String(row.captainId), playerIds: (row.playerIds ?? []) as string[], savedAt: String(row.savedAt), lockedAt: row.lockedAt ? String(row.lockedAt) : undefined, points: row.points == null ? undefined : Number(row.points) })),
    decisions: ((result.decisions ?? []) as Record<string, unknown>[]).map((row) => ({ matchday: Number(row.matchday), decisionKey: String(row.decisionKey), choiceKey: String(row.choiceKey), choiceTitle: String(row.choiceTitle), consequence: String(row.consequence), reputationChange: Number(row.reputationChange), confidenceChange: Number(row.confidenceChange ?? row.reputationChange), budgetChange: Number(row.budgetChange), sportingPointsChange: Number(row.sportingPointsChange), conditionalOriginalTarget: row.conditionalOriginalTarget == null ? undefined : Number(row.conditionalOriginalTarget), conditionalSportingBonus: Number(row.conditionalSportingBonus), decidedAt: String(row.decidedAt) })),
    objectives: ((result.objectives ?? []) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), type: row.type as NexoCareerObjective["type"], title: String(row.title), description: String(row.description), targetValue: Number(row.targetValue), currentValue: Number(row.currentValue), reputationReward: Number(row.reputationReward), failurePenalty: Number(row.failurePenalty), status: row.status as NexoCareerObjective["status"], expiresMatchday: row.expiresMatchday == null ? undefined : Number(row.expiresMatchday), metricKey: row.metricKey as NexoCareerObjective["metricKey"] })),
    events: ((result.events ?? []) as Record<string, unknown>[]).map((row) => ({ type: String(row.type), title: String(row.title), detail: String(row.detail), matchday: row.matchday == null ? undefined : Number(row.matchday), reputationChange: Number(row.reputationChange ?? 0), createdAt: String(row.createdAt) })),
    reports: ((reportData ?? []) as Record<string,unknown>[]).map((row)=>({
      matchday:Number(row.matchday),formation:row.formation?String(row.formation):undefined,captainId:row.captainId?String(row.captainId):undefined,
      players:((row.players??[]) as Record<string,unknown>[]).map((player)=>({playerId:String(player.playerId),name:String(player.name),initials:String(player.initials),position:player.position as NexoCareerPlayer["position"],photoUrl:player.photoUrl?String(player.photoUrl):undefined,isCaptain:Boolean(player.isCaptain),basePoints:Number(player.basePoints),multiplier:Number(player.multiplier),finalPoints:Number(player.finalPoints)})),
      lineupPoints:Number(row.lineupPoints),decisionPoints:Number(row.decisionPoints),totalPoints:Number(row.totalPoints),
      mission:row.mission?(row.mission as NexoCareerReportMission):undefined,decision:row.decision?(row.decision as NexoCareerReportDecision):undefined,
      confidenceBefore:Number(row.confidenceBefore),confidenceAfter:Number(row.confidenceAfter),reputationBefore:Number(row.reputationBefore),reputationAfter:Number(row.reputationAfter),budgetBefore:Number(row.budgetBefore),budgetAfter:Number(row.budgetAfter),consecutiveFailuresAfter:Number(row.consecutiveFailuresAfter),statusAfter:row.statusAfter as NexoCareer["status"],rankingPosition:row.rankingPosition==null?undefined:Number(row.rankingPosition),previousRankingPosition:row.previousRankingPosition==null?undefined:Number(row.previousRankingPosition),createdAt:String(row.createdAt),viewedAt:row.viewedAt?String(row.viewedAt):undefined,
    })),
    decisionPrompt: result.decisionPrompt ? result.decisionPrompt as NexoCareerDecisionPrompt : undefined,
  };
}

export async function markNexoCareerReportViewed(careerId:string,matchday:number):Promise<void>{
  const {error}=await requireClient().rpc("mark_manager_career_report_viewed",{target_career_id:careerId,target_matchday:matchday});
  if(error)throw new Error(error.message);
}

export async function saveNexoCareerLineup(input: { careerId: string; matchday: number; formation: string; playerIds: string[]; captainId: string }): Promise<void> {
  const { error } = await requireClient().rpc("save_manager_career_lineup", { target_career_id: input.careerId, target_matchday: input.matchday, target_formation: input.formation, target_player_ids: input.playerIds, target_captain_id: input.captainId });
  if (error) throw new Error(error.message);
}

export async function buyNexoCareerPlayer(careerId: string, playerId: string): Promise<void> {
  const { error } = await requireClient().rpc("buy_manager_career_player", { target_career_id: careerId, target_player_id: playerId });
  if (error) throw new Error(error.message);
}

export async function sellNexoCareerPlayer(careerId: string, playerId: string): Promise<void> {
  const { error } = await requireClient().rpc("sell_manager_career_player", { target_career_id: careerId, target_player_id: playerId });
  if (error) throw new Error(error.message);
}

export async function saveNexoCareerDecision(careerId: string, decisionKey: string, choiceKey: string): Promise<void> {
  const { error } = await requireClient().rpc("save_manager_career_decision", { target_career_id: careerId, target_decision_key: decisionKey, target_choice_key: choiceKey });
  if (error) throw new Error(error.message);
}
