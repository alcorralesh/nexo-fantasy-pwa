import { getSupabaseClient } from "../lib/supabase-client";

export type NexoPlayerContract = {
  playerId: string;
  ownerMembershipId: string;
  ownerTeamName: string;
  mine: boolean;
  clause: number;
  blindUntil?: string;
  marketValue: number;
  isStarter: boolean;
  availabilityStatus: "active" | "out_of_competition" | "changed_competition";
};

export type NexoContractRules = {
  clausesEnabled: boolean;
  clauseMultiplier: number;
  clauseCutoffHours: number;
  clauseRaiseCostPercent: number;
  blindagesEnabled: boolean;
  blindageDurationHours: number;
  immediateSaleEnabled: boolean;
  immediateSalePercent: number;
  realExitSalePercent: number;
  maxBenchPlayers: number;
};

export type NexoLeagueContracts = {
  leagueId: string;
  membershipId: string;
  budget: number;
  rules: NexoContractRules;
  clauseCutoffAt?: string;
  contracts: NexoPlayerContract[];
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase no esta configurado");
  return client;
}

export async function loadNexoLeagueContracts(leagueId: string): Promise<NexoLeagueContracts> {
  const { data, error } = await requireClient().rpc("my_league_player_contracts", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  const rules = row.rules as Record<string, unknown>;
  return {
    leagueId: String(row.leagueId), membershipId: String(row.membershipId), budget: Number(row.budget),
    clauseCutoffAt: row.clauseCutoffAt ? String(row.clauseCutoffAt) : undefined,
    rules: {
      clausesEnabled: Boolean(rules.clausesEnabled), clauseMultiplier: Number(rules.clauseMultiplier),
      clauseCutoffHours: Number(rules.clauseCutoffHours), clauseRaiseCostPercent: Number(rules.clauseRaiseCostPercent),
      blindagesEnabled: Boolean(rules.blindagesEnabled), blindageDurationHours: Number(rules.blindageDurationHours),
      immediateSaleEnabled: Boolean(rules.immediateSaleEnabled), immediateSalePercent: Number(rules.immediateSalePercent),
      realExitSalePercent: Number(rules.realExitSalePercent ?? 100),
      maxBenchPlayers: Number(rules.maxBenchPlayers),
    },
    contracts: ((row.contracts ?? []) as Record<string, unknown>[]).map((contract) => ({
      playerId: String(contract.playerId), ownerMembershipId: String(contract.ownerMembershipId),
      ownerTeamName: String(contract.ownerTeamName), mine: Boolean(contract.mine), clause: Number(contract.clause),
      blindUntil: contract.blindUntil ? String(contract.blindUntil) : undefined,
      marketValue: Number(contract.marketValue), isStarter: Boolean(contract.isStarter),
      availabilityStatus: String(contract.availabilityStatus ?? "active") as NexoPlayerContract["availabilityStatus"],
    })),
  };
}

export async function raiseNexoPlayerClause(leagueId: string, playerId: string, clause: number) {
  const { data, error } = await requireClient().rpc("raise_my_player_clause", { target_league_id: leagueId, target_player_id: playerId, target_clause: clause });
  if (error) throw new Error(error.message);
  return data as { clause: number; cost: number; budget: number };
}

export async function setNexoPlayerBlindage(leagueId: string, playerId: string, enabled: boolean) {
  const { data, error } = await requireClient().rpc("set_my_player_blindage", { target_league_id: leagueId, target_player_id: playerId, enabled });
  if (error) throw new Error(error.message);
  return data as { blindUntil?: string; durationHours: number };
}

export async function buyNexoPlayerClause(leagueId: string, playerId: string) {
  const { data, error } = await requireClient().rpc("buy_player_clause", { target_league_id: leagueId, target_player_id: playerId });
  if (error) throw new Error(error.message);
  return data as { playerId: string; amount: number; buyerBudget: number; sellerMembershipId: string };
}

export async function sellNexoPlayerImmediately(leagueId: string, playerId: string) {
  const { data, error } = await requireClient().rpc("sell_my_player_immediately", { target_league_id: leagueId, target_player_id: playerId });
  if (error) throw new Error(error.message);
  return data as { playerId: string; amount: number; budget: number; protectedExit?: boolean };
}
