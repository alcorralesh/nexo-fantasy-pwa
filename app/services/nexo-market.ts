import { getSupabaseClient } from "../lib/supabase-client";
import type { PlayerPosition } from "../data";

export type NexoMarketListing = {
  listingId: string;
  playerId: string;
  name: string;
  initials: string;
  position: PlayerPosition;
  club: string;
  price: number;
  photoUrl?: string;
  listedAt: string;
};

export type NexoMarketBid = {
  bidId: string;
  listingId: string;
  playerId: string;
  amount: number;
  placedAt: string;
};

export type NexoLeagueMarket = {
  leagueId: string;
  membershipId: string;
  cycleNumber: number;
  cycleStartedAt: string;
  lastRenewedAt?: string;
  nextRenewalAt: string;
  intervalHours: number;
  nextIntervalHours: number;
  listings: NexoMarketListing[];
  myBids: NexoMarketBid[];
};

export type NexoMarketHistoryEntry = {
  id: string;
  eventType: "bid" | "offer" | "transfer" | "clause" | "clause_raise" | "blindage" | "sale";
  direction: "made" | "received" | "system";
  title: string;
  detail: string;
  playerName: string;
  amount?: number;
  status: "active" | "completed" | "rejected" | "cancelled" | "expired";
  occurredAt: string;
};

export type NexoLeagueActivityEntry = {
  id: string;
  activityType: "transfer" | "market" | "membership" | "clause" | "clause_raise" | "blindage" | "sale";
  actor: string;
  initials: string;
  title: string;
  detail: string;
  occurredAt: string;
};

export type NexoUserMarketListing = {
  listingId: string;
  playerId: string;
  name: string;
  initials: string;
  position: PlayerPosition;
  club: string;
  marketValue: number;
  askingPrice: number;
  sellerMembershipId: string;
  sellerTeamName: string;
  sellerName: string;
  photoUrl?: string;
  listedAt: string;
  mine: boolean;
};

export type NexoUserMarketOffer = {
  offerId: string;
  listingId: string;
  playerId: string;
  amount: number;
  status: "active" | "accepted" | "rejected" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  bidderMembershipId?: string;
  bidderTeamName?: string;
  bidderName?: string;
  bidderInitials?: string;
  playerName?: string;
  sellerMembershipId?: string;
  sellerTeamName?: string;
};

export type NexoLeagueUserMarket = {
  leagueId: string;
  membershipId: string;
  listings: NexoUserMarketListing[];
  receivedOffers: NexoUserMarketOffer[];
  sentOffers: NexoUserMarketOffer[];
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function loadNexoLeagueMarket(leagueId: string): Promise<NexoLeagueMarket> {
  const { data, error } = await requireClient().rpc("my_league_market", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  return mapMarket(data as Record<string, unknown>);
}

export async function loadNexoLeagueMarketHistory(leagueId: string): Promise<NexoMarketHistoryEntry[]> {
  const { data, error } = await requireClient().rpc("my_league_market_history", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    eventType: row.event_type as NexoMarketHistoryEntry["eventType"],
    direction: row.direction as NexoMarketHistoryEntry["direction"],
    title: String(row.title),
    detail: String(row.detail),
    playerName: String(row.player_name),
    amount: row.amount === null || row.amount === undefined ? undefined : Number(row.amount),
    status: row.status as NexoMarketHistoryEntry["status"],
    occurredAt: String(row.occurred_at),
  }));
}

export async function loadNexoLeagueActivity(leagueId: string): Promise<NexoLeagueActivityEntry[]> {
  const { data, error } = await requireClient().rpc("my_league_activity", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    activityType: row.activity_type as NexoLeagueActivityEntry["activityType"],
    actor: String(row.actor),
    initials: String(row.initials),
    title: String(row.title),
    detail: String(row.detail),
    occurredAt: String(row.occurred_at),
  }));
}

export async function loadNexoLeagueUserMarket(leagueId: string): Promise<NexoLeagueUserMarket> {
  const { data, error } = await requireClient().rpc("my_league_user_market", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    leagueId: String(row.leagueId),
    membershipId: String(row.membershipId),
    listings: ((row.listings ?? []) as Record<string, unknown>[]).map(mapUserListing),
    receivedOffers: ((row.receivedOffers ?? []) as Record<string, unknown>[]).map(mapUserOffer),
    sentOffers: ((row.sentOffers ?? []) as Record<string, unknown>[]).map(mapUserOffer),
  };
}

