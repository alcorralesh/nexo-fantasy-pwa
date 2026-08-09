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
