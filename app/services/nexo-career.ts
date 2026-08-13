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
  catalogIncidentsEnabled: boolean;
  exitReinvestPercent: number;
  exitIdentityPercent: number;
  delegationEnabled: boolean;
  delegationMaxUses: number;
  delegationCooldownMatchdays: number;
  delegationWarningMargin: number;
  delegationCloseRanksCost: number;
  delegationTacticalCost: number;
  delegationAcademyCost: number;
  delegationCloseRanksConfidence: number;
  delegationAcademyPointsMultiplier: number;
  delegationIdentityRewardMultiplier: number;
  delegationMaxBonusUses: number;
  delegationUnlocksEnabled: boolean;
  delegationUnusedRewardThreshold: number;
  delegationUnusedRewardCoins: number;
  delegationNeverUsedRewardCoins: number;
  delegationNeverUsedReputation: number;
  interludeEnabled: boolean;
  interludeThresholdDays: number;
  interludeAutoActivate: boolean;
  interludeRecoveryConfidence: number;
  interludeTacticalProtectionPercent: number;
  interludeAcademyReputation: number;
  interludeCommercialBudget: number;
  interludeCommercialConfidenceCost: number;
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

export type NexoCareerLineup = { matchday: number; formation: string; captainId: string; viceCaptainId?: string; playerIds: string[]; savedAt: string; lockedAt?: string; points?: number; delegated?: boolean };
export type NexoCareerDecision = { matchday: number; decisionKey: string; choiceKey: string; choiceTitle: string; consequence: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; conditionalOriginalTarget?: number; conditionalSportingBonus: number; decidedAt: string };
export type NexoCareerObjective = { id: string; type: "identity" | "matchday" | "season" | "confidence"; title: string; description: string; targetValue: number; currentValue: number; reputationReward: number; failurePenalty: number; status: "active" | "completed" | "failed"; expiresMatchday?: number; metricKey?: "points" | "originals" | "captain_points" | "new_signings" | "budget_floor" };
export type NexoCareerDecisionChoice = { key: string; title: string; summary: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; condition?: string; conditionalBonus: number };
export type NexoCareerDecisionPrompt = { key: string; title: string; description: string; choices: NexoCareerDecisionChoice[] };
export type NexoCareerEvent = { type: string; title: string; detail: string; matchday?: number; reputationChange: number; createdAt: string };
export type NexoCareerCatalogIncidentChoice = { key: "reinvest" | "identity"; title: string; summary: string; budgetCredit: number; reputationChange: number; confidenceChange: number };
export type NexoCareerCatalogIncident = { id: string; playerId: string; playerName: string; initials: string; position: NexoCareerPlayer["position"]; photoUrl?: string; changeType: "club_exit" | "competition_exit" | "competition_change"; previousClubId?: string; currentClubId?: string; frozenMarketValue: number; status: "pending" | "resolving" | "resolved" | "cancelled"; resolutionChoice?: "reinvest" | "identity"; budgetCredit?: number; reputationChange?: number; confidenceChange?: number; createdAt: string; resolvedAt?: string; choices: NexoCareerCatalogIncidentChoice[] };
export type NexoCareerDelegationPlanKey = "close_ranks" | "tactical" | "academy";
export type NexoCareerDelegationPlan = { key: NexoCareerDelegationPlanKey; title: string; description: string; cost: number; confidenceChange: number; failuresReduced: number; pointsMultiplier?: number; identityRewardMultiplier?: number };
export type NexoCareerDelegation = { id: string; matchday: number; plan: NexoCareerDelegationPlanKey; status: "scheduled" | "settled" | "cancelled"; cost: number; confidenceChange: number; failuresReduced: number; formation: string; captainId: string; viceCaptainId?: string; playerIds: string[]; fallbackPlayerIds: string[]; createdAt: string };
export type NexoCareerDelegationState = { enabled: boolean; eligible: boolean; blockingReason?: string; used: number; baseMaximum: number; bonusUses: number; maximum: number; remaining: number; cooldownMatchdays: number; nextAvailableMatchday: number; recommended: boolean; recommendationReasons: string[]; current?: NexoCareerDelegation; plans: NexoCareerDelegationPlan[] };
export type NexoCareerInterludeChoice = { key: string; category?: string; icon?: string; title: string; summary: string; immediate: string; returnEffect: string; confidenceChange: number; reputationChange: number; budgetChange: number };
export type NexoCareerInterludePlan = { key:string; icon:string; title:string; summary:string; categories:string[]; basic:string; advanced:string; excellent:string };
export type NexoCareerInterludeProject = { key:string; area:string; icon:string; title:string; summary:string; cost:number; plans:string[]; input:string; configuration?:Record<string,unknown>; completedAt?:string; earnedProgress?:number; matchesPlan?:boolean };
export type NexoCareerInterludeReward = { tier:"failed"|"basic"|"advanced"|"excellent"; title:string; description:string; basicTarget:number; advancedTarget:number; excellentTarget:number; confidenceChange:number; reputationChange:number; budgetChange:number; failuresReduced:number; nextEffect:Record<string,unknown> };
export type NexoCareerStoryChoice={key:string;title:string;summary:string;consequence:string;reputationChange:number;confidenceChange:number;budgetChange:number;input?:string;chapter?:string;chapterTitle?:string;label?:string;configuration?:Record<string,unknown>;decidedAt?:string;day?:number};
export type NexoCareerStoryChapter={key:string;day:number;label:string;title:string;description:string;input:string;choices:NexoCareerStoryChoice[]};
export type NexoCareerInterludeDecision = { plan: NexoCareerInterludeChoice["key"]; title: string; consequence: string; confidenceChange: number; reputationChange: number; budgetChange: number; failuresReduced: number; nextEffect: Record<string,unknown>; decidedAt: string; actionDate?: string; day?:number; earnedProgress?:number; appliedAt?: string };
export type NexoCareerInterlude = { id: string; title: string; status: "pending" | "active" | "cancelled" | "completed"; fromMatchday: number; toMatchday: number; startsAt: string; endsAt: string; gapDays: number; preparationOpensAt?: string; preparationDays?: number; phase?: "activities" | "preparation"; remainingActionDays?: number; dayNumber?:number; currentDay?:number; activityDays?:number; canDecide: boolean; decision?: NexoCareerInterludeDecision; todayDecision?: NexoCareerInterludeDecision; actions?: NexoCareerInterludeDecision[]; choices: NexoCareerInterludeChoice[]; plan?:string; planTitle?:string; planChoices:NexoCareerInterludePlan[]; progress:number; streak:number; managementPoints:number; projectChoices:NexoCareerInterludeProject[]; projects:NexoCareerInterludeProject[]; reward?:NexoCareerInterludeReward; rewardPreview?:NexoCareerInterludeReward; narrativeMode?:boolean; story:NexoCareerStoryChapter[]; storyChoices:NexoCareerStoryChoice[]; currentChapter?:NexoCareerStoryChapter };
export type NexoCareerInterludeReport = { id:string; title:string; fromMatchday:number; toMatchday:number; plan?:string; planTitle?:string; progress:number; activityDays:number; storyChoices:NexoCareerStoryChoice[]; reward?:NexoCareerInterludeReward; settledAt?:string };
export type NexoCareerAdminInterlude = Pick<NexoCareerInterlude,"id"|"title"|"status"|"fromMatchday"|"toMatchday"|"startsAt"|"endsAt"|"gapDays"> & { competitionId: string; season: string; decisionCount: number };
export type NexoProfileAchievement = { key: string; title: string; description: string; rarity: string; coinReward: number; unlockedAt: string; rewardClaimedAt?: string };
export type NexoCareerReportPlayer = { playerId: string; name: string; initials: string; position: NexoCareerPlayer["position"]; photoUrl?: string; isCaptain: boolean; basePoints: number; multiplier: number; finalPoints: number };
export type NexoCareerReportMission = { id: string; title: string; description: string; metricKey?: string; targetValue: number; currentValue: number; status: "completed" | "failed"; reward: number; penalty: number };
export type NexoCareerReportDecision = { choiceTitle: string; consequence: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; conditionalOriginalTarget?: number; conditionalSportingBonus: number; conditionMet: boolean };
export type NexoCareerMatchdayReport = { matchday: number; formation?: string; captainId?: string; players: NexoCareerReportPlayer[]; lineupPoints: number; decisionPoints: number; totalPoints: number; mission?: NexoCareerReportMission; decision?: NexoCareerReportDecision; confidenceBefore: number; confidenceAfter: number; reputationBefore: number; reputationAfter: number; budgetBefore: number; budgetAfter: number; consecutiveFailuresAfter: number; statusAfter: NexoCareer["status"]; rankingPosition?: number; previousRankingPosition?: number; createdAt: string; viewedAt?: string };
export type NexoCareerWorkspace = { budget: number; matchday: number; boardConfidence: number; consecutiveFailures: number; contractTier: "title" | "europe" | "stability"; status: NexoCareer["status"]; squad: NexoCareerPlayer[]; market: NexoCareerPlayer[]; lineups: NexoCareerLineup[]; decisions: NexoCareerDecision[]; objectives: NexoCareerObjective[]; events: NexoCareerEvent[]; incidents: NexoCareerCatalogIncident[]; reports: NexoCareerMatchdayReport[]; interludeReports:NexoCareerInterludeReport[]; delegation: NexoCareerDelegationState; interlude?: NexoCareerInterlude; decisionPrompt?: NexoCareerDecisionPrompt };
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
  const { data, error } = await requireClient().from("manager_career_rules").select("enabled,free_careers_per_competition,extra_career_coin_cost,initial_budget,minimum_original_squad,minimum_original_lineup,weekly_decision_enabled,same_club_ranking_enabled,academy_decision_cost,failure_confidence_penalty,dismissal_confidence_threshold,relaxed_target_multiplier,balanced_target_multiplier,elite_target_multiplier,catalog_incidents_enabled,exit_reinvest_percent,exit_identity_percent,delegation_enabled,delegation_max_uses,delegation_cooldown_matchdays,delegation_warning_margin,delegation_close_ranks_cost,delegation_tactical_cost,delegation_academy_cost,delegation_close_ranks_confidence,delegation_academy_points_multiplier,delegation_identity_reward_multiplier,delegation_max_bonus_uses,delegation_unlocks_enabled,delegation_unused_reward_threshold,delegation_unused_reward_coins,delegation_never_used_reward_coins,delegation_never_used_reputation,interlude_enabled,interlude_threshold_days,interlude_auto_activate,interlude_recovery_confidence,interlude_tactical_protection_percent,interlude_academy_reputation,interlude_commercial_budget,interlude_commercial_confidence_cost").single();
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
    catalogIncidentsEnabled: data.catalog_incidents_enabled !== false,
    exitReinvestPercent: Number(data.exit_reinvest_percent ?? 100),
    exitIdentityPercent: Number(data.exit_identity_percent ?? 85),
    delegationEnabled: data.delegation_enabled !== false,
    delegationMaxUses: Number(data.delegation_max_uses ?? 5),
    delegationCooldownMatchdays: Number(data.delegation_cooldown_matchdays ?? 3),
    delegationWarningMargin: Number(data.delegation_warning_margin ?? 10),
    delegationCloseRanksCost: Number(data.delegation_close_ranks_cost ?? 0.5),
    delegationTacticalCost: Number(data.delegation_tactical_cost ?? 0.5),
    delegationAcademyCost: Number(data.delegation_academy_cost ?? 0.75),
    delegationCloseRanksConfidence: Number(data.delegation_close_ranks_confidence ?? 6),
    delegationAcademyPointsMultiplier: Number(data.delegation_academy_points_multiplier ?? 1.1),
    delegationIdentityRewardMultiplier: Number(data.delegation_identity_reward_multiplier ?? 2),
    delegationMaxBonusUses: Number(data.delegation_max_bonus_uses ?? 2),
    delegationUnlocksEnabled: data.delegation_unlocks_enabled !== false,
    delegationUnusedRewardThreshold: Number(data.delegation_unused_reward_threshold ?? 3),
    delegationUnusedRewardCoins: Number(data.delegation_unused_reward_coins ?? 100),
    delegationNeverUsedRewardCoins: Number(data.delegation_never_used_reward_coins ?? 300),
    delegationNeverUsedReputation: Number(data.delegation_never_used_reputation ?? 10),
    interludeEnabled: data.interlude_enabled !== false,
    interludeThresholdDays: Number(data.interlude_threshold_days ?? 10),
    interludeAutoActivate: data.interlude_auto_activate !== false,
    interludeRecoveryConfidence: Number(data.interlude_recovery_confidence ?? 5),
    interludeTacticalProtectionPercent: Number(data.interlude_tactical_protection_percent ?? 50),
    interludeAcademyReputation: Number(data.interlude_academy_reputation ?? 4),
    interludeCommercialBudget: Number(data.interlude_commercial_budget ?? 1.5),
    interludeCommercialConfidenceCost: Number(data.interlude_commercial_confidence_cost ?? 3),
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
    next_catalog_incidents_enabled: rules.catalogIncidentsEnabled,
    next_exit_reinvest_percent: rules.exitReinvestPercent,
    next_exit_identity_percent: rules.exitIdentityPercent,
    next_delegation_enabled: rules.delegationEnabled,
    next_delegation_max_uses: rules.delegationMaxUses,
    next_delegation_cooldown: rules.delegationCooldownMatchdays,
    next_delegation_warning_margin: rules.delegationWarningMargin,
    next_delegation_close_ranks_cost: rules.delegationCloseRanksCost,
    next_delegation_tactical_cost: rules.delegationTacticalCost,
    next_delegation_academy_cost: rules.delegationAcademyCost,
    next_delegation_close_ranks_confidence: rules.delegationCloseRanksConfidence,
    next_delegation_academy_multiplier: rules.delegationAcademyPointsMultiplier,
    next_delegation_identity_multiplier: rules.delegationIdentityRewardMultiplier,
    next_delegation_max_bonus_uses: rules.delegationMaxBonusUses,
    next_delegation_unlocks_enabled: rules.delegationUnlocksEnabled,
    next_delegation_unused_reward_threshold: rules.delegationUnusedRewardThreshold,
    next_delegation_unused_reward_coins: rules.delegationUnusedRewardCoins,
    next_delegation_never_used_reward_coins: rules.delegationNeverUsedRewardCoins,
    next_delegation_never_used_reputation: rules.delegationNeverUsedReputation,
    next_interlude_enabled: rules.interludeEnabled,
    next_interlude_threshold_days: rules.interludeThresholdDays,
    next_interlude_auto_activate: rules.interludeAutoActivate,
    next_interlude_recovery_confidence: rules.interludeRecoveryConfidence,
    next_interlude_tactical_protection_percent: rules.interludeTacticalProtectionPercent,
    next_interlude_academy_reputation: rules.interludeAcademyReputation,
    next_interlude_commercial_budget: rules.interludeCommercialBudget,
    next_interlude_commercial_confidence_cost: rules.interludeCommercialConfidenceCost,
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
  const [{ data, error },{data:reportData,error:reportError},{data:incidentData,error:incidentError},{data:delegationData,error:delegationError},{data:interludeData,error:interludeError},{data:interludeReportData,error:interludeReportError}] = await Promise.all([
    client.rpc("manager_career_workspace", { target_career_id: careerId }),
    client.rpc("manager_career_matchday_reports", { target_career_id: careerId }),
    client.rpc("manager_career_catalog_incidents", { target_career_id: careerId }),
    client.rpc("manager_career_delegation_state", { target_career_id: careerId }),
    client.rpc("manager_career_interlude_state", { target_career_id: careerId }),
    client.rpc("manager_career_interlude_reports", { target_career_id: careerId }),
  ]);
  if (error) throw new Error(error.message);
  if (reportError) throw new Error(reportError.message);
  if (incidentError) throw new Error(incidentError.message);
  if (delegationError) throw new Error(delegationError.message);
  if (interludeError) throw new Error(interludeError.message);
  if (interludeReportError) throw new Error(interludeReportError.message);
  const result = (data ?? {}) as Record<string, unknown>;
  const career = (result.career ?? {}) as Record<string, unknown>;
  return {
    budget: Number(career.budget ?? 0), matchday: Number(career.matchday ?? 1), boardConfidence: Number(career.boardConfidence ?? 60), consecutiveFailures: Number(career.consecutiveFailures ?? 0), contractTier: (career.contractTier as NexoCareerWorkspace["contractTier"]) ?? "stability", status: (career.status as NexoCareer["status"]) ?? "active",
    squad: ((result.squad ?? []) as Record<string, unknown>[]).map((row) => mapCareerPlayer(row, true)),
    market: ((result.market ?? []) as Record<string, unknown>[]).map((row) => mapCareerPlayer(row, false)),
    lineups: ((result.lineups ?? []) as Record<string, unknown>[]).map((row) => ({ matchday: Number(row.matchday), formation: String(row.formation), captainId: String(row.captainId), viceCaptainId: row.viceCaptainId ? String(row.viceCaptainId) : undefined, playerIds: (row.playerIds ?? []) as string[], savedAt: String(row.savedAt), lockedAt: row.lockedAt ? String(row.lockedAt) : undefined, points: row.points == null ? undefined : Number(row.points), delegated: Boolean(row.delegated) })),
    decisions: ((result.decisions ?? []) as Record<string, unknown>[]).map((row) => ({ matchday: Number(row.matchday), decisionKey: String(row.decisionKey), choiceKey: String(row.choiceKey), choiceTitle: String(row.choiceTitle), consequence: String(row.consequence), reputationChange: Number(row.reputationChange), confidenceChange: Number(row.confidenceChange ?? row.reputationChange), budgetChange: Number(row.budgetChange), sportingPointsChange: Number(row.sportingPointsChange), conditionalOriginalTarget: row.conditionalOriginalTarget == null ? undefined : Number(row.conditionalOriginalTarget), conditionalSportingBonus: Number(row.conditionalSportingBonus), decidedAt: String(row.decidedAt) })),
    objectives: ((result.objectives ?? []) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), type: row.type as NexoCareerObjective["type"], title: String(row.title), description: String(row.description), targetValue: Number(row.targetValue), currentValue: Number(row.currentValue), reputationReward: Number(row.reputationReward), failurePenalty: Number(row.failurePenalty), status: row.status as NexoCareerObjective["status"], expiresMatchday: row.expiresMatchday == null ? undefined : Number(row.expiresMatchday), metricKey: row.metricKey as NexoCareerObjective["metricKey"] })),
    events: ((result.events ?? []) as Record<string, unknown>[]).map((row) => ({ type: String(row.type), title: String(row.title), detail: String(row.detail), matchday: row.matchday == null ? undefined : Number(row.matchday), reputationChange: Number(row.reputationChange ?? 0), createdAt: String(row.createdAt) })),
    incidents: ((incidentData ?? []) as Record<string,unknown>[]).map((row)=>({
      id:String(row.id),playerId:String(row.playerId),playerName:String(row.playerName),initials:String(row.initials),position:row.position as NexoCareerPlayer["position"],photoUrl:row.photoUrl?String(row.photoUrl):undefined,
      changeType:row.changeType as NexoCareerCatalogIncident["changeType"],previousClubId:row.previousClubId?String(row.previousClubId):undefined,currentClubId:row.currentClubId?String(row.currentClubId):undefined,
      frozenMarketValue:Number(row.frozenMarketValue),status:row.status as NexoCareerCatalogIncident["status"],resolutionChoice:row.resolutionChoice as NexoCareerCatalogIncident["resolutionChoice"],budgetCredit:row.budgetCredit==null?undefined:Number(row.budgetCredit),
      reputationChange:row.reputationChange==null?undefined:Number(row.reputationChange),confidenceChange:row.confidenceChange==null?undefined:Number(row.confidenceChange),createdAt:String(row.createdAt),resolvedAt:row.resolvedAt?String(row.resolvedAt):undefined,
      choices:((row.choices??[]) as Record<string,unknown>[]).map((choice)=>({key:choice.key as NexoCareerCatalogIncidentChoice["key"],title:String(choice.title),summary:String(choice.summary),budgetCredit:Number(choice.budgetCredit),reputationChange:Number(choice.reputationChange),confidenceChange:Number(choice.confidenceChange)})),
    })),
    reports: ((reportData ?? []) as Record<string,unknown>[]).map((row)=>({
      matchday:Number(row.matchday),formation:row.formation?String(row.formation):undefined,captainId:row.captainId?String(row.captainId):undefined,
      players:((row.players??[]) as Record<string,unknown>[]).map((player)=>({playerId:String(player.playerId),name:String(player.name),initials:String(player.initials),position:player.position as NexoCareerPlayer["position"],photoUrl:player.photoUrl?String(player.photoUrl):undefined,isCaptain:Boolean(player.isCaptain),basePoints:Number(player.basePoints),multiplier:Number(player.multiplier),finalPoints:Number(player.finalPoints)})),
      lineupPoints:Number(row.lineupPoints),decisionPoints:Number(row.decisionPoints),totalPoints:Number(row.totalPoints),
      mission:row.mission?(row.mission as NexoCareerReportMission):undefined,decision:row.decision?(row.decision as NexoCareerReportDecision):undefined,
      confidenceBefore:Number(row.confidenceBefore),confidenceAfter:Number(row.confidenceAfter),reputationBefore:Number(row.reputationBefore),reputationAfter:Number(row.reputationAfter),budgetBefore:Number(row.budgetBefore),budgetAfter:Number(row.budgetAfter),consecutiveFailuresAfter:Number(row.consecutiveFailuresAfter),statusAfter:row.statusAfter as NexoCareer["status"],rankingPosition:row.rankingPosition==null?undefined:Number(row.rankingPosition),previousRankingPosition:row.previousRankingPosition==null?undefined:Number(row.previousRankingPosition),createdAt:String(row.createdAt),viewedAt:row.viewedAt?String(row.viewedAt):undefined,
    })),
    interludeReports: ((interludeReportData??[]) as Record<string,unknown>[]).map(mapInterludeReport),
    delegation: mapDelegationState((delegationData ?? {}) as Record<string,unknown>),
    interlude: interludeData ? mapInterludeState(interludeData as Record<string,unknown>) : undefined,
    decisionPrompt: result.decisionPrompt ? result.decisionPrompt as NexoCareerDecisionPrompt : undefined,
  };
}

