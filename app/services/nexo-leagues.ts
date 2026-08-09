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

type RosterRow = {
  membership_id: string;
  roster_id: string;
  squad: InitialSquad;
};

type PrivateAdminRow = {
  league_id: string;
  access_code: string;
  rules: Record<string, unknown>;
  join_locked: boolean;
  capacity: number;
};

export type NexoLeagueRankingRow = {
  membershipId: string;
  leagueId: string;
  userId: string;
  teamId: string;
  teamName: string;
  teamShortName: string;
  managerName: string;
  initials: string;
  role: "admin" | "member";
  totalPoints: number;
  matchdayPoints: number;
  totalValue: number;
  position: number;
  squad?: InitialSquad;
};

type RankingRow = {
  membership_id: string; league_id: string; user_id: string; team_id: string;
  team_name: string; team_short_name: string; manager_name: string; initials: string;
  member_role: "admin" | "member"; total_points: number; matchday_points: number;
  total_value: number; ranking_position: number; squad?: InitialSquad | null;
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

export async function loadNexoLeagueState(): Promise<{ publicLeagues: PublicLeagueSummary[]; leagues: LeagueSummary[]; participations: LeagueParticipation[]; adminLeagueIds: string[]; privateLeagueRules: Record<string, Record<string, unknown>>; rankings: Record<string, NexoLeagueRankingRow[]>; squads: Record<string, InitialSquad> }> {
  const client = requireClient();
  const [{ data: directory, error: directoryError }, { data: memberships, error: membershipsError }, { data: rosters, error: rostersError }, { data: privateAdmin, error: privateAdminError }, { data: rankings, error: rankingsError }] = await Promise.all([
    client.rpc("league_directory"),
    client.rpc("my_league_memberships"),
    client.rpc("my_market_rosters"),
    client.rpc("my_private_league_admin_details"),
    client.rpc("my_league_rankings"),
  ]);
  if (directoryError) throw directoryError;
  if (membershipsError) throw membershipsError;
  if (rostersError) throw rostersError;
  if (privateAdminError) throw privateAdminError;
  if (rankingsError) throw rankingsError;
  const rows = (directory ?? []) as DirectoryRow[];
  const mine = (memberships ?? []) as MembershipRow[];
  const myRosters = (rosters ?? []) as RosterRow[];
  const privateAdminRows = (privateAdmin ?? []) as PrivateAdminRow[];
  const rankingRows = ((rankings ?? []) as RankingRow[]).map((row): NexoLeagueRankingRow => ({
    membershipId: row.membership_id, leagueId: row.league_id, userId: row.user_id,
    teamId: row.team_id, teamName: row.team_name, teamShortName: row.team_short_name,
    managerName: row.manager_name, initials: row.initials, role: row.member_role,
    totalPoints: Number(row.total_points), matchdayPoints: Number(row.matchday_points),
    totalValue: Number(row.total_value), position: Number(row.ranking_position), squad: row.squad ?? undefined,
  }));
  const rosterByMembership = new Map(myRosters.map((row) => [row.membership_id, row]));
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
      rosterId: rosterByMembership.get(row.membership_id)?.roster_id ?? `roster_${row.membership_id}`,
      budget: Number(row.budget),
    })),
    adminLeagueIds: mine.filter((row) => row.role === "admin").map((row) => row.league_id),
    privateLeagueRules: Object.fromEntries(privateAdminRows.map((row) => [row.league_id, {
      ...row.rules,
      accessCode: row.access_code,
      joinLocked: row.join_locked,
      capacity: row.capacity,
      version: Number(row.rules.version ?? 1),
      updatedAt: Date.now(),
    }])),
    rankings: Object.fromEntries([...new Set(rankingRows.map((row) => row.leagueId))].map((leagueId) => [leagueId, rankingRows.filter((row) => row.leagueId === leagueId)])),
    squads: Object.fromEntries(myRosters.map((row) => [row.membership_id, row.squad])),
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

export async function updateNexoPrivateLeague(input: { leagueId: string; name: string; capacity: number; joinLocked: boolean; rules: Record<string, unknown> }): Promise<void> {
  const { error } = await requireClient().rpc("update_my_private_league", {
    target_league_id: input.leagueId,
    new_name: input.name,
    new_capacity: input.capacity,
    new_join_locked: input.joinLocked,
    new_rules: input.rules,
  });
  if (error) throw new Error(error.message);
}

export async function regenerateNexoPrivateLeagueCode(leagueId: string): Promise<string> {
  const { data, error } = await requireClient().rpc("regenerate_my_private_league_code", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function leaveNexoLeague(leagueId: string, successorMembershipId?: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("leave_my_league", { target_league_id: leagueId, successor_membership_id: successorMembershipId ?? null });
  if (error) throw new Error(error.message);
}
