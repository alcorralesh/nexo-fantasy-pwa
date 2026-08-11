import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Position = "POR" | "DEF" | "MED" | "DEL";
type Player = { provider_id: string; competition_id: string; player_name: string; position: Position; club_name: string; market_value: number; photo_url: string | null; source_name: string };
type ExistingPlayer = { provider_id: string; competition_id: string; name: string; position: Position; active: boolean; photo_url: string | null; sports_clubs: { name: string } | Array<{ name: string }> | null };

const allowedOrigins = new Set(["https://alcorralesh.github.io", "http://localhost:3000"]);
const season = "2026";
const competitionPages = [
  { id: "primera", url: "https://www.laliga.com/laliga-easports/clubes", clubs: 20 },
  { id: "segunda", url: "https://www.laliga.com/laliga-hypermotion/clubes", clubs: 22 },
];

function responseHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://alcorralesh.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}
function json(request: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...responseHeaders(request), "Content-Type": "application/json" } }); }
function decodeHtml(value: string) { return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ").replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/\s+/g, " ").trim(); }
function positionCode(value: string): Position { const normalized = value.toLocaleLowerCase("es"); if (normalized.includes("porter")) return "POR"; if (normalized.includes("defensa")) return "DEF"; if (normalized.includes("centro") || normalized.includes("medio")) return "MED"; if (normalized.includes("delanter")) return "DEL"; throw new Error(`Posición desconocida: ${value}`); }
function stableValue(id: string, position: Position) { const base = { POR: 5.8, DEF: 6.1, MED: 6.7, DEL: 7.1 }[position]; let hash = 0; for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0; return Math.round((base + ((hash % 9) - 4) / 10) * 10) / 10; }
async function getText(url: string) { const response = await fetch(url, { headers: { "user-agent": "NexoFantasyCatalog/1.0" } }); if (!response.ok) throw new Error(`${response.status} al consultar la fuente oficial`); return response.text(); }
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) { const output = new Array<R>(items.length); let cursor = 0; async function next() { while (cursor < items.length) { const index = cursor++; output[index] = await worker(items[index]); } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next)); return output; }

