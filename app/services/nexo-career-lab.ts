import { getSupabaseClient } from "../lib/supabase-client";

export type CareerLabProfile = "conservative" | "competitive" | "academy" | "chaotic" | "custom";
export type CareerLabMode = "guided" | "automatic";
export type CareerLabPhase = "preparation" | "locked" | "played" | "adjustment_pending" | "interlude" | "completed" | "failed";

export type CareerLabUser = { id: string; name: string; email: string; initials: string };
export type CareerLabCareer = { id: string; userId: string; competitionId: string; sportsClubId: string; sportsClubName: string; difficulty: string; matchday: number; status: string };
export type CareerLabTeam = { id: string; name: string; competitionId: string; playerCount: number };
export type CareerLabOptions = { users: CareerLabUser[]; careers: CareerLabCareer[]; teams: CareerLabTeam[] };
export type CareerLabSession = { id: string; title: string; userId: string; userName?: string; competitionId: string; sportsClubId: string; sportsClubName?: string; difficulty: string; profile: CareerLabProfile; mode: CareerLabMode; seed: string; status: string; matchday: number; maximumMatchday: number; phase: CareerLabPhase; updatedAt: string; expiresAt?: string; previewToken?: string; previewEnabled?: boolean };
export type CareerLabPlayer = { id: string; name: string; initials: string; position: string; club: string; clubId: string; value: number; original: boolean; active: boolean; status?: string; points?: number };
export type CareerLabObjective = { id: string; type: "season" | "identity" | "matchday" | "confidence"; title: string; description: string; targetValue: number; currentValue: number; reputationReward: number; failurePenalty: number; status: "active" | "completed" | "failed"; expiresMatchday?: number };
export type CareerLabDecisionChoice = { key: string; title: string; summary: string; reputationChange: number; confidenceChange: number; budgetChange: number; sportingPointsChange: number; condition?: string; conditionalBonus?: number };
export type CareerLabDecisionPrompt = { key: string; title: string; description: string; choices: CareerLabDecisionChoice[] };
export type CareerLabCheck = { key: string; label: string; passed: boolean; detail?: string };
export type CareerLabLog = { sequence: number; matchday: number; phase: string; action: string; title: string; detail: string; checks: CareerLabCheck[]; severity: string; createdAt: string };
export type CareerLabEvent = { id: string; matchday: number; moment: string; type: string; title: string; payload: Record<string, unknown>; status: string };
export type CareerLabCheckpoint = { id: string; sequence: number; matchday: number; phase: string; label: string; createdAt: string };
export type CareerLabCalendarRound = { matchday: number; originalStart: string; originalEnd: string; startAt: string; endAt: string; edited: boolean; gapBeforeDays?: number; interludeDetected?: boolean };
export type CareerLabState = {
  session: CareerLabSession;
  state: { budget: number; confidence: number; reputation: number; sportingPoints: number; objectivePoints: number; consecutiveFailures: number; status: string; squad: CareerLabPlayer[]; currentLineup?: { formation: string; captainId: string; originals?: number; valid: boolean; locked: boolean; points?: number; players: CareerLabPlayer[] } | null; reports: Array<Record<string, unknown>>; decisions: Array<Record<string, unknown>>; objectives: CareerLabObjective[]; decisionPrompt?: CareerLabDecisionPrompt; incidents: Array<Record<string, unknown>>; interludes: Array<Record<string, unknown>>; calendarExceptions: Array<Record<string, unknown>>; activeInterlude?: Record<string, unknown>; realSideEffects: number };
  lastReport?: { action: string; detail: string; checks: CareerLabCheck[] };
  events: CareerLabEvent[];
  logs: CareerLabLog[];
  checkpoints: CareerLabCheckpoint[];
  stepsExecuted?: number;
};

function client() {
  const value = getSupabaseClient();
  if (!value) throw new Error("Supabase todavía no está configurado.");
  return value;
}

async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(name, params);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadCareerLabOptions = () => rpc<CareerLabOptions>("manager_career_lab_options");
export const loadCareerLabSessions = () => rpc<CareerLabSession[]>("admin_manager_career_lab_sessions");
export const loadCareerLabState = (id: string) => rpc<CareerLabState>("admin_manager_career_lab_state", { target_session_id: id });

export function createCareerLab(input: { userId: string; sourceCareerId?: string; competitionId: string; sportsClubId: string; difficulty: string; profile: CareerLabProfile; mode: CareerLabMode; seed: string; title: string }) {
  return rpc<string>("admin_create_manager_career_lab", {
    target_user_id: input.userId,
    target_source_career_id: input.sourceCareerId || null,
    target_competition_id: input.competitionId,
    target_sports_club_id: input.sportsClubId,
    target_difficulty: input.difficulty,
    target_profile: input.profile,
    target_mode: input.mode,
    target_seed: input.seed,
    target_title: input.title,
  });
}

export const stepCareerLab = (id: string, action: string, options: Record<string, unknown> = {}) => rpc<CareerLabState>("admin_step_manager_career_lab", { target_session_id: id, target_action: action, target_options: options });
export const runCareerLab = (id: string, until: "matchday" | "next_interlude" | "next_failure" | "season_end") => rpc<CareerLabState>("admin_run_manager_career_lab", { target_session_id: id, target_until: until, target_limit: 500 });
export const scheduleCareerLabEvent = (id: string, event: { matchday: number; moment: string; type: string; title: string; payload: Record<string, unknown> }) => rpc<string>("admin_schedule_manager_career_lab_event", { target_session_id: id, target_matchday: event.matchday, target_moment: event.moment, target_type: event.type, target_title: event.title, target_payload: event.payload });
export const restoreCareerLabCheckpoint = (id: string, checkpointId: string) => rpc<CareerLabState>("admin_restore_manager_career_lab_checkpoint", { target_session_id: id, target_checkpoint_id: checkpointId });
export const deleteCareerLab = (id: string) => rpc<void>("admin_delete_manager_career_lab", { target_session_id: id });
export const loadCareerLabCalendar = (id: string) => rpc<CareerLabCalendarRound[]>("admin_manager_career_lab_calendar", { target_session_id: id });
export const updateCareerLabCalendar = (id: string, matchday: number, startAt: string, endAt: string) => rpc<CareerLabState>("admin_update_manager_career_lab_calendar", { target_session_id: id, target_matchday: matchday, target_start_at: startAt, target_end_at: endAt, target_interlude_days: 10 });

export type CareerLabPublicPreview = Pick<CareerLabState, "state"> & {
  session: Pick<CareerLabSession, "title" | "userName" | "competitionId" | "sportsClubName" | "status" | "matchday" | "maximumMatchday" | "phase" | "updatedAt">;
};
export const loadCareerLabPublicPreview = (token: string) => rpc<CareerLabPublicPreview>("manager_career_lab_public_preview", { target_token: token });
export const actCareerLabPublic = (token: string, action: "decision" | "prepare_lineup" | "lock_lineup" | "interlude" | "incident", payload: Record<string, unknown> = {}) => rpc<CareerLabPublicPreview>("manager_career_lab_public_action", { target_token: token, target_action: action, target_payload: payload });