export function mapInterludeReport(row:Record<string,unknown>):NexoCareerInterludeReport{
  const reward=(row.reward??row.narrativeResult) as Record<string,unknown>|undefined;
  return {id:String(row.id),title:String(row.title??"Interludio"),fromMatchday:Number(row.fromMatchday??row.from_matchday),toMatchday:Number(row.toMatchday??row.to_matchday),plan:row.plan?String(row.plan):undefined,planTitle:row.planTitle?String(row.planTitle):row.plan_title?String(row.plan_title):undefined,progress:Number(row.progress??0),activityDays:Number(row.activityDays??row.activity_days??0),storyChoices:((row.storyChoices??row.story_choices??[]) as Record<string,unknown>[]).map((item)=>({key:String(item.key),title:String(item.title),summary:String(item.summary??""),consequence:String(item.consequence??""),reputationChange:Number(item.reputationChange??0),confidenceChange:Number(item.confidenceChange??0),budgetChange:Number(item.budgetChange??0),input:item.input?String(item.input):undefined,chapter:item.chapter?String(item.chapter):undefined,chapterTitle:item.chapterTitle?String(item.chapterTitle):undefined,label:item.label?String(item.label):undefined,configuration:(item.configuration??{}) as Record<string,unknown>,decidedAt:item.decidedAt?String(item.decidedAt):undefined,day:item.day==null?undefined:Number(item.day)})),reward:reward?{tier:String(reward.tier??"basic") as NexoCareerInterludeReward["tier"],title:String(reward.title??"Interludio completado"),description:String(reward.description??""),basicTarget:Number(reward.basicTarget??0),advancedTarget:Number(reward.advancedTarget??0),excellentTarget:Number(reward.excellentTarget??0),confidenceChange:Number(reward.confidenceChange??0),reputationChange:Number(reward.reputationChange??0),budgetChange:Number(reward.budgetChange??0),failuresReduced:Number(reward.failuresReduced??0),nextEffect:(reward.nextEffect??{}) as Record<string,unknown>}:undefined,settledAt:row.settledAt?String(row.settledAt):row.settled_at?String(row.settled_at):undefined};
}

