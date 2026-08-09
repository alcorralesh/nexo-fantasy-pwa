import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SEASON = "2026";
const CATALOG_VERSION = "2026-08-09";
const OUTPUT = resolve("supabase/migrations/202608090004_full_official_rosters.sql");

const competitions = [
  { id: "primera", url: "https://www.laliga.com/laliga-easports/clubes" },
  { id: "segunda", url: "https://www.laliga.com/laliga-hypermotion/clubes" },
];

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function positionCode(position) {
  const normalized = position.toLocaleLowerCase("es");
  if (normalized.includes("porter")) return "POR";
  if (normalized.includes("defensa")) return "DEF";
  if (normalized.includes("centro") || normalized.includes("medio")) return "MED";
  if (normalized.includes("delanter")) return "DEL";
  throw new Error(`Posición desconocida: ${position}`);
}

function stableValue(providerId, position) {
  const base = { POR: 5.8, DEF: 6.1, MED: 6.7, DEL: 7.1 }[position];
  let hash = 0;
  for (const char of providerId) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return Math.round((base + ((hash % 9) - 4) / 10) * 10) / 10;
}

function sql(value) {
  if (value == null) return "null";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function getText(url) {
  const response = await fetch(url, { headers: { "user-agent": "NexoFantasyCatalog/1.0" } });
  if (!response.ok) throw new Error(`${response.status} al consultar ${url}`);
  return response.text();
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return output;
}

async function loadLaligaPlayers() {
  const bootstrap = await getText("https://www.laliga.com/clubes/athletic-club/plantilla");
  const backendUrl = bootstrap.match(/"backendUrl":"([^"]+)"/)?.[1];
  const subscription = bootstrap.match(/"backendSubscription":"([^"]+)"/)?.[1];
  if (!backendUrl || !subscription) throw new Error("No se pudo localizar el servicio público de LALIGA");

  const players = [];
  for (const competition of competitions) {
    const listing = await getText(competition.url);
    const slugs = [...listing.matchAll(/href="\/clubes\/([^/"?#]+)(?:\/[^"#?]*)?"/g)]
      .map((match) => match[1])
      .filter((slug, index, all) => all.indexOf(slug) === index);
    const expected = competition.id === "primera" ? 20 : 22;
    if (slugs.length !== expected) throw new Error(`${competition.id}: se esperaban ${expected} clubes y se encontraron ${slugs.length}`);

    const squads = await mapLimit(slugs, 6, async (slug) => {
      const params = new URLSearchParams({
        limit: "60", offset: "0", orderField: "id", orderType: "DESC", seasonYear: SEASON,
        contentLanguage: "es", countryCode: "ES", "subscription-key": subscription,
      });
      const payload = JSON.parse(await getText(`${backendUrl}/api/v1/teams/${slug}/squad?${params}`));
      if (!payload.squads?.length) throw new Error(`${competition.id}/${slug}: plantilla vacía`);
      return payload.squads;
    });

    for (const squad of squads.flat()) {
      if (!squad.current || squad.role?.slug !== "jugador" || !squad.person || !squad.position || !squad.team) continue;
      const position = positionCode(squad.position.name);
      const providerId = `laliga:${squad.person.id}`;
      players.push({
        providerId,
        competitionId: competition.id,
        name: squad.person.name,
        position,
        club: squad.team.name,
        marketValue: stableValue(providerId, position),
        photoUrl: squad.photos?.["002"]?.["256x256"] ?? squad.photos?.["002"]?.["128x128"] ?? null,
        source: "LALIGA",
      });
    }
  }
  return players;
}

async function loadLigaFPlayers() {
  const listing = await getText("https://ligaf.es/competicion/primera_division_femenina");
  const teamLinks = [];
  const seenTeamIds = new Set();
  for (const match of listing.matchAll(/href="(\/equipo\/[^"?]+\/(\d+)\/plantilla\/2027)"/g)) {
    if (seenTeamIds.has(match[2])) continue;
    seenTeamIds.add(match[2]);
    teamLinks.push(match[1]);
  }
  if (teamLinks.length !== 16) throw new Error(`Liga F: se esperaban 16 clubes y se encontraron ${teamLinks.length}`);

  const pages = await mapLimit(teamLinks, 5, (path) => getText(`https://ligaf.es${path}`));
  const players = [];
  for (const page of pages) {
    const club = decodeHtml(page.match(/<title>\s*Plantilla\s+(.+?)\s*\|\s*LPFF\s*<\/title>/i)?.[1] ?? "");
    if (!club) throw new Error("No se pudo leer el nombre de un club de Liga F");
    const playerPattern = /<a href="\/jugadora\/[^"/]+\/(\d+)"[\s\S]*?<p class="name mt5">[\s\S]*?<\/p>\s*<p class="name mt5 fs-4">([\s\S]*?)<\/p>[\s\S]*?<div class="badge[^">]*">([\s\S]*?)<\/div>[\s\S]*?<img class="player-img"[^>]+src="([^"]+)"/g;
    let match;
    let found = 0;
    while ((match = playerPattern.exec(page))) {
      const position = positionCode(decodeHtml(match[3]));
      const providerId = `ligaf:${match[1]}`;
      players.push({
        providerId,
        competitionId: "liga_f",
        name: decodeHtml(match[2]),
        position,
        club,
        marketValue: stableValue(providerId, position),
        photoUrl: decodeHtml(match[4]),
        source: "Liga F",
      });
      found++;
    }
    if (found === 0) throw new Error(`${club}: la plantilla publicada está vacía`);
    if (found < 15) console.warn(`${club}: la fuente oficial publica por ahora ${found} jugadoras`);
  }
  return players;
}