function laligaRuntime(html: string) {
  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
    ?? html.match(/<script[^>]*>(\{"props"[\s\S]*?"scriptLoader":\[\]\})<\/script>/i)?.[1];
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData.replace(/&quot;/g, '"'));
      if (parsed.runtimeConfig?.backendUrl && parsed.runtimeConfig?.backendSubscription) return parsed.runtimeConfig;
    } catch { /* La expresion regular de respaldo cubre HTML parcialmente escapado. */ }
  }
  const backendUrl = html.match(/(?:\\?"|&quot;)backendUrl(?:\\?"|&quot;):(?:\\?"|&quot;)(https?:[^"&\\]+)(?:\\?"|&quot;)/)?.[1];
  const backendSubscription = html.match(/(?:\\?"|&quot;)backendSubscription(?:\\?"|&quot;):(?:\\?"|&quot;)([^"&\\]+)(?:\\?"|&quot;)/)?.[1];
  return { backendUrl, backendSubscription };
}

async function loadLaliga(): Promise<Player[]> {
  const bootstrap = await getText("https://www.laliga.com/clubes/athletic-club/plantilla");
  const runtime = laligaRuntime(bootstrap);
  const backendUrl = runtime.backendUrl;
  const subscription = runtime.backendSubscription;
  if (!backendUrl || !subscription) throw new Error("No se pudo localizar el servicio público de LALIGA");
  const players: Player[] = [];
  for (const competition of competitionPages) {
    const listing = await getText(competition.url);
    const slugs = [...listing.matchAll(/href="\/clubes\/([^/"?#]+)(?:\/[^"#?]*)?"/g)].map((match) => match[1]).filter((slug, index, all) => all.indexOf(slug) === index);
    if (slugs.length !== competition.clubs) throw new Error(`${competition.id}: se esperaban ${competition.clubs} clubes y se encontraron ${slugs.length}`);
    const squads = await mapLimit(slugs, 7, async (slug) => {
      const params = new URLSearchParams({ limit: "60", offset: "0", orderField: "id", orderType: "DESC", seasonYear: season, contentLanguage: "es", countryCode: "ES", "subscription-key": subscription });
      const payload = JSON.parse(await getText(`${backendUrl}/api/v1/teams/${slug}/squad?${params}`));
      if (!payload.squads?.length) throw new Error(`${competition.id}/${slug}: plantilla vacía`);
      return payload.squads;
    });
    for (const squad of squads.flat()) {
      if (!squad.current || squad.role?.slug !== "jugador" || !squad.person || !squad.position || !squad.team) continue;
      const position = positionCode(squad.position.name); const providerId = `laliga:${squad.person.id}`;
      players.push({ provider_id: providerId, competition_id: competition.id, player_name: squad.person.name, position, club_name: squad.team.name, market_value: stableValue(providerId, position), photo_url: squad.photos?.["002"]?.["256x256"] ?? squad.photos?.["002"]?.["128x128"] ?? null, source_name: "LALIGA" });
    }
  }
  return players;
}

async function loadLigaF(): Promise<Player[]> {
  const listing = await getText("https://ligaf.es/competicion/primera_division_femenina");
  const teamLinks: string[] = []; const seen = new Set<string>();
  for (const match of listing.matchAll(/href="(\/equipo\/[^"?]+\/(\d+)\/plantilla\/2027)"/g)) { if (!seen.has(match[2])) { seen.add(match[2]); teamLinks.push(match[1]); } }
  if (teamLinks.length !== 16) throw new Error(`Liga F: se esperaban 16 clubes y se encontraron ${teamLinks.length}`);
  const pages = await mapLimit(teamLinks, 6, (path) => getText(`https://ligaf.es${path}`)); const players: Player[] = [];
  for (const page of pages) {
    const club = decodeHtml(page.match(/<title>\s*Plantilla\s+(.+?)\s*\|\s*LPFF\s*<\/title>/i)?.[1] ?? "");
    const pattern = /<a href="\/jugadora\/[^"/]+\/(\d+)"[\s\S]*?<p class="name mt5">[\s\S]*?<\/p>\s*<p class="name mt5 fs-4">([\s\S]*?)<\/p>[\s\S]*?<div class="badge[^">]*">([\s\S]*?)<\/div>[\s\S]*?<img class="player-img"[^>]+src="([^"]+)"/g;
    let match: RegExpExecArray | null; let found = 0;
    while ((match = pattern.exec(page))) { const position = positionCode(decodeHtml(match[3])); const providerId = `ligaf:${match[1]}`; players.push({ provider_id: providerId, competition_id: "liga_f", player_name: decodeHtml(match[2]), position, club_name: club, market_value: stableValue(providerId, position), photo_url: decodeHtml(match[4]), source_name: "Liga F" }); found++; }
    if (!club || found === 0) throw new Error("Una plantilla de Liga F está vacía o no se pudo interpretar");
  }
  return players;
}

function summarize(players: Player[], existing: ExistingPlayer[]) {
  const current = new Map(existing.map((row) => [row.provider_id, row])); const incoming = new Map(players.map((player) => [player.provider_id, player]));
  let additions = 0, updates = 0, deactivations = 0, reactivations = 0, competitionChanges = 0, clubChanges = 0, positionChanges = 0;
  for (const player of players) { const row = current.get(player.provider_id); if (!row) additions++; else { const club = Array.isArray(row.sports_clubs) ? row.sports_clubs[0]?.name : row.sports_clubs?.name; if (!row.active) reactivations++; if (row.competition_id !== player.competition_id) competitionChanges++; else if (club !== player.club_name) clubChanges++; if (row.position !== player.position) positionChanges++; if (!row.active || row.competition_id !== player.competition_id || row.name !== player.player_name || row.position !== player.position || club !== player.club_name || (row.photo_url ?? null) !== player.photo_url) updates++; } }
  for (const row of existing) if (row.active && !incoming.has(row.provider_id)) deactivations++;
  const competitions = Object.fromEntries(["primera", "segunda", "liga_f"].map((id) => [id, players.filter((player) => player.competition_id === id).length]));
  return { additions, updates, deactivations, reactivations, competitionChanges, clubChanges, positionChanges, unchanged: players.length - additions - updates, total: players.length, competitions };
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
    const { data: job, error: jobError } = await admin.from("player_catalog_sync_jobs").insert({ requested_by: user.id, mode }).select("id").single();
    if (jobError) return json(request, { error: jobError.code === "23505" ? "Ya hay una sincronización en curso" : jobError.message }, jobError.code === "23505" ? 409 : 500);
    jobId = job.id;
    const [laliga, ligaF] = await Promise.all([loadLaliga(), loadLigaF()]);
    const players = [...new Map([...laliga, ...ligaF].map((player) => [player.provider_id, player])).values()];
    const { data: existing, error: existingError } = await admin.from("players").select("provider_id,competition_id,name,position,active,photo_url,sports_clubs(name)").or("provider_id.like.laliga:%,provider_id.like.ligaf:%");
    if (existingError) throw existingError;
    const summary = summarize(players, (existing ?? []) as ExistingPlayer[]); const catalogVersion = new Date().toISOString().slice(0, 10);
    if (mode === "apply") {
      const { data, error } = await admin.rpc("apply_player_catalog_snapshot", { target_job_id: jobId, target_catalog_version: catalogVersion, snapshot: players, target_summary: summary });
      if (error) throw error;
      return json(request, { jobId, mode, catalogVersion, summary: data });
    }
    await admin.from("player_catalog_sync_jobs").update({ status: "succeeded", catalog_version: catalogVersion, summary, finished_at: new Date().toISOString() }).eq("id", jobId);
    return json(request, { jobId, mode, catalogVersion, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado";
    if (admin && jobId) await admin.from("player_catalog_sync_jobs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", jobId);
    return json(request, { error: message }, 500);
  }
});