function mapInterludeState(row: Record<string,unknown>): NexoCareerInterlude {
  const mapDecision=(value:Record<string,unknown>|null|undefined)=>value?{plan:value.plan as NexoCareerInterludeChoice["key"],title:String(value.title),consequence:String(value.consequence),confidenceChange:Number(value.confidenceChange),reputationChange:Number(value.reputationChange),budgetChange:Number(value.budgetChange),failuresReduced:Number(value.failuresReduced),nextEffect:(value.nextEffect??{}) as Record<string,unknown>,decidedAt:String(value.decidedAt),actionDate:value.actionDate?String(value.actionDate):undefined,appliedAt:value.appliedAt?String(value.appliedAt):undefined}:undefined;
  const decision=mapDecision(row.decision as Record<string,unknown>|null|undefined);
  const todayDecision=mapDecision(row.todayDecision as Record<string,unknown>|null|undefined);
  const actions=((row.actions??[]) as Record<string,unknown>[]).map((item)=>mapDecision(item)).filter((item):item is NonNullable<typeof item>=>Boolean(item));
  const mapReward=(value:unknown)=>{const item=value as Record<string,unknown>|undefined;return item?{tier:String(item.tier) as NexoCareerInterludeReward["tier"],title:String(item.title),description:String(item.description),basicTarget:Number(item.basicTarget??4),advancedTarget:Number(item.advancedTarget??8),excellentTarget:Number(item.excellentTarget??12),confidenceChange:Number(item.confidenceChange??0),reputationChange:Number(item.reputationChange??0),budgetChange:Number(item.budgetChange??0),failuresReduced:Number(item.failuresReduced??0),nextEffect:(item.nextEffect??{}) as Record<string,unknown>}:undefined};
  const mapProject=(item:Record<string,unknown>):NexoCareerInterludeProject=>({key:String(item.key),area:String(item.area),icon:String(item.icon??"·"),title:String(item.title),summary:String(item.summary),cost:Number(item.cost),plans:(item.plans??[]) as string[],input:String(item.input??"review"),configuration:(item.configuration??{}) as Record<string,unknown>,completedAt:item.completedAt?String(item.completedAt):undefined,earnedProgress:item.earnedProgress==null?undefined:Number(item.earnedProgress),matchesPlan:item.matchesPlan==null?undefined:Boolean(item.matchesPlan)});
  const mapStoryChoice=(item:Record<string,unknown>):NexoCareerStoryChoice=>({key:String(item.key),title:String(item.title),summary:String(item.summary??""),consequence:String(item.consequence??""),reputationChange:Number(item.reputationChange??0),confidenceChange:Number(item.confidenceChange??0),budgetChange:Number(item.budgetChange??0),input:item.input?String(item.input):undefined,chapter:item.chapter?String(item.chapter):undefined,chapterTitle:item.chapterTitle?String(item.chapterTitle):undefined,label:item.label?String(item.label):undefined,configuration:(item.configuration??{}) as Record<string,unknown>,decidedAt:item.decidedAt?String(item.decidedAt):undefined,day:item.day==null?undefined:Number(item.day)});
  const mapChapter=(item:Record<string,unknown>):NexoCareerStoryChapter=>({key:String(item.key),day:Number(item.day),label:String(item.label),title:String(item.title),description:String(item.description),input:String(item.input??"none"),choices:((item.choices??[]) as Record<string,unknown>[]).map(mapStoryChoice)});
  return {id:String(row.id),title:String(row.title),status:row.status as NexoCareerInterlude["status"],fromMatchday:Number(row.fromMatchday),toMatchday:Number(row.toMatchday),startsAt:String(row.startsAt),endsAt:String(row.endsAt),gapDays:Number(row.gapDays),preparationOpensAt:row.preparationOpensAt?String(row.preparationOpensAt):undefined,preparationDays:row.preparationDays==null?undefined:Number(row.preparationDays),phase:row.phase as NexoCareerInterlude["phase"],remainingActionDays:row.remainingActionDays==null?undefined:Number(row.remainingActionDays),dayNumber:Number(row.dayNumber??row.currentDay??1),currentDay:Number(row.currentDay??row.dayNumber??1),activityDays:Number(row.activityDays??row.remainingActionDays??1),canDecide:Boolean(row.canDecide),decision,todayDecision,actions,choices:((row.choices??[]) as Record<string,unknown>[]).map((choice)=>({key:String(choice.key),category:choice.category?String(choice.category):undefined,icon:choice.icon?String(choice.icon):undefined,title:String(choice.title),summary:String(choice.summary),immediate:String(choice.immediate),returnEffect:String(choice.returnEffect),confidenceChange:Number(choice.confidenceChange),reputationChange:Number(choice.reputationChange),budgetChange:Number(choice.budgetChange)})),plan:row.plan?String(row.plan):undefined,planTitle:row.planTitle?String(row.planTitle):undefined,planChoices:((row.planChoices??[]) as Record<string,unknown>[]).map((item)=>({key:String(item.key),icon:String(item.icon??"·"),title:String(item.title),summary:String(item.summary),categories:(item.categories??[]) as string[],basic:String(item.basic),advanced:String(item.advanced),excellent:String(item.excellent)})),progress:Number(row.progress??0),streak:Number(row.streak??0),managementPoints:Number(row.managementPoints??6),projectChoices:((row.projectChoices??[]) as Record<string,unknown>[]).map(mapProject),projects:((row.projects??[]) as Record<string,unknown>[]).map(mapProject),reward:mapReward(row.reward),rewardPreview:mapReward(row.rewardPreview),narrativeMode:Boolean(row.narrativeMode),story:((row.story??[]) as Record<string,unknown>[]).map(mapChapter),storyChoices:((row.storyChoices??[]) as Record<string,unknown>[]).map(mapStoryChoice),currentChapter:row.currentChapter?mapChapter(row.currentChapter as Record<string,unknown>):undefined};
}

