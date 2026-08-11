import type { CompetitionName } from "../data";
import { getSupabaseClient } from "../lib/supabase-client";

export type NexoChallengeFixture = {
  id: string;
  home: string;
  away: string;
  matchday: number;
  kickoffLabel: string;
};

export type NexoChallenge = {
  id: string;
  name: string;
  description: string;
  competition: CompetitionName;
  competitionId: string;
  format: "partidazo" | "matches";
  fixtures: NexoChallengeFixture[];
  matchdays: number[];
  lineupPolicy: "fixed" | "per_matchday";
  maxPlayersPerClub: number;
  capacity: number;
  memberCount: number;
  featured: boolean;
  status: "announced" | "open" | "live" | "finished";
  previousMatchday: number;
  budgetPercentile: number;
  snapshot?: {
    id: string;
    capturedAt: number;
    algorithmVersion: string;
    budget: number;
    percentile: number;
    playerPrices: Record<string, number>;
  };
};

type ChallengeRow = {
  league_id: string;
  name: string;
  description: string;
  competition_id: string;
  competition_name: CompetitionName;
  format: "partidazo" | "matches";
  lineup_policy: "fixed" | "per_matchday";
  max_players_per_club: number;
  capacity: number;
  member_count: number;
  featured: boolean;
  status: "announced" | "open" | "live" | "finished";
  previous_matchday: number;
  budget_percentile: number;
  budget: number | null;
  snapshot_id: string | null;
  snapshot_at: string | null;
  fixtures: Array<{ id: string; home: string; away: string; matchday: number; kickoffAt: string | null }>;
  player_prices: Record<string, number> | null;
};

const competitionUiIds: Record<string, string> = {
  primera: "comp_primera",
  segunda: "comp_segunda",
  liga_f: "comp_liga_f",
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

function kickoffLabel(value: string | null, matchday: number) {
  if (!value) return `Jornada ${matchday}`;
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export async function loadNexoChallenges(): Promise<NexoChallenge[]> {
  const { data, error } = await requireClient().rpc("fantasy_challenge_directory");
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChallengeRow[]).map((row) => ({
    id: row.league_id,
    name: row.name,
    description: row.description,
    competition: row.competition_name,
    competitionId: competitionUiIds[row.competition_id] ?? row.competition_id,
    format: row.format,
    fixtures: (row.fixtures ?? []).map((fixture) => ({
      id: fixture.id,
      home: fixture.home,
      away: fixture.away,
      matchday: Number(fixture.matchday),
      kickoffLabel: kickoffLabel(fixture.kickoffAt, Number(fixture.matchday)),
    })),
    matchdays: Array.from(new Set((row.fixtures ?? []).map((fixture) => Number(fixture.matchday)))).sort((a, b) => a - b),
    lineupPolicy: row.lineup_policy,
    maxPlayersPerClub: Number(row.max_players_per_club),
    capacity: Number(row.capacity),
    memberCount: Number(row.member_count),
    featured: row.featured,
    status: row.status,
    previousMatchday: Number(row.previous_matchday),
    budgetPercentile: Number(row.budget_percentile),
    snapshot: row.snapshot_id && row.snapshot_at && row.budget != null
      ? {
          id: row.snapshot_id,
          capturedAt: new Date(row.snapshot_at).getTime(),
          algorithmVersion: "market-value-v1 · challenge-lock",
          budget: Number(row.budget),
          percentile: Number(row.budget_percentile),
          playerPrices: Object.fromEntries(Object.entries(row.player_prices ?? {}).map(([id, price]) => [id, Number(price)])),
        }
      : undefined,
  }));
}

export async function createNexoChallenge(input: {
  name: string;
  description: string;
  format: "partidazo" | "matches";
  fixtureIds: string[];
  lineupPolicy: "fixed" | "per_matchday";
  maxPlayersPerClub: number;
  capacity: number;
  featured: boolean;
  budgetPercentile: number;
}): Promise<string> {
  const { data, error } = await requireClient().rpc("admin_create_fantasy_challenge", {
    challenge_name: input.name,
    challenge_description: input.description,
    challenge_format: input.format,
    selected_fixture_ids: input.fixtureIds,
    requested_lineup_policy: input.lineupPolicy,
    requested_max_players_per_club: input.maxPlayersPerClub,
    requested_capacity: input.capacity,
    requested_featured: input.featured,
    requested_budget_percentile: input.budgetPercentile,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateNexoChallenge(leagueId: string, input: {
  name: string;
  description: string;
  fixtureIds: string[];
  lineupPolicy: "fixed" | "per_matchday";
  maxPlayersPerClub: number;
  capacity: number;
  featured: boolean;
  budgetPercentile: number;
}): Promise<void> {
  const { error } = await requireClient().rpc("admin_update_fantasy_challenge", {
    target_league_id: leagueId,
    challenge_name: input.name,
    challenge_description: input.description,
    selected_fixture_ids: input.fixtureIds,
    requested_lineup_policy: input.lineupPolicy,
    requested_max_players_per_club: input.maxPlayersPerClub,
    requested_capacity: input.capacity,
    requested_featured: input.featured,
    requested_budget_percentile: input.budgetPercentile,
  });
  if (error) throw new Error(error.message);
}

export async function snapshotNexoChallenge(leagueId: string): Promise<void> {
  const { error } = await requireClient().rpc("admin_snapshot_fantasy_challenge", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
}
