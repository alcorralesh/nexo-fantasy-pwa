import type { CompetitionName } from "../data";
import { getSupabaseClient } from "../lib/supabase-client";

const competitionNames: Record<string, CompetitionName> = { primera: "Primera", segunda: "Segunda", liga_f: "Liga F" };
const calendarCacheKey = "nexo_match_calendar_2026_27_v2";
const calendarCacheLifetime = 30 * 60 * 1000;
const calendarPageSize = 1000;

export type MatchFixture = {
  id: string;
  providerId: string;
  competition: CompetitionName;
  season: string;
  matchday: number;
  home: string;
  away: string;
  homeShortName: string;
  awayShortName: string;
  homeBadgeUrl?: string;
  awayBadgeUrl?: string;
  kickoffAt?: string;
  kickoffConfirmed: boolean;
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
  homeScore?: number;
  awayScore?: number;
  venue?: string;
};

export type CalendarSyncSummary = { total: number; competitions: Record<"primera" | "segunda" | "liga_f", number>; scheduled: number; live: number; final: number; changed: number };
export type CalendarSyncResult = { jobId: string; mode: "preview" | "apply"; season: string; summary: CalendarSyncSummary };
export type CalendarSyncJob = { id: string; mode: "preview" | "apply"; status: "running" | "succeeded" | "failed"; season: string; summary: Partial<CalendarSyncSummary>; error_message: string | null; started_at: string; finished_at: string | null };

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado.");
  return client;
}

export async function loadNexoMatchCalendar(): Promise<MatchFixture[]> {
  if (typeof window !== "undefined") {
    try {
      const cached = JSON.parse(window.localStorage.getItem(calendarCacheKey) ?? "null") as { expiresAt: number; fixtures: MatchFixture[] } | null;
      if (cached && cached.expiresAt > Date.now()) return cached.fixtures;
    } catch { /* La caché se sustituye con datos del backend. */ }
  }
  const client = requireClient();
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += calendarPageSize) {
    const { data, error } = await client
      .from("match_fixtures")
      .select("id,provider_id,competition_id,season,matchday,home_club_name,away_club_name,home_short_name,away_short_name,home_badge_url,away_badge_url,kickoff_at,kickoff_confirmed,status,home_score,away_score,venue")
      .eq("season", "2026")
      .order("competition_id")
      .order("matchday")
      .order("kickoff_at")
      .range(from, from + calendarPageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < calendarPageSize) break;
  }
  const fixtures: MatchFixture[] = rows.map((row) => ({
    id: row.id, providerId: row.provider_id, competition: competitionNames[row.competition_id] ?? "Primera",
    season: row.season, matchday: row.matchday, home: row.home_club_name, away: row.away_club_name,
    homeShortName: row.home_short_name, awayShortName: row.away_short_name,
    homeBadgeUrl: row.home_badge_url ?? undefined, awayBadgeUrl: row.away_badge_url ?? undefined,
    kickoffAt: row.kickoff_at ?? undefined, kickoffConfirmed: row.kickoff_confirmed, status: row.status,
    homeScore: row.home_score ?? undefined, awayScore: row.away_score ?? undefined, venue: row.venue ?? undefined,
  }));
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(calendarCacheKey, JSON.stringify({ expiresAt: Date.now() + calendarCacheLifetime, fixtures })); } catch { /* La respuesta sigue en memoria. */ }
  }
  return fixtures;
}

export async function runNexoCalendarSync(mode: "preview" | "apply"): Promise<CalendarSyncResult> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke("sync-match-calendar", { body: { mode } });
  if (error) {
    let message = (data as { error?: string } | null)?.error ?? error.message;
    const response = (error as { context?: Response }).context;
    if (response) {
      try {
        const payload = await response.clone().json() as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // Conservamos el mensaje de Supabase cuando la respuesta no contiene JSON.
      }
    }
    throw new Error(message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  if (mode === "apply" && typeof window !== "undefined") window.localStorage.removeItem(calendarCacheKey);
  return data as CalendarSyncResult;
}

export async function loadNexoCalendarSyncHistory(): Promise<CalendarSyncJob[]> {
  const client = requireClient();
  const { data, error } = await client.from("calendar_sync_jobs").select("id,mode,status,season,summary,error_message,started_at,finished_at").order("started_at", { ascending: false }).limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []) as CalendarSyncJob[];
}