function mapDelegationState(row: Record<string,unknown>): NexoCareerDelegationState {
  const current=row.current as Record<string,unknown>|null|undefined;
  return {enabled:row.enabled!==false,eligible:Boolean(row.eligible),blockingReason:row.blockingReason?String(row.blockingReason):undefined,used:Number(row.used??0),baseMaximum:Number(row.baseMaximum??row.maximum??5),bonusUses:Number(row.bonusUses??0),maximum:Number(row.maximum??5),remaining:Number(row.remaining??5),cooldownMatchdays:Number(row.cooldownMatchdays??3),nextAvailableMatchday:Number(row.nextAvailableMatchday??1),recommended:Boolean(row.recommended),recommendationReasons:(row.recommendationReasons??[]) as string[],current:current?{id:String(current.id),matchday:Number(current.matchday),plan:current.plan as NexoCareerDelegationPlanKey,status:current.status as NexoCareerDelegation["status"],cost:Number(current.cost),confidenceChange:Number(current.confidenceChange),failuresReduced:Number(current.failuresReduced),formation:String(current.formation),captainId:String(current.captainId),viceCaptainId:current.viceCaptainId?String(current.viceCaptainId):undefined,playerIds:(current.playerIds??[]) as string[],fallbackPlayerIds:(current.fallbackPlayerIds??[]) as string[],createdAt:String(current.createdAt)}:undefined,plans:((row.plans??[]) as Record<string,unknown>[]).map((plan)=>({key:plan.key as NexoCareerDelegationPlanKey,title:String(plan.title),description:String(plan.description),cost:Number(plan.cost),confidenceChange:Number(plan.confidenceChange),failuresReduced:Number(plan.failuresReduced),pointsMultiplier:plan.pointsMultiplier==null?undefined:Number(plan.pointsMultiplier),identityRewardMultiplier:plan.identityRewardMultiplier==null?undefined:Number(plan.identityRewardMultiplier)}))};
}