function buildMigration(players) {
  const unique = [...new Map(players.map((player) => [player.providerId, player])).values()]
    .sort((a, b) => a.competitionId.localeCompare(b.competitionId) || a.club.localeCompare(b.club) || a.name.localeCompare(b.name));
  const values = unique.map((player) => `(${[
    player.providerId, player.competitionId, player.name, player.position, player.club,
    player.marketValue, player.photoUrl, player.source,
  ].map(sql).join(",")})`).join(",\n");

  return `-- Catálogo completo 2026/27 obtenido de las plantillas públicas de LALIGA y Liga F.\n\n` +
`alter table public.players add column if not exists photo_url text;\n` +
`alter table public.players add column if not exists source_name text;\n` +
`alter table public.players add column if not exists source_updated_at timestamptz;\n\n` +
`create temporary table _nexo_official_player_seed (\n` +
`  provider_id text, competition_id text, player_name text, position text, club_name text,\n` +
`  market_value numeric, photo_url text, source_name text\n` +
`) on commit drop;\n\n` +
`insert into _nexo_official_player_seed values\n${values};\n\n` +
`update public.players\n` +
`set active = false, updated_at = now()\n` +
`where (provider_id is null and catalog_version = '2026-08-08')\n` +
`   or provider_id like 'laliga:%' or provider_id like 'ligaf:%';\n\n` +
`insert into public.sports_clubs (id, competition_id, name, active)\n` +
`select competition_id || '_' || substr(md5(club_name), 1, 12), competition_id, club_name, true\n` +
`from _nexo_official_player_seed group by competition_id, club_name\n` +
`on conflict (competition_id, name) do update set active = true;\n\n` +
`insert into public.players (\n` +
`  id, competition_id, sports_club_id, provider_id, name, initials, position, market_value, active,\n` +
`  catalog_version, photo_url, source_name, source_updated_at\n` +
`)\n` +
`select replace(seed.provider_id, ':', '_'), seed.competition_id, club.id, seed.provider_id, seed.player_name,\n` +
`  upper(left(regexp_replace(seed.player_name, '[^[:alnum:]]', '', 'g'), 2)), seed.position, seed.market_value, true,\n` +
`  '${CATALOG_VERSION}', seed.photo_url, seed.source_name, now()\n` +
`from _nexo_official_player_seed seed\n` +
`join public.sports_clubs club on club.competition_id = seed.competition_id and club.name = seed.club_name\n` +
`on conflict (id) do update set competition_id = excluded.competition_id, sports_club_id = excluded.sports_club_id,\n` +
`  provider_id = excluded.provider_id, name = excluded.name, initials = excluded.initials, position = excluded.position,\n` +
`  market_value = excluded.market_value, active = true, catalog_version = excluded.catalog_version,\n` +
`  photo_url = excluded.photo_url, source_name = excluded.source_name, source_updated_at = now();\n`;
}

const [laligaPlayers, ligaFPlayers] = await Promise.all([loadLaligaPlayers(), loadLigaFPlayers()]);
const players = [...laligaPlayers, ...ligaFPlayers];
await writeFile(OUTPUT, buildMigration(players), "utf8");

const counts = Object.fromEntries(["primera", "segunda", "liga_f"].map((competition) => [
  competition,
  players.filter((player) => player.competitionId === competition).length,
]));
console.log(JSON.stringify({ output: OUTPUT, total: players.length, counts }, null, 2));
