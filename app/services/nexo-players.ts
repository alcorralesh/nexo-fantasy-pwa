import type { CompetitionName } from "../data";
import type { CompetitionPlayer } from "../data/competition-players";
import { getSupabaseClient } from "../lib/supabase-client";

const competitionNames: Record<string, CompetitionName> = { primera: "Primera", segunda: "Segunda", liga_f: "Liga F" };
const catalogCacheKey = "nexo_player_catalog_2026_27_v3";
const catalogCacheLifetime = 6 * 60 * 60 * 1000;

export type CatalogSyncSummary = {
  additions: number;
  updates: number;
  deactivations: number;
  reactivations?: number;
  competitionChanges?: number;
  clubChanges?: number;
  positionChanges?: number;
  unchanged: number;
  total: number;
  competitions: Record<"primera" | "segunda" | "liga_f", number>;
  reconciliation?: {
    systemListingsCancelled: number;
    systemBidsCancelled: number;
    userListingsCancelled: number;
    userOffersCancelled: number;
    directOffersCancelled: number;
    lineupsRequiringReview: number;
  };
};

export type CatalogSyncResult = { jobId: string; mode: "preview" | "apply"; catalogVersion: string; summary: CatalogSyncSummary };
export type CatalogSyncJob = { id: string; mode: "preview" | "apply"; status: "running" | "succeeded" | "failed"; catalog_version: string | null; summary: Partial<CatalogSyncSummary>; error_message: string | null; started_at: string; finished_at: string | null };
export type NexoPlayerMatchdayPoints = Record<string,number>;

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function loadNexoPlayerCatalog(): Promise<Record<CompetitionName, CompetitionPlayer[]>> {
  if (typeof window !== "undefined") {
    try {
      const cached = JSON.parse(window.localStorage.getItem(catalogCacheKey) ?? "null") as { expiresAt: number; catalog: Record<CompetitionName, CompetitionPlayer[]> } | null;
      if (cached && cached.expiresAt > Date.now()) return cached.catalog;
    } catch { /* Una caché dañada se sustituye con la respuesta del backend. */ }
  }
  const client = requireClient();
  type CatalogRow={id:string;competition_id:string;name:string;initials:string;position:CompetitionPlayer["position"];market_value:number|string;catalog_version:string;photo_url:string|null;sports_clubs:{name:string}|null};
  const rows:CatalogRow[]=[];
  const pageSize=1000;
  for(let from=0;;from+=pageSize){
    const {data,error}=await client.from("players").select("id,competition_id,name,initials,position,market_value,catalog_version,photo_url,sports_clubs(name)").eq("active",true).order("name").range(from,from+pageSize-1);
    if(error)throw error;
    const page=(data??[]) as unknown as CatalogRow[];
    rows.push(...page);
    if(page.length<pageSize)break;
  }
  const catalog: Record<CompetitionName, CompetitionPlayer[]> = { Primera: [], Segunda: [], "Liga F": [] };
  for (const row of rows) {
    const competition = competitionNames[row.competition_id] ?? "Primera";
    const clubRelation = row.sports_clubs as unknown as { name: string } | null;
    catalog[competition].push({
      id: row.id,
      name: row.name,
      initials: row.initials,
      position: row.position,
      value: Number(row.market_value),
      club: clubRelation?.name ?? "Sin club",
      competition,
      catalogVersion: row.catalog_version,
      photoUrl: row.photo_url ?? undefined,
    });
  }
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(catalogCacheKey, JSON.stringify({ expiresAt: Date.now() + catalogCacheLifetime, catalog })); }
    catch { /* El catálogo sigue disponible en memoria si el dispositivo no admite más almacenamiento. */ }
  }
  return catalog;
}

export async function loadNexoAdminPlayerCatalog(): Promise<Record<CompetitionName, CompetitionPlayer[]>> {
  const client = requireClient();
  type CatalogRow={id:string;competition_id:string;name:string;initials:string;position:CompetitionPlayer["position"];market_value:number|string;catalog_version:string;photo_url:string|null;active:boolean;sports_clubs:{name:string}|null};
  const rows: CatalogRow[] = [];
  const pageSize = 1000;
  for (let from = 0;; from += pageSize) {
    const { data, error } = await client.from("players").select("id,competition_id,name,initials,position,market_value,catalog_version,photo_url,active,sports_clubs(name)").order("name").range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as CatalogRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const catalog: Record<CompetitionName, CompetitionPlayer[]> = { Primera: [], Segunda: [], "Liga F": [] };
  for (const row of rows) {
    const competition = competitionNames[row.competition_id] ?? "Primera";
    catalog[competition].push({ id:row.id,name:row.name,initials:row.initials,position:row.position,value:Number(row.market_value),club:row.sports_clubs?.name ?? "Sin club",competition,catalogVersion:row.catalog_version,photoUrl:row.photo_url ?? undefined,active:row.active });
  }
  return catalog;
}

export async function updateNexoPlayer(player: CompetitionPlayer, active = player.active ?? true): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("update_player_catalog_entry", {
    target_player_id: player.id,
    new_name: player.name,
    new_position: player.position,
    new_market_value: player.value,
    new_active: active,
    new_competition_id: player.competition === "Primera" ? "primera" : player.competition === "Segunda" ? "segunda" : "liga_f",
    new_club_name: player.club,
    new_photo_url: player.photoUrl ?? null,
  });
  if (error) throw new Error(error.message);
  if (typeof window !== "undefined") window.localStorage.removeItem(catalogCacheKey);
}

export async function runNexoPlayerCatalogSync(mode: "preview" | "apply"): Promise<CatalogSyncResult> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("sync-player-catalog", { body: { mode } });
  if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message);
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  if (mode === "apply" && typeof window !== "undefined") window.localStorage.removeItem(catalogCacheKey);
  return data as CatalogSyncResult;
}

export async function loadNexoPlayerCatalogSyncHistory(): Promise<CatalogSyncJob[]> {
  const client = requireClient();
  const { data, error } = await client.from("player_catalog_sync_jobs").select("id,mode,status,catalog_version,summary,error_message,started_at,finished_at").order("started_at", { ascending: false }).limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogSyncJob[];
}

export async function loadNexoPlayerMatchdayPoints(competition:CompetitionName,matchday:number):Promise<NexoPlayerMatchdayPoints>{
  const competitionId=competition==="Primera"?"primera":competition==="Segunda"?"segunda":"liga_f";
  const {data,error}=await requireClient().rpc("admin_player_matchday_points",{target_competition_id:competitionId,target_matchday:matchday});
  if(error)throw new Error(error.message);
  return Object.fromEntries(((data??[]) as {player_id:string;points:number|string}[]).map((row)=>[row.player_id,Number(row.points)]));
}