export async function loadNexoProfileAchievements():Promise<NexoProfileAchievement[]>{
  const {data,error}=await requireClient().rpc("my_profile_achievements");
  if(error) throw new Error(error.message);
  return ((data??[]) as Record<string,unknown>[]).map((row)=>({key:String(row.achievement_key),title:String(row.title),description:String(row.description),rarity:String(row.rarity),coinReward:Number(row.coin_reward),unlockedAt:String(row.unlocked_at),rewardClaimedAt:row.reward_claimed_at?String(row.reward_claimed_at):undefined}));
}

export async function loadNexoProfileCoins():Promise<number>{
  const {data,error}=await requireClient().from("profiles").select("coins").single();
  if(error) throw new Error(error.message);
  return Number(data.coins);
}

export async function delegateNexoCareerMatchday(careerId:string,plan:NexoCareerDelegationPlanKey):Promise<void>{
  const {error}=await requireClient().rpc("delegate_manager_career_matchday",{target_career_id:careerId,target_plan:plan});
  if(error)throw new Error(error.message);
}

export async function saveNexoCareerInterludeDecision(careerId:string,interludeId:string,plan:NexoCareerInterludeChoice["key"]):Promise<NexoCareerInterlude>{
  const {data,error}=await requireClient().rpc("save_manager_career_interlude_decision",{target_career_id:careerId,target_interlude_id:interludeId,target_plan:plan});
  if(error)throw new Error(error.message);
  return mapInterludeState(data as Record<string,unknown>);
}

