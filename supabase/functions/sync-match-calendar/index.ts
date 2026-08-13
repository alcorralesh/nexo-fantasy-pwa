import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SourceTeam = { id?: number; nickname?: string; boundname?: string; name?: string; shortname?: string; shield?: { url?: string } };
type SourceMatch = { id: number; date?: string; time?: string; status?: string; home_team: SourceTeam; away_team: SourceTeam; venue?: { name?: string }; home_score?: number; away_score?: number; score?: { home?: number; away?: number }; result?: { home?: number; away?: number } };
type Fixture = { provider_id: string; competition_id: string; season: string; matchday: number; home_club_name: string; away_club_name: string; home_short_name: string; away_short_name: string; home_badge_url: string | null; away_badge_url: string | null; kickoff_at: string | null; kickoff_confirmed: boolean; status: string; home_score: number | null; away_score: number | null; venue: string | null; source_name: string };

const allowedOrigins = new Set(["https://alcorralesh.github.io", "http://localhost:3000"]);
const season = "2026";
const seasonRoute = "2026-27";
const competitions = [
  { id: "primera", slug: "laliga-easports", rounds: 38 },
  { id: "segunda", slug: "laliga-hypermotion", rounds: 42 },
  { id: "liga_f", slug: "futbol-femenino", rounds: 30 },
] as const;

function responseHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return { "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://alcorralesh.github.io", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", "Vary": "Origin" };
}
function json(request: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...responseHeaders(request), "Content-Type": "application/json" } }); }
const retryableSourceStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const sourceRequestAttempts = 4;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getText(url: string) {
  let lastError = "Error desconocido";
  for (let attempt = 1; attempt <= sourceRequestAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "accept-language": "es-ES,es;q=0.9",
          "user-agent": "NexoFantasyCalendar/1.1",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response.text();
      lastError = `${response.status} al consultar ${url}`;
      if (!retryableSourceStatuses.has(response.status) || attempt === sourceRequestAttempts) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1_000, 15_000)
        : 700 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 350);
      await response.body?.cancel();
      await wait(delay);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "La fuente oficial no respondió";
      if (attempt === sourceRequestAttempts) break;
      await wait(700 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 350));
    }
  }
  throw new Error(`La fuente oficial no respondió tras ${sourceRequestAttempts} intentos: ${lastError}`);
}
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) { const output = new Array<R>(items.length); let cursor = 0; async function next() { while (cursor < items.length) { const index = cursor++; output[index] = await worker(items[index]); } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next)); return output; }
function name(team: SourceTeam) { return team.nickname ?? team.boundname ?? team.name ?? "Equipo pendiente"; }
function matchStatus(value = "") { const normalized = value.toLowerCase(); if (normalized.includes("postpon") || normalized.includes("suspend")) return "postponed"; if (normalized.includes("cancel")) return "cancelled"; if (normalized.includes("live") || normalized.includes("playing") || normalized.includes("half")) return "live"; if (normalized.includes("postmatch") || normalized.includes("finish") || normalized.includes("final")) return "final"; return "scheduled"; }
function score(match: SourceMatch, side: "home" | "away") { const value = side === "home" ? match.home_score ?? match.score?.home ?? match.result?.home : match.away_score ?? match.score?.away ?? match.result?.away; return Number.isFinite(value) ? Number(value) : null; }
function fixture(match: SourceMatch, competitionId: string, matchday: number): Fixture {
  const kickoff = match.date ?? match.time ?? null;
  const kickoffDate = kickoff ? new Date(kickoff) : null;
  const kickoffConfirmed = Boolean(kickoffDate && !Number.isNaN(kickoffDate.getTime()) && !(kickoffDate.getUTCHours() === 0 && kickoffDate.getUTCMinutes() === 0));
  return { provider_id: String(match.id), competition_id: competitionId, season, matchday, home_club_name: name(match.home_team), away_club_name: name(match.away_team), home_short_name: match.home_team.shortname ?? "", away_short_name: match.away_team.shortname ?? "", home_badge_url: match.home_team.shield?.url ?? null, away_badge_url: match.away_team.shield?.url ?? null, kickoff_at: kickoffDate && !Number.isNaN(kickoffDate.getTime()) ? kickoffDate.toISOString() : null, kickoff_confirmed: kickoffConfirmed, status: matchStatus(match.status), home_score: score(match, "home"), away_score: score(match, "away"), venue: match.venue?.name ?? null, source_name: "LALIGA" };
}