export async function listNexoRosterPlayer(leagueId: string, playerId: string, askingPrice: number): Promise<string> {
  const { data, error } = await requireClient().rpc("list_my_roster_player", { target_league_id: leagueId, target_player_id: playerId, target_asking_price: askingPrice });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function withdrawNexoUserListing(listingId: string): Promise<void> {
  const { error } = await requireClient().rpc("withdraw_my_user_listing", { target_listing_id: listingId });
  if (error) throw new Error(error.message);
}

export async function placeNexoUserMarketOffer(listingId: string, amount: number): Promise<string> {
  const { data, error } = await requireClient().rpc("place_my_user_market_offer", { target_listing_id: listingId, target_amount: amount });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function cancelNexoUserMarketOffer(offerId: string): Promise<void> {
  const { error } = await requireClient().rpc("cancel_my_user_market_offer", { target_offer_id: offerId });
  if (error) throw new Error(error.message);
}

export async function respondNexoUserMarketOffer(offerId: string, accept: boolean): Promise<void> {
  const { error } = await requireClient().rpc("respond_to_my_user_market_offer", { target_offer_id: offerId, accept_offer: accept });
  if (error) throw new Error(error.message);
}

export async function placeNexoMarketBid(listingId: string, amount: number): Promise<NexoMarketBid> {
  const { data, error } = await requireClient().rpc("place_my_market_bid", { target_listing_id: listingId, target_amount: amount });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    bidId: String(row.bidId),
    listingId: String(row.listingId),
    playerId: String(row.playerId),
    amount: Number(row.amount),
    placedAt: String(row.placedAt),
  };
}

export async function cancelNexoMarketBid(listingId: string): Promise<void> {
  const { error } = await requireClient().rpc("cancel_my_market_bid", { target_listing_id: listingId });
  if (error) throw new Error(error.message);
}

export async function forceNexoMarketRenewal(leagueId: string): Promise<{ cycleNumber: number; transfers: number; unsold: number; listings: number; nextRenewalAt: string; intervalHours: number }> {
  const { data, error } = await requireClient().rpc("admin_renew_league_market", { target_league_id: leagueId });
  if (error) throw new Error(error.message);
  const result = data as Record<string, unknown>;
  return {
    cycleNumber: Number(result.cycleNumber),
    transfers: Number(result.transfers),
    unsold: Number(result.unsold),
    listings: Number(result.listings),
    nextRenewalAt: String(result.nextRenewalAt),
    intervalHours: Number(result.intervalHours),
  };
}

function mapMarket(row: Record<string, unknown>): NexoLeagueMarket {
  return {
    leagueId: String(row.leagueId),
    membershipId: String(row.membershipId),
    cycleNumber: Number(row.cycleNumber),
    cycleStartedAt: String(row.cycleStartedAt),
    lastRenewedAt: row.lastRenewedAt ? String(row.lastRenewedAt) : undefined,
    nextRenewalAt: String(row.nextRenewalAt),
    intervalHours: Number(row.intervalHours),
    nextIntervalHours: Number(row.nextIntervalHours),
    listings: ((row.listings ?? []) as Record<string, unknown>[]).map((listing) => ({
      listingId: String(listing.listingId),
      playerId: String(listing.playerId),
      name: String(listing.name),
      initials: String(listing.initials),
      position: listing.position as PlayerPosition,
      club: String(listing.club),
      price: Number(listing.price),
      photoUrl: listing.photoUrl ? String(listing.photoUrl) : undefined,
      listedAt: String(listing.listedAt),
    })),
    myBids: ((row.myBids ?? []) as Record<string, unknown>[]).map((bid) => ({
      bidId: String(bid.bidId),
      listingId: String(bid.listingId),
      playerId: String(bid.playerId),
      amount: Number(bid.amount),
      placedAt: String(bid.placedAt),
    })),
  };
}

function mapUserListing(row: Record<string, unknown>): NexoUserMarketListing {
  return {
    listingId: String(row.listingId), playerId: String(row.playerId), name: String(row.name), initials: String(row.initials),
    position: row.position as PlayerPosition, club: String(row.club), marketValue: Number(row.marketValue), askingPrice: Number(row.askingPrice),
    sellerMembershipId: String(row.sellerMembershipId), sellerTeamName: String(row.sellerTeamName), sellerName: String(row.sellerName),
    photoUrl: row.photoUrl ? String(row.photoUrl) : undefined, listedAt: String(row.listedAt), mine: Boolean(row.mine),
  };
}

function mapUserOffer(row: Record<string, unknown>): NexoUserMarketOffer {
  return {
    offerId: String(row.offerId), listingId: String(row.listingId), playerId: String(row.playerId), amount: Number(row.amount),
    status: row.status as NexoUserMarketOffer["status"], createdAt: String(row.createdAt), expiresAt: String(row.expiresAt),
    resolvedAt: row.resolvedAt ? String(row.resolvedAt) : undefined,
    bidderMembershipId: row.bidderMembershipId ? String(row.bidderMembershipId) : undefined,
    bidderTeamName: row.bidderTeamName ? String(row.bidderTeamName) : undefined,
    bidderName: row.bidderName ? String(row.bidderName) : undefined,
    bidderInitials: row.bidderInitials ? String(row.bidderInitials) : undefined,
    playerName: row.playerName ? String(row.playerName) : undefined,
    sellerMembershipId: row.sellerMembershipId ? String(row.sellerMembershipId) : undefined,
    sellerTeamName: row.sellerTeamName ? String(row.sellerTeamName) : undefined,
  };
}