export async function saveNexoCareerInterludePlan(careerId:string,interludeId:string,plan:string):Promise<NexoCareerInterlude>{const {data,error}=await requireClient().rpc("save_manager_career_interlude_plan",{target_career_id:careerId,target_interlude_id:interludeId,target_plan:plan});if(error)throw new Error(error.message);return mapInterludeState(data as Record<string,unknown>)}
export async function saveNexoCareerInterludeProject(careerId:string,interludeId:string,project:string,configuration:Record<string,unknown>):Promise<NexoCareerInterlude>{const {data,error}=await requireClient().rpc("save_manager_career_interlude_project",{target_career_id:careerId,target_interlude_id:interludeId,target_project:project,target_configuration:configuration});if(error)throw new Error(error.message);return mapInterludeState(data as Record<string,unknown>)}
export async function saveNexoCareerInterludeStory(careerId:string,interludeId:string,chapter:string,choice:string,configuration:Record<string,unknown>):Promise<NexoCareerInterlude>{const {data,error}=await requireClient().rpc("save_manager_career_interlude_story",{target_career_id:careerId,target_interlude_id:interludeId,target_chapter:chapter,target_choice:choice,target_configuration:configuration});if(error)throw new Error(error.message);return mapInterludeState(data as Record<string,unknown>)}

