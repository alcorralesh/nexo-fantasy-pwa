import type { CompetitionName, InitialSquad, LeagueParticipation, LeagueSummary, PublicLeagueSummary } from "../data";
import { getSupabaseClient } from "../lib/supabase-client";

type DirectoryRow = {
  id: string;
  name: string;
  competition_id: string;
  competition_name: CompetitionName;
  visibility: "public" | "private";
  mode: "market" | "fantasy";
  roster_policy: "exclusive" | "repeatable";
  accent: "lime" | "blue" | "violet";
  capacity: number;
  member_count: number;
  starting_budget: number;
  target_squad_value: number;
  join_locked: boolean;
  featured: boolean;
  rules: Record<string, unknown>;
};

type MembershipRow = {
  membership_id: string;
  league_id: string;
  team_id: string;
  role: "admin" | "member";
  budget: number;
  name: string;
  competition_id: string;
  competition_name: CompetitionName;
  visibility: "public" | "private";
  mode: "market" | "fantasy";
  roster_policy: "exclusive" | "repeatable";
  accent: "lime" | "blue" | "violet";
  capacity: number;
  member_count: number;
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

function uiCompetitionId(id: string) {
  return competitionUiIds[id] ?? id;
}

export async function loadNexoLeagueState(): Promise<{ publicLeagues: PublicLeagueSummary[]; leagues: LeagueSummary[]; participations: LeagueParticipation[]; adminLeagueIds: string[] }> {
  const client = requireClient();
  const [{ data: directory, error: directoryError }, { data: memberships, error: membershipsError }] = await Promise.all([
    client.rpc("league_directory"),
    client.rpc("my_league_memberships"),
  ]);
  if (directoryError) throw directoryError;
  if (membershipsError) throw membershipsError;
  const rows = (directory ?? []) as DirectoryRow[];
  const mine = (memberships ?? []) as MembershipRow[];
  return {
    publicLeagues: rows.filter((row) => row.visibility === "public").map((row) => ({
      id: row.id,
      name: row.name,
      competitionId: uiCompetitionId(row.competition_id),
      competition: row.competition_name,
      mode: row.mode,
      rosterPolicy: row.roster_policy,
      memberCount: Number(row.member_count),
      capacity: row.capacity,
      startingBudget: Number(row.starting_budget),
      targetSquadValue: Number(row.target_squad_value),
      accent: row.accent,
    })),
    leagues: mine.map((row) => ({
      id: row.league_id,
      name: row.name,
      competitionId: uiCompetitionId(row.competition_id),
      competition: row.competition_name,
      mode: row.mode,
      rosterPolicy: row.roster_policy,
      type: row.mode === "fantasy" ? "Fantástica · Presupuesto" : row.visibility === "private" ? "Privada · Mercado" : "Pública · Mercado",
      rank: "—",
      members: `${row.member_count}/${row.capacity}`,
      accent: row.accent,
    })),
    participations: mine.map((row) => ({
      id: row.membership_id,
      leagueId: row.league_id,
      teamId: row.team_id,
      rosterId: `roster_${row.membership_id}`,
      budget: Number(row.budget),
    })),
    adminLeagueIds: mine.filter((row) => row.role === "admin").map((row) => row.league_id),
  };
}

export async function reserveNexoLeaguePlace(leagueId: string, accessCode?: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc("reserve_league_place", { target_league_id: leagueId, access_code: accessCode ?? null });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function confirmNexoLeagueJoin(reservationId: string, teamId: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc("confirm_league_join", { reservation_id: reservationId, selected_team_id: teamId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function confirmNexoMarketLeagueJoin(input: { reservationId: string; teamId: string; idempotencyKey: string; squadSize?: number }): Promise<{ membershipId: string; squad: InitialSquad }> {
  const client = requireClient();
  const { data, error } = await client.rpc("confirm_market_league_join", {
    reservation_id: input.reservationId,
    selected_team_id: input.teamId,
    request_key: input.idempotencyKey,
    requested_squad_size: input.squadSize ?? 16,
  });
  if (error) throw new Error(error.message);
  return { membershipId: data.membershipId, squad: data.squad as InitialSquad };
}

export async function allocateNexoMarketRoster(input: { membershipId: string; targetValue: number; squadSize: number; idempotencyKey: string }): Promise<InitialSquad> {
  const client = requireClient();
  const { data, error } = await client.rpc("allocate_my_market_roster", {
    membership_id: input.membershipId,
    requested_target_value: input.targetValue,
    requested_squad_size: input.squadSize,
    request_key: input.idempotencyKey,
  });
  if (error) throw new Error(error.message);
  return data.squad as InitialSquad;
}

export async function cancelNexoLeagueReservation(reservationId: string): Promise<void> {
  const client = requireClient();
  await client.rpc("cancel_league_reservation", { reservation_id: reservationId });
}

export async function previewNexoPrivateLeague(accessCode: string): Promise<DirectoryRow | null> {
  const client = requireClient();
  const { data, error } = await client.rpc("preview_private_league", { access_code: accessCode });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as DirectoryRow | undefined) ?? null;
}

export async function createNexoPrivateLeague(input: { name: string; teamId: string; capacity: number; rules: Record<string, unknown> }): Promise<{ leagueId: string; membershipId: string; accessCode: string; squad: InitialSquad }> {
  const client = requireClient();
  const { data, error } = await client.rpc("create_private_league", {
    league_name: input.name,
    selected_team_id: input.teamId,
    requested_capacity: input.capacity,
    requested_rules: input.rules,
  });
  if (error) throw new Error(error.message);
  return { leagueId: data.leagueId, membershipId: data.membershipId, accessCode: data.accessCode, squad: data.squad as InitialSquad };
}

export async function leaveNexoLeague(leagueId: string, successorMembershipId?: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("leave_my_league", { target_league_id: leagueId, successor_membership_id: successorMembershipId ?? null });
  if (error) throw new Error(error.message);
}