async function loadRound(competition: typeof competitions[number], matchday: number) {
  const url = `https://www.laliga.com/${competition.slug}/resultados/${seasonRoute}/jornada-${matchday}`;
  const html = await getText(url);
  const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error(`${competition.id}/J${matchday}: no se encontró el calendario`);
  const matches = JSON.parse(raw)?.props?.pageProps?.matches as SourceMatch[] | undefined;
  const expected = competition.id === "segunda" ? 11 : competition.id === "liga_f" ? 8 : 10;
  if (!Array.isArray(matches) || matches.length !== expected) throw new Error(`${competition.id}/J${matchday}: se esperaban ${expected} partidos y llegaron ${matches?.length ?? 0}`);
  return matches.map((match) => fixture(match, competition.id, matchday));
}

function summarize(fixtures: Fixture[], existing: Array<Record<string, unknown>>) {
  const current = new Map(existing.map((row) => [String(row.provider_id), row]));
  let changed = 0;
  for (const item of fixtures) {
    const row = current.get(item.provider_id);
    if (!row || row.kickoff_at !== item.kickoff_at || row.status !== item.status || row.home_score !== item.home_score || row.away_score !== item.away_score) changed++;
  }
  return { total: fixtures.length, competitions: { primera: fixtures.filter((item) => item.competition_id === "primera").length, segunda: fixtures.filter((item) => item.competition_id === "segunda").length, liga_f: fixtures.filter((item) => item.competition_id === "liga_f").length }, scheduled: fixtures.filter((item) => item.status === "scheduled").length, live: fixtures.filter((item) => item.status === "live").length, final: fixtures.filter((item) => item.status === "final").length, changed };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  if (origin && !allowedOrigins.has(origin)) return json(request, { error: "Origen no permitido" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método no permitido" }, 405);
  let jobId: string | null = null; let admin: ReturnType<typeof createClient> | null = null;
  try {
    const url = Deno.env.get("SUPABASE_URL")!; const anon = Deno.env.get("SUPABASE_ANON_KEY")!; const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(request, { error: "Debes iniciar sesión" }, 401);
    const { data: profile } = await userClient.from("profiles").select("id,role").eq("id", user.id).single();
    if (profile?.role !== "admin") return json(request, { error: "Acceso reservado a administradores" }, 403);
    admin = createClient(url, serviceKey); const body = await request.json().catch(() => ({})); const mode = body.mode === "apply" ? "apply" : "preview";
    const { data: job, error: jobError } = await admin.from("calendar_sync_jobs").insert({ requested_by: user.id, mode, season }).select("id").single();
    if (jobError) return json(request, { error: jobError.code === "23505" ? "Ya hay una sincronización en curso" : jobError.message }, jobError.code === "23505" ? 409 : 500);
    jobId = job.id;
    const tasks = competitions.flatMap((competition) => Array.from({ length: competition.rounds }, (_, index) => ({ competition, matchday: index + 1 })));
    // LALIGA puede responder con 429/502 cuando recibe demasiadas peticiones simultáneas.
    // Se limita la concurrencia para que la sincronización completa sea estable también en el plan gratuito.
    const rounds = await mapLimit(tasks, 6, ({ competition, matchday }) => loadRound(competition, matchday));
    const fixtures = rounds.flat();
    const { data: existing, error: existingError } = await admin.from("match_fixtures").select("provider_id,kickoff_at,status,home_score,away_score").eq("season", season);
    if (existingError) throw existingError;
    const summary = summarize(fixtures, existing ?? []);
    if (mode === "apply") {
      const { data, error } = await admin.rpc("apply_match_calendar_snapshot", { target_job_id: jobId, target_season: season, snapshot: fixtures, target_summary: summary });
      if (error) throw error;
      return json(request, { jobId, mode, season, summary: data });
    }
    await admin.from("calendar_sync_jobs").update({ status: "succeeded", summary, finished_at: new Date().toISOString() }).eq("id", jobId);
    return json(request, { jobId, mode, season, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    if (admin && jobId) await admin.from("calendar_sync_jobs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", jobId);
    return json(request, { error: message }, 500);
  }
});