export async function loadNexoCareerAdminInterludes():Promise<NexoCareerAdminInterlude[]>{
  const {data,error}=await requireClient().rpc("admin_manager_career_interludes");
  if(error)throw new Error(error.message);
  return ((data??[]) as Record<string,unknown>[]).map((row)=>({id:String(row.id),competitionId:String(row.competition_id),season:String(row.season),fromMatchday:Number(row.from_matchday),toMatchday:Number(row.to_matchday),startsAt:String(row.starts_at),endsAt:String(row.ends_at),gapDays:Number(row.gap_days),title:String(row.title),status:row.status as NexoCareerInterlude["status"],decisionCount:Number(row.decision_count)}));
}

export async function updateNexoCareerAdminInterlude(interlude:NexoCareerAdminInterlude):Promise<void>{
  const {error}=await requireClient().rpc("update_manager_career_interlude",{target_interlude_id:interlude.id,target_status:interlude.status,target_title:interlude.title});
  if(error)throw new Error(error.message);
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

export async function resolveNexoCareerCatalogIncident(incidentId: string, choice: NexoCareerCatalogIncidentChoice["key"]): Promise<void> {
  const { error } = await requireClient().rpc("resolve_manager_career_catalog_incident", { target_incident_id: incidentId, target_choice: choice });
  if (error) throw new Error(error.message);
}
