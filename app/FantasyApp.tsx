// @ts-nocheck -- Legacy prototype UI; the data layer remains fully typed.
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  CompetitionName,
  CompetitionSummary,
  FantasyBootstrapData,
  FantasyTeamSummary,
  InitialSquad,
  InitialSquadPlayer,
  LeagueParticipation,
  LeagueSummary,
  LineupData,
  LineupPlayer,
  MarketPlayer,
  PlayerPosition,
  PublicLeagueSummary,
} from "./data";
import { helpRules } from "./data/help-rules";
import { competitionCatalogSummary, competitionPlayers, type CompetitionPlayer } from "./data/competition-players";
import { getCompetitionTrends, type PlayerTrend } from "./data/market-trends";
import { getNextFixture } from "./data/next-fixtures";
import { defaultMarketValueConfig, type MarketValueConfig } from "./domain/market-value";
import { calculatePlayerPoints, defaultScoringRules, demoPlayerMatchStats, type ScoringRule } from "./domain/scoring";
import { createDemoAllocationGateway } from "./services/initial-squad-allocation";
import { acceptNexoLegalDocuments, completeNexoOnboarding, createNexoTeam, loadNexoIdentity, registerInNexo, sendNexoPasswordReset, signInToNexo, signOutFromNexo, type NexoIdentity, type NexoRegistration } from "./services/nexo-auth";
import { cancelNexoLeagueReservation, confirmNexoLeagueJoin, createNexoPrivateLeague, leaveNexoLeague, loadNexoLeagueState, previewNexoPrivateLeague, reserveNexoLeaguePlace } from "./services/nexo-leagues";
import { withBasePath } from "./base-path";

type Section = "inicio" | "equipo" | "tendencias" | "ligas" | "liga" | "perfil" | "ayuda" | "admin";
type LeagueAreaSection = "resumen" | "equipo" | "mercado" | "jornada" | "clasificacion";
type CreateTeamInput = { name: string; competition: CompetitionName };
type AllocationPresentation = { league: PublicLeagueSummary; team: FantasyTeamSummary; squad: InitialSquad };
type MarketRules = { maxDebtPercent: number; maxBenchPlayers: number; renewalHours: number; fantasyMatchdayBudget: number; fantasyAllowCopyPrevious: boolean; fantasyAllowRandomWithinBudget: boolean; fantasyAllowRandomUnlimited: boolean; fantasyAllowClear: boolean };
type ClubRules = { maxActiveTeams: number; maxRankingResults: number; extraTeamSlotCost: number; singleMatchEventsConsumeSlot: boolean };
type ClubIdentityMeta = { motto: string; primaryColor: string; secondaryColor: string; foundedYear: number };
type ClubIdentityInput = { name: string; shortName: string; motto: string; primaryColor: string; secondaryColor: string };
type AchievementCategory = "Primeros pasos" | "Competición" | "Mercado" | "Clubes" | "Comunidad";
type AchievementRarity = "Común" | "Raro" | "Épico" | "Legendario";
type AchievementDefinition = { id: string; category: AchievementCategory; title: string; description: string; icon: string; rarity: AchievementRarity; target: number; progress: number; coinReward: number };
type CoinAction = { id: string; title: string; description: string; reward: number; frequency: "Única" | "Diaria" | "Semanal"; progress: number; target: number };
type CoinLedgerEntry = { id: string; concept: string; amount: number; createdAt: number; source: "achievement" | "action" | "spend" };
type EconomyRules = { dailyEarnCap: number; achievementMultiplier: number; dailyLoginReward: number; weeklyLineupReward: number; fairPlayReward: number };
type AppNotification = { id: string; type: "achievement" | "market" | "matchday"; title: string; body: string; createdAt: number; read: boolean; achievementId?: string };
type MarketHistoryEvent = { id: string; type: "bid" | "offer" | "transfer" | "listing" | "clause" | "blindage" | "sale"; direction: "made" | "received" | "system"; title: string; detail: string; playerName: string; amount?: number; status: "active" | "completed" | "rejected" | "cancelled" | "expired"; createdAt: number };
type PrivateLeagueActivityEvent = { id: string; type: "transfer" | "market" | "clause" | "membership" | "lineup"; actor: string; initials: string; title: string; detail: string; createdAt: number };
type MatchdaySettlementRules = { moneyPerPoint: number; minimumPayout: number; maximumPayout: number; postponedGraceHours: number; postponedPolicy: "wait" | "provisional"; advanceNoticeHours: number; activateNextFantasyEvents: boolean };
type AuthUser = { id: string; displayName: string; email: string; initials: string; role: "admin" | "user" };
type OnboardingConfig = { version: number; forceReason: string };
type LegalVersion = { id: string; version: number; publishedAt: number; changeSummary: string };
type LegalConfig = { privacyVersions: LegalVersion[]; termsVersions: LegalVersion[] };
type UserPreferences = { defaultCompetition: CompetitionName; marketNotifications: boolean; matchdayNotifications: boolean; achievementNotifications: boolean; reducedMotion: boolean; compactMode: boolean };
type FantasyBuilderCommand = { id: string; type: "copy" | "random" | "clear"; respectBudget?: boolean };
type FantasyEventFormat = "partidazo" | "matches" | "matchdays";
type FantasyEventFixture = { id: string; home: string; away: string; matchday: number; kickoffLabel: string };
type FantasyPriceSnapshot = { id: string; capturedAt: number; algorithmVersion: string; budget: number; percentile: number; playerPrices: Record<string, number> };
type FantasyEvent = { id: string; name: string; description: string; competition: CompetitionName; competitionId: string; format: FantasyEventFormat; fixtures: FantasyEventFixture[]; matchdays: number[]; lineupPolicy: "fixed" | "per_matchday"; maxPlayersPerClub: number; capacity: number; memberCount: number; featured: boolean; status: "draft" | "announced" | "open" | "live" | "finished"; previousMatchday: number; budgetPercentile: number; snapshot?: FantasyPriceSnapshot };
type MarketBid = { playerId: string; amount: number; placedAt: number };
type PlayerContract = { clause: number; listed: boolean; blindUntil?: number; untouchable: boolean; offers: number };
type PlayerOffer = { id: string; playerId: string; source: "rival" | "game"; bidderName: string; bidderInitials: string; amount: number; createdAt: number; expiresAt: number; status: "active" | "accepted" | "rejected" | "expired" };
type SentOffer = { id: string; targetPlayerId: string; targetPlayerName: string; targetTeamId: string; targetTeamName: string; amount: number; createdAt: number; expiresAt: number; status: "active" | "cancelled" | "accepted" | "rejected" | "expired" };
type ClausePurchase = { playerId: string; playerName: string; rivalTeamId: string; amount: number; purchasedAt: number };
type FantasyLineupDraft = { matchday: number; formation: string; playerIds: string[]; captainId: string; spent: number; savedAt: number };
type PrivateLeagueRules = {
  accessCode: string;
  joinLocked: boolean;
  capacity: number;
  startingBudget: number;
  initialSquadSize: number;
  renewalHours: number;
  marketPlayersPerRenewal: number;
  maxBenchPlayers: number;
  maxDebtPercent: number;
  clausesEnabled: boolean;
  clauseMultiplier: number;
  clauseCutoffHours: number;
  blindagesEnabled: boolean;
  blindageDurationHours: number;
  directOffersEnabled: boolean;
  gameOffersEnabled: boolean;
  immediateSalePercent: number;
  captainMultiplier: number;
  lineupLockMinutes: number;
  version: number;
  updatedAt: number;
};
type CreatePrivateLeagueInput = { name: string; competition: CompetitionName; teamId: string; rules: Omit<PrivateLeagueRules, "accessCode" | "version" | "updatedAt"> };
type PrivateLeagueParticipant = { id: string; initials: string; userName: string; teamName: string; role: "admin" | "member" };
type PrivateLeagueInvite = { league: LeagueSummary; rules: PrivateLeagueRules; participants: PrivateLeagueParticipant[]; activeReservations: number };
type ReportCategory = "cheating" | "unsporting" | "harassment" | "other";
type ReportResolution = "warning" | "dismissed" | "expelled";
type LeagueReport = { id: string; leagueId: string; reportedUserId: string; reportedUserName: string; reportedTeamName: string; category: ReportCategory; details: string; status: "pending" | ReportResolution; createdAt: number; resolvedAt?: number };

const PRIVATE_JOIN_RESERVATION_MINUTES = 3;

function createFantasyPriceSnapshot(event: FantasyEvent, catalog = competitionPlayers[event.competition]): FantasyPriceSnapshot {
  const clubs = event.fixtures.length ? new Set(event.fixtures.flatMap((fixture) => [fixture.home, fixture.away])) : null;
  const eligible = catalog.filter((player) => !clubs || clubs.has(player.club));
  const prices = Object.fromEntries(eligible.map((player) => [player.id, player.value]));
  const quota: Record<PlayerPosition, number> = { POR: 1, DEF: 4, MED: 4, DEL: 2 };
  const totals: number[] = [];
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const candidate = (Object.keys(quota) as PlayerPosition[]).flatMap((position) => eligible.filter((player) => player.position === position).map((player) => ({ player, order: Math.random() })).sort((a, b) => a.order - b.order).slice(0, quota[position]).map((item) => item.player));
    const clubCounts = candidate.reduce<Record<string, number>>((counts, player) => ({ ...counts, [player.club]: (counts[player.club] ?? 0) + 1 }), {});
    if (candidate.length === 11 && Object.values(clubCounts).every((count) => count <= event.maxPlayersPerClub)) totals.push(candidate.reduce((total, player) => total + player.value, 0));
  }
  totals.sort((a, b) => a - b);
  const percentileIndex = Math.min(Math.max(0, Math.floor((totals.length - 1) * event.budgetPercentile / 100)), Math.max(0, totals.length - 1));
  const fallback = (Object.keys(quota) as PlayerPosition[]).flatMap((position) => eligible.filter((player) => player.position === position).sort((a, b) => a.value - b.value).slice(0, quota[position])).reduce((total, player) => total + player.value, 0);
  const budget = Math.ceil((totals[percentileIndex] ?? fallback) * 2) / 2;
  return { id: `fantasy_snapshot_${crypto.randomUUID()}`, capturedAt: Date.now(), algorithmVersion: "market-value-v1 · weekly-lock", budget, percentile: event.budgetPercentile, playerPrices: prices };
}

function createDemoFantasyEvents(): FantasyEvent[] {
  const openEvent: FantasyEvent = { id: "fantasy_event_clasicos", name: "Clásicos del fin de semana", description: "Tres grandes partidos, un único once y clasificación acumulada.", competition: "Primera", competitionId: "comp_primera", format: "matches", fixtures: [{ id: "fx_rm_bar", home: "Real Madrid", away: "FC Barcelona", matchday: 5, kickoffLabel: "Dom · 21:00" }, { id: "fx_ath_bar", home: "Athletic Club", away: "FC Barcelona", matchday: 5, kickoffLabel: "Sáb · 18:30" }], matchdays: [5], lineupPolicy: "fixed", maxPlayersPerClub: 6, capacity: 500, memberCount: 82, featured: false, status: "open", previousMatchday: 4, budgetPercentile: 60 };
  openEvent.snapshot = createFantasyPriceSnapshot(openEvent);
  return [
    { id: "fantasy_event_partidazo", name: "El Partidazo", description: "Real Madrid contra FC Barcelona. Un partido, un once, una clasificación.", competition: "Primera", competitionId: "comp_primera", format: "partidazo", fixtures: [{ id: "fx_partidazo", home: "Real Madrid", away: "FC Barcelona", matchday: 6, kickoffLabel: "Dom 30 ago · 21:00" }], matchdays: [6], lineupPolicy: "fixed", maxPlayersPerClub: 6, capacity: 1000, memberCount: 247, featured: true, status: "announced", previousMatchday: 5, budgetPercentile: 60 },
    openEvent,
  ];
}

function availablePrivateLeagueSlots(invite: PrivateLeagueInvite) {
  return Math.max(0, invite.rules.capacity - invite.participants.length - invite.activeReservations);
}

function createLocalSquad(competition: CompetitionName, squadSize = 16): InitialSquad {
  const startingQuotas: Record<PlayerPosition, number> = { POR: 1, DEF: 4, MED: 4, DEL: 2 };
  const quotas = { ...startingQuotas };
  const extraOrder: PlayerPosition[] = ["POR", "DEF", "MED", "DEL", "DEF", "MED", "DEL", "POR", "DEF"];
  for (let index = 0; index < Math.max(0, Math.min(20, squadSize) - 11); index += 1) quotas[extraOrder[index % extraOrder.length]] += 1;
  const players = (Object.keys(quotas) as PlayerPosition[]).flatMap((position) => competitionPlayers[competition].filter((player) => player.position === position).sort((a, b) => a.value - b.value).slice(0, quotas[position]));
  const startingPlayerIds = (Object.keys(startingQuotas) as PlayerPosition[]).flatMap((position) => players.filter((player) => player.position === position).slice(0, startingQuotas[position]).map((player) => player.id));
  const totalValue = Number(players.reduce((total, player) => total + player.value, 0).toFixed(1));
  return { formation: "4-4-2", players, startingPlayerIds, benchPlayerIds: players.filter((player) => !startingPlayerIds.includes(player.id)).map((player) => player.id), totalValue, targetValue: totalValue };
}

function createSeededSquads(data: FantasyBootstrapData) {
  const squads: Record<string, InitialSquad> = {};
  data.participations.forEach((participation) => {
    const league = data.leagues.find((item) => item.id === participation.leagueId);
    if (!league) return;
    const quotas: Record<PlayerPosition, number> = { POR: 2, DEF: 5, MED: 5, DEL: 4 };
    const startingQuotas: Record<PlayerPosition, number> = { POR: 1, DEF: 4, MED: 4, DEL: 2 };
    const players = (Object.keys(quotas) as PlayerPosition[]).flatMap((position) => competitionPlayers[league.competition].filter((player) => player.position === position).sort((a, b) => a.value - b.value).slice(0, quotas[position]));
    const startingPlayerIds = (Object.keys(startingQuotas) as PlayerPosition[]).flatMap((position) => players.filter((player) => player.position === position).slice(0, startingQuotas[position]).map((player) => player.id));
    const totalValue = Number(players.reduce((total, player) => total + player.value, 0).toFixed(1));
    squads[participation.id] = { formation: "4-4-2", players, startingPlayerIds, benchPlayerIds: players.filter((player) => !startingPlayerIds.includes(player.id)).map((player) => player.id), totalValue, targetValue: totalValue };
  });
  return squads;
}

const achievementCatalog: AchievementDefinition[] = [
  { id: "welcome", category: "Primeros pasos", title: "Bienvenido a Nexo", description: "Completa tu perfil de usuario.", icon: "N", rarity: "Común", target: 1, progress: 1, coinReward: 50 },
  { id: "first_club", category: "Primeros pasos", title: "Fundador", description: "Crea tu primer club.", icon: "C", rarity: "Común", target: 1, progress: 1, coinReward: 75 },
  { id: "first_lineup", category: "Competición", title: "Primer once", description: "Guarda una alineación completa.", icon: "XI", rarity: "Común", target: 1, progress: 1, coinReward: 50 },
  { id: "five_matchdays", category: "Competición", title: "Constancia", description: "Puntúa en cinco jornadas.", icon: "5", rarity: "Raro", target: 5, progress: 4, coinReward: 125 },
  { id: "podium", category: "Competición", title: "En el podio", description: "Finaliza una liga entre los tres primeros.", icon: "III", rarity: "Épico", target: 1, progress: 1, coinReward: 300 },
  { id: "champion", category: "Competición", title: "Campeón", description: "Gana una liga con al menos ocho participantes.", icon: "★", rarity: "Legendario", target: 1, progress: 0, coinReward: 750 },
  { id: "first_bid", category: "Mercado", title: "Primera puja", description: "Realiza una puja válida.", icon: "↗", rarity: "Común", target: 1, progress: 1, coinReward: 40 },
  { id: "market_master", category: "Mercado", title: "Rey del mercado", description: "Completa diez fichajes ganadores.", icon: "◆", rarity: "Épico", target: 10, progress: 7, coinReward: 350 },
  { id: "club_top100", category: "Clubes", title: "Top 100", description: "Sitúa un club entre los cien mejores.", icon: "100", rarity: "Raro", target: 1, progress: 1, coinReward: 150 },
  { id: "three_teams", category: "Clubes", title: "Club polivalente", description: "Compite con un club en tres modalidades.", icon: "3", rarity: "Raro", target: 3, progress: 2, coinReward: 175 },
  { id: "fair_play", category: "Comunidad", title: "Juego limpio", description: "Completa una temporada sin sanciones.", icon: "✓", rarity: "Épico", target: 1, progress: 0, coinReward: 400 },
  { id: "friends_league", category: "Comunidad", title: "Con amigos", description: "Participa en una liga privada de ocho usuarios.", icon: "8", rarity: "Raro", target: 8, progress: 5, coinReward: 125 },
];

const coinActions: CoinAction[] = [
  { id: "daily_visit", title: "Entrar hoy", description: "Abre Nexo y revisa tus avisos.", reward: 20, frequency: "Diaria", progress: 1, target: 1 },
  { id: "weekly_lineup", title: "Alineación semanal", description: "Guarda un once válido antes del cierre.", reward: 75, frequency: "Semanal", progress: 1, target: 1 },
  { id: "market_week", title: "Participar en el mercado", description: "Realiza tres operaciones válidas esta semana.", reward: 60, frequency: "Semanal", progress: 2, target: 3 },
  { id: "fair_play_week", title: "Semana de juego limpio", description: "Participa sin operaciones anuladas ni sanciones.", reward: 50, frequency: "Semanal", progress: 1, target: 1 },
  { id: "complete_profile", title: "Completar el perfil", description: "Configura nombre, país y preferencias.", reward: 100, frequency: "Única", progress: 1, target: 1 },
];

const navItems: { id: Section; label: string; icon: string }[] = [
  { id: "inicio", label: "Inicio", icon: "⌂" },
  { id: "equipo", label: "Clubes", icon: "♙" },
  { id: "tendencias", label: "Tendencias", icon: "↗" },
  { id: "ligas", label: "Ligas", icon: "◫" },
  { id: "perfil", label: "Perfil", icon: "●" },
];

function Brand() {
  return (
    <div className="brand" aria-label="Nexo Fantasy">
      <span className="brand-mark">N</span>
      <span className="brand-copy"><strong>NEXO</strong><small>FANTASY</small></span>
    </div>
  );
}

function Avatar({ label = "BC" }: { label?: string }) {
  return <span className="avatar">{label}</span>;
}

function NotificationCenter({ notifications, onOpen, onMarkAllRead, onClose }: { notifications: AppNotification[]; onOpen: (notification: AppNotification) => void; onMarkAllRead: () => void; onClose: () => void }) {
  const unread = notifications.filter((item) => !item.read).length;
  return <section className="notification-center" role="dialog" aria-label="Centro de notificaciones"><header><div><p className="eyebrow">ACTIVIDAD</p><h2>Notificaciones</h2></div><button onClick={onClose} aria-label="Cerrar notificaciones">×</button></header><div className="notification-center-summary"><span>{unread}</span><p><strong>{unread === 1 ? "Tienes un aviso nuevo" : `Tienes ${unread} avisos nuevos`}</strong><small>Los logros desbloqueados aparecerán aquí.</small></p>{unread > 0 && <button onClick={onMarkAllRead}>Marcar todo como leído</button>}</div><div className="notification-list">{notifications.map((notification) => <button key={notification.id} className={`${notification.read ? "read" : "unread"} ${notification.type}`} onClick={() => onOpen(notification)}><span>{notification.type === "achievement" ? "★" : notification.type === "market" ? "↗" : "◷"}</span><p><small>{notification.type === "achievement" ? "LOGRO" : notification.type === "market" ? "MERCADO" : "JORNADA"} · {formatNotificationTime(notification.createdAt)}</small><strong>{notification.title}</strong><em>{notification.body}</em>{notification.type === "achievement" && <b>Ver en mi vitrina →</b>}</p>{!notification.read && <i />}</button>)}{notifications.length === 0 && <div className="notification-empty"><span>✓</span><strong>Todo al día</strong><p>No tienes avisos pendientes.</p></div>}</div><footer>Los avisos importantes se conservan hasta que los consultes.</footer></section>;
}

function formatNotificationTime(createdAt: number) {
  const minutes = Math.max(1, Math.floor((Date.now() - createdAt) / 60000));
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes < 1440) return `hace ${Math.floor(minutes / 60)} h`;
  return `hace ${Math.floor(minutes / 1440)} d`;
}

function AuthGateway({ onLogin, onRegister, onRecover, onDemo }: { onLogin: (email: string, password: string) => Promise<void>; onRegister: (input: NexoRegistration) => Promise<{ confirmationRequired: boolean }>; onRecover: (email: string) => Promise<void>; onDemo: () => void }) {
  const [mode, setMode] = useState<"login" | "register" | "recover">("login");
  const [registerStep, setRegisterStep] = useState(1);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [country, setCountry] = useState("España");
  const [favoriteCompetition, setFavoriteCompetition] = useState<CompetitionName>("Primera");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);

  function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
  function validPassword(value: string) { return value.length >= 8 && /[A-Z]/.test(value) && /\d/.test(value); }
  async function submitLogin(event: FormEvent) { event.preventDefault(); if (!validEmail(email) || password.length < 6) { setError("Revisa el correo y la contraseña."); return; } setError(""); try { await onLogin(email.trim().toLowerCase(), password); } catch (failure) { setError(failure instanceof Error ? failure.message : "No se ha podido iniciar sesión."); } }
  function continueRegister(event: FormEvent) { event.preventDefault(); if (displayName.trim().length < 2) { setError("Escribe tu nombre visible."); return; } if (username.trim().length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) { setError("El usuario debe tener al menos 3 caracteres y solo puede usar letras, números o _."); return; } if (!validEmail(email)) { setError("Introduce un correo válido."); return; } if (!validPassword(password)) { setError("La contraseña necesita 8 caracteres, una mayúscula y un número."); return; } if (password !== confirmPassword) { setError("Las contraseñas no coinciden."); return; } setError(""); setRegisterStep(2); }
  async function finishRegister(event: FormEvent) { event.preventDefault(); if (!accepted) { setError("Debes aceptar las condiciones y la política de privacidad."); return; } setError(""); try { const result = await onRegister({ email: email.trim().toLowerCase(), password, username: username.trim(), displayName: displayName.trim(), country, favoriteCompetition }); if (result.confirmationRequired) { setMode("login"); setRegisterStep(1); setPassword(""); setConfirmPassword(""); setError("Cuenta creada. Revisa tu correo para confirmarla antes de iniciar sesión."); } } catch (failure) { setError(failure instanceof Error ? failure.message : "No se ha podido crear la cuenta."); } }
  async function submitRecovery(event: FormEvent) { event.preventDefault(); if (!validEmail(email)) { setError("Introduce el correo de tu cuenta."); return; } setError(""); try { await onRecover(email.trim().toLowerCase()); setRecoverySent(true); } catch (failure) { setError(failure instanceof Error ? failure.message : "No se ha podido enviar el enlace."); } }
  function changeMode(next: typeof mode) { setMode(next); setError(""); setRegisterStep(1); setRecoverySent(false); }

  return <main className="auth-page"><section className="auth-story"><Brand /><div><p className="eyebrow">TU FÚTBOL · TUS DECISIONES</p><h1>Construye un club.<br />Compite a tu manera.</h1><p>Crea equipos, entra en ligas con amigos y domina cada jornada desde cualquier dispositivo.</p></div><section><article><span>XI</span><p><strong>Alineaciones por jornada</strong><small>Prepara cada once antes de su cierre.</small></p></article><article><span>↗</span><p><strong>Mercado estratégico</strong><small>Pujas, ofertas, cláusulas y blindajes.</small></p></article><article><span>★</span><p><strong>Una carrera permanente</strong><small>Clubes, ranking, logros y recompensas.</small></p></article></section><footer><span>Primera</span><span>Segunda</span><span>Liga F</span></footer></section><section className="auth-panel"><div className="auth-mobile-brand"><Brand /></div>{mode === "login" && <><div className="auth-heading"><p className="eyebrow">BIENVENIDO DE NUEVO</p><h2>Entra en Nexo</h2><p>Continúa gestionando tus clubes y ligas.</p></div><form className="auth-form" onSubmit={submitLogin}><label><span>Correo electrónico</span><input type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="tu@email.com" /></label><label><span>Contraseña <button type="button" onClick={() => changeMode("recover")}>¿La has olvidado?</button></span><div className="password-input"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="Tu contraseña" /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Ocultar" : "Ver"}</button></div></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button auth-submit" type="submit">Iniciar sesión</button><button type="button" className="demo-access" onClick={onDemo}>Usar acceso de demostración</button></form><p className="auth-switch">¿Todavía no tienes cuenta? <button onClick={() => changeMode("register")}>Crear cuenta</button></p></>}{mode === "register" && <><div className="auth-heading"><p className="eyebrow">CREA TU CUENTA · PASO {registerStep} DE 2</p><h2>{registerStep === 1 ? "Empieza tu carrera" : "Personaliza tu experiencia"}</h2><p>{registerStep === 1 ? "Tus credenciales serán la llave de todos tus clubes." : "Podrás cambiar estas preferencias desde tu perfil."}</p></div><div className="auth-stepper"><i className="active" /><i className={registerStep === 2 ? "active" : ""} /></div>{registerStep === 1 ? <form className="auth-form register" onSubmit={continueRegister}><div className="auth-form-row"><label><span>Nombre visible</span><input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); }} placeholder="Ej. Lucía Martín" /></label><label><span>Nombre de usuario</span><input value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} placeholder="lucia_m" /></label></div><label><span>Correo electrónico</span><input type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="tu@email.com" /></label><label><span>Contraseña</span><div className="password-input"><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="8 caracteres, mayúscula y número" /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Ocultar" : "Ver"}</button></div></label><label><span>Repite la contraseña</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" type="submit">Continuar →</button></form> : <form className="auth-form" onSubmit={finishRegister}><label><span>País</span><select value={country} onChange={(event) => setCountry(event.target.value)}><option>España</option><option>Portugal</option><option>México</option><option>Argentina</option><option>Otro</option></select></label><label><span>Competición que quieres ver primero</span><div className="register-competition-options">{(["Primera", "Segunda", "Liga F"] as CompetitionName[]).map((item) => <button type="button" className={favoriteCompetition === item ? "active" : ""} key={item} onClick={() => setFavoriteCompetition(item)}>{item}</button>)}</div></label><label className="auth-consent"><input type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked); setError(""); }} /><span><strong>Acepto las <a href={withBasePath("/terms")} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>condiciones</a> y la <a href={withBasePath("/privacy")} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>política de privacidad</a></strong><small>Ambos documentos se abren en una página independiente.</small></span></label>{error && <p className="form-error">{error}</p>}<div className="auth-register-actions"><button type="button" className="secondary-button" onClick={() => setRegisterStep(1)}>Atrás</button><button className="primary-button" type="submit">Crear cuenta y ver la guía</button></div></form>}<p className="auth-switch">¿Ya tienes cuenta? <button onClick={() => changeMode("login")}>Iniciar sesión</button></p></>}{mode === "recover" && <><div className="auth-heading"><p className="eyebrow">RECUPERAR ACCESO</p><h2>{recoverySent ? "Revisa tu correo" : "Restablece tu contraseña"}</h2><p>{recoverySent ? `Hemos preparado las instrucciones para ${email}.` : "Te enviaremos un enlace seguro y de un solo uso."}</p></div>{recoverySent ? <div className="recovery-success"><span>✓</span><strong>Solicitud enviada</strong><p>El enlace caducará en 30 minutos y solo podrá utilizarse una vez.</p><button className="primary-button full" onClick={() => changeMode("login")}>Volver al inicio de sesión</button></div> : <form className="auth-form" onSubmit={submitRecovery}><label><span>Correo electrónico</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="tu@email.com" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit">Enviar enlace</button><button type="button" className="demo-access" onClick={() => changeMode("login")}>Volver</button></form>}</>}</section></main>;
}

const onboardingSlides = [
  { icon: "C", eyebrow: "1 · TU IDENTIDAD", title: "Todo empieza con tu club", description: "Tu club agrupa tu carrera. Después creará un equipo independiente en cada liga, con su propia plantilla, saldo y puntos.", points: ["Puedes competir en varias modalidades", "El club conserva ranking, logros e historial", "El club activo solo cambia el contexto de navegación"] },
  { icon: "◫", eyebrow: "2 · ELIGE CÓMO COMPETIR", title: "Cada liga juega de forma distinta", description: "Entra en mercados públicos, crea una liga privada con amigos o monta un once fantástico para una jornada o un Partidazo.", points: ["Jugadores exclusivos en ligas de mercado", "Código y reglas propias en ligas privadas", "Jugadores repetibles y presupuesto fijo en Fantástica"] },
  { icon: "XI", eyebrow: "3 · CADA JORNADA", title: "Guarda el once antes del cierre", description: "La alineación se bloquea al comenzar el primer partido asignado a su jornada. Después puedes preparar inmediatamente la siguiente.", points: ["Titulares, formación y capitán quedan congelados", "Los aplazados mantienen el once original", "Las jornadas solapadas se gestionan por separado"] },
  { icon: "↗", eyebrow: "4 · MERCADO", title: "Refuerza tu plantilla", description: "Utiliza pujas, ofertas, cláusulas y blindajes. El saldo retenido no se descuenta definitivamente hasta resolver la operación.", points: ["Las cantidades activas son privadas", "La puja más alta gana en la renovación", "Cada operación queda en tu historial"] },
  { icon: "★", eyebrow: "5 · PROGRESA", title: "Puntos, dinero y recompensas", description: "Las estadísticas se procesan al terminar los partidos. Los puntos generan saldo deportivo y los logros pueden conceder monedas generales.", points: ["El saldo deportivo pertenece a una sola liga", "Las monedas nunca compran puntos", "Ayuda conserva todas las reglas del juego"] },
];

function GameOnboarding({ userName, reason, onFinish }: { userName: string; reason: string; onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const slide = onboardingSlides[step];
  return <div className="onboarding-backdrop"><section className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><header><Brand /><span>{step + 1}/{onboardingSlides.length}</span></header><div className="onboarding-progress">{onboardingSlides.map((_, index) => <i key={index} className={index <= step ? "active" : ""} />)}</div>{reason && step === 0 && <article className="onboarding-return-reason"><span>↻</span><p><strong>La guía se muestra de nuevo</strong><small>{reason}</small></p></article>}<main><div className="onboarding-visual"><span>{slide.icon}</span><i /><i /><i /></div><div className="onboarding-copy"><p className="eyebrow">{slide.eyebrow}</p><h2 id="onboarding-title">{step === 0 ? `${userName}, ${slide.title.toLocaleLowerCase("es")}` : slide.title}</h2><p>{slide.description}</p><ul>{slide.points.map((point) => <li key={point}><span>✓</span>{point}</li>)}</ul></div></main><footer><button className="secondary-button" disabled={step === 0} onClick={() => setStep(step - 1)}>Atrás</button><div>{onboardingSlides.map((_, index) => <button key={index} className={index === step ? "active" : ""} onClick={() => setStep(index)} aria-label={`Ir al paso ${index + 1}`} />)}</div>{step < onboardingSlides.length - 1 ? <button className="primary-button" onClick={() => setStep(step + 1)}>Siguiente →</button> : <button className="primary-button" onClick={onFinish}>Entrar en Nexo</button>}</footer></section></div>;
}

function LegalAcceptanceDialog({ config, onAccept, onLogout }: { config: LegalConfig; onAccept: () => void; onLogout: () => void }) {
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const privacy = config.privacyVersions.at(-1)!;
  const terms = config.termsVersions.at(-1)!;
  return <div className="legal-acceptance-backdrop"><section className="legal-acceptance-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-acceptance-title"><header><span>§</span><div><p className="eyebrow">DOCUMENTOS ACTUALIZADOS</p><h2 id="legal-acceptance-title">Revisa las nuevas versiones</h2><p>El juego queda pausado hasta que aceptes los documentos vigentes.</p></div></header><div className="legal-acceptance-list"><label><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><div><strong>Condiciones · versión {terms.version}</strong><small>{terms.changeSummary}</small></div><a href={`${withBasePath("/terms")}?version=${terms.version}`} target="_blank" rel="noreferrer">Leer completas ↗</a></label><label><input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><div><strong>Privacidad · versión {privacy.version}</strong><small>{privacy.changeSummary}</small></div><a href={`${withBasePath("/privacy")}?version=${privacy.version}`} target="_blank" rel="noreferrer">Leer completa ↗</a></label></div><footer><button className="secondary-button" onClick={onLogout}>Cerrar sesión</button><button className="primary-button" disabled={!termsAccepted || !privacyAccepted} onClick={onAccept}>Aceptar y continuar</button></footer></section></div>;
}

export function FantasyApp({ initialData }: { initialData: FantasyBootstrapData }) {
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingConfig, setOnboardingConfig] = useState<OnboardingConfig>({ version: 1, forceReason: "" });
  const [legalAcceptanceOpen, setLegalAcceptanceOpen] = useState(false);
  const [legalConfig, setLegalConfig] = useState<LegalConfig>({ privacyVersions: [{ id: "privacy_v1", version: 1, publishedAt: Date.now() - 30 * 86400000, changeSummary: "Primera política de privacidad de Nexo." }], termsVersions: [{ id: "terms_v1", version: 1, publishedAt: Date.now() - 30 * 86400000, changeSummary: "Primeras condiciones generales del juego." }] });
  const [legalConfigLoaded, setLegalConfigLoaded] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>({ defaultCompetition: "Primera", marketNotifications: true, matchdayNotifications: true, achievementNotifications: true, reducedMotion: false, compactMode: false });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [active, setActive] = useState<Section>("inicio");
  const [competition, setCompetition] = useState<CompetitionName>(initialData.competitions[0].name);
  const [teams, setTeams] = useState(initialData.teams);
  const [availablePublicLeagues, setAvailablePublicLeagues] = useState(initialData.publicLeagues);
  const [leagues, setLeagues] = useState(initialData.leagues);
  const [participations, setParticipations] = useState(initialData.participations);
  const [initialSquads, setInitialSquads] = useState<Record<string, InitialSquad>>(() => createSeededSquads(initialData));
  const [allocationPresentation, setAllocationPresentation] = useState<AllocationPresentation | null>(null);
  const [teamId, setTeamId] = useState(initialData.activeTeamId);
  const [backendClubId, setBackendClubId] = useState<string | null>(null);
  const [coins, setCoins] = useState(initialData.user.coins);
  const [economyRules, setEconomyRules] = useState<EconomyRules>({ dailyEarnCap: 250, achievementMultiplier: 1, dailyLoginReward: 20, weeklyLineupReward: 75, fairPlayReward: 50 });
  const [settlementRules, setSettlementRules] = useState<MatchdaySettlementRules>({ moneyPerPoint: 0.1, minimumPayout: 0, maximumPayout: 15, postponedGraceHours: 48, postponedPolicy: "provisional", advanceNoticeHours: 24, activateNextFantasyEvents: true });
  const [claimedAchievements, setClaimedAchievements] = useState<string[]>([]);
  const [claimedCoinActions, setClaimedCoinActions] = useState<string[]>([]);
  const [coinLedger, setCoinLedger] = useState<CoinLedgerEntry[]>([{ id: "initial_balance", concept: "Saldo inicial de prueba", amount: initialData.user.coins, createdAt: Date.now() - 86400000, source: "action" }]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => [
    { id: "achievement_podium", type: "achievement", title: "¡Nuevo logro desbloqueado!", body: "En el podio · Has terminado una liga entre los tres primeros.", createdAt: Date.now() - 12 * 60000, read: false, achievementId: "podium" },
    { id: "achievement_first_lineup", type: "achievement", title: "Primer once", body: "Tu primera alineación completa ya forma parte de la vitrina.", createdAt: Date.now() - 2 * 86400000, read: true, achievementId: "first_lineup" },
  ]);
  const [teamCreatorOpen, setTeamCreatorOpen] = useState(false);
  const [publicJoinOpen, setPublicJoinOpen] = useState(false);
  const [fantasyJoinOpen, setFantasyJoinOpen] = useState(false);
  const [fantasyJoinEventId, setFantasyJoinEventId] = useState<string | null>(null);
  const [resumeJoinAfterClub, setResumeJoinAfterClub] = useState<{ mode: "market" | "fantasy"; eventId?: string | null } | null>(null);
  const [fantasyEvents, setFantasyEvents] = useState<FantasyEvent[]>(() => createDemoFantasyEvents());
  const [privateLeagueCreatorOpen, setPrivateLeagueCreatorOpen] = useState(false);
  const [managedPrivateLeagueId, setManagedPrivateLeagueId] = useState<string | null>(null);
  const [privateJoinInvite, setPrivateJoinInvite] = useState<PrivateLeagueInvite | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState(initialData.leagues[0]?.id ?? "");
  const [leagueAreaSection, setLeagueAreaSection] = useState<LeagueAreaSection>("resumen");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("Todos");
  const [featuredLeagueIds, setFeaturedLeagueIds] = useState<string[]>([]);
  const [featuredLeaguesLoaded, setFeaturedLeaguesLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [marketRules, setMarketRules] = useState<MarketRules>({ maxDebtPercent: 20, maxBenchPlayers: 20, renewalHours: 24, fantasyMatchdayBudget: 100, fantasyAllowCopyPrevious: true, fantasyAllowRandomWithinBudget: true, fantasyAllowRandomUnlimited: true, fantasyAllowClear: true });
  const [clubRules, setClubRules] = useState<ClubRules>({ maxActiveTeams: 10, maxRankingResults: 5, extraTeamSlotCost: 250, singleMatchEventsConsumeSlot: false });
  const [clubIdentityMeta, setClubIdentityMeta] = useState<Record<string, ClubIdentityMeta>>({});
  const [leagueBids, setLeagueBids] = useState<Record<string, MarketBid[]>>({});
  const [playerContracts, setPlayerContracts] = useState<Record<string, PlayerContract>>({});
  const [playerOffers, setPlayerOffers] = useState<Record<string, PlayerOffer[]>>({});
  const [sentOffers, setSentOffers] = useState<Record<string, SentOffer[]>>({});
  const [clausePurchases, setClausePurchases] = useState<Record<string, ClausePurchase[]>>({});
  const [privateLeagueRules, setPrivateLeagueRules] = useState<Record<string, PrivateLeagueRules>>({});
  const [privateLeagueAdminIds, setPrivateLeagueAdminIds] = useState<string[]>([]);
  const [privateLeagueInvites, setPrivateLeagueInvites] = useState<PrivateLeagueInvite[]>(() => createDemoPrivateInvites());
  const [leagueReports, setLeagueReports] = useState<LeagueReport[]>([]);
  const [fantasyLineups, setFantasyLineups] = useState<Record<string, FantasyLineupDraft>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("nexo_fantasy_lineups_v1") ?? "{}"); } catch { return {}; }
  });
  const [matchdayStartAt] = useState(() => Date.now() + 5 * 24 * 60 * 60 * 1000);
  const [scoringRules, setScoringRules] = useState<ScoringRule[]>(() => defaultScoringRules.map((rule) => ({ ...rule, points: { ...rule.points } })));
  const [adminPlayerCatalog, setAdminPlayerCatalog] = useState<Record<CompetitionName, CompetitionPlayer[]>>(() => ({
    Primera: competitionPlayers.Primera.map((player) => ({ ...player })),
    Segunda: competitionPlayers.Segunda.map((player) => ({ ...player })),
    "Liga F": competitionPlayers["Liga F"].map((player) => ({ ...player })),
  }));
  useEffect(() => { window.localStorage.setItem("nexo_fantasy_lineups_v1", JSON.stringify(fantasyLineups)); }, [fantasyLineups]);
  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const identity = await loadNexoIdentity();
        if (identity && !cancelled) {
          applyBackendIdentity(identity);
          setSessionUser(identity.user);
          return;
        }
        const saved = window.localStorage.getItem("nexo_auth_session_v1");
        if (saved && !cancelled) {
          const stored = JSON.parse(saved) as Omit<AuthUser, "role"> & { role?: AuthUser["role"] };
          if (stored.id === "demo_user") setSessionUser({ ...stored, role: "admin" });
        }
      } catch { /* La sesión puede volver a iniciarse desde la pantalla de acceso. */ }
      finally { if (!cancelled) setAuthChecked(true); }
    }
    restoreSession();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("nexo_legal_config_v1");
      if (saved) setLegalConfig(JSON.parse(saved));
    } catch { /* Se mantiene la versión inicial del prototipo. */ }
    finally { setLegalConfigLoaded(true); }
  }, []);
  useEffect(() => {
    if (!legalConfigLoaded) return;
    try { window.localStorage.setItem("nexo_legal_config_v1", JSON.stringify(legalConfig)); } catch { /* Prototipo local. */ }
  }, [legalConfig, legalConfigLoaded]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("nexo_user_preferences_v1");
      if (saved) {
        const stored = JSON.parse(saved) as UserPreferences;
        setPreferences(stored);
        setCompetition(stored.defaultCompetition);
      }
    } catch { /* Se mantienen las preferencias iniciales. */ }
    finally { setPreferencesLoaded(true); }
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try { window.localStorage.setItem("nexo_user_preferences_v1", JSON.stringify(preferences)); } catch { /* Preferencias locales. */ }
    document.documentElement.classList.toggle("nexo-reduced-motion", preferences.reducedMotion);
    document.documentElement.classList.toggle("nexo-compact", preferences.compactMode);
  }, [preferences, preferencesLoaded]);
  useEffect(() => {
    if (!sessionUser) return;
    let accepted = { privacy: 0, terms: 0 };
    try { accepted = JSON.parse(window.localStorage.getItem("nexo_legal_acceptance_v1") ?? "{}"); } catch { /* Se solicitará de nuevo. */ }
    const currentPrivacy = legalConfig.privacyVersions.at(-1)?.version ?? 1;
    const currentTerms = legalConfig.termsVersions.at(-1)?.version ?? 1;
    if (accepted.privacy < currentPrivacy || accepted.terms < currentTerms) setLegalAcceptanceOpen(true);
  }, [sessionUser, legalConfig]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("nexo_featured_leagues_v1");
      if (saved) setFeaturedLeagueIds(JSON.parse(saved));
    } catch {
      // Las ligas destacadas son una preferencia visual y no bloquean el juego.
    } finally {
      setFeaturedLeaguesLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (!featuredLeaguesLoaded) return;
    try { window.localStorage.setItem("nexo_featured_leagues_v1", JSON.stringify(featuredLeagueIds)); } catch { /* Preferencia solo local. */ }
  }, [featuredLeagueIds, featuredLeaguesLoaded]);
  const teamInfo = teams.find((item) => item.id === teamId) ?? teams[0];
  const team = teamInfo.name;
  const selectedPrivateRules = privateLeagueRules[selectedLeagueId];
  const selectedFantasyEvent = fantasyEvents.find((event) => event.id === selectedLeagueId);
  const effectiveMarketRules = selectedPrivateRules ? { ...marketRules, renewalHours: selectedPrivateRules.renewalHours, maxBenchPlayers: selectedPrivateRules.maxBenchPlayers, maxDebtPercent: selectedPrivateRules.maxDebtPercent } : marketRules;
  const fantasyEventLeagues: PublicLeagueSummary[] = fantasyEvents.filter((event) => event.status !== "draft" && event.status !== "finished").map((event) => ({ id: event.id, name: event.name, competitionId: event.competitionId, competition: event.competition, mode: "fantasy", rosterPolicy: "repeatable", memberCount: event.memberCount, capacity: event.capacity, startingBudget: event.snapshot?.budget ?? 0, targetSquadValue: event.snapshot?.budget ?? 0, accent: event.featured ? "violet" : "blue" }));

  function activeTeamCountForClub(clubId: string) {
    return participations.filter((participation) => {
      if (participation.teamId !== clubId) return false;
      const event = fantasyEvents.find((item) => item.id === participation.leagueId);
      if (event?.status === "finished") return false;
      if (event?.format === "partidazo" && !clubRules.singleMatchEventsConsumeSlot) return false;
      return true;
    }).length;
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function applyBackendIdentity(identity: NexoIdentity) {
    setSessionUser(identity.user);
    setCoins(identity.coins);
    setBackendClubId(identity.activeClubId);
    if (identity.teams.length) {
      setTeams(identity.teams);
      setTeamId(identity.teams[0].id);
      setCompetition(identity.teams[0].competition);
    }
    try { window.localStorage.setItem("nexo_onboarding_seen_version", String(identity.onboardingVersion)); } catch { /* Preferencia local opcional. */ }
    void refreshBackendLeagues();
  }

  async function refreshBackendLeagues() {
    try {
      const state = await loadNexoLeagueState();
      setAvailablePublicLeagues(state.publicLeagues);
      setLeagues(state.leagues);
      setParticipations(state.participations);
      setPrivateLeagueAdminIds(state.adminLeagueIds);
    } catch { /* La pantalla puede seguir usando los datos de demostración si la red falla. */ }
  }

  async function loginWithBackend(email: string, password: string) {
    const identity = await signInToNexo(email, password);
    applyBackendIdentity(identity);
    startSession(identity.user);
  }

  async function registerWithBackend(input: NexoRegistration) {
    const result = await registerInNexo(input);
    if (result.identity) {
      applyBackendIdentity(result.identity);
      startSession(result.identity.user, true);
    }
    return { confirmationRequired: result.confirmationRequired };
  }

  function startSession(user: AuthUser, newlyRegistered = false) {
    setSessionUser(user);
    try {
      if (user.id === "demo_user") window.localStorage.setItem("nexo_auth_session_v1", JSON.stringify(user));
      else window.localStorage.removeItem("nexo_auth_session_v1");
    } catch { /* La sesión real la conserva Supabase. */ }
    const currentPrivacy = legalConfig.privacyVersions.at(-1)?.version ?? 1;
    const currentTerms = legalConfig.termsVersions.at(-1)?.version ?? 1;
    if (newlyRegistered) {
      try { window.localStorage.setItem("nexo_legal_acceptance_v1", JSON.stringify({ privacy: currentPrivacy, terms: currentTerms, acceptedAt: Date.now() })); } catch { /* Prototipo local. */ }
      setOnboardingOpen(true);
    } else {
      let accepted = { privacy: 0, terms: 0 };
      try { accepted = JSON.parse(window.localStorage.getItem("nexo_legal_acceptance_v1") ?? "{}"); } catch { /* Se solicitará de nuevo. */ }
      if (accepted.privacy < currentPrivacy || accepted.terms < currentTerms) setLegalAcceptanceOpen(true);
      else if (Number(window.localStorage.getItem("nexo_onboarding_seen_version") ?? 0) < onboardingConfig.version) setOnboardingOpen(true);
    }
  }

  function finishOnboarding() {
    try { window.localStorage.setItem("nexo_onboarding_seen_version", String(onboardingConfig.version)); } catch { /* Prototipo local. */ }
    if (sessionUser?.id !== "demo_user") void completeNexoOnboarding(onboardingConfig.version);
    setOnboardingOpen(false);
    notify("Guía completada · ya puedes empezar a jugar");
  }

  async function logout() {
    if (sessionUser?.id !== "demo_user") await signOutFromNexo();
    try { window.localStorage.removeItem("nexo_auth_session_v1"); } catch { /* Prototipo local. */ }
    setSessionUser(null);
    setLegalAcceptanceOpen(false);
    setOnboardingOpen(false);
    setActive("inicio");
  }

  function forceOnboarding(reason: string) {
    setOnboardingConfig((current) => ({ version: current.version + 1, forceReason: reason.trim() || "Novedades importantes del juego" }));
    setOnboardingOpen(true);
    notify("El onboarding se volverá a mostrar en la próxima sesión");
  }

  function acceptCurrentLegalVersions() {
    const acceptance = { privacy: legalConfig.privacyVersions.at(-1)?.version ?? 1, terms: legalConfig.termsVersions.at(-1)?.version ?? 1, acceptedAt: Date.now() };
    try { window.localStorage.setItem("nexo_legal_acceptance_v1", JSON.stringify(acceptance)); } catch { /* Prototipo local. */ }
    if (sessionUser?.id !== "demo_user") void acceptNexoLegalDocuments();
    setLegalAcceptanceOpen(false);
    if (Number(window.localStorage.getItem("nexo_onboarding_seen_version") ?? 0) < onboardingConfig.version) setOnboardingOpen(true);
    notify("Documentos aceptados · acceso restablecido");
  }

  function publishLegalVersion(kind: "privacy" | "terms", changeSummary: string) {
    setLegalConfig((current) => {
      const key = kind === "privacy" ? "privacyVersions" : "termsVersions";
      const nextVersion = (current[key].at(-1)?.version ?? 0) + 1;
      return { ...current, [key]: [...current[key], { id: `${kind}_v${nextVersion}_${Date.now()}`, version: nextVersion, publishedAt: Date.now(), changeSummary: changeSummary.trim() }] };
    });
    setLegalAcceptanceOpen(true);
    notify(`Nueva versión de ${kind === "privacy" ? "privacidad" : "condiciones"} publicada`);
  }

  function claimAchievement(achievementId: string) {
    const achievement = achievementCatalog.find((item) => item.id === achievementId);
    if (!achievement || achievement.progress < achievement.target || claimedAchievements.includes(achievementId)) return;
    const reward = Math.round(achievement.coinReward * economyRules.achievementMultiplier);
    setClaimedAchievements((current) => [...current, achievementId]);
    setCoins((current) => current + reward);
    setCoinLedger((current) => [{ id: `achievement_${achievementId}`, concept: `Logro: ${achievement.title}`, amount: reward, createdAt: Date.now(), source: "achievement" }, ...current]);
    notify(`Logro reclamado · +${reward} monedas`);
  }

  function openNotification(notification: AppNotification) {
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    setNotificationsOpen(false);
    if (notification.type === "achievement") navigate("perfil");
  }

  function claimCoinAction(actionId: string) {
    const action = coinActions.find((item) => item.id === actionId);
    if (!action || action.progress < action.target || claimedCoinActions.includes(actionId)) return;
    const today = new Date().toDateString();
    const earnedToday = coinLedger.filter((entry) => entry.source === "action" && entry.amount > 0 && new Date(entry.createdAt).toDateString() === today).reduce((total, entry) => total + entry.amount, 0);
    const configuredReward = actionId === "daily_visit" ? economyRules.dailyLoginReward : actionId === "weekly_lineup" ? economyRules.weeklyLineupReward : actionId === "fair_play_week" ? economyRules.fairPlayReward : action.reward;
    if (earnedToday + configuredReward > economyRules.dailyEarnCap) { notify("Has alcanzado el límite diario de recompensas"); return; }
    setClaimedCoinActions((current) => [...current, actionId]);
    setCoins((current) => current + configuredReward);
    setCoinLedger((current) => [{ id: `action_${actionId}_${Date.now()}`, concept: action.title, amount: configuredReward, createdAt: Date.now(), source: "action" }, ...current]);
    notify(`Recompensa recibida · +${configuredReward} monedas`);
  }

  function toggleFeaturedLeague(leagueId: string) {
    setFeaturedLeagueIds((current) => current.includes(leagueId) ? current.filter((id) => id !== leagueId) : [...current, leagueId]);
  }

  function updateClubIdentity(clubId: string, input: ClubIdentityInput): string | null {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 24) return "El nombre debe tener entre 3 y 24 caracteres.";
    if (teams.some((club) => club.id !== clubId && club.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return "Ya tienes otro club con ese nombre.";
    setTeams((current) => current.map((club) => club.id === clubId ? { ...club, name, shortName: input.shortName.trim().toUpperCase().slice(0, 3) || club.shortName } : club));
    setClubIdentityMeta((current) => ({ ...current, [clubId]: { motto: input.motto.trim(), primaryColor: input.primaryColor, secondaryColor: input.secondaryColor, foundedYear: current[clubId]?.foundedYear ?? 2026 } }));
    notify("Identidad del club actualizada en todas sus participaciones");
    return null;
  }

  function openFantasyJoin(eventId?: string) {
    setFantasyJoinEventId(eventId ?? null);
    setFantasyJoinOpen(true);
  }

  function createFantasyEvent(event: Omit<FantasyEvent, "id" | "memberCount" | "status" | "snapshot">) {
    const next: FantasyEvent = { ...event, id: `fantasy_event_${crypto.randomUUID()}`, memberCount: 0, status: "announced" };
    setFantasyEvents((current) => event.featured ? [...current.map((item) => ({ ...item, featured: false })), next] : [...current, next]);
    notify(`${event.format === "partidazo" ? "El Partidazo" : "Evento fantástico"} publicado · presupuesto pendiente`);
  }

  function snapshotFantasyEvent(eventId: string) {
    setFantasyEvents((current) => current.map((event) => event.id === eventId ? { ...event, status: "open", snapshot: createFantasyPriceSnapshot(event, adminPlayerCatalog[event.competition]) } : event));
    notify("Jornada anterior cerrada · precios y presupuesto congelados");
  }

  function submitLeagueReport(leagueId: string, rival: RivalTeam, category: ReportCategory, details: string) {
    const duplicate = leagueReports.some((report) => report.leagueId === leagueId && report.reportedUserId === rival.id && report.status === "pending");
    if (duplicate) return "Ya tienes una denuncia pendiente sobre este usuario en la liga.";
    setLeagueReports((current) => [...current, { id: `report_${crypto.randomUUID()}`, leagueId, reportedUserId: rival.id, reportedUserName: rival.manager, reportedTeamName: rival.name, category, details: details.trim(), status: "pending", createdAt: Date.now() }]);
    notify("Denuncia enviada de forma privada al administrador");
    return null;
  }

  function resolveLeagueReport(reportId: string, resolution: ReportResolution) {
    const selectedReport = leagueReports.find((report) => report.id === reportId);
    setLeagueReports((current) => current.map((report) => report.id === reportId ? { ...report, status: resolution, resolvedAt: Date.now() } : report));
    if (resolution === "expelled" && selectedReport) {
      setPrivateLeagueInvites((current) => current.map((invite) => {
        if (invite.league.id !== selectedReport.leagueId) return invite;
        const participants = invite.participants.filter((participant) => participant.id !== selectedReport.reportedUserId && participant.teamName !== selectedReport.reportedTeamName);
        return { ...invite, participants, league: { ...invite.league, members: `${participants.length}/${invite.rules.capacity}` } };
      }));
      setLeagues((current) => current.map((league) => league.id === selectedReport.leagueId ? { ...league, members: `${Math.max(0, Number(league.members.split("/")[0]) - 1)}/${league.members.split("/")[1]}` } : league));
    }
    notify(resolution === "expelled" ? "Resolución guardada · usuario expulsado" : resolution === "warning" ? "Resolución guardada · advertencia enviada" : "Denuncia archivada sin sanción");
  }

  async function leaveLeague(leagueId: string, successorId?: string): Promise<string | null> {
    const participation = participations.find((item) => item.leagueId === leagueId);
    const invite = privateLeagueInvites.find((item) => item.league.id === leagueId);
    const isAdmin = privateLeagueAdminIds.includes(leagueId);
    if (isAdmin && invite && invite.participants.length > 1 && !successorId) return "Selecciona quién será el nuevo administrador.";
    if (sessionUser?.id !== "demo_user") {
      try { await leaveNexoLeague(leagueId, successorId); }
      catch (failure) { return failure instanceof Error ? failure.message : "No se ha podido abandonar la liga."; }
    }
    if (invite) {
      if (isAdmin && invite.participants.length === 1) {
        setPrivateLeagueInvites((current) => current.filter((item) => item.league.id !== leagueId));
        setPrivateLeagueRules((current) => { const next = { ...current }; delete next[leagueId]; return next; });
      } else {
        setPrivateLeagueInvites((current) => current.map((item) => item.league.id === leagueId ? { ...item, participants: item.participants.filter((participant) => participant.id !== initialData.user.id).map((participant) => participant.id === successorId ? { ...participant, role: "admin" as const } : participant), league: { ...item.league, members: `${Math.max(0, item.participants.length - 1)}/${item.rules.capacity}` } } : item));
      }
    }
    setPrivateLeagueAdminIds((current) => current.filter((id) => id !== leagueId));
    setParticipations((current) => current.filter((item) => item.leagueId !== leagueId));
    setLeagues((current) => current.filter((item) => item.id !== leagueId));
    setLeagueBids((current) => { const next = { ...current }; delete next[leagueId]; return next; });
    setSentOffers((current) => { const next = { ...current }; delete next[leagueId]; return next; });
    setClausePurchases((current) => { const next = { ...current }; delete next[leagueId]; return next; });
    if (participation) {
      setInitialSquads((current) => { const next = { ...current }; delete next[participation.id]; return next; });
      setPlayerContracts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${participation.id}:`))));
      setPlayerOffers((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${participation.id}:`))));
      setFantasyLineups((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${participation.id}:`))));
    }
    setManagedPrivateLeagueId(null);
    setSelectedLeagueId("");
    navigate("ligas");
    notify(isAdmin && invite?.participants.length === 1 ? "Liga cerrada · eras su único participante" : isAdmin ? "Has abandonado la liga y transferido la administración" : "Has abandonado la liga");
    return null;
  }

  function adjustLeagueBudget(participationId: string, difference: number) {
    setParticipations((current) => current.map((item) => item.id === participationId ? { ...item, budget: Number((item.budget + difference).toFixed(1)) } : item));
  }

  function sellBenchPlayer(participationId: string, player: InitialSquadPlayer, saleAmount = player.value * .5) {
    setInitialSquads((current) => {
      const squad = current[participationId];
      if (!squad || squad.startingPlayerIds.includes(player.id)) return current;
      return { ...current, [participationId]: { ...squad, players: squad.players.filter((item) => item.id !== player.id), benchPlayerIds: squad.benchPlayerIds.filter((id) => id !== player.id), totalValue: Number((squad.totalValue - player.value).toFixed(1)) } };
    });
    adjustLeagueBudget(participationId, saleAmount);
    setPlayerContracts((current) => { const next = { ...current }; delete next[`${participationId}:${player.id}`]; return next; });
  }

  function createPlayerOffer(participationId: string, player: InitialSquadPlayer, source: "rival" | "game", renewalHours = 24) {
    const key = `${participationId}:${player.id}`;
    const existing = playerOffers[key] ?? [];
    if (existing.some((offer) => offer.source === source && offer.status === "active" && offer.expiresAt > Date.now())) return;
    const createdAt = Date.now();
    const offer: PlayerOffer = source === "rival"
      ? { id: `offer_${crypto.randomUUID()}`, playerId: player.id, source, bidderName: "Rayo Blanco", bidderInitials: "RB", amount: Number((player.value * 1.12).toFixed(1)), createdAt, expiresAt: createdAt + 24 * 60 * 60 * 1000, status: "active" }
      : { id: `offer_${crypto.randomUUID()}`, playerId: player.id, source, bidderName: "Nexo · Mercado", bidderInitials: "NF", amount: Number((player.value * 1.04).toFixed(1)), createdAt, expiresAt: nextMarketRenewal(renewalHours), status: "active" };
    setPlayerOffers((current) => ({ ...current, [key]: [...(current[key] ?? []), offer] }));
    setPlayerContracts((current) => { const contract = current[key] ?? { clause: Number((player.value * 1.5).toFixed(1)), listed: true, untouchable: false, offers: 0 }; return { ...current, [key]: { ...contract, offers: contract.offers + 1 } }; });
  }

  function respondToPlayerOffer(participationId: string, player: InitialSquadPlayer, offerId: string, accept: boolean) {
    const key = `${participationId}:${player.id}`;
    const offers = playerOffers[key] ?? [];
    const selectedOffer = offers.find((offer) => offer.id === offerId && offer.status === "active" && offer.expiresAt > Date.now());
    if (!selectedOffer) { notify("La oferta ya no está disponible"); return; }
    setPlayerOffers((current) => ({ ...current, [key]: (current[key] ?? []).map((offer) => offer.id === offerId ? { ...offer, status: accept ? "accepted" : "rejected" } : accept && offer.status === "active" ? { ...offer, status: "rejected" } : offer) }));
    setPlayerContracts((current) => current[key] ? { ...current, [key]: { ...current[key], offers: accept ? 0 : Math.max(0, current[key].offers - 1) } } : current);
    if (accept) {
      sellBenchPlayer(participationId, player, selectedOffer.amount);
      notify(`Oferta de ${selectedOffer.amount.toFixed(1).replace(".", ",")} M aceptada; las demás se han rechazado`);
    } else notify("Oferta rechazada");
  }

  function renewLeagueMarketAsAdmin(leagueId: string) {
    const leagueParticipationIds = participations.filter((item) => item.leagueId === leagueId).map((item) => item.id);
    const listedPlayers = leagueParticipationIds.flatMap((participationId) => {
      const squad = initialSquads[participationId];
      return (squad?.players ?? []).filter((player) => playerContracts[`${participationId}:${player.id}`]?.listed).map((player) => ({ participationId, player }));
    });
    listedPlayers.forEach(({ participationId, player }) => createPlayerOffer(participationId, player, "game", marketRules.renewalHours));
    notify(listedPlayers.length ? `Mercado renovado · ${listedPlayers.length} ofertas del juego simuladas` : "Mercado renovado · no había jugadores en venta");
  }

  function executeClausePurchase(leagueId: string, rivalTeamId: string, player: InitialSquadPlayer, clause: number, blind: boolean): string | null {
    const league = leagues.find((item) => item.id === leagueId);
    const participation = participations.find((item) => item.leagueId === leagueId);
    if (!league || !participation) return "No se ha encontrado tu participación en esta liga";
    if (league.mode === "fantasy") return "Las ligas fantásticas no utilizan clausulazos";
    if (blind) return "Este jugador está blindado y no admite clausulazo";
    if (Date.now() >= matchdayStartAt - 24 * 60 * 60 * 1000) return "El plazo de clausulazos ha cerrado 24 horas antes de la jornada";
    const squad = initialSquads[participation.id];
    if (!squad) return "Tu plantilla todavía no está disponible";
    if (squad.players.some((item) => item.id === player.id)) return "Este jugador ya pertenece a tu plantilla";
    if (clausePurchases[leagueId]?.some((purchase) => purchase.playerId === player.id)) return "Otro clausulazo ya ha transferido a este jugador";
    const benchCount = Math.max(0, squad.players.length - 11);
    if (benchCount >= marketRules.maxBenchPlayers) return `Tu banquillo ya tiene el máximo de ${marketRules.maxBenchPlayers} jugadores`;
    if (participation.budget < clause) return `Necesitas ${clause.toFixed(1).replace(".", ",")} M de saldo real`;
    setParticipations((current) => current.map((item) => item.id === participation.id ? { ...item, budget: Number((item.budget - clause).toFixed(1)) } : item));
    setInitialSquads((current) => ({ ...current, [participation.id]: { ...squad, players: [...squad.players, player], benchPlayerIds: [...squad.benchPlayerIds, player.id], totalValue: Number((squad.totalValue + player.value).toFixed(1)) } }));
    setClausePurchases((current) => ({ ...current, [leagueId]: [...(current[leagueId] ?? []), { playerId: player.id, playerName: player.name, rivalTeamId, amount: clause, purchasedAt: Date.now() }] }));
    setSentOffers((current) => ({ ...current, [leagueId]: (current[leagueId] ?? []).map((offer) => offer.targetPlayerId === player.id && offer.status === "active" ? { ...offer, status: "cancelled" } : offer) }));
    notify(`Clausulazo completado · ${player.name} ya está en tu banquillo`);
    return null;
  }

  function navigate(section: Section) {
    if (section === "admin" && sessionUser?.role !== "admin") {
      notify("Esta sección está reservada a administradores");
      setActive("inicio");
      return;
    }
    setActive(section);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openLeague(leagueId: string) {
    setSelectedLeagueId(leagueId);
    setLeagueAreaSection("resumen");
    navigate("liga");
  }

  async function createPrivateLeague(input: CreatePrivateLeagueInput): Promise<{ error?: string; leagueId?: string; accessCode?: string }> {
    const name = input.name.trim();
    const selectedTeam = teams.find((item) => item.id === input.teamId);
    if (selectedTeam && activeTeamCountForClub(selectedTeam.id) >= clubRules.maxActiveTeams) return { error: `Este club ya tiene ${clubRules.maxActiveTeams} equipos activos. Libera una plaza o utiliza otro club.` };
    if (name.length < 3 || name.length > 30) return { error: "El nombre debe tener entre 3 y 30 caracteres." };
    if (leagues.some((item) => item.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return { error: "Ya existe una liga con ese nombre." };
    if (!selectedTeam || selectedTeam.competition !== input.competition) return { error: "Selecciona un equipo de la misma competición." };
    let leagueId = `private_local_${crypto.randomUUID()}`;
    let participationId = `entry_local_${crypto.randomUUID()}`;
    let accessCode = "";
    if (sessionUser?.id !== "demo_user") {
      try {
        const created = await createNexoPrivateLeague({ name, teamId: selectedTeam.id, capacity: input.rules.capacity, rules: input.rules });
        leagueId = created.leagueId;
        participationId = created.membershipId;
        accessCode = created.accessCode;
      } catch (failure) { return { error: failure instanceof Error ? failure.message : "No se ha podido crear la liga." }; }
    } else {
      do { accessCode = `NX-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; } while (Object.values(privateLeagueRules).some((rules) => rules.accessCode === accessCode));
    }
    const rules: PrivateLeagueRules = { ...input.rules, accessCode, version: 1, updatedAt: Date.now() };
    const league: LeagueSummary = { id: leagueId, name, competitionId: selectedTeam.competitionId, competition: input.competition, mode: "market", rosterPolicy: "exclusive", type: "Privada · Mercado", rank: "1.º", members: `1/${rules.capacity}`, accent: "lime" };
    const participation: LeagueParticipation = { id: participationId, leagueId, teamId: selectedTeam.id, rosterId: `roster_local_${crypto.randomUUID()}`, budget: rules.startingBudget };
    setLeagues((current) => [...current, league]);
    setParticipations((current) => [...current, participation]);
    setInitialSquads((current) => ({ ...current, [participationId]: createLocalSquad(input.competition, rules.initialSquadSize) }));
    setPrivateLeagueRules((current) => ({ ...current, [leagueId]: rules }));
    setPrivateLeagueAdminIds((current) => [...current, leagueId]);
    setPrivateLeagueInvites((current) => [...current, { league, rules, participants: [{ id: participationId, initials: sessionUser?.initials ?? initialData.user.initials, userName: sessionUser?.displayName ?? initialData.user.displayName, teamName: selectedTeam.name, role: "admin" }], activeReservations: 0 }]);
    setTeamId(selectedTeam.id);
    setCompetition(input.competition);
    notify("Liga privada creada · ya puedes compartir el código");
    return { leagueId, accessCode };
  }

  function updatePrivateLeague(leagueId: string, name: string, rules: PrivateLeagueRules) {
    const nextRules = { ...rules, version: rules.version + 1, updatedAt: Date.now() };
    setPrivateLeagueRules((current) => ({ ...current, [leagueId]: nextRules }));
    setLeagues((current) => current.map((league) => league.id === leagueId ? { ...league, name: name.trim() || league.name, members: `${league.members.split("/")[0]}/${rules.capacity}` } : league));
    setPrivateLeagueInvites((current) => current.map((invite) => invite.league.id === leagueId ? { ...invite, league: { ...invite.league, name: name.trim() || invite.league.name, members: `${invite.participants.length}/${rules.capacity}` }, rules: nextRules } : invite));
    notify("Reglas actualizadas · se aplicarán a las próximas operaciones");
  }

  function regeneratePrivateLeagueCode(leagueId: string): string {
    let accessCode = "";
    do { accessCode = `NX-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; } while (Object.values(privateLeagueRules).some((rules) => rules.accessCode === accessCode));
    setPrivateLeagueRules((current) => current[leagueId] ? { ...current, [leagueId]: { ...current[leagueId], accessCode, version: current[leagueId].version + 1, updatedAt: Date.now() } } : current);
    setPrivateLeagueInvites((current) => current.map((invite) => invite.league.id === leagueId ? { ...invite, rules: { ...invite.rules, accessCode, version: invite.rules.version + 1, updatedAt: Date.now() } } : invite));
    notify("Código anterior invalidado · comparte el nuevo código");
    return accessCode;
  }

  async function findPrivateLeagueByCode(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) { notify("Introduce un código de liga"); return; }
    const invite = privateLeagueInvites.find((item) => item.rules.accessCode === normalized);
    if (invite) { setPrivateJoinInvite(invite); return; }
    if (sessionUser?.id === "demo_user") { notify("No existe ninguna liga activa con ese código"); return; }
    try {
      const result = await previewNexoPrivateLeague(normalized);
      if (!result) { notify("No existe ninguna liga activa con ese código"); return; }
      const participantRows = Array.isArray(result.rules?._participants) ? result.rules._participants : [];
      const backendRules: PrivateLeagueRules = { ...defaultPrivateLeagueRules, ...result.rules, accessCode: normalized, capacity: result.capacity, startingBudget: Number(result.starting_budget), joinLocked: result.join_locked, version: 1, updatedAt: Date.now() };
      const backendInvite: PrivateLeagueInvite = {
        league: { id: result.id, name: result.name, competitionId: result.competition_id === "primera" ? "comp_primera" : result.competition_id === "segunda" ? "comp_segunda" : "comp_liga_f", competition: result.competition_name, mode: result.mode, rosterPolicy: result.roster_policy, type: "Privada · Mercado", rank: "—", members: `${result.member_count}/${result.capacity}`, accent: result.accent },
        rules: backendRules,
        participants: participantRows.map((participant) => ({ id: participant.id, initials: participant.initials, userName: participant.userName, teamName: participant.teamName, role: participant.role })),
        activeReservations: 0,
      };
      setPrivateLeagueInvites((current) => [...current.filter((item) => item.league.id !== backendInvite.league.id), backendInvite]);
      setPrivateJoinInvite(backendInvite);
    } catch { notify("No se ha podido comprobar el código. Inténtalo de nuevo."); }
  }

  async function joinPrivateLeague(invite: PrivateLeagueInvite, selectedTeamId: string): Promise<string | null> {
    const selectedTeam = teams.find((team) => team.id === selectedTeamId);
    if (selectedTeam && activeTeamCountForClub(selectedTeam.id) >= clubRules.maxActiveTeams) return `Este club ya ha alcanzado el límite de ${clubRules.maxActiveTeams} equipos activos.`;
    if (invite.rules.joinLocked) return "El administrador ha bloqueado temporalmente nuevas entradas.";
    if (availablePrivateLeagueSlots(invite) <= 0) return "La última plaza acaba de ocuparse o está reservada por otro usuario.";
    if (participations.some((item) => item.leagueId === invite.league.id)) return "Ya participas en esta liga.";
    if (!selectedTeam || selectedTeam.competition !== invite.league.competition) return "Selecciona un equipo de la misma competición.";
    let backendReservationId: string | null = null;
    if (sessionUser?.id !== "demo_user") {
      try { backendReservationId = await reserveNexoLeaguePlace(invite.league.id, invite.rules.accessCode); }
      catch (failure) { return failure instanceof Error ? failure.message : "No se ha podido reservar la plaza."; }
    }
    setPrivateLeagueInvites((current) => current.map((item) => item.league.id === invite.league.id ? { ...item, activeReservations: item.activeReservations + 1 } : item));
    const assignedIds = new Set(participations.filter((item) => item.leagueId === invite.league.id).flatMap((item) => initialSquads[item.id]?.players.map((player) => player.id) ?? []));
    let allocatedSquad: InitialSquad;
    try {
      allocatedSquad = (await createDemoAllocationGateway(assignedIds).allocate({ leagueId: invite.league.id, teamId: selectedTeam.id, competition: invite.league.competition, targetValue: createLocalSquad(invite.league.competition, invite.rules.initialSquadSize).totalValue, squadSize: invite.rules.initialSquadSize, idempotencyKey: crypto.randomUUID() })).squad;
    } catch {
      if (backendReservationId) await cancelNexoLeagueReservation(backendReservationId);
      setPrivateLeagueInvites((current) => current.map((item) => item.league.id === invite.league.id ? { ...item, activeReservations: Math.max(0, item.activeReservations - 1) } : item));
      return "No quedan suficientes jugadores exclusivos para entregar una plantilla válida. La plaza reservada se ha liberado.";
    }
    let backendMembershipId: string | null = null;
    if (backendReservationId) {
      try { backendMembershipId = await confirmNexoLeagueJoin(backendReservationId, selectedTeam.id); }
      catch (failure) {
        await cancelNexoLeagueReservation(backendReservationId);
        setPrivateLeagueInvites((current) => current.map((item) => item.league.id === invite.league.id ? { ...item, activeReservations: Math.max(0, item.activeReservations - 1) } : item));
        return failure instanceof Error ? failure.message : "La plaza reservada ya no está disponible.";
      }
    }
    const participation: LeagueParticipation = { id: backendMembershipId ?? `entry_local_${crypto.randomUUID()}`, leagueId: invite.league.id, teamId: selectedTeam.id, rosterId: `roster_local_${crypto.randomUUID()}`, budget: invite.rules.startingBudget };
    const nextParticipants: PrivateLeagueParticipant[] = [...invite.participants, { id: initialData.user.id, initials: initialData.user.initials, userName: initialData.user.displayName, teamName: selectedTeam.name, role: "member" }];
    const joinedLeague = { ...invite.league, rank: "—", members: `${nextParticipants.length}/${invite.rules.capacity}` };
    setParticipations((current) => [...current, participation]);
    setInitialSquads((current) => ({ ...current, [participation.id]: allocatedSquad }));
    setLeagues((current) => current.some((league) => league.id === joinedLeague.id) ? current.map((league) => league.id === joinedLeague.id ? joinedLeague : league) : [...current, joinedLeague]);
    setPrivateLeagueRules((current) => ({ ...current, [joinedLeague.id]: invite.rules }));
    setPrivateLeagueInvites((current) => current.map((item) => item.league.id === joinedLeague.id ? { ...item, league: joinedLeague, participants: nextParticipants, activeReservations: Math.max(0, item.activeReservations - 1) } : item));
    setPrivateJoinInvite(null);
    setJoinCode("");
    setTeamId(selectedTeam.id);
    setCompetition(joinedLeague.competition);
    setAllocationPresentation({ league: { id: joinedLeague.id, name: joinedLeague.name, competitionId: joinedLeague.competitionId, competition: joinedLeague.competition, mode: "market", rosterPolicy: "exclusive", memberCount: nextParticipants.length, capacity: invite.rules.capacity, startingBudget: invite.rules.startingBudget, targetSquadValue: allocatedSquad.targetValue, accent: joinedLeague.accent }, team: selectedTeam, squad: allocatedSquad });
    return null;
  }

  function createTeam(input: CreateTeamInput): string | null {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 24) {
      return "El nombre debe tener entre 3 y 24 caracteres.";
    }
    if (teams.some((item) => item.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) {
      return "Ya tienes un club con ese nombre.";
    }

    const competitionInfo = initialData.competitions.find((item) => item.name === input.competition);
    if (!competitionInfo) return "La competición seleccionada no está disponible.";

    const currentCount = teams.filter((item) => item.competition === input.competition).length;
    const requiresCoins = currentCount >= initialData.rules.freeTeamsPerCompetition;
    if (requiresCoins && coins < initialData.rules.additionalTeamCost) {
      return "No tienes monedas suficientes para desbloquear otra plaza.";
    }

    const shortName = name
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 3)
      .toUpperCase() || "XI";
    const newTeam: FantasyTeamSummary = {
      id: `team_local_${crypto.randomUUID()}`,
      name,
      shortName,
      competitionId: competitionInfo.id,
      competition: input.competition,
    };

    setTeams((current) => [...current, newTeam]);
    setTeamId(newTeam.id);
    setCompetition(input.competition);
    if (backendClubId && sessionUser?.id !== "demo_user") {
      void createNexoTeam({ clubId: backendClubId, name, shortName, competition: input.competition })
        .then((persistedTeam) => {
          setTeams((current) => current.map((item) => item.id === newTeam.id ? persistedTeam : item));
          setTeamId((current) => current === newTeam.id ? persistedTeam.id : current);
        })
        .catch(() => {
          setTeams((current) => current.filter((item) => item.id !== newTeam.id));
          notify("No se ha podido guardar el equipo. Inténtalo de nuevo.");
        });
    }
    if (requiresCoins) setCoins((current) => current - initialData.rules.additionalTeamCost);
    setTeamCreatorOpen(false);
    notify(requiresCoins ? `Club creado · ${initialData.rules.additionalTeamCost} monedas utilizadas` : "Club creado gratis");
    if (resumeJoinAfterClub) {
      if (resumeJoinAfterClub.mode === "fantasy") { setFantasyJoinEventId(resumeJoinAfterClub.eventId ?? null); setFantasyJoinOpen(true); }
      else setPublicJoinOpen(true);
      setResumeJoinAfterClub(null);
    }
    return null;
  }

  async function joinPublicLeague(leagueId: string, selectedTeamId: string): Promise<string | null> {
    const publicLeague = [...availablePublicLeagues, ...fantasyEventLeagues].find((item) => item.id === leagueId);
    const fantasyEvent = fantasyEvents.find((event) => event.id === leagueId);
    const selectedTeam = teams.find((item) => item.id === selectedTeamId);
    const consumesClubSlot = !(fantasyEvent?.format === "partidazo" && !clubRules.singleMatchEventsConsumeSlot);
    if (selectedTeam && consumesClubSlot && activeTeamCountForClub(selectedTeam.id) >= clubRules.maxActiveTeams) return `Este club ya tiene ${clubRules.maxActiveTeams} equipos activos. Elige otro club o libera una plaza.`;
    if (!publicLeague || !selectedTeam) return "No se ha podido preparar la participación.";
    if (publicLeague.competitionId !== selectedTeam.competitionId) return "El equipo no pertenece a esta competición.";
    if (participations.some((item) => item.leagueId === leagueId)) return "Ya participas en esta liga.";
    if (publicLeague.memberCount >= publicLeague.capacity) return "Esta liga ya está completa.";

    let reservationId: string | null = null;
    const persistentLeague = availablePublicLeagues.some((league) => league.id === leagueId) && sessionUser?.id !== "demo_user";
    if (persistentLeague) {
      try { reservationId = await reserveNexoLeaguePlace(leagueId); }
      catch (failure) { return failure instanceof Error ? failure.message : "No se ha podido reservar la plaza."; }
    }

    let allocatedSquad: InitialSquad = { formation: "4-4-2", players: [], startingPlayerIds: [], benchPlayerIds: [], totalValue: 0, targetValue: 0 };
    if (publicLeague.mode === "market") {
      const sameLeagueParticipationIds = participations.filter((item) => item.leagueId === leagueId).map((item) => item.id);
      const assignedPlayerIds = new Set(sameLeagueParticipationIds.flatMap((participationId) => initialSquads[participationId]?.players.map((player) => player.id) ?? []));
      try {
        const confirmedAllocation = await createDemoAllocationGateway(assignedPlayerIds).allocate({ leagueId, teamId: selectedTeamId, competition: publicLeague.competition, targetValue: publicLeague.targetSquadValue, idempotencyKey: crypto.randomUUID() });
        allocatedSquad = confirmedAllocation.squad;
      } catch {
        if (reservationId) await cancelNexoLeagueReservation(reservationId);
        return "No quedan suficientes jugadores para formar una plantilla equilibrada.";
      }
    }

    let persistentMembershipId: string | null = null;
    if (reservationId) {
      try { persistentMembershipId = await confirmNexoLeagueJoin(reservationId, selectedTeamId); }
      catch (failure) {
        await cancelNexoLeagueReservation(reservationId);
        return failure instanceof Error ? failure.message : "La plaza ya no está disponible.";
      }
    }

    const participation: LeagueParticipation = {
      id: persistentMembershipId ?? `entry_local_${crypto.randomUUID()}`,
      leagueId,
      teamId: selectedTeamId,
      rosterId: `roster_local_${crypto.randomUUID()}`,
      budget: fantasyEvent?.snapshot?.budget ?? publicLeague.startingBudget,
    };
    const joinedLeague: LeagueSummary = {
      id: publicLeague.id,
      name: publicLeague.name,
      competitionId: publicLeague.competitionId,
      competition: publicLeague.competition,
      mode: publicLeague.mode,
      rosterPolicy: publicLeague.rosterPolicy,
      type: publicLeague.mode === "fantasy" ? "Fantástica · Presupuesto" : "Pública · Mercado",
      rank: "—",
      members: `${publicLeague.memberCount + 1}/${publicLeague.capacity}`,
      accent: publicLeague.accent,
    };

    setParticipations((current) => [...current, participation]);
    setInitialSquads((current) => ({ ...current, [participation.id]: allocatedSquad }));
    setLeagues((current) => [...current, joinedLeague]);
    if (persistentLeague) setAvailablePublicLeagues((current) => current.map((league) => league.id === leagueId ? { ...league, memberCount: league.memberCount + 1 } : league));
    if (fantasyEvent) setFantasyEvents((current) => current.map((event) => event.id === fantasyEvent.id ? { ...event, memberCount: event.memberCount + 1 } : event));
    setTeamId(selectedTeamId);
    setCompetition(publicLeague.competition);
    setPublicJoinOpen(false);
    setFantasyJoinOpen(false);
    setFantasyJoinEventId(null);
    if (publicLeague.mode === "fantasy") {
      setSelectedLeagueId(joinedLeague.id);
      setLeagueAreaSection("equipo");
      setActive("liga");
      notify("Ya estás dentro · crea tu equipo para la Jornada 5");
    } else setAllocationPresentation({ league: publicLeague, team: selectedTeam, squad: allocatedSquad });
    return null;
  }

  function createTeamFromJoin(competitionName: CompetitionName, mode: "market" | "fantasy", eventId?: string | null) {
    setCompetition(competitionName);
    setResumeJoinAfterClub({ mode, eventId });
    setPublicJoinOpen(false);
    setFantasyJoinOpen(false);
    setFantasyJoinEventId(null);
    setTeamCreatorOpen(true);
  }

  if (!authChecked || !sessionUser) return <AuthGateway onLogin={loginWithBackend} onRegister={registerWithBackend} onRecover={sendNexoPasswordReset} onDemo={() => startSession({ id: "demo_user", displayName: initialData.user.displayName, email: "", initials: initialData.user.initials, role: "admin" })} />;
  const displayUser = { ...initialData.user, ...sessionUser };
  const visibleNotifications = notifications.filter((item) => item.type === "achievement" ? preferences.achievementNotifications : item.type === "market" ? preferences.marketNotifications : preferences.matchdayNotifications);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Navegación principal">
          {navItems.map((item) => (
            <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="side-team">
          <span className="team-crest">{teamInfo.shortName}</span>
          <div><small>Club activo</small><strong>{team}</strong></div>
          <button aria-label="Cambiar club" onClick={() => navigate("equipo")}>⌄</button>
        </div>
        <button className={`admin-link ${active === "ayuda" ? "active" : ""}`} onClick={() => navigate("ayuda")}>
          <span>?</span> Ayuda y reglas
        </button>
        {sessionUser.role === "admin" && <button className={`admin-link ${active === "admin" ? "active" : ""}`} onClick={() => navigate("admin")}>
          <span>⚙</span> Administración
        </button>}
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><Brand /></div>
          <div className="topbar-spacer" />
          <button className="coin-pill" onClick={() => notify(`Tienes ${coins.toLocaleString("es-ES")} monedas de prueba`)} aria-label="Ver monedas">
            <span>◆</span> {coins.toLocaleString("es-ES")}
          </button>
          <div className="notification-anchor">
            <button className={`notification-button ${visibleNotifications.some((item) => !item.read) ? "has-unread" : ""}`} onClick={() => setNotificationsOpen((current) => !current)} aria-label={`Notificaciones · ${visibleNotifications.filter((item) => !item.read).length} sin leer`} aria-expanded={notificationsOpen}>♢{visibleNotifications.some((item) => !item.read) && <i>{visibleNotifications.filter((item) => !item.read).length}</i>}</button>
            {notificationsOpen && <NotificationCenter notifications={visibleNotifications} onOpen={openNotification} onMarkAllRead={() => setNotifications((current) => current.map((item) => ({ ...item, read: true })))} onClose={() => setNotificationsOpen(false)} />}
          </div>
          <button className="profile-button" onClick={() => navigate("perfil")}><Avatar label={displayUser.initials} /><span>{displayUser.displayName}</span></button>
        </header>

        <main className="content">
          {active === "inicio" && (
            <Dashboard userName={displayUser.displayName} competition={competition} setCompetition={setCompetition} team={team} teamLeagueCount={participations.filter((item) => item.teamId === teamId).length} clubMotto={clubIdentityMeta[teamId]?.motto} leagues={leagues} featuredLeagueIds={featuredLeagueIds} onToggleFeaturedLeague={toggleFeaturedLeague} onOpenLeague={openLeague} featuredFantasyEvent={fantasyEvents.find((event) => event.featured && event.status !== "finished")} onJoinFantasy={openFantasyJoin} navigate={navigate} />
          )}
          {active === "equipo" && (
            <TeamView teamId={teamId} setTeamId={setTeamId} teams={teams} leagues={leagues} participations={participations} clubRules={clubRules} clubIdentityMeta={clubIdentityMeta} onUpdateClub={updateClubIdentity} competition={competition} setCompetition={setCompetition} freeLimit={initialData.rules.freeTeamsPerCompetition} onCreateTeam={() => setTeamCreatorOpen(true)} onOpenLeague={openLeague} onBrowseLeagues={() => navigate("ligas")} />
          )}
          {active === "tendencias" && (
            <TrendsView competition={competition} setCompetition={setCompetition} query={query} setQuery={setQuery} position={position} setPosition={setPosition} />
          )}
          {active === "ligas" && (
            <LeaguesView leagues={leagues} featuredLeagueIds={featuredLeagueIds} onToggleFeaturedLeague={toggleFeaturedLeague} fantasyEvents={fantasyEvents.filter((event) => event.status !== "draft" && event.status !== "finished")} onOpenLeague={openLeague} onJoinPublic={() => setPublicJoinOpen(true)} onJoinFantasy={openFantasyJoin} onCreatePrivate={() => setPrivateLeagueCreatorOpen(true)} onJoinCode={findPrivateLeagueByCode} joinCode={joinCode} setJoinCode={setJoinCode} notify={notify} />
          )}
          {active === "liga" && leagues.find((item) => item.id === selectedLeagueId) && (
            <LeagueDetailView
              league={leagues.find((item) => item.id === selectedLeagueId)!}
              team={teams.find((item) => item.id === participations.find((entry) => entry.leagueId === selectedLeagueId)?.teamId) ?? teamInfo}
              participation={participations.find((entry) => entry.leagueId === selectedLeagueId)}
              squad={initialSquads[participations.find((entry) => entry.leagueId === selectedLeagueId)?.id ?? ""]}
              section={leagueAreaSection}
              onSectionChange={setLeagueAreaSection}
              onBack={() => navigate("ligas")}
              marketPlayers={competitionPlayers[leagues.find((item) => item.id === selectedLeagueId)!.competition].map((player, index) => ({ id: player.id, initials: player.initials, name: player.name, clubId: player.club.toLowerCase().replace(/[^a-z0-9]+/g, "_"), club: player.club, position: player.position, points: 0, price: player.value, trend: index % 2 ? "+0,1 M" : "Sin cambios" }))}
              marketRules={effectiveMarketRules}
              privateRules={selectedPrivateRules}
              canManagePrivateLeague={privateLeagueAdminIds.includes(selectedLeagueId)}
              privateAdmin={privateLeagueInvites.find((invite) => invite.league.id === selectedLeagueId)?.participants.find((participant) => participant.role === "admin")}
              privateParticipants={privateLeagueInvites.find((invite) => invite.league.id === selectedLeagueId)?.participants ?? []}
              onManagePrivateLeague={() => setManagedPrivateLeagueId(selectedLeagueId)}
              reports={leagueReports.filter((report) => report.leagueId === selectedLeagueId)}
              onReport={(rival, category, details) => submitLeagueReport(selectedLeagueId, rival, category, details)}
              onResolveReport={resolveLeagueReport}
              onLeaveLeague={(successorId) => leaveLeague(selectedLeagueId, successorId)}
              bids={leagueBids[selectedLeagueId] ?? []}
              onChangeBids={(bids) => setLeagueBids((current) => ({ ...current, [selectedLeagueId]: bids }))}
              playerContracts={playerContracts}
              playerOffers={playerOffers}
              onChangePlayerContract={(playerId, contract) => { const participationId = participations.find((entry) => entry.leagueId === selectedLeagueId)?.id; if (participationId) setPlayerContracts((current) => ({ ...current, [`${participationId}:${playerId}`]: contract })); }}
              onCreatePlayerOffer={(player, source) => { const participationId = participations.find((entry) => entry.leagueId === selectedLeagueId)?.id; if (participationId) createPlayerOffer(participationId, player, source, marketRules.renewalHours); }}
              onRespondPlayerOffer={(player, offerId, accept) => { const participationId = participations.find((entry) => entry.leagueId === selectedLeagueId)?.id; if (participationId) respondToPlayerOffer(participationId, player, offerId, accept); }}
              sentOffers={sentOffers[selectedLeagueId] ?? []}
              onChangeSentOffers={(offers) => setSentOffers((current) => ({ ...current, [selectedLeagueId]: offers }))}
              clausePurchases={clausePurchases[selectedLeagueId] ?? []}
              matchdayStartAt={matchdayStartAt}
              onClausePurchase={(rivalTeamId, player, clause, blind) => executeClausePurchase(selectedLeagueId, rivalTeamId, player, clause, blind)}
              scoringRules={scoringRules}
              settlementRules={settlementRules}
              fantasyLineup={fantasyLineups[`${participations.find((entry) => entry.leagueId === selectedLeagueId)?.id ?? ""}:5`]}
              fantasyEvent={selectedFantasyEvent}
              onSaveFantasyLineup={(lineup) => { const participationId = participations.find((entry) => entry.leagueId === selectedLeagueId)?.id; if (participationId) setFantasyLineups((current) => ({ ...current, [`${participationId}:5`]: lineup })); }}
              onAdjustBudget={(difference) => { const participationId = participations.find((entry) => entry.leagueId === selectedLeagueId)?.id; if (participationId) adjustLeagueBudget(participationId, difference); }}
              onImmediateSale={(player) => { const participationId = participations.find((entry) => entry.leagueId === selectedLeagueId)?.id; if (participationId) sellBenchPlayer(participationId, player); }}
              notify={notify}
            />
          )}
          {active === "perfil" && <ProfileView user={displayUser} coins={coins} teams={teams} activeTeamId={teamId} onCreateTeam={() => setTeamCreatorOpen(true)} onLogout={logout} navigate={navigate} notify={notify} isAdmin={sessionUser.role === "admin"} preferences={preferences} onSavePreferences={(next) => { setPreferences(next); setCompetition(next.defaultCompetition); notify("Preferencias guardadas"); }} achievements={achievementCatalog} claimedAchievements={claimedAchievements} onClaimAchievement={claimAchievement} actions={coinActions} claimedActions={claimedCoinActions} onClaimAction={claimCoinAction} ledger={coinLedger} economyRules={economyRules} />}
          {active === "ayuda" && <HelpView />}
          {active === "admin" && sessionUser.role === "admin" && <AdminView marketRules={marketRules} setMarketRules={setMarketRules} clubRules={clubRules} setClubRules={setClubRules} economyRules={economyRules} setEconomyRules={setEconomyRules} settlementRules={settlementRules} setSettlementRules={setSettlementRules} onboardingConfig={onboardingConfig} onForceOnboarding={forceOnboarding} legalConfig={legalConfig} onPublishLegalVersion={publishLegalVersion} scoringRules={scoringRules} onChangeScoringRules={setScoringRules} teams={teams} leagues={leagues} participations={participations} squads={initialSquads} bids={leagueBids} playerContracts={playerContracts} playerOffers={playerOffers} sentOffers={sentOffers} playerCatalog={adminPlayerCatalog} onChangePlayerCatalog={setAdminPlayerCatalog} fantasyEvents={fantasyEvents} onCreateFantasyEvent={createFantasyEvent} onSnapshotFantasyEvent={snapshotFantasyEvent} onOpenLeague={openLeague} onRenewMarket={renewLeagueMarketAsAdmin} notify={notify} />}
        </main>

        {active === "liga" ? <LeagueAreaNav section={leagueAreaSection} onChange={setLeagueAreaSection} mobile /> : <nav className="bottom-nav" aria-label="Navegación móvil">{navItems.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => navigate(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>}
      </div>
      {teamCreatorOpen && (
        <CreateTeamDialog
          competitions={initialData.competitions}
          teams={teams}
          coins={coins}
          freeLimit={initialData.rules.freeTeamsPerCompetition}
          additionalCost={initialData.rules.additionalTeamCost}
          defaultCompetition={competition}
          onClose={() => { setTeamCreatorOpen(false); setResumeJoinAfterClub(null); }}
          onCreate={createTeam}
        />
      )}
      {onboardingOpen && <GameOnboarding userName={displayUser.displayName} reason={onboardingConfig.forceReason} onFinish={finishOnboarding} />}
      {legalAcceptanceOpen && <LegalAcceptanceDialog config={legalConfig} onAccept={acceptCurrentLegalVersions} onLogout={logout} />}
      {publicJoinOpen && (
        <JoinPublicLeagueDialog
          mode="market"
          competitions={initialData.competitions}
          teams={teams}
          publicLeagues={availablePublicLeagues.filter((league) => league.mode === "market")}
          participations={participations}
          clubRules={clubRules}
          onClose={() => setPublicJoinOpen(false)}
          onNeedTeam={(competitionName) => createTeamFromJoin(competitionName, "market")}
          onJoin={joinPublicLeague}
        />
      )}
      {fantasyJoinOpen && (
        <JoinPublicLeagueDialog mode="fantasy" initialEventId={fantasyJoinEventId} competitions={initialData.competitions} teams={teams} publicLeagues={[...availablePublicLeagues.filter((league) => league.mode === "fantasy"), ...fantasyEventLeagues]} fantasyEvents={fantasyEvents} participations={participations} clubRules={clubRules} onClose={() => { setFantasyJoinOpen(false); setFantasyJoinEventId(null); }} onNeedTeam={(competitionName) => createTeamFromJoin(competitionName, "fantasy", fantasyJoinEventId)} onJoin={joinPublicLeague} />
      )}
      {privateLeagueCreatorOpen && <CreatePrivateLeagueDialog competitions={initialData.competitions} teams={teams} defaultCompetition={competition} onClose={() => setPrivateLeagueCreatorOpen(false)} onCreate={createPrivateLeague} onOpenLeague={(leagueId) => { setPrivateLeagueCreatorOpen(false); openLeague(leagueId); }} />}
      {privateJoinInvite && <JoinPrivateLeagueDialog invite={privateJoinInvite} teams={teams} participations={participations} clubRules={clubRules} alreadyJoined={participations.some((item) => item.leagueId === privateJoinInvite.league.id)} onClose={() => setPrivateJoinInvite(null)} onJoin={joinPrivateLeague} onOpenExisting={() => { setPrivateJoinInvite(null); openLeague(privateJoinInvite.league.id); }} />}
      {managedPrivateLeagueId && privateLeagueRules[managedPrivateLeagueId] && leagues.find((league) => league.id === managedPrivateLeagueId) && <ManagePrivateLeagueDialog league={leagues.find((league) => league.id === managedPrivateLeagueId)!} rules={privateLeagueRules[managedPrivateLeagueId]} onClose={() => setManagedPrivateLeagueId(null)} onSave={(name, rules) => { updatePrivateLeague(managedPrivateLeagueId, name, rules); setManagedPrivateLeagueId(null); }} onRegenerateCode={() => regeneratePrivateLeagueCode(managedPrivateLeagueId)} />}
      {allocationPresentation && (
        <SquadAllocationScreen
          presentation={allocationPresentation}
          onFinish={() => { const leagueId = allocationPresentation.league.id; setAllocationPresentation(null); openLeague(leagueId); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const defaultPrivateLeagueRules: Omit<PrivateLeagueRules, "accessCode" | "version" | "updatedAt"> = {
  joinLocked: false,
  capacity: 12,
  startingBudget: 100,
  initialSquadSize: 16,
  renewalHours: 24,
  marketPlayersPerRenewal: 10,
  maxBenchPlayers: 20,
  maxDebtPercent: 20,
  clausesEnabled: true,
  clauseMultiplier: 1.5,
  clauseCutoffHours: 24,
  blindagesEnabled: true,
  blindageDurationHours: 24,
  directOffersEnabled: true,
  gameOffersEnabled: true,
  immediateSalePercent: 50,
  captainMultiplier: 2,
  lineupLockMinutes: 1,
};

function createDemoPrivateInvites(): PrivateLeagueInvite[] {
  const participants: PrivateLeagueParticipant[] = [
    { id: "invite_u1", initials: "LM", userName: "Lucía Martín", teamName: "Rayo Verde", role: "admin" },
    { id: "invite_u2", initials: "DR", userName: "Diego Ramos", teamName: "Distrito Sur", role: "member" },
    { id: "invite_u3", initials: "AM", userName: "Ana Molina", teamName: "Unión Norte", role: "member" },
    { id: "invite_u4", initials: "JS", userName: "Javi Soto", teamName: "Once Central", role: "member" },
    { id: "invite_u5", initials: "CG", userName: "Carmen Gil", teamName: "Barrio Alto", role: "member" },
  ];
  const openRules: PrivateLeagueRules = { ...defaultPrivateLeagueRules, accessCode: "AMIGOS7", version: 3, updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 };
  const lockedRules: PrivateLeagueRules = { ...defaultPrivateLeagueRules, accessCode: "CERRADA7", joinLocked: true, capacity: 12, version: 5, updatedAt: Date.now() - 4 * 60 * 60 * 1000 };
  return [
    { league: { id: "private_invite_amigos", name: "Liga de los Domingos", competitionId: "comp_primera", competition: "Primera", mode: "market", rosterPolicy: "exclusive", type: "Privada · Mercado", rank: "—", members: "5/12", accent: "lime" }, rules: openRules, participants, activeReservations: 0 },
    { league: { id: "private_invite_locked", name: "La Peña Cerrada", competitionId: "comp_primera", competition: "Primera", mode: "market", rosterPolicy: "exclusive", type: "Privada · Mercado", rank: "—", members: "5/12", accent: "violet" }, rules: lockedRules, participants, activeReservations: 0 },
  ];
}

function CreatePrivateLeagueDialog({ competitions, teams, defaultCompetition, onClose, onCreate, onOpenLeague }: { competitions: CompetitionSummary[]; teams: FantasyTeamSummary[]; defaultCompetition: CompetitionName; onClose: () => void; onCreate: (input: CreatePrivateLeagueInput) => Promise<{ error?: string; leagueId?: string; accessCode?: string }>; onOpenLeague: (leagueId: string) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [competition, setCompetition] = useState(defaultCompetition);
  const compatibleTeams = teams.filter((team) => team.competition === competition);
  const [teamId, setTeamId] = useState(() => teams.find((team) => team.competition === defaultCompetition)?.id ?? "");
  const [rules, setRules] = useState({ ...defaultPrivateLeagueRules });
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ leagueId: string; accessCode: string } | null>(null);

  function selectCompetition(next: CompetitionName) {
    setCompetition(next);
    setTeamId(teams.find((team) => team.competition === next)?.id ?? "");
    setError("");
  }

  function continueWizard() {
    if (step === 1 && (name.trim().length < 3 || !teamId)) { setError(name.trim().length < 3 ? "Escribe un nombre de al menos 3 caracteres." : "Necesitas un equipo de esta competición."); return; }
    setError("");
    setStep((current) => Math.min(4, current + 1));
  }

  async function createLeague() {
    const result = await onCreate({ name, competition, teamId, rules });
    if (result.error || !result.leagueId || !result.accessCode) { setError(result.error ?? "No se ha podido crear la liga."); return; }
    setCreated({ leagueId: result.leagueId, accessCode: result.accessCode });
  }

  if (created) return <div className="dialog-backdrop"><section className="team-dialog private-league-dialog private-created-dialog" role="dialog" aria-modal="true" aria-labelledby="private-created-title"><div className="private-created-mark">✓</div><p className="eyebrow">LIGA PRIVADA CREADA</p><h2 id="private-created-title">{name}</h2><p>Comparte este código con tus amigos. Solo podrán entrar con un equipo de {competition}.</p><div className="private-code-card"><small>CÓDIGO DE ACCESO</small><strong>{created.accessCode}</strong><span>{rules.capacity - 1} plazas disponibles ahora</span></div><div className="private-created-actions"><button className="secondary-button" onClick={onClose}>Cerrar</button><button className="primary-button" onClick={() => onOpenLeague(created.leagueId)}>Entrar y gestionar</button></div></section></div>;

  return <div className="dialog-backdrop"><section className="team-dialog private-league-dialog" role="dialog" aria-modal="true" aria-labelledby="private-league-title"><div className="dialog-header"><div><p className="eyebrow">NUEVA LIGA PRIVADA</p><h2 id="private-league-title">Crea tu competición</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="private-wizard-progress">{[[1,"Liga"],[2,"Mercado"],[3,"Reglas"],[4,"Revisar"]].map(([number,label]) => <div className={step >= number ? "active" : ""} key={number}><span>{step > number ? "✓" : number}</span><small>{label}</small></div>)}</div>{step === 1 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Nombre, división y equipo</h3><p>La división no podrá cambiar cuando haya participantes.</p></div><label className="private-field"><span>Nombre de la liga</span><input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="Ej. La liga de los viernes" /></label><div className="private-choice-label">COMPETICIÓN</div><div className="private-competition-grid">{competitions.filter((item) => item.enabled).map((item) => <button className={competition === item.name ? "active" : ""} key={item.id} onClick={() => selectCompetition(item.name)}><span>{item.name.slice(0,1)}</span><strong>{item.displayName}</strong></button>)}</div><div className="private-choice-label">EQUIPO CON EL QUE JUGARÁS</div><div className="private-team-grid">{compatibleTeams.map((team) => <button className={teamId === team.id ? "active" : ""} key={team.id} onClick={() => setTeamId(team.id)}><span>{team.shortName}</span><div><strong>{team.name}</strong><small>{team.competition}</small></div><b>{teamId === team.id ? "✓" : ""}</b></button>)}{!compatibleTeams.length && <div className="private-no-team">No tienes ningún equipo de {competition}. Créalo primero desde Equipo.</div>}</div></section>}{step === 2 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Economía y mercado</h3><p>Estos valores controlan el reparto inicial y cada renovación.</p></div><PrivateEconomyRules rules={rules} onChange={setRules} /></section>}{step === 3 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Operaciones y jornada</h3><p>Decide qué pueden hacer los participantes y hasta cuándo.</p></div><PrivateOperationRules rules={rules} onChange={setRules} /></section>}{step === 4 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Revisa antes de crear</h3><p>Podrás editar estas reglas después desde Gestionar liga.</p></div><div className="private-review-hero"><span>{name.slice(0,1).toUpperCase()}</span><div><small>{competition} · PRIVADA</small><strong>{name}</strong><p>{teams.find((team) => team.id === teamId)?.name}</p></div></div><div className="private-review-grid"><div><small>PARTICIPANTES</small><strong>{rules.capacity}</strong></div><div><small>PRESUPUESTO</small><strong>{rules.startingBudget} M</strong></div><div><small>PLANTILLA</small><strong>{rules.initialSquadSize}</strong></div><div><small>RENOVACIÓN</small><strong>{rules.renewalHours} h</strong></div><div><small>CLÁUSULAS</small><strong>{rules.clausesEnabled ? "Sí" : "No"}</strong></div><div><small>OFERTAS</small><strong>{rules.directOffersEnabled ? "Sí" : "No"}</strong></div></div><article className="private-future-note"><span>↗</span><p><strong>Cambios seguros</strong><small>Las futuras modificaciones no reescribirán jornadas, ventas ni pujas ya resueltas.</small></p></article></section>}{error && <p className="form-error">{error}</p>}<div className="wizard-actions"><button className="secondary-button" onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)}>{step === 1 ? "Cancelar" : "Atrás"}</button><button className="primary-button" onClick={step === 4 ? createLeague : continueWizard}>{step === 4 ? "Crear y obtener código" : "Continuar"}</button></div></section></div>;
}

function LegacyJoinPrivateLeagueDialog({ invite, teams, alreadyJoined, onClose, onJoin, onOpenExisting }: { invite: PrivateLeagueInvite; teams: FantasyTeamSummary[]; alreadyJoined: boolean; onClose: () => void; onJoin: (invite: PrivateLeagueInvite, teamId: string) => Promise<string | null>; onOpenExisting: () => void }) {
  const [step, setStep] = useState(1);
  const compatibleTeams = teams.filter((team) => team.competition === invite.league.competition);
  const [teamId, setTeamId] = useState(compatibleTeams[0]?.id ?? "");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const availableSlots = availablePrivateLeagueSlots(invite);
  const full = availableSlots <= 0;
  const unavailable = invite.rules.joinLocked || full || alreadyJoined;
  const status = alreadyJoined ? "Ya perteneces" : invite.rules.joinLocked ? "Entradas bloqueadas" : full ? "Sin plazas disponibles" : `${availableSlots} ${availableSlots === 1 ? "plaza disponible" : "plazas disponibles"}`;

  async function confirmJoin() {
    if (unavailable || !teamId) return;
    setJoining(true);
    const result = await onJoin(invite, teamId);
    setJoining(false);
    if (result) setError(result);
  }

  return <div className="dialog-backdrop"><section className="team-dialog private-league-dialog join-private-dialog" role="dialog" aria-modal="true" aria-labelledby="join-private-title"><div className="dialog-header"><div><p className="eyebrow">INVITACIÓN PRIVADA · {invite.rules.accessCode}</p><h2 id="join-private-title">{invite.league.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="private-wizard-progress three">{[[1,"Liga"],[2,"Reglas"],[3,"Equipo"]].map(([number,label]) => <div className={step >= number ? "active" : ""} key={number}><span>{step > number ? "✓" : number}</span><small>{label}</small></div>)}</div>{step === 1 && <section className="private-wizard-step"><div className={`private-invite-hero ${unavailable ? "unavailable" : ""}`}><span>{invite.league.name.slice(0,1)}</span><div><small>{invite.league.competition} · LIGA PRIVADA</small><strong>{invite.league.name}</strong><p>{invite.participants.length}/{invite.rules.capacity} participantes{invite.activeReservations > 0 ? ` · ${invite.activeReservations} en proceso` : ""}</p></div><b>{status}</b></div>{invite.rules.joinLocked && <article className="private-locked-alert"><span>×</span><div><strong>El administrador ha cerrado las entradas</strong><p>Puedes consultar la liga y sus reglas, pero no podrás unirte hasta que vuelva a abrirla.</p></div></article>}<div className="private-choice-label">YA ESTÁN DENTRO</div><div className="private-participant-list">{invite.participants.map((participant) => <article key={participant.id}><Avatar label={participant.initials} /><div><strong>{participant.userName}</strong><small>{participant.teamName}</small></div>{participant.role === "admin" && <b>ADMIN</b>}</article>)}</div></section>}{step === 2 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Reglas antes de entrar</h3><p>Esta es la versión {invite.rules.version} publicada por el administrador.</p></div><div className="private-invite-rule-grid"><div><small>PRESUPUESTO</small><strong>{invite.rules.startingBudget} M</strong></div><div><small>PLANTILLA</small><strong>{invite.rules.initialSquadSize}</strong></div><div><small>MERCADO</small><strong>Cada {invite.rules.renewalHours} h</strong></div><div><small>DEUDA</small><strong>{invite.rules.maxDebtPercent} %</strong></div><div><small>VENTA RÁPIDA</small><strong>{invite.rules.immediateSalePercent} %</strong></div><div><small>CAPITÁN</small><strong>×{invite.rules.captainMultiplier}</strong></div></div><div className="private-invite-features"><span className={invite.rules.clausesEnabled ? "active" : ""}>Cláusulas</span><span className={invite.rules.blindagesEnabled ? "active" : ""}>Blindajes</span><span className={invite.rules.directOffersEnabled ? "active" : ""}>Ofertas</span><span className={invite.rules.gameOffersEnabled ? "active" : ""}>Ofertas del juego</span></div><p className="private-immutable">Los jugadores son exclusivos: el backend debe reservar la plantilla completa en una única operación antes de confirmar tu entrada.</p></section>}{step === 3 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Elige tu equipo de {invite.league.competition}</h3><p>Su identidad se utilizará solo dentro de esta participación.</p></div><div className="private-team-grid">{compatibleTeams.map((team) => <button className={teamId === team.id ? "active" : ""} key={team.id} onClick={() => setTeamId(team.id)}><span>{team.shortName}</span><div><strong>{team.name}</strong><small>{team.competition}</small></div><b>{teamId === team.id ? "✓" : ""}</b></button>)}{!compatibleTeams.length && <div className="private-no-team">Necesitas crear primero un equipo de {invite.league.competition}.</div>}</div><article className="private-join-summary"><span>✓</span><div><strong>Reservamos tu plaza al pulsar Unirme</strong><small>La reserva dura {PRIVATE_JOIN_RESERVATION_MINUTES} minutos y se libera si cancelas, caduca o falla la creación de la plantilla.</small></div></article></section>}{error && <p className="form-error">{error}</p>}<div className="wizard-actions"><button className="secondary-button" onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)}>{step === 1 ? "Cerrar" : "Atrás"}</button>{alreadyJoined ? <button className="primary-button" onClick={onOpenExisting}>Abrir mi liga</button> : step < 3 ? <button className="primary-button" onClick={() => setStep((current) => current + 1)}>Ver {step === 1 ? "reglas" : "equipos"}</button> : <button className="primary-button" disabled={unavailable || !teamId || joining} onClick={confirmJoin}>{joining ? "Reservando plaza y plantilla…" : invite.rules.joinLocked ? "Entradas bloqueadas" : full ? "Liga completa" : "Unirme a la liga"}</button>}</div></section></div>;
}

function JoinPrivateLeagueDialog({ invite, teams, participations, clubRules, alreadyJoined, onClose, onJoin, onOpenExisting }: { invite: PrivateLeagueInvite; teams: FantasyTeamSummary[]; participations: LeagueParticipation[]; clubRules: ClubRules; alreadyJoined: boolean; onClose: () => void; onJoin: (invite: PrivateLeagueInvite, teamId: string) => Promise<string | null>; onOpenExisting: () => void }) {
  const [step, setStep] = useState(1);
  const compatibleClubs = teams.filter((club) => club.competition === invite.league.competition);
  const [clubId, setClubId] = useState(compatibleClubs[0]?.id ?? "");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const availableSlots = availablePrivateLeagueSlots(invite);
  const full = availableSlots <= 0;
  const unavailable = invite.rules.joinLocked || full || alreadyJoined;
  const status = alreadyJoined ? "Ya perteneces" : invite.rules.joinLocked ? "Entradas bloqueadas" : full ? "Sin plazas" : `${availableSlots} ${availableSlots === 1 ? "plaza disponible" : "plazas disponibles"}`;
  async function confirmJoin() {
    if (unavailable || !clubId) return;
    setJoining(true); setError("");
    const result = await onJoin(invite, clubId);
    setJoining(false);
    if (result) setError(result);
  }
  return <div className="dialog-backdrop"><section className="team-dialog private-league-dialog join-private-dialog" role="dialog" aria-modal="true" aria-labelledby="join-private-club-title">
    <div className="dialog-header"><div><p className="eyebrow">INVITACIÓN PRIVADA · {invite.rules.accessCode}</p><h2 id="join-private-club-title">{invite.league.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div>
    <div className="private-wizard-progress three">{[[1,"Liga"],[2,"Reglas"],[3,"Club"]].map(([number,label]) => <div className={step >= number ? "active" : ""} key={number}><span>{step > number ? "✓" : number}</span><small>{label}</small></div>)}</div>
    {step === 1 && <section className="private-wizard-step"><div className={`private-invite-hero ${unavailable ? "unavailable" : ""}`}><span>{invite.league.name[0]}</span><div><small>{invite.league.competition} · LIGA PRIVADA</small><strong>{invite.league.name}</strong><p>{invite.participants.length}/{invite.rules.capacity} participantes{invite.activeReservations ? ` · ${invite.activeReservations} en proceso` : ""}</p></div><b>{status}</b></div>{invite.rules.joinLocked && <article className="private-locked-alert"><span>×</span><div><strong>El administrador ha cerrado las entradas</strong><p>Puedes consultar las reglas, pero no unirte hasta que vuelva a abrirlas.</p></div></article>}<div className="private-choice-label">CLUBES QUE YA COMPITEN</div><div className="private-participant-list">{invite.participants.map((participant) => <article key={participant.id}><Avatar label={participant.initials} /><div><strong>{participant.teamName}</strong><small>{participant.userName} · equipo de esta liga</small></div>{participant.role === "admin" && <b>ADMIN</b>}</article>)}</div></section>}
    {step === 2 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Reglas antes de entrar</h3><p>Se aplicarán únicamente al nuevo equipo de tu club dentro de esta liga.</p></div><div className="private-invite-rule-grid"><div><small>PRESUPUESTO</small><strong>{invite.rules.startingBudget} M</strong></div><div><small>PLANTILLA</small><strong>{invite.rules.initialSquadSize}</strong></div><div><small>MERCADO</small><strong>Cada {invite.rules.renewalHours} h</strong></div><div><small>DEUDA</small><strong>{invite.rules.maxDebtPercent} %</strong></div><div><small>VENTA RÁPIDA</small><strong>{invite.rules.immediateSalePercent} %</strong></div><div><small>CAPITÁN</small><strong>×{invite.rules.captainMultiplier}</strong></div></div><div className="private-invite-features"><span className={invite.rules.clausesEnabled ? "active" : ""}>Cláusulas</span><span className={invite.rules.blindagesEnabled ? "active" : ""}>Blindajes</span><span className={invite.rules.directOffersEnabled ? "active" : ""}>Ofertas</span><span className={invite.rules.gameOffersEnabled ? "active" : ""}>Ofertas del juego</span></div><p className="private-immutable">Plantilla, saldo y operaciones serán independientes de los demás equipos del club.</p></section>}
    {step === 3 && <section className="private-wizard-step"><div className="wizard-copy"><h3>Elige un club de {invite.league.competition}</h3><p>Conservará su identidad e historial; al confirmar crearemos un equipo exclusivo para esta liga.</p></div><div className="private-team-grid">{compatibleClubs.map((club) => <button className={clubId === club.id ? "active" : ""} key={club.id} onClick={() => setClubId(club.id)}><span>{club.shortName}</span><div><strong>{club.name}</strong><small>{club.competition} · club</small></div><b>{clubId === club.id ? "✓" : ""}</b></button>)}{!compatibleClubs.length && <div className="private-no-team">Necesitas crear primero un club de {invite.league.competition} desde Mis clubes.</div>}</div><article className="private-join-summary"><span>✓</span><div><strong>Primero reservamos la plaza; después creamos el equipo</strong><small>Ambas operaciones utilizarán una transacción para evitar plazas o jugadores duplicados.</small></div></article></section>}
    {error && <p className="form-error">{error}</p>}<div className="wizard-actions"><button className="secondary-button" onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)}>{step === 1 ? "Cerrar" : "Atrás"}</button>{alreadyJoined ? <button className="primary-button" onClick={onOpenExisting}>Abrir mi liga</button> : step < 3 ? <button className="primary-button" onClick={() => setStep((current) => current + 1)}>Continuar</button> : <button className="primary-button" disabled={unavailable || !clubId || joining} onClick={confirmJoin}>{joining ? "Creando equipo…" : invite.rules.joinLocked ? "Entradas bloqueadas" : full ? "Liga completa" : "Unirme con este club"}</button>}</div>
  </section></div>;
}

function PrivateRuleControl({ label, value, suffix, min, max, step = 1, onChange }: { label: string; value: number; suffix: string; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="private-rule-control"><span><strong>{label}</strong><b>{String(value).replace(".", ",")} {suffix}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><small>{min} {suffix} — {max} {suffix}</small></label>;
}

function PrivateRuleToggle({ label, description, enabled, onChange }: { label: string; description: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <button type="button" className={`private-rule-toggle ${enabled ? "active" : ""}`} onClick={() => onChange(!enabled)}><span>{enabled ? "✓" : ""}</span><div><strong>{label}</strong><small>{description}</small></div><b>{enabled ? "ACTIVO" : "INACTIVO"}</b></button>;
}

function PrivateEconomyRules({ rules, onChange }: { rules: Omit<PrivateLeagueRules, "accessCode" | "version" | "updatedAt"> | PrivateLeagueRules; onChange: (rules: any) => void }) {
  const update = (key: keyof PrivateLeagueRules, value: number | boolean) => onChange({ ...rules, [key]: value });
  return <div className="private-rules-grid"><PrivateRuleControl label="Participantes" value={rules.capacity} suffix="usuarios" min={4} max={20} onChange={(value) => update("capacity", value)} /><PrivateRuleControl label="Presupuesto inicial" value={rules.startingBudget} suffix="M" min={50} max={200} step={5} onChange={(value) => update("startingBudget", value)} /><PrivateRuleControl label="Plantilla inicial" value={rules.initialSquadSize} suffix="jugadores" min={11} max={20} onChange={(value) => update("initialSquadSize", value)} /><PrivateRuleControl label="Renovación de mercado" value={rules.renewalHours} suffix="h" min={6} max={72} step={6} onChange={(value) => update("renewalHours", value)} /><PrivateRuleControl label="Jugadores por renovación" value={rules.marketPlayersPerRenewal} suffix="jugadores" min={5} max={20} onChange={(value) => update("marketPlayersPerRenewal", value)} /><PrivateRuleControl label="Banquillo máximo" value={rules.maxBenchPlayers} suffix="jugadores" min={5} max={30} onChange={(value) => update("maxBenchPlayers", value)} /><PrivateRuleControl label="Endeudamiento" value={rules.maxDebtPercent} suffix="%" min={0} max={50} step={5} onChange={(value) => update("maxDebtPercent", value)} /></div>;
}

function PrivateOperationRules({ rules, onChange }: { rules: Omit<PrivateLeagueRules, "accessCode" | "version" | "updatedAt"> | PrivateLeagueRules; onChange: (rules: any) => void }) {
  const update = (key: keyof PrivateLeagueRules, value: number | boolean) => onChange({ ...rules, [key]: value });
  return <div className="private-operation-rules"><PrivateRuleToggle label="Cláusulas" description="Permite fichajes inmediatos pagando la cláusula." enabled={rules.clausesEnabled} onChange={(value) => update("clausesEnabled", value)} />{rules.clausesEnabled && <div className="private-rules-grid compact"><PrivateRuleControl label="Multiplicador inicial" value={rules.clauseMultiplier} suffix="× valor" min={1} max={3} step={.1} onChange={(value) => update("clauseMultiplier", value)} /><PrivateRuleControl label="Cierre del clausulazo" value={rules.clauseCutoffHours} suffix="h antes" min={0} max={72} step={6} onChange={(value) => update("clauseCutoffHours", value)} /></div>}<PrivateRuleToggle label="Blindajes" description="Impide clausulazos durante el periodo configurado." enabled={rules.blindagesEnabled} onChange={(value) => update("blindagesEnabled", value)} />{rules.blindagesEnabled && <PrivateRuleControl label="Duración del blindaje" value={rules.blindageDurationHours} suffix="h" min={12} max={72} step={12} onChange={(value) => update("blindageDurationHours", value)} />}<PrivateRuleToggle label="Ofertas entre usuarios" description="Permite negociar jugadores de plantillas rivales." enabled={rules.directOffersEnabled} onChange={(value) => update("directOffersEnabled", value)} /><PrivateRuleToggle label="Ofertas automáticas del juego" description="El juego ofrece por jugadores puestos en venta." enabled={rules.gameOffersEnabled} onChange={(value) => update("gameOffersEnabled", value)} /><div className="private-rules-grid compact"><PrivateRuleControl label="Venta inmediata" value={rules.immediateSalePercent} suffix="% del valor" min={25} max={100} step={5} onChange={(value) => update("immediateSalePercent", value)} /><PrivateRuleControl label="Multiplicador de capitán" value={rules.captainMultiplier} suffix="× puntos" min={1} max={3} step={.5} onChange={(value) => update("captainMultiplier", value)} /><PrivateRuleControl label="Cierre de alineación" value={rules.lineupLockMinutes} suffix="min antes" min={1} max={60} onChange={(value) => update("lineupLockMinutes", value)} /></div></div>;
}

function ManagePrivateLeagueDialog({ league, rules, onClose, onSave, onRegenerateCode }: { league: LeagueSummary; rules: PrivateLeagueRules; onClose: () => void; onSave: (name: string, rules: PrivateLeagueRules) => void; onRegenerateCode: () => string }) {
  const [name, setName] = useState(league.name);
  const [draft, setDraft] = useState({ ...rules });
  const [tab, setTab] = useState<"access" | "market" | "operations">("access");
  return <div className="dialog-backdrop"><section className="team-dialog private-league-dialog manage-private-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-private-title"><div className="dialog-header"><div><p className="eyebrow">ADMINISTRADOR · VERSIÓN {rules.version}</p><h2 id="manage-private-title">Gestionar liga</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><nav className="private-manage-tabs"><button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>Acceso</button><button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>Mercado</button><button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}>Operaciones</button></nav>{tab === "access" && <section className="private-wizard-step"><label className="private-field"><span>Nombre de la liga</span><input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} /></label><div className="private-code-manage"><div><small>CÓDIGO ACTUAL</small><strong>{draft.accessCode}</strong></div><button onClick={() => { const accessCode = onRegenerateCode(); setDraft({ ...draft, accessCode, version: draft.version + 1, updatedAt: Date.now() }); }}>Regenerar código</button></div><PrivateRuleToggle label="Bloquear nuevas entradas" description="Nadie podrá unirse con el código aunque todavía queden plazas." enabled={draft.joinLocked} onChange={(joinLocked) => setDraft({ ...draft, joinLocked })} /><p className="private-immutable">La competición <strong>{league.competition}</strong> queda bloqueada para proteger plantillas, calendario y estadísticas.</p><PrivateRuleControl label="Capacidad" value={draft.capacity} suffix="usuarios" min={Math.max(4, Number(league.members.split("/")[0]))} max={20} onChange={(value) => setDraft({ ...draft, capacity: value })} /></section>}{tab === "market" && <PrivateEconomyRules rules={draft} onChange={setDraft} />}{tab === "operations" && <PrivateOperationRules rules={draft} onChange={setDraft} />}<article className="private-future-note warning"><span>!</span><p><strong>Los cambios no son retroactivos</strong><small>Mercado y operaciones: próxima renovación. Alineación y capitán: siguiente jornada abierta.</small></p></article><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={() => onSave(name, draft)}>Guardar nueva versión</button></div></section></div>;
}

function CompetitionTabs({ value, onChange }: { value: CompetitionName; onChange: (value: CompetitionName) => void }) {
  return (
    <div className="competition-tabs" role="tablist" aria-label="Competición">
      {(["Primera", "Segunda", "Liga F"] as CompetitionName[]).map((item) => (
        <button key={item} className={value === item ? "active" : ""} onClick={() => onChange(item)} role="tab" aria-selected={value === item}>
          {item}
        </button>
      ))}
    </div>
  );
}

function FeaturedFantasyEvent({ event, onJoin }: { event: FantasyEvent; onJoin: (eventId: string) => void }) {
  const fixture = event.fixtures[0];
  return <section className="featured-partidazo"><div className="partidazo-brand"><span>★</span><div><small>EDICIÓN ESPECIAL · LIGA FANTÁSTICA</small><strong>EL PARTIDAZO</strong></div></div><div className="partidazo-fixture"><span>{fixture?.home.slice(0, 2).toUpperCase()}</span><div><small>{fixture?.kickoffLabel}</small><strong>{fixture?.home} <em>vs</em> {fixture?.away}</strong><p>{event.description}</p></div><span>{fixture?.away.slice(0, 2).toUpperCase()}</span></div><div className="partidazo-status"><small>{event.snapshot ? "PRESUPUESTO CONGELADO" : `SE PUBLICA AL CERRAR J${event.previousMatchday}`}</small><strong>{event.snapshot ? `${event.snapshot.budget.toFixed(1).replace(".", ",")} M` : "Pendiente"}</strong><span>{event.memberCount.toLocaleString("es-ES")} inscritos</span><button onClick={() => onJoin(event.id)}>{event.snapshot ? "Unirme y crear once" : "Inscribirme ahora"} →</button></div></section>;
}

function Dashboard({ userName, competition, setCompetition, team, teamLeagueCount, clubMotto, leagues, featuredLeagueIds, onToggleFeaturedLeague, onOpenLeague, featuredFantasyEvent, onJoinFantasy, navigate }: {
  userName: string;
  competition: CompetitionName;
  setCompetition: (value: CompetitionName) => void;
  team: string;
  teamLeagueCount: number;
  clubMotto?: string;
  leagues: LeagueSummary[];
  featuredLeagueIds: string[];
  onToggleFeaturedLeague: (leagueId: string) => void;
  onOpenLeague: (leagueId: string) => void;
  featuredFantasyEvent?: FantasyEvent;
  onJoinFantasy: (eventId?: string) => void;
  navigate: (value: Section) => void;
}) {
  const featuredLeagues = leagues.filter((league) => featuredLeagueIds.includes(league.id)).slice(0, 4);
  const leagueAlert = (league: LeagueSummary, index: number) => league.mode === "fantasy"
    ? { label: "Preparar once", tone: "lineup" }
    : league.type.includes("Privada")
      ? { label: index % 2 ? "Mercado renovado" : "2 ofertas nuevas", tone: "market" }
      : { label: "Cierra en 4 días", tone: "deadline" };
  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">TEMPORADA 26/27</p><h1>Buenas, {userName} <span>👋</span></h1><p>Todo listo para preparar tu próxima jornada.</p></div>
        <CompetitionTabs value={competition} onChange={setCompetition} />
      </section>

      {featuredFantasyEvent && <FeaturedFantasyEvent event={featuredFantasyEvent} onJoin={onJoinFantasy} />}

      <section className="hero-grid">
        <article className="matchday-card">
          <div className="matchday-copy">
            <span className="status-dot">JORNADA 1 · ABIERTA</span>
            <h2>Tu once empieza<br />aquí.</h2>
            <p>Cierre de alineaciones en <strong>4 días y 3 horas</strong>.</p>
            <button className="primary-button" onClick={() => navigate("equipo")}>Preparar alineación <span>→</span></button>
          </div>
          <div className="mini-pitch" aria-hidden="true">
            <div className="pitch-circle" />
            <span className="mini-player p1">MR</span><span className="mini-player p2">AB</span>
            <span className="mini-player p3">LN</span><span className="mini-player p4">AS</span>
          </div>
        </article>

        <article className="score-card club-score-card">
          <div className="score-top"><span className="team-crest large">XI</span><div><small>CLUB ACTIVO</small><strong>{team}</strong><span>{competition}</span></div><button onClick={() => navigate("equipo")}>•••</button></div>
          <div className="score-number"><strong>{teamLeagueCount}</strong><span>equipos en ligas</span></div>
          <div className="score-stats"><div><small>Carrera</small><strong>1.284 pts</strong></div><div><small>Mejor puesto</small><strong>3.º</strong></div><div><small>Palmarés</small><strong>2</strong></div></div>
          <button className="dashboard-active-club" onClick={() => navigate("equipo")}><span>ACTIVO</span><p><strong>#18 del ranking · ↑ 3</strong><small>{clubMotto || "Se preseleccionará en tus próximas ligas"}</small></p><b>Gestionar →</b></button>
        </article>
      </section>

      <section className="section-block dashboard-featured-leagues">
        <div className="section-title"><div><p className="eyebrow">ACCESOS RÁPIDOS</p><h2>Tus ligas destacadas</h2><p>Solo lo importante, siempre a mano.</p></div><button className="text-button" onClick={() => navigate("ligas")}>Gestionar ligas <span>→</span></button></div>
        {featuredLeagues.length ? <div className="dashboard-featured-grid">{featuredLeagues.map((league, index) => {
          const alert = leagueAlert(league, index);
          return <article className="dashboard-featured-card" key={league.id}>
            <button className="dashboard-league-open" onClick={() => onOpenLeague(league.id)}>
              <span className={`league-symbol ${league.accent}`}>{league.name.slice(0, 1)}</span>
              <div className="league-main"><small>{league.competition} · {league.type}</small><strong>{league.name}</strong><em className={`dashboard-league-alert ${alert.tone}`}>{alert.label}</em></div>
              <div className="league-rank"><strong>{league.rank}</strong><small>{league.members} jugadores</small></div><span className="chevron">›</span>
            </button>
            <button className="dashboard-unfeature" onClick={() => onToggleFeaturedLeague(league.id)} aria-label={`Quitar ${league.name} de destacadas`} title="Quitar de destacadas">★</button>
          </article>;
        })}</div> : <article className="dashboard-featured-empty"><span>☆</span><div><p className="eyebrow">PERSONALIZA TU INICIO</p><h3>Fija las ligas que más utilizas</h3><p>Márcalas con una estrella y aparecerán aquí con sus próximos avisos.</p></div><button className="primary-button" onClick={() => navigate("ligas")}>Elegir destacadas <span>→</span></button></article>}
      </section>

      <section className="lower-grid">
        <article className="activity-card">
          <div className="section-title compact"><div><p className="eyebrow">TENDENCIAS</p><h2>Últimos movimientos</h2></div><button className="icon-button" onClick={() => navigate("tendencias")}>→</button></div>
          <div className="activity-row"><Avatar label="LN" /><div><strong>Leo Navarro</strong><small>Fichado por Barrio XI</small></div><span className="positive">7,1 M</span></div>
          <div className="activity-row"><Avatar label="IC" /><div><strong>Iván Cruz</strong><small>Tu puja ha sido superada</small></div><span>6,7 M</span></div>
          <div className="activity-row"><Avatar label="RS" /><div><strong>Raúl Sanz</strong><small>Nuevo en el mercado</small></div><span>4,8 M</span></div>
        </article>
        <article className="data-card">
          <span className="data-icon">✓</span>
          <div><p className="eyebrow">DATOS OPTIMIZADOS</p><h3>Sin llamadas innecesarias</h3><p>Las estadísticas se actualizarán una vez finalice cada partido.</p></div>
          <span className="quota"><strong>17</strong>/100 hoy</span>
        </article>
      </section>
    </>
  );
}

function TeamView({ teamId, setTeamId, teams, leagues, participations, clubRules, clubIdentityMeta, onUpdateClub, competition, setCompetition, freeLimit, onCreateTeam, onOpenLeague, onBrowseLeagues }: {
  teamId: string;
  setTeamId: (value: string) => void;
  teams: FantasyTeamSummary[];
  leagues: LeagueSummary[];
  participations: LeagueParticipation[];
  clubRules: ClubRules;
  clubIdentityMeta: Record<string, ClubIdentityMeta>;
  onUpdateClub: (clubId: string, input: ClubIdentityInput) => string | null;
  competition: CompetitionName;
  setCompetition: (value: CompetitionName) => void;
  freeLimit: number;
  onCreateTeam: () => void;
  onOpenLeague: (leagueId: string) => void;
  onBrowseLeagues: () => void;
}) {
  const [editIdentityOpen, setEditIdentityOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const competitionClubs = teams.filter((item) => item.competition === competition);
  const activeClub = teams.find((item) => item.id === teamId && item.competition === competition) ?? competitionClubs[0];
  const clubParticipations = activeClub ? participations.filter((item) => item.teamId === activeClub.id).map((participation) => ({ participation, league: leagues.find((league) => league.id === participation.leagueId) })).filter((item): item is { participation: LeagueParticipation; league: LeagueSummary } => Boolean(item.league)) : [];
  const marketTeams = clubParticipations.filter(({ league }) => league.mode === "market").length;
  const fantasyTeams = clubParticipations.filter(({ league }) => league.mode === "fantasy").length;

  function changeCompetition(value: CompetitionName) {
    setCompetition(value);
    const firstClub = teams.find((item) => item.competition === value);
    if (firstClub) setTeamId(firstClub.id);
  }

  return (
    <>
      <section className="page-heading team-heading"><div><p className="eyebrow">MIS CLUBES</p><h1>Tu identidad en el juego</h1><p>{competitionClubs.length}/{freeLimit} clubes gratuitos en {competition}. Cada liga crea su propio equipo.</p></div><CompetitionTabs value={competition} onChange={changeCompetition} /></section>
      <div className="team-switcher club-switcher" role="tablist" aria-label="Clubes de la competición">
        {competitionClubs.map((item) => <button key={item.id} className={activeClub?.id === item.id ? "active" : ""} onClick={() => setTeamId(item.id)}><span>{item.shortName}</span><div><strong>{item.name}</strong><small>{participations.filter((entry) => entry.teamId === item.id).length} equipos en ligas</small></div></button>)}
        <button className="new-team" onClick={onCreateTeam}>＋<span>Nuevo club</span></button>
      </div>
      {!activeClub ? (
        <section className="empty-teams-card">
          <span>＋</span>
          <p className="eyebrow">PRIMER CLUB EN {competition.toUpperCase()}</p>
          <h2>Crea una identidad para competir</h2>
          <p>Su nombre, escudo, historial y palmarés agruparán todos los equipos que utilices en las ligas de esta competición.</p>
          <button className="primary-button" onClick={onCreateTeam}>Crear mi club</button>
        </section>
      ) : (
      <section className="club-hub">
        <article className="club-identity-hero" style={{ borderColor: clubIdentityMeta[activeClub.id]?.primaryColor }}><span style={{ background: clubIdentityMeta[activeClub.id]?.primaryColor, color: clubIdentityMeta[activeClub.id]?.secondaryColor }}>{activeClub.shortName}</span><div><p className="eyebrow">CLUB ACTIVO · {activeClub.competition.toUpperCase()}</p><h2>{activeClub.name}</h2><p>{clubIdentityMeta[activeClub.id]?.motto || `Una identidad, ${clubParticipations.length} ${clubParticipations.length === 1 ? "equipo" : "equipos"} independientes en distintas ligas.`}</p></div><div className="club-identity-actions"><button className="secondary-button" onClick={() => setHistoryOpen(true)}>Ver historial</button><button className="primary-button" onClick={() => setEditIdentityOpen(true)}>Editar identidad</button></div></article>
        <article className="active-club-explanation"><span>ACTIVO</span><div><strong>¿Qué significa club activo?</strong><p>Es el club que Inicio utiliza como contexto y que aparecerá preseleccionado al entrar en nuevas ligas de {competition}. Cambiarlo no mueve jugadores, saldos ni equipos ya inscritos.</p></div><b>Preferencia personal</b></article>
        <article className={`club-team-limit ${clubParticipations.length >= clubRules.maxActiveTeams ? "full" : ""}`}><div><p className="eyebrow">CAPACIDAD DEL CLUB</p><strong>{clubParticipations.length}/{clubRules.maxActiveTeams} equipos activos</strong><small>Los eventos de un solo partido no ocupan plaza. Las ligas finalizadas liberan la suya.</small></div><div><i style={{ width: `${Math.min(100, clubParticipations.length / clubRules.maxActiveTeams * 100)}%` }} /></div><span>{clubParticipations.length >= clubRules.maxActiveTeams ? "Límite alcanzado" : `${clubRules.maxActiveTeams - clubParticipations.length} libres`}</span></article>
        <div className="club-career-stats"><div><small>EQUIPOS ACTIVOS</small><strong>{clubParticipations.length}</strong></div><div><small>PUNTOS DE CARRERA</small><strong>{clubParticipations.length ? 1284 + clubParticipations.length * 37 : 0}</strong></div><div><small>MEJOR POSICIÓN</small><strong>{clubParticipations.length ? "2.º" : "—"}</strong></div><div><small>TÍTULOS</small><strong>{clubParticipations.length > 2 ? 1 : 0}</strong></div></div>
        <section className="club-participations"><div className="section-title"><div><p className="eyebrow">EQUIPOS DEL CLUB</p><h2>Participaciones activas</h2><p>Cada tarjeta tiene plantilla, saldo, mercado y puntos propios.</p></div><button className="text-button" onClick={onBrowseLeagues}>Buscar ligas →</button></div>{clubParticipations.length ? <div>{clubParticipations.map(({ participation, league }, index) => <article key={participation.id}><button onClick={() => onOpenLeague(league.id)}><span className={`league-symbol ${league.accent}`}>{league.name[0]}</span><div><small>{league.type}</small><strong>{league.name}</strong><em>{league.mode === "fantasy" ? "Once por evento o jornada" : "Plantilla y mercado exclusivos"}</em></div><section><span><small>POSICIÓN</small><b>{league.rank}</b></span><span><small>{league.mode === "fantasy" ? "PUNTOS" : "SALDO"}</small><b>{league.mode === "fantasy" ? `${84 + index * 11} pts` : `${participation.budget.toFixed(1).replace(".", ",")} M`}</b></span></section><i>›</i></button></article>)}</div> : <article className="club-no-participations"><span>↗</span><div><strong>Este club todavía no compite</strong><p>Úsalo al unirte a una liga y crearemos automáticamente su primer equipo independiente.</p></div><button onClick={onBrowseLeagues}>Encontrar una liga</button></article>}</section>
        <section className="club-career-grid"><article><p className="eyebrow">DISTRIBUCIÓN</p><h3>Equipos por modalidad</h3><div><span><b>{marketTeams}</b>Mercado</span><span><b>{fantasyTeams}</b>Fantástica</span><span><b>{clubParticipations.filter(({ league }) => league.type.includes("Privada")).length}</b>Privadas</span></div></article><article><p className="eyebrow">HISTORIAL DEL CLUB</p><h3>Palmarés y progresión</h3><p>Las posiciones finales y los logros de cada equipo se añadirán aquí cuando termine su liga o evento.</p><span>Temporada 26/27 · En curso</span></article></section>
        <ClubRanking activeClub={activeClub} competition={competition} maxResults={clubRules.maxRankingResults} />
      </section>
      )}
      {activeClub && editIdentityOpen && <EditClubIdentityDialog club={activeClub} meta={clubIdentityMeta[activeClub.id]} onClose={() => setEditIdentityOpen(false)} onSave={(input) => { const error = onUpdateClub(activeClub.id, input); if (!error) setEditIdentityOpen(false); return error; }} />}
      {activeClub && historyOpen && <ClubHistoryDialog club={activeClub} participations={clubParticipations} onOpenLeague={(leagueId) => { setHistoryOpen(false); onOpenLeague(leagueId); }} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

function EditClubIdentityDialog({ club, meta, onClose, onSave }: { club: FantasyTeamSummary; meta?: ClubIdentityMeta; onClose: () => void; onSave: (input: ClubIdentityInput) => string | null }) {
  const [name, setName] = useState(club.name);
  const [shortName, setShortName] = useState(club.shortName);
  const [motto, setMotto] = useState(meta?.motto ?? "Juntos hasta el final");
  const [primaryColor, setPrimaryColor] = useState(meta?.primaryColor ?? "#c9f653");
  const [secondaryColor, setSecondaryColor] = useState(meta?.secondaryColor ?? "#101a12");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = onSave({ name, shortName, motto, primaryColor, secondaryColor });
    if (result) setError(result);
  }
  return <div className="dialog-backdrop club-identity-backdrop"><section className="team-dialog club-identity-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-club-title"><div className="dialog-header"><div><p className="eyebrow">IDENTIDAD DEL CLUB</p><h2 id="edit-club-title">Personaliza {club.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><form onSubmit={submit}><article className="club-edit-preview" style={{ background: `linear-gradient(125deg,${secondaryColor},${primaryColor})` }}><span style={{ background: primaryColor, color: secondaryColor }}>{shortName || "XI"}</span><div><small>{club.competition} · TEMPORADA 26/27</small><strong>{name || "Nombre del club"}</strong><p>{motto || "Tu lema aparecerá aquí"}</p></div></article><div className="club-edit-grid"><label><span>Nombre del club</span><input value={name} maxLength={24} onChange={(event) => { setName(event.target.value); setError(""); }} /></label><label><span>Siglas</span><input value={shortName} maxLength={3} onChange={(event) => setShortName(event.target.value.toUpperCase())} /></label><label className="full"><span>Lema</span><input value={motto} maxLength={60} onChange={(event) => setMotto(event.target.value)} /></label><label className="club-color-field"><span>Color principal</span><input type="color" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} /><b>{primaryColor}</b></label><label className="club-color-field"><span>Color secundario</span><input type="color" value={secondaryColor} onChange={(event) => setSecondaryColor(event.target.value)} /><b>{secondaryColor}</b></label></div><article className="club-edit-safety"><span>✓</span><p><strong>La identidad se actualiza; los equipos no cambian</strong><small>Plantillas, saldos, puntos, mercados y clasificaciones conservan exactamente su estado.</small></p></article>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button">Guardar identidad</button></div></form></section></div>;
}

function ClubHistoryDialog({ club, participations, onOpenLeague, onClose }: { club: FantasyTeamSummary; participations: { participation: LeagueParticipation; league: LeagueSummary }[]; onOpenLeague: (leagueId: string) => void; onClose: () => void }) {
  const [season, setSeason] = useState("26/27");
  const [mode, setMode] = useState<"Todas" | "Mercado" | "Fantástica">("Todas");
  const activeRows = participations.map(({ league }, index) => ({ id: league.id, name: league.name, type: league.mode === "fantasy" ? "Fantástica" : "Mercado", status: "En curso", position: league.rank, points: 96 + index * 17, season: "26/27", result: index === 0 ? "Racha de 3 jornadas" : "Próxima jornada abierta", active: true }));
  const pastRows = [{ id: "history_champions", name: "Liga del Barrio", type: "Mercado", status: "Finalizada", position: "1.º", points: 812, season: "25/26", result: "Campeón", active: false }, { id: "history_fantasy", name: "Clásicos de Primavera", type: "Fantástica", status: "Finalizada", position: "3.º", points: 184, season: "25/26", result: "Podio", active: false }, { id: "history_cup", name: "El Partidazo · Final", type: "Fantástica", status: "Finalizada", position: "8.º", points: 71, season: "26/27", result: "Top 10", active: false }];
  const rows = [...activeRows, ...pastRows].filter((row) => row.season === season && (mode === "Todas" || row.type === mode));
  return <div className="dialog-backdrop club-history-backdrop"><section className="team-dialog club-history-dialog" role="dialog" aria-modal="true" aria-labelledby="club-history-title"><div className="dialog-header"><div><p className="eyebrow">CARRERA Y PALMARÉS</p><h2 id="club-history-title">Historial de {club.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="club-history-hero"><span>{club.shortName}</span><div><small>{club.competition}</small><strong>1.284 puntos de carrera</strong><p>2 títulos · 3 podios · mejor posición 1.º</p></div><b>#18 global</b></div><div className="club-history-filters"><div>{["26/27","25/26"].map((item) => <button className={season === item ? "active" : ""} key={item} onClick={() => setSeason(item)}>{item}</button>)}</div><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option>Todas</option><option>Mercado</option><option>Fantástica</option></select></div><div className="club-history-list">{rows.map((row) => <article key={row.id}><span className={row.position === "1.º" ? "champion" : ""}>{row.position}</span><div><small>{row.type} · {row.status}</small><strong>{row.name}</strong><p>{row.result}</p></div><b>{row.points} pts</b>{row.active ? <button onClick={() => onOpenLeague(row.id)}>Abrir →</button> : <em>Archivada</em>}</article>)}{!rows.length && <div className="competitions-empty"><strong>Sin resultados en este periodo</strong><p>Cambia la temporada o la modalidad.</p></div>}</div><section className="club-honours"><p className="eyebrow">VITRINA DEL CLUB</p><div><article><span>★</span><strong>Campeón de liga</strong><small>25/26</small></article><article><span>III</span><strong>Podio fantástico</strong><small>25/26</small></article><article><span>10</span><strong>Top 10 Partidazo</strong><small>26/27</small></article></div></section><div className="dialog-actions"><button className="primary-button" onClick={onClose}>Cerrar historial</button></div></section></div>;
}

function ClubRanking({ activeClub, competition, maxResults }: { activeClub: FantasyTeamSummary; competition: CompetitionName; maxResults: number }) {
  const [scope, setScope] = useState<"global" | "friends">("global");
  const rivals = [
    { id: "club_norte", name: "Atlético Norte", owner: "Sara R.", initials: "AN", score: 914, movement: 2, titles: 4, teams: 7, friend: true },
    { id: "club_distrito", name: "Distrito Sur", owner: "Diego Ramos", initials: "DS", score: 887, movement: -1, titles: 3, teams: 6, friend: true },
    { id: activeClub.id, name: activeClub.name, owner: "Tú", initials: activeClub.shortName, score: 842, movement: 3, titles: 2, teams: 5, friend: true },
    { id: "club_union", name: "Unión Central", owner: "Javi Soto", initials: "UC", score: 819, movement: 0, titles: 1, teams: 8, friend: true },
    { id: "club_barrio", name: "Barrio Alto", owner: "Carmen Gil", initials: "BA", score: 784, movement: -2, titles: 2, teams: 4, friend: false },
    { id: "club_reyes", name: "Reyes del Área", owner: "Marcos L.", initials: "RA", score: 762, movement: 1, titles: 0, teams: 3, friend: false },
  ];
  const visible = rivals.filter((club) => scope === "global" || club.friend).sort((a, b) => b.score - a.score);
  return <section className="club-ranking"><header><div><p className="eyebrow">RANKING DE CLUBES · {competition.toUpperCase()}</p><h2>Compárate con otros usuarios</h2><p>La puntuación utiliza los {maxResults} mejores resultados normalizados de la temporada.</p></div><nav><button className={scope === "global" ? "active" : ""} onClick={() => setScope("global")}>Global</button><button className={scope === "friends" ? "active" : ""} onClick={() => setScope("friends")}>Amigos</button></nav></header><div className="club-ranking-head"><span>#</span><span>Club</span><span>Equipos</span><span>Títulos</span><span>Puntuación</span></div><div>{visible.map((club, index) => { const mine = club.id === activeClub.id; return <article className={mine ? "mine" : ""} key={club.id}><strong>{index + 1}</strong><span className="ranking-avatar">{club.initials}</span><p><b>{club.name}{mine && <em>TÚ</em>}</b><small>{club.owner} · {competition}</small></p><span>{club.teams}</span><span>{club.titles}</span><div><b>{club.score}</b><small className={club.movement > 0 ? "positive" : club.movement < 0 ? "negative" : ""}>{club.movement > 0 ? `↑ ${club.movement}` : club.movement < 0 ? `↓ ${Math.abs(club.movement)}` : "—"}</small></div></article>; })}</div><footer><span>i</span><p><strong>Comparación justa</strong><small>Participar en más ligas no suma automáticamente: solo cuentan los mejores resultados y se normalizan por modalidad y número de participantes.</small></p><button>Ver ranking completo →</button></footer></section>;
}

type TrendActivityMetric = "lineupSelections" | "captainSelections" | "offersReceived" | "bidsReceived" | "protections" | "marketListings" | "transfers";

const trendActivityGroups: { metric: TrendActivityMetric; label: string; title: string; description: string; unit: string; icon: string }[] = [
  { metric: "lineupSelections", label: "ALINEACIONES", title: "Más alineados", description: "Veces incluidos en un once confirmado.", unit: "onces", icon: "11" },
  { metric: "captainSelections", label: "CAPITANÍA", title: "Más capitanes", description: "Elecciones como capitán en jornadas cerradas.", unit: "capitanías", icon: "C" },
  { metric: "offersReceived", label: "OFERTAS", title: "Más ofertados", description: "Propuestas directas recibidas de otros usuarios.", unit: "ofertas", icon: "◇" },
  { metric: "bidsReceived", label: "PUJAS", title: "Más pujados", description: "Pujas válidas registradas en mercados de liga.", unit: "pujas", icon: "↗" },
  { metric: "protections", label: "PROTECCIÓN", title: "Más blindados", description: "Blindajes activados por sus propietarios.", unit: "blindajes", icon: "◆" },
  { metric: "marketListings", label: "ESCAPARATE", title: "Más puestos en venta", description: "Anuncios publicados por sus propietarios.", unit: "anuncios", icon: "◎" },
  { metric: "transfers", label: "OPERACIONES", title: "Más traspasados", description: "Cambios de propietario ya confirmados.", unit: "traspasos", icon: "↔" },
];

function TrendsView({ competition, setCompetition, query, setQuery, position, setPosition }: { competition: CompetitionName; setCompetition: (value: CompetitionName) => void; query: string; setQuery: (value: string) => void; position: string; setPosition: (value: string) => void }) {
  const [fullRankingOpen, setFullRankingOpen] = useState(false);
  const trends = useMemo(() => getCompetitionTrends(competition), [competition]);
  const filtered = trends.filter((player) => (position === "Todos" || player.position === position) && `${player.name} ${player.club}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const risers = [...filtered].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const mostSigned = [...trends].sort((a, b) => b.signings - a.signings).slice(0, 5);
  const bestPerformance = [...trends].sort((a, b) => b.performance - a.performance).slice(0, 4);
  const indexHistory = Array.from({ length: 12 }, (_, index) => Number((trends.reduce((total, player) => total + player.history[index], 0) / trends.length).toFixed(2)));
  const totalValue = trends.reduce((total, player) => total + player.value, 0);
  const averageChange = trends.reduce((total, player) => total + player.changePercent, 0) / trends.length;
  return <>
    <ClubTrendPulse competition={competition} />
    <section className="trends-hero"><div className="trends-hero-copy"><p className="eyebrow">INTELIGENCIA DE MERCADO</p><h1>El pulso de<br />la competición.</h1><p>Un único valor por jugador, calculado con la actividad agregada de todas las ligas.</p><CompetitionTabs value={competition} onChange={setCompetition} /></div><div className="market-index"><div><small>ÍNDICE NEXO · 7 DÍAS</small><strong>{totalValue.toFixed(1).replace(".", ",")} M</strong><span className={averageChange >= 0 ? "positive" : "negative"}>{averageChange >= 0 ? "↑" : "↓"} {Math.abs(averageChange).toFixed(1).replace(".", ",")} %</span></div><TrendBars values={indexHistory} /><footer><span>Hace 7 días</span><span>Ahora</span></footer></div></section>
    <section className="trend-kpis"><article><small>Jugadores al alza</small><strong>{trends.filter((player) => player.changePercent > 0).length}</strong><span>de {trends.length} cargados</span></article><article><small>Mayor subida</small><strong>+{Math.max(...trends.map((player) => player.changePercent)).toFixed(1)} %</strong><span>{[...trends].sort((a, b) => b.changePercent - a.changePercent)[0].name}</span></article><article><small>Movimientos analizados</small><strong>{trends.reduce((total, player) => total + player.signings, 0).toLocaleString("es-ES")}</strong><span>ventana de 72 horas</span></article><article><small>Próximo cálculo</small><strong>02:14 h</strong><span>mismo valor en todas las ligas</span></article></section>
    <section className="trend-toolbar"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jugador o club" /></label><div className="filter-pills">{["Todos", "POR", "DEF", "MED", "DEL"].map((item) => <button key={item} onClick={() => setPosition(item)} className={position === item ? "active" : ""}>{item}</button>)}</div><button className="trend-period">Últimos 7 días⌄</button></section>
    <section className="trends-main-grid"><article className="trend-panel trend-movers"><div className="section-title compact"><div><p className="eyebrow">VALOR DE MERCADO</p><h2>Mayores subidas</h2></div><span className="live-calculation">● ACTUALIZADO</span></div>{risers.map((player, index) => <TrendPlayerRow key={player.id} player={player} rank={index + 1} />)}{risers.length === 0 && <div className="empty-state"><strong>Sin resultados</strong><p>Prueba con otro filtro.</p></div>}</article><article className="trend-panel most-signed"><p className="eyebrow">DEMANDA GLOBAL</p><h2>Más fichados</h2><p>Altas netas en ligas durante la ventana actual.</p><div className="signings-chart">{mostSigned.map((player, index) => <div key={player.id}><span>{player.name}</span><i><b style={{ width: `${(player.signings / mostSigned[0].signings) * 100}%` }} /></i><strong>{player.signings}</strong><small>#{index + 1}</small></div>)}</div></article></section>
    <LeagueActivityTrends trends={trends} />
    <section className="section-block"><div className="section-title"><div><p className="eyebrow">FORMA DEPORTIVA</p><h2>Mejor rendimiento</h2></div><button className="text-button" onClick={() => setFullRankingOpen(true)}>Ver clasificación completa →</button></div><div className="performance-grid">{bestPerformance.map((player, index) => <article key={player.id}><div className="performance-rank">0{index + 1}</div><Avatar label={player.initials} /><div><small>{player.position} · {player.club}</small><strong>{player.name}</strong><span>{player.performance} pts · índice {player.demandIndex}</span></div><TrendBars values={player.history.slice(-6)} compact /></article>)}</div></section>
    <section className="algorithm-note"><span>ƒ</span><div><strong>Valor global y protegido</strong><p>El cálculo agrupa demanda, transferencias netas y prima mediana de las pujas. Excluye acciones repetidas y aplica límites configurables antes de publicar un único valor para todas las ligas.</p></div><b>Revisión cada 6 h</b></section>
    {fullRankingOpen && <FullPerformanceRankingDialog players={trends} competition={competition} onClose={() => setFullRankingOpen(false)} />}
  </>;
}

function FullPerformanceRankingDialog({ players, competition, onClose }: { players: PlayerTrend[]; competition: CompetitionName; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("Todos");
  const [order, setOrder] = useState<"points" | "demand" | "value">("points");
  const visible = [...players].filter((player) => (position === "Todos" || player.position === position) && `${player.name} ${player.club}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es"))).sort((a, b) => order === "points" ? b.performance - a.performance : order === "demand" ? b.demandIndex - a.demandIndex : b.value - a.value);
  return <div className="dialog-backdrop performance-ranking-backdrop" role="presentation"><section className="team-dialog performance-ranking-dialog" role="dialog" aria-modal="true" aria-labelledby="performance-ranking-title"><div className="dialog-header"><div><p className="eyebrow">{competition.toUpperCase()} · RENDIMIENTO</p><h2 id="performance-ranking-title">Clasificación completa</h2><p>Estadísticas consolidadas tras finalizar los partidos.</p></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="performance-ranking-toolbar"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jugador o club" /></label><div className="filter-pills">{["Todos", "POR", "DEF", "MED", "DEL"].map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{item}</button>)}</div><select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}><option value="points">Ordenar por puntos</option><option value="demand">Ordenar por índice</option><option value="value">Ordenar por valor</option></select></div><div className="performance-ranking-head"><span>#</span><span>Jugador</span><span>Puntos</span><span>Índice</span><span>Valor</span><span>Evolución</span></div><div className="performance-ranking-list">{visible.map((player, index) => <article key={player.id}><b>{index + 1}</b><Avatar label={player.initials} /><p><strong>{player.name}</strong><small>{player.position} · {player.club}</small></p><strong>{player.performance}</strong><span>{player.demandIndex}</span><span>{player.value.toFixed(1).replace(".", ",")} M</span><TrendBars values={player.history.slice(-6)} compact /></article>)}{visible.length === 0 && <div className="empty-state"><strong>Sin resultados</strong><p>Cambia los filtros para ver más jugadores.</p></div>}</div><footer><span>{visible.length} jugadores</span><small>Sin datos en directo · última actualización tras cierre de partidos</small></footer></section></div>;
}

function ClubTrendPulse({ competition }: { competition: CompetitionName }) {
  const clubs = [{ name: "Atlético Norte", initials: "AN", score: 914, change: 28, history: [72,75,77,79,82,86,91] }, { name: "Distrito Sur", initials: "DS", score: 887, change: 19, history: [70,74,73,78,80,85,88] }, { name: "Barrio XI", initials: "BX", score: 842, change: 31, history: [62,67,70,72,78,80,84] }];
  return <section className="club-trend-pulse"><header><div><p className="eyebrow">CLUBES · {competition.toUpperCase()}</p><h2>Quién está creciendo</h2><p>Evolución normalizada del ranking durante los últimos 30 días.</p></div><button>Ranking completo →</button></header><div>{clubs.map((club, index) => <article key={club.name}><b>0{index + 1}</b><span>{club.initials}</span><p><strong>{club.name}</strong><small>+{club.change} puntos · {club.score} total</small></p><div>{club.history.map((value, point) => <i key={point} style={{ height: `${value}%` }} />)}</div><em className="positive">↑ {index + 1 + (index === 2 ? 2 : 0)}</em></article>)}</div><footer><span>★</span><p><strong>Más títulos este mes: Atlético Norte</strong><small>2 campeonatos · 3 podios · 5 resultados computados</small></p><b>Actualización tras cada jornada cerrada</b></footer></section>;
}

function LeagueActivityTrends({ trends }: { trends: PlayerTrend[] }) {
  return <section className="section-block league-activity-trends"><div className="section-title"><div><p className="eyebrow">ACTIVIDAD AGREGADA DE LAS LIGAS</p><h2>Lo que está pasando en el juego</h2><p>Clasificaciones anónimas creadas a partir de acciones confirmadas.</p></div><span className="activity-privacy-badge">Sin revelar usuarios ni importes</span></div><div className="activity-trend-grid">{trendActivityGroups.map((group) => {
    const leaders = [...trends].sort((a, b) => b[group.metric] - a[group.metric]).slice(0, 3);
    const maximum = leaders[0]?.[group.metric] ?? 1;
    return <article className="activity-trend-card" key={group.metric}><header><span>{group.icon}</span><div><small>{group.label}</small><h3>{group.title}</h3></div></header><p>{group.description}</p><div className="activity-leader-list">{leaders.map((player, index) => <div key={player.id}><b>{index + 1}</b><Avatar label={player.initials} /><span><strong>{player.name}</strong><small>{player.position} · {player.club}</small><i><em style={{ width: `${(player[group.metric] / maximum) * 100}%` }} /></i></span><strong>{player[group.metric].toLocaleString("es-ES")}<small>{group.unit}</small></strong></div>)}</div></article>;
  })}</div></section>;
}

function TrendBars({ values, compact = false }: { values: number[]; compact?: boolean }) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(0.01, maximum - minimum);
  return <div className={`trend-bars ${compact ? "compact" : ""}`} aria-label={`Evolución desde ${values[0].toFixed(1)} hasta ${values.at(-1)?.toFixed(1)}`}>{values.map((value, index) => <i key={index} style={{ height: `${28 + ((value - minimum) / range) * 72}%` }} />)}</div>;
}

function TrendPlayerRow({ player, rank }: { player: PlayerTrend; rank: number }) {
  return <div className="trend-player-row"><b>{String(rank).padStart(2, "0")}</b><Avatar label={player.initials} /><div className="trend-player-name"><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><TrendBars values={player.history} compact /><div className="trend-player-value"><strong>{player.value.toFixed(1).replace(".", ",")} M</strong><span className={player.changePercent >= 0 ? "positive" : "negative"}>{player.changePercent >= 0 ? "+" : ""}{player.changePercent.toFixed(1).replace(".", ",")} %</span></div></div>;
}

function LeaguesView({ leagues, featuredLeagueIds, onToggleFeaturedLeague, fantasyEvents, onOpenLeague, onJoinPublic, onJoinFantasy, onCreatePrivate, onJoinCode, joinCode, setJoinCode, notify }: { leagues: LeagueSummary[]; featuredLeagueIds: string[]; onToggleFeaturedLeague: (leagueId: string) => void; fantasyEvents: FantasyEvent[]; onOpenLeague: (leagueId: string) => void; onJoinPublic: () => void; onJoinFantasy: (eventId?: string) => void; onCreatePrivate: () => void; onJoinCode: (code: string) => void; joinCode: string; setJoinCode: (v: string) => void; notify: (v: string) => void }) {
  return (
    <>
      <section className="page-heading"><div><p className="eyebrow">COMPITE A TU MANERA</p><h1>Ligas</h1><p>Crea una competición o únete a una que ya esté en marcha.</p></div><div className="league-heading-actions"><button className="secondary-button" onClick={onJoinPublic}>Unirme a una liga</button><button className="primary-button" onClick={onCreatePrivate}>＋ Crear liga</button></div></section>
      <section className="league-modes">
        <button className="mode-card dark" onClick={onJoinPublic}><span className="mode-number">01</span><div><small>ABIERTA</small><h2>Liga pública</h2><p>Entra en un grupo equilibrado con plantilla y presupuesto propios para esa liga.</p></div><strong>Jugadores exclusivos →</strong></button>
        <button className="mode-card lime-card" onClick={onCreatePrivate}><span className="mode-number">02</span><div><small>CON CÓDIGO</small><h2>Liga privada</h2><p>Tú eliges las reglas, el presupuesto, las cláusulas y quién puede entrar.</p></div><strong>Crear y configurar →</strong></button>
        <button className="mode-card cream" onClick={() => onJoinFantasy()}><span className="mode-number">03</span><div><small>PLANTILLA LIBRE</small><h2>Liga fantástica</h2><p>Crea tu mejor plantilla con presupuesto fijo y jugadores no exclusivos.</p></div><strong>Unirme →</strong></button>
      </section>
      <section className="fantasy-event-showcase"><div className="section-title"><div><p className="eyebrow">FANTÁSTICAS ABIERTAS Y PRÓXIMAS</p><h2>Elige tu reto</h2><p>Un partido, varios encuentros o una competición de varias jornadas.</p></div><button className="text-button" onClick={() => onJoinFantasy()}>Ver todas →</button></div><div className="fantasy-event-cards">{fantasyEvents.map((event) => <button className={event.featured ? "featured" : ""} key={event.id} onClick={() => onJoinFantasy(event.id)}><span>{event.format === "partidazo" ? "★" : event.format === "matches" ? "◆" : "J"}</span><div><small>{event.format === "partidazo" ? "EL PARTIDAZO" : event.format === "matches" ? `${event.fixtures.length} PARTIDOS` : `${event.matchdays.length} JORNADAS`}</small><strong>{event.name}</strong><p>{event.fixtures.slice(0,2).map((fixture) => `${fixture.home}–${fixture.away}`).join(" · ") || `Jornadas ${event.matchdays.join(", ")}`}</p></div><b>{event.snapshot ? `${event.snapshot.budget.toFixed(1).replace(".", ",")} M` : "Presupuesto pendiente"}<small>{event.memberCount} inscritos</small></b></button>)}</div></section>
      <section className="join-card"><div><p className="eyebrow">¿TIENES UNA INVITACIÓN?</p><h2>Únete con un código</h2><p>Comprueba las reglas, las plazas y quién está dentro antes de confirmar.</p><small className="demo-invite-codes">Prueba: <b>AMIGOS7</b> · bloqueada: <b>CERRADA7</b></small></div><div className="join-form"><input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={12} placeholder="AMIGOS7" aria-label="Código de liga" /><button onClick={() => onJoinCode(joinCode)}>Comprobar</button></div></section>
      <MyCompetitions leagues={leagues} featuredIds={featuredLeagueIds} onToggleFeatured={onToggleFeaturedLeague} onOpenLeague={onOpenLeague} />
    </>
  );
}

type CompetitionLeagueFilter = "Todas" | CompetitionName;
type CompetitionModeFilter = "Todas" | "Públicas" | "Privadas" | "Fantásticas";

function MyCompetitions({ leagues, featuredIds, onToggleFeatured, onOpenLeague }: { leagues: LeagueSummary[]; featuredIds: string[]; onToggleFeatured: (leagueId: string) => void; onOpenLeague: (leagueId: string) => void }) {
  const [query, setQuery] = useState("");
  const [competition, setCompetition] = useState<CompetitionLeagueFilter>("Todas");
  const [mode, setMode] = useState<CompetitionModeFilter>("Todas");

  const visibleLeagues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    const originalOrder = new Map(leagues.map((league, index) => [league.id, index]));
    return leagues
      .filter((league) => {
        const matchesQuery = !normalizedQuery || `${league.name} ${league.type} ${league.competition}`.toLocaleLowerCase("es").includes(normalizedQuery);
        const matchesCompetition = competition === "Todas" || league.competition === competition;
        const matchesMode = mode === "Todas"
          || (mode === "Fantásticas" && league.mode === "fantasy")
          || (mode === "Públicas" && league.mode !== "fantasy" && league.type.includes("Pública"))
          || (mode === "Privadas" && league.mode !== "fantasy" && league.type.includes("Privada"));
        return matchesQuery && matchesCompetition && matchesMode;
      })
      .sort((a, b) => Number(featuredIds.includes(b.id)) - Number(featuredIds.includes(a.id)) || (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0));
  }, [competition, featuredIds, leagues, mode, query]);

  const hasFilters = Boolean(query || competition !== "Todas" || mode !== "Todas");
  const clearFilters = () => { setQuery(""); setCompetition("Todas"); setMode("Todas"); };

  return (
    <section className="section-block my-competitions-section">
      <div className="section-title competitions-title">
        <div><p className="eyebrow">ACTIVAS</p><h2>Tus competiciones</h2><p>Encuentra una liga y fija arriba las que más utilizas.</p></div>
        <div className="competition-results"><strong>{visibleLeagues.length}</strong><small>de {leagues.length} ligas</small></div>
      </div>
      <div className="competition-filter-panel">
        <label className="competition-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o tipo" aria-label="Buscar en mis competiciones" /></label>
        <div className="competition-filter-group" aria-label="Filtrar por competición">
          {(["Todas", "Primera", "Segunda", "Liga F"] as CompetitionLeagueFilter[]).map((item) => <button key={item} className={competition === item ? "active" : ""} onClick={() => setCompetition(item)}>{item}</button>)}
        </div>
        <label className="competition-mode-filter"><span>Tipo</span><select value={mode} onChange={(event) => setMode(event.target.value as CompetitionModeFilter)} aria-label="Filtrar por tipo de liga"><option>Todas</option><option>Públicas</option><option>Privadas</option><option>Fantásticas</option></select></label>
        {hasFilters && <button className="clear-competition-filters" onClick={clearFilters}>Limpiar</button>}
      </div>
      {visibleLeagues.length ? <div className="league-grid my-league-grid">{visibleLeagues.map((league) => {
        const featured = featuredIds.includes(league.id);
        return <article className={`my-league-card ${featured ? "featured" : ""}`} key={league.id}>
          <button className="my-league-open" onClick={() => onOpenLeague(league.id)}>
            <span className={`league-symbol ${league.accent}`}>{league.name[0]}</span>
            <div className="league-main">{featured && <em>DESTACADA</em>}<strong>{league.name}</strong><small>{league.competition} · {league.type}</small></div>
            <div className="league-rank"><strong>{league.rank}</strong><small>{league.members} jugadores</small></div>
            <span className="chevron">›</span>
          </button>
          <button className="league-feature-button" onClick={() => onToggleFeatured(league.id)} aria-pressed={featured} aria-label={`${featured ? "Quitar" : "Marcar"} ${league.name} como destacada`} title={featured ? "Quitar de destacadas" : "Marcar como destacada"}>{featured ? "★" : "☆"}</button>
        </article>;
      })}</div> : <div className="competitions-empty"><span>⌕</span><strong>No hay competiciones con esos filtros</strong><p>Prueba otra búsqueda o limpia los filtros.</p><button onClick={clearFilters}>Mostrar todas</button></div>}
    </section>
  );
}

const leagueAreaTabs: { id: LeagueAreaSection; label: string; icon: string }[] = [
  { id: "resumen", label: "Resumen", icon: "⌂" },
  { id: "equipo", label: "Equipo", icon: "♟" },
  { id: "mercado", label: "Mercado", icon: "↗" },
  { id: "jornada", label: "Jornada", icon: "◷" },
  { id: "clasificacion", label: "Ranking", icon: "≡" },
];

function LeagueAreaNav({ section, onChange, mobile = false }: { section: LeagueAreaSection; onChange: (section: LeagueAreaSection) => void; mobile?: boolean }) {
  return <nav className={mobile ? "bottom-nav league-mobile-nav" : "league-area-nav"} aria-label="Secciones de la liga">{leagueAreaTabs.map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => onChange(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>;
}

function LeagueDetailView({ league, team, participation, squad, section, onSectionChange, onBack, marketPlayers, marketRules, privateRules, canManagePrivateLeague, privateAdmin, privateParticipants, onManagePrivateLeague, reports, onReport, onResolveReport, onLeaveLeague, bids, onChangeBids, playerContracts, playerOffers, onChangePlayerContract, onCreatePlayerOffer, onRespondPlayerOffer, sentOffers, onChangeSentOffers, clausePurchases, matchdayStartAt, onClausePurchase, scoringRules, settlementRules, fantasyLineup, fantasyEvent, onSaveFantasyLineup, onAdjustBudget, onImmediateSale, notify }: {
  league: LeagueSummary;
  team: FantasyTeamSummary;
  participation?: LeagueParticipation;
  squad?: InitialSquad;
  section: LeagueAreaSection;
  onSectionChange: (section: LeagueAreaSection) => void;
  onBack: () => void;
  marketPlayers: MarketPlayer[];
  marketRules: MarketRules;
  privateRules?: PrivateLeagueRules;
  canManagePrivateLeague: boolean;
  privateAdmin?: PrivateLeagueParticipant;
  privateParticipants: PrivateLeagueParticipant[];
  onManagePrivateLeague: () => void;
  reports: LeagueReport[];
  onReport: (rival: RivalTeam, category: ReportCategory, details: string) => string | null;
  onResolveReport: (reportId: string, resolution: ReportResolution) => void;
  onLeaveLeague: (successorId?: string) => Promise<string | null>;
  bids: MarketBid[];
  onChangeBids: (bids: MarketBid[]) => void;
  playerContracts: Record<string, PlayerContract>;
  playerOffers: Record<string, PlayerOffer[]>;
  onChangePlayerContract: (playerId: string, contract: PlayerContract) => void;
  onCreatePlayerOffer: (player: InitialSquadPlayer, source: "rival" | "game") => void;
  onRespondPlayerOffer: (player: InitialSquadPlayer, offerId: string, accept: boolean) => void;
  sentOffers: SentOffer[];
  onChangeSentOffers: (offers: SentOffer[]) => void;
  clausePurchases: ClausePurchase[];
  matchdayStartAt: number;
  onClausePurchase: (rivalTeamId: string, player: InitialSquadPlayer, clause: number, blind: boolean) => string | null;
  scoringRules: ScoringRule[];
  settlementRules: MatchdaySettlementRules;
  fantasyLineup?: FantasyLineupDraft;
  fantasyEvent?: FantasyEvent;
  onSaveFantasyLineup: (lineup: FantasyLineupDraft) => void;
  onAdjustBudget: (difference: number) => void;
  onImmediateSale: (player: InitialSquadPlayer) => void;
  notify: (message: string) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const starters = squad?.players.filter((player) => squad.startingPlayerIds.includes(player.id)) ?? [];
  const ownedMarketListings = (squad?.players ?? []).flatMap((player) => {
    const contract = playerContracts[`${participation?.id ?? ""}:${player.id}`];
    return contract?.listed ? [{ player, contract }] : [];
  });
  const receivedMarketOffers = ownedMarketListings.flatMap(({ player }) => (playerOffers[`${participation?.id ?? ""}:${player.id}`] ?? []).map((offer) => ({ player, offer })));
  const fantasyScopedPlayers = fantasyEvent?.snapshot ? marketPlayers.filter((player) => fantasyEvent.snapshot?.playerPrices[player.id] !== undefined).map((player) => ({ ...player, price: fantasyEvent.snapshot!.playerPrices[player.id] })) : marketPlayers;
  return (
    <>
      <header className="league-context-header">
        <button className="league-back" onClick={onBack} aria-label="Volver a las ligas">‹</button>
        <span className={`league-symbol ${league.accent}`}>{league.name[0]}</span>
        <div className="league-context-copy"><p className="eyebrow">{league.competition} · {league.type}</p><h1>{league.name}</h1><p>{team.name} · {league.members} participantes</p></div>
        {privateRules && canManagePrivateLeague && <button className="league-manage-button" onClick={onManagePrivateLeague}><span>⚙</span> Gestionar liga</button>}
        <button className="league-more" onClick={() => setOptionsOpen(true)} aria-label="Opciones de la liga">•••</button>
      </header>
      <LeagueAreaNav section={section} onChange={onSectionChange} />

      {section === "resumen" && <LeagueOverview league={league} team={team} squad={squad} budget={participation?.budget ?? 100} isPrivateLeague={Boolean(privateRules) || league.type.includes("Privada")} privateParticipants={privateParticipants} onSectionChange={onSectionChange} notify={notify} />}
      {section === "equipo" && <LeagueSquadView squad={squad} starters={starters} league={league} marketPlayers={fantasyScopedPlayers} participationId={participation?.id ?? ""} budget={participation?.budget ?? 0} fantasyMatchdayBudget={fantasyEvent?.snapshot?.budget ?? marketRules.fantasyMatchdayBudget} fantasyOptions={marketRules} fantasyEvent={fantasyEvent} scoringRules={scoringRules} fantasyLineup={fantasyLineup} onSaveFantasyLineup={onSaveFantasyLineup} playerContracts={playerContracts} playerOffers={playerOffers} onChangePlayerContract={onChangePlayerContract} onCreatePlayerOffer={onCreatePlayerOffer} onRespondPlayerOffer={onRespondPlayerOffer} onAdjustBudget={onAdjustBudget} onImmediateSale={onImmediateSale} notify={notify} />}
      {section === "mercado" && <LeagueMarketView league={league} players={fantasyScopedPlayers} squad={squad} budget={participation?.budget ?? 100} rules={marketRules} bids={bids} onChangeBids={onChangeBids} ownedListings={ownedMarketListings} receivedOffers={receivedMarketOffers} onRespondOffer={onRespondPlayerOffer} sentOffers={sentOffers} onChangeSentOffers={onChangeSentOffers} onGenerateSystemOffers={() => ownedMarketListings.forEach(({ player }) => onCreatePlayerOffer(player, "game"))} notify={notify} />}
      {section === "jornada" && <LeagueMatchdayView squad={squad} competition={league.competition} scoringRules={scoringRules} settlementRules={settlementRules} onPrepareTeam={() => onSectionChange("equipo")} notify={notify} />}
      {section === "clasificacion" && <LeagueRankingView team={team} competition={league.competition} budget={participation?.budget ?? 0} rules={marketRules} bidCommitment={bids.reduce((total, bid) => total + bid.amount, 0)} sentOffers={sentOffers} onChangeSentOffers={onChangeSentOffers} clausePurchases={clausePurchases} matchdayStartAt={matchdayStartAt} onClausePurchase={onClausePurchase} isPrivateLeague={Boolean(privateRules) || league.type.includes("Privada")} currentUserIsAdmin={canManagePrivateLeague} privateAdmin={privateAdmin} onReport={onReport} />}
      {optionsOpen && <LeagueOptionsDialog league={league} isPrivateLeague={Boolean(privateRules) || league.type.includes("Privada")} isAdmin={canManagePrivateLeague} participants={privateParticipants} reports={reports} onResolveReport={onResolveReport} onLeave={onLeaveLeague} onClose={() => setOptionsOpen(false)} />}
    </>
  );
}

function LeagueOverview({ league, team, squad, budget, isPrivateLeague, privateParticipants, onSectionChange, notify }: { league: LeagueSummary; team: FantasyTeamSummary; squad?: InitialSquad; budget: number; isPrivateLeague: boolean; privateParticipants: PrivateLeagueParticipant[]; onSectionChange: (section: LeagueAreaSection) => void; notify: (message: string) => void }) {
  const [activityOpen, setActivityOpen] = useState(false);
  const leagueActivity = createPrivateLeagueActivity(privateParticipants);
  return <div className="league-overview">
    <section className="league-welcome-card">
      <div><span className="league-ready">✓ TODO LISTO</span><p className="eyebrow">BIENVENIDO A TU NUEVA LIGA</p><h2>{squad ? "Tu plantilla está preparada" : "Tu liga está en marcha"}</h2><p>{squad ? "Tus 16 jugadores están confirmados. Revisa el once inicial antes de que comience la jornada." : `Compite con ${team.name}, prepara tu once y escala posiciones.`}</p><button className="primary-button" onClick={() => onSectionChange("equipo")}>Revisar mi equipo <span>→</span></button></div>
      <div className="league-rank-hero"><small>POSICIÓN ACTUAL</small><strong>{league.rank === "—" ? "12.º" : league.rank}</strong><span>0 pts · comienza desde cero</span></div>
    </section>
    <section className="league-kpis">
      <article><span>◈</span><div><small>Saldo disponible</small><strong>{budget.toFixed(1).replace(".", ",")} M</strong></div></article>
      <article><span>◆</span><div><small>Valor de plantilla</small><strong>{squad ? `${squad.totalValue.toFixed(1).replace(".", ",")} M` : "88,4 M"}</strong></div></article>
      <article><span>XI</span><div><small>Formación</small><strong>{squad?.formation ?? "4-4-2"}</strong></div></article>
      <article><span>◷</span><div><small>Próxima jornada</small><strong>6 días</strong></div></article>
    </section>
    <section className="league-dashboard-grid">
      <article className="league-panel next-actions"><div className="section-title compact"><div><p className="eyebrow">PRIMEROS PASOS</p><h2>Prepara la jornada</h2></div><strong>1/3</strong></div>
        <button className="done"><span>✓</span><div><strong>Plantilla recibida</strong><small>16 jugadores confirmados</small></div></button>
        <button onClick={() => onSectionChange("equipo")}><span>2</span><div><strong>Revisa tu alineación</strong><small>Comprueba titulares y banquillo</small></div><b>›</b></button>
        <button onClick={() => onSectionChange("mercado")}><span>3</span><div><strong>Explora el mercado</strong><small>Refuerza tu plantilla mediante pujas</small></div><b>›</b></button>
      </article>
      <article className="league-panel matchday-preview"><div><p className="eyebrow">JORNADA 1</p><h2>Empieza el viernes</h2><p>Las estadísticas aparecerán cuando terminen los partidos.</p></div><div className="matchday-time"><strong>6</strong><span>días</span></div><button className="secondary-button" onClick={() => onSectionChange("jornada")}>Ver jornada</button></article>
      {isPrivateLeague ? <article className="league-panel league-activity private-league-activity-preview"><div className="section-title compact"><div><p className="eyebrow">ACTIVIDAD DE LA LIGA</p><h2>Qué hacen tus rivales</h2></div><button className="text-button" onClick={() => setActivityOpen(true)}>Ver todo</button></div>{leagueActivity.slice(0, 3).map((item) => <button key={item.id} onClick={() => setActivityOpen(true)}><span>{item.initials}</span><p><strong>{item.title}</strong><small>{item.actor} · {formatNotificationTime(item.createdAt)}</small></p><b>›</b></button>)}<footer>Las pujas y ofertas activas siguen siendo privadas.</footer></article> : <article className="league-panel league-activity"><div className="section-title compact"><div><p className="eyebrow">ACTIVIDAD</p><h2>Últimos movimientos</h2></div><button className="text-button" onClick={() => notify("Actividad completa")}>Ver todo</button></div><p><span>✓</span><strong>Tu plantilla inicial ha sido confirmada</strong><small>Ahora mismo</small></p><p><span>↗</span><strong>El mercado tiene 5 jugadores disponibles</strong><small>Hace 8 min</small></p><p><span>+</span><strong>Un nuevo participante se ha unido</strong><small>Hace 21 min</small></p></article>}
      <article className="league-panel nearby-rivals"><div className="section-title compact"><div><p className="eyebrow">TU ZONA DEL RANKING</p><h2>Tus rivales</h2></div><button className="text-button" onClick={() => onSectionChange("clasificacion")}>Ver todos</button></div>{[["RB", "Rayo Blanco", "74 pts"], ["AC", "Atlético Cierzo", "86 pts"], ["UV", "Unión Violeta", "0 pts"]].map((rival, index) => <button key={rival[1]} onClick={() => onSectionChange("clasificacion")}><span>{rival[0]}</span><div><strong>{rival[1]}</strong><small>{index === 2 ? "Justo por debajo" : `${index + 1} posiciones por encima`}</small></div><b>{rival[2]} ›</b></button>)}</article>
    </section>
    {activityOpen && <PrivateLeagueActivityDialog events={leagueActivity} leagueName={league.name} onClose={() => setActivityOpen(false)} />}
  </div>;
}

function createPrivateLeagueActivity(participants: PrivateLeagueParticipant[]): PrivateLeagueActivityEvent[] {
  const rivals = participants.length ? participants : [{ id: "r1", initials: "LM", userName: "Lucía Martín", teamName: "Rayo Verde", role: "member" as const }, { id: "r2", initials: "DR", userName: "Diego Ramos", teamName: "Distrito Sur", role: "member" as const }];
  const actor = (index: number) => rivals[index % rivals.length];
  return [
    { id: "activity_1", type: "transfer", actor: actor(0).teamName, initials: actor(0).initials, title: "Fichó a Nico Williams", detail: "Traspaso confirmado por 12,4 M", createdAt: Date.now() - 18 * 60000 },
    { id: "activity_2", type: "market", actor: actor(1).teamName, initials: actor(1).initials, title: "Puso a Dani Olmo en el mercado", detail: "Ya puede recibir ofertas de la liga y del juego", createdAt: Date.now() - 74 * 60000 },
    { id: "activity_3", type: "clause", actor: actor(2).teamName, initials: actor(2).initials, title: "Subió una cláusula", detail: "La nueva cantidad no se publica hasta consultar al jugador", createdAt: Date.now() - 3 * 3600000 },
    { id: "activity_4", type: "membership", actor: actor(3).teamName, initials: actor(3).initials, title: "Se unió a la liga", detail: "La liga cuenta con un nuevo participante", createdAt: Date.now() - 20 * 3600000 },
    { id: "activity_5", type: "lineup", actor: actor(0).teamName, initials: actor(0).initials, title: "Guardó su equipo para la jornada", detail: "El once no será visible hasta el cierre", createdAt: Date.now() - 26 * 3600000 },
  ];
}

function PrivateLeagueActivityDialog({ events, leagueName, onClose }: { events: PrivateLeagueActivityEvent[]; leagueName: string; onClose: () => void }) {
  const [filter, setFilter] = useState<"all" | PrivateLeagueActivityEvent["type"]>("all");
  const visible = events.filter((item) => filter === "all" || item.type === filter);
  return <div className="dialog-backdrop league-activity-backdrop"><section className="team-dialog private-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="private-activity-title"><div className="dialog-header"><div><p className="eyebrow">LIGA PRIVADA · REGISTRO COMPARTIDO</p><h2 id="private-activity-title">Actividad de {leagueName}</h2><p>Movimientos confirmados de todos los participantes.</p></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="private-activity-privacy"><span>◉</span><p><strong>Transparencia sin romper la estrategia</strong><small>No se muestran importes de pujas u ofertas activas, saldos ni alineaciones antes del cierre.</small></p></div><div className="activity-dialog-filters">{([['all','Todo'],['transfer','Fichajes'],['market','Mercado'],['clause','Cláusulas'],['membership','Miembros'],['lineup','Alineaciones']] as const).map(([id,label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="private-activity-feed">{visible.map((item) => <article key={item.id}><span>{item.initials}</span><div><small>{item.type.toUpperCase()} · {formatNotificationTime(item.createdAt)}</small><strong>{item.title}</strong><p>{item.actor} · {item.detail}</p></div></article>)}{visible.length === 0 && <div className="empty-state"><strong>Sin movimientos</strong><p>No hay actividad de este tipo.</p></div>}</div><footer><span>{visible.length} movimientos</span><small>Solo se registran acciones confirmadas por el servidor.</small></footer></section></div>;
}

function LeagueSquadView({ squad, starters, league, marketPlayers, participationId, budget, fantasyMatchdayBudget, fantasyOptions, fantasyEvent, scoringRules, fantasyLineup, onSaveFantasyLineup, playerContracts, playerOffers, onChangePlayerContract, onCreatePlayerOffer, onRespondPlayerOffer, onAdjustBudget, onImmediateSale, notify }: { squad?: InitialSquad; starters: InitialSquadPlayer[]; league: LeagueSummary; marketPlayers: MarketPlayer[]; participationId: string; budget: number; fantasyMatchdayBudget: number; fantasyOptions: MarketRules; fantasyEvent?: FantasyEvent; scoringRules: ScoringRule[]; fantasyLineup?: FantasyLineupDraft; onSaveFantasyLineup: (lineup: FantasyLineupDraft) => void; playerContracts: Record<string, PlayerContract>; playerOffers: Record<string, PlayerOffer[]>; onChangePlayerContract: (playerId: string, contract: PlayerContract) => void; onCreatePlayerOffer: (player: InitialSquadPlayer, source: "rival" | "game") => void; onRespondPlayerOffer: (player: InitialSquadPlayer, offerId: string, accept: boolean) => void; onAdjustBudget: (difference: number) => void; onImmediateSale: (player: InitialSquadPlayer) => void; notify: (message: string) => void }) {
  const formations: Record<string, Record<PlayerPosition, number>> = {
    "4-4-2": { POR: 1, DEF: 4, MED: 4, DEL: 2 },
    "4-3-3": { POR: 1, DEF: 4, MED: 3, DEL: 3 },
    "3-4-3": { POR: 1, DEF: 3, MED: 4, DEL: 3 },
    "3-5-2": { POR: 1, DEF: 3, MED: 5, DEL: 2 },
    "5-3-2": { POR: 1, DEF: 5, MED: 3, DEL: 2 },
  };
  const [formation, setFormation] = useState("4-4-2");
  const [starterIds, setStarterIds] = useState(() => starters.map((player) => player.id));
  const [captainId, setCaptainId] = useState(starters.find((player) => player.position === "DEL")?.id ?? starters[0]?.id ?? "");
  const [saved, setSaved] = useState(false);
  const [pendingFormation, setPendingFormation] = useState<string | null>(null);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [managedBenchPlayerId, setManagedBenchPlayerId] = useState<string | null>(null);
  const [selectedTeamMatchday, setSelectedTeamMatchday] = useState(5);
  const [fantasyCommand, setFantasyCommand] = useState<FantasyBuilderCommand | null>(null);

  useEffect(() => {
    setStarterIds(starters.map((player) => player.id));
    setCaptainId(starters.find((player) => player.position === "DEL")?.id ?? starters[0]?.id ?? "");
    setDetailPlayerId(null);
    setManagedBenchPlayerId(null);
    setSaved(false);
  }, [squad?.players]);

  if (!squad) return <section className="league-tab-view"><div className="league-section-heading"><div><p className="eyebrow">ALINEACIÓN DE LA LIGA</p><h2>Mi equipo</h2><p>Los cambios solo afectan a esta liga.</p></div></div><div className="empty-state league-empty"><strong>Plantilla pendiente de sincronización</strong><p>Se mostrará aquí cuando el backend confirme el reparto de esta liga.</p></div></section>;

  if (selectedTeamMatchday < 5) return <LockedTeamMatchdayView squad={squad} competition={league.competition} matchday={selectedTeamMatchday} scoringRules={scoringRules} onSelectMatchday={setSelectedTeamMatchday} />;
  if (league.mode === "fantasy" && fantasyEvent && !fantasyEvent.snapshot) return <FantasyBudgetPending event={fantasyEvent} />;
  if (league.mode === "fantasy") return <>{fantasyEvent?.snapshot && <FantasySnapshotBanner event={fantasyEvent} />}<FantasyQuickTools options={fantasyOptions} onCommand={(type, respectBudget) => setFantasyCommand({ id: crypto.randomUUID(), type, respectBudget })} /><FantasyMatchdayBuilder competition={league.competition} players={marketPlayers} previousPlayerIds={squad.startingPlayerIds} matchdayBudget={fantasyMatchdayBudget} scoringRules={scoringRules} savedLineup={fantasyLineup} command={fantasyCommand} onSave={onSaveFantasyLineup} onSelectMatchday={setSelectedTeamMatchday} notify={notify} /></>;

  const currentStarters = squad.players.filter((player) => starterIds.includes(player.id));
  const currentBench = squad.players.filter((player) => !starterIds.includes(player.id));
  const detailPlayer = squad.players.find((player) => player.id === detailPlayerId);
  const managedBenchPlayer = currentBench.find((player) => player.id === managedBenchPlayerId);
  const managedContract = managedBenchPlayer ? playerContracts[`${participationId}:${managedBenchPlayer.id}`] ?? { clause: Number((managedBenchPlayer.value * 1.5).toFixed(1)), listed: false, untouchable: false, offers: 0 } : undefined;
  const managedOffers = managedBenchPlayer ? playerOffers[`${participationId}:${managedBenchPlayer.id}`] ?? [] : [];

  function changeFormation(nextFormation: string) {
    if (nextFormation !== formation) setPendingFormation(nextFormation);
  }

  function replaceStarter(outId: string, inId: string) {
    const outgoing = squad.players.find((player) => player.id === outId);
    const incoming = squad.players.find((player) => player.id === inId);
    if (!outgoing || !incoming || outgoing.position !== incoming.position || starterIds.includes(inId)) {
      notify("Ese cambio no es compatible con tu alineación");
      return;
    }
    setStarterIds((ids) => ids.map((id) => id === outId ? inId : id));
    if (captainId === outId) setCaptainId(inId);
    setDetailPlayerId(null);
    setSaved(false);
    notify(`${incoming.name} entra en el once`);
  }

  function saveLineup() {
    if (currentStarters.length !== 11 || !captainId) { notify("Completa el once y selecciona capitán"); return; }
    setSaved(true);
    notify("Borrador de la Jornada 5 guardado");
  }

  return <section className="league-tab-view lineup-builder">
    <div className="league-section-heading"><div><p className="eyebrow">JORNADA 5 · BORRADOR ABIERTO</p><h2>Prepara la siguiente jornada</h2><p>La Jornada 4 está bloqueada, pero ya puedes montar el once de la Jornada 5.</p></div><button className="primary-button" onClick={saveLineup}>{saved ? "✓ Alineación guardada" : "Guardar alineación"}</button></div>
    <TeamMatchdaySelector selected={selectedTeamMatchday} onSelect={setSelectedTeamMatchday} />
    <div className="lineup-process"><span className="complete">1 <b>Formación</b></span><span className="complete">2 <b>Once</b></span><span className={captainId ? "complete" : ""}>3 <b>Capitán</b></span><span className={saved ? "complete" : ""}>4 <b>Confirmación</b></span></div>
    <div className="formation-picker"><small>FORMACIÓN</small>{Object.keys(formations).map((item) => <button className={formation === item ? "active" : ""} key={item} onClick={() => changeFormation(item)}>{item}</button>)}</div>
    <div className="lineup-layout"><article className="pitch-card"><div className="pitch-header"><div><p className="eyebrow">ONCE INICIAL · {currentStarters.length}/11</p><h2>{formation}</h2></div><span className="saved-state">{saved ? "Guardada" : "Toca un jugador para abrir su ficha"}</span></div><div className="football-pitch league-detail-pitch"><div className="field-line center-line" /><div className="field-line center-circle" /><div className="field-line box top-box" /><div className="field-line box bottom-box" />{(["DEL", "MED", "DEF", "POR"] as PlayerPosition[]).map((position) => <div className="player-row" key={position}>{currentStarters.filter((player) => player.position === position).map((player) => <button className="pitch-player lineup-player" key={player.id} onClick={() => setDetailPlayerId(player.id)}><span>{player.initials}{captainId === player.id && <b>C</b>}</span><strong>{player.name}</strong><small>{player.club}</small></button>)}</div>)}</div></article><aside className="lineup-panel"><div className="panel-block lineup-instructions"><p className="eyebrow">BANQUILLO · {currentBench.length}</p><small>Toca un suplente para gestionar su contrato, cláusula y operaciones.</small>{currentBench.map((player) => { const contract = playerContracts[`${participationId}:${player.id}`]; const blind = Boolean(contract?.blindUntil && contract.blindUntil > Date.now()); const activeOfferCount = (playerOffers[`${participationId}:${player.id}`] ?? []).filter((offer) => offer.status === "active" && offer.expiresAt > Date.now()).length; return <button className={`bench-player selectable-bench ${contract?.listed ? "listed" : ""}`} key={player.id} onClick={() => setManagedBenchPlayerId(player.id)}><Avatar label={player.initials} /><span>{player.name}<small>{player.position} · {player.club}</small></span><span className="bench-statuses"><b>{player.position}</b>{contract?.listed && <em>EN VENTA</em>}{blind && <em className="blind">BLINDADO</em>}{activeOfferCount ? <i>{activeOfferCount} ofertas</i> : null}</span></button>; })}</div><div className="panel-block captain-panel"><p className="eyebrow">CAPITÁN</p><p>El capitán obtiene el multiplicador que configure la liga.</p><div className="captain-current"><Avatar label={squad.players.find((player) => player.id === captainId)?.initials} /><div><small>CAPITÁN ACTUAL</small><strong>{squad.players.find((player) => player.id === captainId)?.name}</strong></div></div></div><div className="lineup-lock-note"><span>◷</span><p><strong>Cierre automático</strong><small>El backend guardará una copia inmutable del once cuando llegue la hora límite.</small></p></div></aside></div>
    {detailPlayer && <PlayerDetailSheet player={detailPlayer} competition={league.competition} captain={captainId === detailPlayer.id} scoringRules={scoringRules} bench={currentBench} marketPlayers={marketPlayers} onClose={() => setDetailPlayerId(null)} onSwap={(incomingId) => replaceStarter(detailPlayer.id, incomingId)} onCaptain={() => { setCaptainId(detailPlayer.id); setSaved(false); notify(`${detailPlayer.name} es tu capitán`); }} notify={notify} />}
    {managedBenchPlayer && managedContract && <BenchPlayerManagementSheet player={managedBenchPlayer} competition={league.competition} exclusiveMarket={league.mode !== "fantasy"} budget={budget} contract={managedContract} offers={managedOffers} onChangeContract={(contract) => onChangePlayerContract(managedBenchPlayer.id, contract)} onCreateRivalOffer={() => onCreatePlayerOffer(managedBenchPlayer, "rival")} onRespondOffer={(offerId, accept) => onRespondPlayerOffer(managedBenchPlayer, offerId, accept)} onAdjustBudget={onAdjustBudget} onImmediateSale={() => { onImmediateSale(managedBenchPlayer); setManagedBenchPlayerId(null); notify(`${managedBenchPlayer.name} vendido por ${(managedBenchPlayer.value * .5).toFixed(1).replace(".", ",")} M`); }} onClose={() => setManagedBenchPlayerId(null)} notify={notify} />}
    {pendingFormation && <FormationChangeDialog currentFormation={formation} targetFormation={pendingFormation} targetQuotas={formations[pendingFormation]} players={squad.players} starterIds={starterIds} onClose={() => setPendingFormation(null)} onConfirm={(nextIds) => { setFormation(pendingFormation); setStarterIds(nextIds); if (!nextIds.includes(captainId)) setCaptainId(nextIds[0]); setSaved(false); setPendingFormation(null); }} />}
  </section>;
}

function FantasyBudgetPending({ event }: { event: FantasyEvent }) {
  return <section className="league-tab-view fantasy-budget-pending"><span>◷</span><p className="eyebrow">INSCRIPCIÓN CONFIRMADA · PRECIOS PENDIENTES</p><h2>Tu presupuesto se publicará al cerrar la Jornada {event.previousMatchday}</h2><p>En ese momento calcularemos los valores fantásticos semanales, congelaremos una única versión para todos y abriremos el constructor del equipo.</p><div><strong>{event.name}</strong><span>{event.fixtures.map((fixture) => `${fixture.home} vs ${fixture.away}`).join(" · ")}</span><small>{event.memberCount} participantes inscritos</small></div><article><b>✓</b><p><strong>No tienes que volver a inscribirte</strong><small>Cuando el snapshot esté disponible aparecerán aquí el presupuesto y todos los jugadores válidos.</small></p></article></section>;
}

function FantasySnapshotBanner({ event }: { event: FantasyEvent }) {
  const snapshot = event.snapshot!;
  return <article className="fantasy-snapshot-banner"><span>SNAP</span><div><p className="eyebrow">PRECIOS SEMANALES CONGELADOS</p><strong>{Object.keys(snapshot.playerPrices).length} jugadores · presupuesto {snapshot.budget.toFixed(1).replace(".", ",")} M</strong><small>Todos usan la versión {snapshot.algorithmVersion}, capturada el {new Date(snapshot.capturedAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.</small></div><b>P{snapshot.percentile}</b></article>;
}

function FantasyQuickTools({ options, onCommand }: { options: MarketRules; onCommand: (type: FantasyBuilderCommand["type"], respectBudget?: boolean) => void }) {
  const [randomOpen, setRandomOpen] = useState(false);
  const [respectBudget, setRespectBudget] = useState(options.fantasyAllowRandomWithinBudget);
  const [confirmClear, setConfirmClear] = useState(false);
  const randomEnabled = options.fantasyAllowRandomWithinBudget || options.fantasyAllowRandomUnlimited;
  return <section className="fantasy-quick-tools"><div><p className="eyebrow">INICIO RÁPIDO</p><h3>¿Cómo quieres preparar tu once?</h3><small>Puedes usar estas opciones en cualquier momento antes de guardar.</small></div><div className="fantasy-tool-buttons">{options.fantasyAllowCopyPrevious && <button onClick={() => onCommand("copy")}><span>↻</span><p><strong>Copiar Jornada 4</strong><small>Usar el once anterior</small></p></button>}{randomEnabled && <button onClick={() => setRandomOpen(true)}><span>⚄</span><p><strong>Equipo aleatorio</strong><small>Elige cómo tratar el saldo</small></p></button>}{options.fantasyAllowClear && <button className="clear" onClick={() => setConfirmClear(true)}><span>×</span><p><strong>Vaciar equipo</strong><small>Empezar completamente de cero</small></p></button>}</div>{randomOpen && <div className="dialog-backdrop fantasy-tool-backdrop"><section className="team-dialog fantasy-random-dialog" role="dialog" aria-modal="true" aria-labelledby="fantasy-random-title"><div className="dialog-header"><div><p className="eyebrow">GENERADOR DE ONCE</p><h2 id="fantasy-random-title">Equipo aleatorio</h2></div><button className="dialog-close" onClick={() => setRandomOpen(false)} aria-label="Cerrar">×</button></div><p>Se respetará la formación seleccionada y podrás modificar cualquier jugador después.</p><div className="fantasy-random-options">{options.fantasyAllowRandomWithinBudget && <button className={respectBudget ? "active" : ""} onClick={() => setRespectBudget(true)}><span>{respectBudget ? "✓" : ""}</span><div><strong>Respetar presupuesto</strong><small>El once generado nunca superará el saldo máximo.</small></div></button>}{options.fantasyAllowRandomUnlimited && <button className={!respectBudget ? "active" : ""} onClick={() => setRespectBudget(false)}><span>{!respectBudget ? "✓" : ""}</span><div><strong>Ignorar presupuesto</strong><small>Puede superar el límite; tendrás que ajustarlo antes de guardar.</small></div></button>}</div><div className="dialog-actions"><button className="secondary-button" onClick={() => setRandomOpen(false)}>Cancelar</button><button className="primary-button" onClick={() => { onCommand("random", respectBudget); setRandomOpen(false); }}>Generar equipo</button></div></section></div>}{confirmClear && <div className="dialog-backdrop fantasy-tool-backdrop"><section className="team-dialog fantasy-clear-dialog" role="dialog" aria-modal="true"><div className="dialog-header"><div><p className="eyebrow">VACIAR BORRADOR</p><h2>Empezar de cero</h2></div><button className="dialog-close" onClick={() => setConfirmClear(false)} aria-label="Cerrar">×</button></div><p>Se eliminarán los 11 jugadores y el capitán del borrador actual. El presupuesto volverá a estar completo.</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setConfirmClear(false)}>Cancelar</button><button className="leave-league-button" onClick={() => { onCommand("clear"); setConfirmClear(false); }}>Vaciar equipo</button></div></section></div>}</section>;
}

function FantasyMatchdayBuilder({ competition, players, previousPlayerIds, matchdayBudget, scoringRules, savedLineup, command, onSave, onSelectMatchday, notify }: { competition: CompetitionName; players: MarketPlayer[]; previousPlayerIds: string[]; matchdayBudget: number; scoringRules: ScoringRule[]; savedLineup?: FantasyLineupDraft; command: FantasyBuilderCommand | null; onSave: (lineup: FantasyLineupDraft) => void; onSelectMatchday: (matchday: number) => void; notify: (message: string) => void }) {
  const formations: Record<string, Record<PlayerPosition, number>> = { "4-4-2": { POR: 1, DEF: 4, MED: 4, DEL: 2 }, "4-3-3": { POR: 1, DEF: 4, MED: 3, DEL: 3 }, "3-4-3": { POR: 1, DEF: 3, MED: 4, DEL: 3 }, "3-5-2": { POR: 1, DEF: 3, MED: 5, DEL: 2 }, "5-3-2": { POR: 1, DEF: 5, MED: 3, DEL: 2 } };
  const [formation, setFormation] = useState(savedLineup?.formation ?? "4-4-2");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => savedLineup?.playerIds.filter((id) => players.some((player) => player.id === id)) ?? []);
  const [captainId, setCaptainId] = useState(savedLineup?.captainId ?? "");
  const [saved, setSaved] = useState(Boolean(savedLineup));
  const [positionFilter, setPositionFilter] = useState<PlayerPosition>("POR");
  const [query, setQuery] = useState("");
  const [pendingFormation, setPendingFormation] = useState<string | null>(null);
  const [lastMovement, setLastMovement] = useState<{ type: "buy" | "sell"; playerName: string; amount: number; balance: number } | null>(null);
  useEffect(() => {
    setFormation(savedLineup?.formation ?? "4-4-2");
    setSelectedIds(savedLineup?.playerIds.filter((id) => players.some((player) => player.id === id)) ?? []);
    setCaptainId(savedLineup?.captainId ?? "");
    setSaved(Boolean(savedLineup));
    setLastMovement(null);
  }, [competition, savedLineup]);
  const selectedPlayers = players.filter((player) => selectedIds.includes(player.id));
  const spent = selectedPlayers.reduce((total, player) => total + player.price, 0);
  const remaining = Number((matchdayBudget - spent).toFixed(1));
  const complete = selectedIds.length === 11 && selectedIds.includes(captainId) && remaining >= 0 && (Object.keys(formations[formation]) as PlayerPosition[]).every((position) => selectedPlayers.filter((player) => player.position === position).length === formations[formation][position]);
  const visiblePlayers = players.filter((player) => player.position === positionFilter && `${player.name} ${player.club}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));

  function addPlayer(player: MarketPlayer) {
    if (selectedIds.includes(player.id)) {
      setSelectedIds((ids) => ids.filter((id) => id !== player.id));
      if (captainId === player.id) setCaptainId("");
      setLastMovement({ type: "sell", playerName: player.name, amount: player.price, balance: Number((remaining + player.price).toFixed(1)) });
      setSaved(false);
      return;
    }
    const positionCount = selectedPlayers.filter((item) => item.position === player.position).length;
    if (positionCount >= formations[formation][player.position]) { notify(`Ya has completado las plazas de ${player.position}`); return; }
    if (player.price > remaining) { notify("Este jugador supera el presupuesto restante"); return; }
    setSelectedIds((ids) => [...ids, player.id]);
    setLastMovement({ type: "buy", playerName: player.name, amount: player.price, balance: Number((remaining - player.price).toFixed(1)) });
    setSaved(false);
  }

  function copyPrevious() {
    const available = previousPlayerIds.map((id) => players.find((player) => player.id === id)).filter((player): player is MarketPlayer => Boolean(player));
    const valid = (Object.keys(formations[formation]) as PlayerPosition[]).flatMap((position) => available.filter((player) => player.position === position).slice(0, formations[formation][position]));
    const cost = valid.reduce((total, player) => total + player.price, 0);
    if (valid.length !== 11 || cost > matchdayBudget) { notify("El once anterior no cumple la formación o el presupuesto actual"); return; }
    setSelectedIds(valid.map((player) => player.id));
    setCaptainId(valid.find((player) => player.position === "DEL")?.id ?? valid[0].id);
    setLastMovement(null);
    setSaved(false);
    notify("Once anterior copiado como punto de partida");
  }

  function createRandomTeam(respectBudget: boolean) {
    const positions = Object.keys(formations[formation]) as PlayerPosition[];
    let chosen: MarketPlayer[] = [];
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const candidate = positions.flatMap((position) => players.filter((player) => player.position === position).map((player) => ({ player, order: Math.random() })).sort((a, b) => a.order - b.order).slice(0, formations[formation][position]).map((item) => item.player));
      const cost = candidate.reduce((total, player) => total + player.price, 0);
      if (candidate.length === 11 && (!respectBudget || cost <= matchdayBudget)) { chosen = candidate; break; }
    }
    if (chosen.length !== 11) { notify("No se ha encontrado un once aleatorio válido con este presupuesto"); return; }
    setSelectedIds(chosen.map((player) => player.id));
    setCaptainId(chosen.find((player) => player.position === "DEL")?.id ?? chosen[0].id);
    setLastMovement(null);
    setSaved(false);
    const cost = chosen.reduce((total, player) => total + player.price, 0);
    notify(respectBudget ? `Once aleatorio creado · ${(matchdayBudget - cost).toFixed(1).replace(".", ",")} M disponibles` : cost > matchdayBudget ? "Once aleatorio creado · ajusta el saldo antes de guardar" : "Once aleatorio creado");
  }

  function clearFantasyTeam() {
    setSelectedIds([]);
    setCaptainId("");
    setLastMovement(null);
    setSaved(false);
    notify("Equipo vaciado · presupuesto completo disponible");
  }

  useEffect(() => {
    if (!command) return;
    if (command.type === "copy") copyPrevious();
    if (command.type === "random") createRandomTeam(Boolean(command.respectBudget));
    if (command.type === "clear") clearFantasyTeam();
  }, [command?.id]);

  function applyFormation(next: string, nextIds: string[]) {
    const nextPlayers = players.filter((player) => nextIds.includes(player.id));
    const nextSpent = nextPlayers.reduce((total, player) => total + player.price, 0);
    const difference = Number((nextSpent - spent).toFixed(1));
    setFormation(next);
    setSelectedIds(nextIds);
    if (!nextIds.includes(captainId)) setCaptainId("");
    if (difference !== 0) setLastMovement({ type: difference > 0 ? "buy" : "sell", playerName: "cambio de formación", amount: Math.abs(difference), balance: Number((matchdayBudget - nextSpent).toFixed(1)) });
    setSaved(false);
    setPendingFormation(null);
  }

  function saveFantasyLineup() {
    if (!complete) { notify("Completa el once y selecciona capitán antes de guardar"); return; }
    onSave({ matchday: 5, formation, playerIds: selectedIds, captainId, spent: Number(spent.toFixed(1)), savedAt: Date.now() });
    setSaved(true);
    notify("Equipo fantástico de la Jornada 5 guardado");
  }

  return <section className="league-tab-view fantasy-lineup-builder"><div className="league-section-heading"><div><p className="eyebrow">LIGA FANTÁSTICA · JORNADA 5</p><h2>Crea un equipo nuevo</h2><p>Ficha y vende desde el banquillo universal de {competition}. Cada jornada empieza vacía.</p></div><button className="primary-button" disabled={!complete} onClick={saveFantasyLineup}>{saved ? "✓ Equipo guardado" : complete ? "Guardar equipo" : `${selectedIds.length}/11 jugadores`}</button></div><TeamMatchdaySelector selected={5} onSelect={onSelectMatchday} /><section className="fantasy-budget-hero"><div><small>SALDO DISPONIBLE</small><strong>{remaining.toFixed(1).replace(".", ",")} M</strong><span>presupuesto exclusivo de esta jornada</span></div><div><div className="fantasy-budget-summary"><span><small>INICIAL</small><b>{matchdayBudget.toFixed(1).replace(".", ",")} M</b></span><span><small>GASTADO</small><b>{spent.toFixed(1).replace(".", ",")} M</b></span><span><small>FICHAJES</small><b>{selectedIds.length}/11</b></span></div><div className="fantasy-budget-meter"><i style={{ width: `${Math.min(100, spent / matchdayBudget * 100)}%` }} /></div></div><button onClick={copyPrevious}>↻ Copiar equipo de la Jornada 4</button></section>{lastMovement && <article className={`fantasy-movement ${lastMovement.type}`}><span>{lastMovement.type === "buy" ? "−" : "+"}{lastMovement.amount.toFixed(1).replace(".", ",")} M</span><div><strong>{lastMovement.type === "buy" ? "Fichaje realizado" : "Venta realizada"}: {lastMovement.playerName}</strong><small>Nuevo saldo disponible: {lastMovement.balance.toFixed(1).replace(".", ",")} M</small></div></article>}<div className="formation-picker fantasy-formations"><small>FORMACIÓN</small>{Object.keys(formations).map((item) => <button className={formation === item ? "active" : ""} key={item} onClick={() => item !== formation && setPendingFormation(item)}>{item}</button>)}</div><div className="fantasy-builder-grid"><article className="pitch-card"><div className="pitch-header"><div><p className="eyebrow">TU ONCE · {selectedIds.length}/11</p><h2>{formation}</h2></div><span className="saved-state">{saved ? "Guardado · puedes seguir editando" : "Toca un fichado para venderlo · elige capitán abajo"}</span></div><div className="football-pitch league-detail-pitch fantasy-draft-pitch"><div className="field-line center-line" /><div className="field-line center-circle" /><div className="field-line box top-box" /><div className="field-line box bottom-box" />{(["DEL","MED","DEF","POR"] as PlayerPosition[]).map((position) => <div className="player-row" key={position}>{selectedPlayers.filter((player) => player.position === position).map((player) => <button className="pitch-player lineup-player" key={player.id} onClick={() => addPlayer(player)}><span>{player.initials}{captainId === player.id && <b>C</b>}</span><strong>{player.name}</strong><small>Vender · +{player.price.toFixed(1).replace(".", ",")} M</small></button>)}{Array.from({ length: Math.max(0, formations[formation][position] - selectedPlayers.filter((player) => player.position === position).length) }, (_, index) => <span className="empty-pitch-slot" key={index}>+</span>)}</div>)}</div><div className="fantasy-captain-picker"><p className="eyebrow">CAPITÁN DE LA JORNADA</p><div>{selectedPlayers.map((player) => <button className={captainId === player.id ? "active" : ""} key={player.id} onClick={() => { setCaptainId(player.id); setSaved(false); }}><Avatar label={player.initials} /><span>{player.name}</span></button>)}</div></div></article><aside className="fantasy-player-picker"><div className="fantasy-universal-head"><div><p className="eyebrow">BANQUILLO UNIVERSAL</p><h3>Todos los jugadores</h3><small>Compra y vende al instante. Pueden repetirse entre participantes.</small></div><span><b>{players.length}</b> disponibles</span></div><label className="fantasy-player-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jugador o club" /></label><nav>{(["POR","DEF","MED","DEL"] as PlayerPosition[]).map((position) => <button className={positionFilter === position ? "active" : ""} key={position} onClick={() => setPositionFilter(position)}>{position} <b>{selectedPlayers.filter((player) => player.position === position).length}/{formations[formation][position]}</b></button>)}</nav><div className="fantasy-catalog-list">{visiblePlayers.map((player) => { const selected = selectedIds.includes(player.id); const disabled = !selected && (player.price > remaining || selectedPlayers.filter((item) => item.position === player.position).length >= formations[formation][player.position]); return <button className={selected ? "selected" : ""} disabled={disabled} key={player.id} onClick={() => addPlayer(player)}><Avatar label={player.initials} /><span><strong>{player.name}</strong><small>{player.club}</small></span><b>{player.price.toFixed(1).replace(".", ",")} M</b><em>{selected ? "Vender" : "Fichar"}</em></button>; })}</div></aside></div><article className="fantasy-reset-note"><span>{matchdayBudget.toFixed(0)} M</span><div><strong>Presupuesto independiente por jornada</strong><p>Cada fichaje resta su precio y cada venta devuelve exactamente el importe pagado. No afecta a otras jornadas ni a otros participantes.</p></div></article>{pendingFormation && <FantasyFormationChangeDialog currentFormation={formation} targetFormation={pendingFormation} targetQuotas={formations[pendingFormation]} players={players} selectedIds={selectedIds} budget={matchdayBudget} onClose={() => setPendingFormation(null)} onConfirm={(ids) => applyFormation(pendingFormation, ids)} />}</section>;
}

function FantasyFormationChangeDialog({ currentFormation, targetFormation, targetQuotas, players, selectedIds, budget, onClose, onConfirm }: { currentFormation: string; targetFormation: string; targetQuotas: Record<PlayerPosition, number>; players: MarketPlayer[]; selectedIds: string[]; budget: number; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [workingIds, setWorkingIds] = useState(selectedIds);
  const [query, setQuery] = useState("");
  const workingPlayers = players.filter((player) => workingIds.includes(player.id));
  const spent = workingPlayers.reduce((total, player) => total + player.price, 0);
  const remaining = Number((budget - spent).toFixed(1));
  const counts = (Object.keys(targetQuotas) as PlayerPosition[]).reduce((result, position) => ({ ...result, [position]: workingPlayers.filter((player) => player.position === position).length }), {} as Record<PlayerPosition, number>);
  const excessPositions = (Object.keys(targetQuotas) as PlayerPosition[]).filter((position) => counts[position] > targetQuotas[position]);
  const missingPositions = (Object.keys(targetQuotas) as PlayerPosition[]).filter((position) => counts[position] < targetQuotas[position]);
  const removing = excessPositions.length > 0;
  const normalizedQuery = query.toLocaleLowerCase("es");
  const candidates = (removing
    ? workingPlayers.filter((player) => excessPositions.includes(player.position))
    : players.filter((player) => !workingIds.includes(player.id) && missingPositions.includes(player.position)))
    .filter((player) => `${player.name} ${player.club}`.toLocaleLowerCase("es").includes(normalizedQuery));
  const valid = workingIds.length === 11 && excessPositions.length === 0 && missingPositions.length === 0 && remaining >= 0;

  function choose(player: MarketPlayer) {
    if (removing) {
      setWorkingIds((ids) => ids.filter((id) => id !== player.id));
      return;
    }
    if (player.price > remaining) return;
    setWorkingIds((ids) => counts[player.position] < targetQuotas[player.position] ? [...ids, player.id] : ids);
  }

  return <div className="dialog-backdrop formation-backdrop" role="presentation"><section className="team-dialog formation-dialog fantasy-formation-dialog" role="dialog" aria-modal="true" aria-labelledby="fantasy-formation-dialog-title"><div className="dialog-header"><div><p className="eyebrow">CAMBIO DE FORMACIÓN FANTÁSTICA</p><h2 id="fantasy-formation-dialog-title">{currentFormation} → {targetFormation}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="fantasy-formation-balance"><span><small>SALDO DISPONIBLE</small><strong>{remaining.toFixed(1).replace(".", ",")} M</strong></span><span><small>JUGADORES</small><strong>{workingIds.length}/11</strong></span></div><div className="formation-change-summary">{(["POR", "DEF", "MED", "DEL"] as PlayerPosition[]).map((position) => <div className={counts[position] === targetQuotas[position] ? "ready" : ""} key={position}><small>{position}</small><strong>{counts[position]} → {targetQuotas[position]}</strong></div>)}</div><div className="formation-change-step"><span>{removing ? "1" : "2"}</span><div><p className="eyebrow">{removing ? "PRIMERO, ELIGE QUIÉN VENDES" : "AHORA, ELIGE A QUIÉN FICHAS"}</p><h3>{removing ? "Libera las plazas que desaparecen" : "Completa la nueva formación"}</h3><p>{removing ? "El precio de cada jugador vuelve inmediatamente al saldo del cambio." : "Puedes elegir cualquier jugador disponible de toda la competición."}</p></div></div>{!removing && !valid && <label className="fantasy-player-search formation-player-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar entre todos los jugadores" /></label>}<div className="formation-player-grid fantasy-formation-player-grid">{candidates.map((player) => <button disabled={!removing && player.price > remaining} key={player.id} onClick={() => choose(player)}><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><span>{player.price.toFixed(1).replace(".", ",")} M</span><b>{removing ? "Vender" : "Fichar"}</b></button>)}</div>{!candidates.length && !valid && <div className="formation-empty"><strong>No hay jugadores disponibles con este filtro</strong><small>Prueba otra búsqueda o libera más presupuesto.</small></div>}{valid && <div className="formation-ready"><span>✓</span><div><strong>Nuevo once completo</strong><small>Cumple el {targetFormation} y mantiene {remaining.toFixed(1).replace(".", ",")} M disponibles.</small></div></div>}<div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={() => onConfirm(workingIds)}>Aplicar {targetFormation}</button></div></section></div>;
}

function TeamMatchdaySelector({ selected, onSelect }: { selected: number; onSelect: (matchday: number) => void }) {
  return <nav className="team-matchday-selector" aria-label="Alineaciones por jornada">{[1,2,3,4,5].map((matchday) => { const editable = matchday === 5; return <button className={`${selected === matchday ? "active" : ""} ${editable ? "draft" : "locked"}`} key={matchday} onClick={() => onSelect(matchday)}><span>{editable ? "✎" : "✓"}</span><div><small>JORNADA {matchday}</small><strong>{editable ? "En preparación" : matchday === 4 ? "Bloqueada · última" : "Cerrada"}</strong></div>{editable ? <em>EDITAR</em> : <em>VER PUNTOS</em>}</button>; })}</nav>;
}

function LockedTeamMatchdayView({ squad, competition, matchday, scoringRules, onSelectMatchday }: { squad: InitialSquad; competition: CompetitionName; matchday: number; scoringRules: ScoringRule[]; onSelectMatchday: (matchday: number) => void }) {
  const [selectedPlayer, setSelectedPlayer] = useState<InitialSquadPlayer | null>(null);
  const formations = ["4-4-2", "4-3-3", "3-5-2", "4-4-2"];
  const formation = formations[matchday - 1] ?? "4-4-2";
  const starters = squad.players.filter((player) => squad.startingPlayerIds.includes(player.id));
  const bench = squad.players.filter((player) => !squad.startingPlayerIds.includes(player.id));
  const captain = starters.find((player) => player.position === "DEL") ?? starters[0];
  const scoreFor = (player: InitialSquadPlayer) => calculatePlayerPoints(demoPlayerMatchStats(`${player.id}_j${matchday}`, player.position), player.position, scoringRules).total;
  const total = starters.reduce((sum, player) => sum + scoreFor(player), 0);
  return <section className="league-tab-view locked-team-matchday"><div className="league-section-heading"><div><p className="eyebrow">JORNADA {matchday} · COPIA CERRADA</p><h2>Alineación bloqueada</h2><p>Este es el equipo utilizado para puntuar. Ya no se puede modificar.</p></div><div className="locked-matchday-total"><small>TOTAL</small><strong>{total} pts</strong></div></div><TeamMatchdaySelector selected={matchday} onSelect={onSelectMatchday} /><article className="locked-team-banner"><span>◉</span><div><strong>Solo consulta</strong><p>Los fichajes, ventas y cambios actuales no alteran esta fotografía histórica. Puedes abrir cualquier jugador para revisar sus puntos.</p></div><button onClick={() => onSelectMatchday(5)}>Preparar Jornada 5 →</button></article><div className="locked-lineup-layout"><article className="pitch-card"><div className="pitch-header"><div><p className="eyebrow">ONCE CERRADO · {starters.length}/11</p><h2>{formation}</h2></div><span className="saved-state">Capitán · {captain?.name}</span></div><div className="football-pitch league-detail-pitch locked-pitch"><div className="field-line center-line" /><div className="field-line center-circle" /><div className="field-line box top-box" /><div className="field-line box bottom-box" />{(["DEL", "MED", "DEF", "POR"] as PlayerPosition[]).map((position) => <div className="player-row" key={position}>{starters.filter((player) => player.position === position).map((player) => { const score = scoreFor(player); return <button className="pitch-player lineup-player locked-player" key={player.id} onClick={() => setSelectedPlayer(player)}><span>{player.initials}{captain?.id === player.id && <b>C</b>}</span><strong>{player.name}</strong><small className={score >= 0 ? "positive" : "negative"}>{score > 0 ? "+" : ""}{score} pts</small></button>; })}</div>)}</div></article><aside className="locked-bench-panel"><div><p className="eyebrow">BANQUILLO · NO SUMA</p><h3>Puntos informativos</h3></div>{bench.map((player) => { const score = scoreFor(player); return <button key={player.id} onClick={() => setSelectedPlayer(player)}><Avatar label={player.initials} /><span><strong>{player.name}</strong><small>{player.position} · {player.club}</small></span><b className={score >= 0 ? "positive" : "negative"}>{score > 0 ? "+" : ""}{score}</b></button>; })}<footer>Esta plantilla se conserva aunque el jugador haya sido vendido posteriormente.</footer></aside></div>{selectedPlayer && <PlayerDetailSheet player={selectedPlayer} competition={competition} captain={captain?.id === selectedPlayer.id} matchday={matchday} scoringRules={scoringRules} readOnly onClose={() => setSelectedPlayer(null)} />}</section>;
}

function playerDemoStats(playerId: string) {
  const seed = [...playerId].reduce((total, character, index) => total + character.charCodeAt(0) * (index + 1), 0);
  const matches = 24 + seed % 12;
  const points = 78 + seed % 91;
  return { matches, points, average: Number((points / matches).toFixed(1)), form: 55 + seed % 41 };
}

function offerValidityLabel(expiresAt: number, now: number) {
  const remaining = Math.max(0, expiresAt - now);
  if (!remaining) return "Caducada";
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return `${hours} h ${minutes} min`;
}

function BenchPlayerManagementSheet({ player, competition, exclusiveMarket, budget, contract, offers, onChangeContract, onCreateRivalOffer, onRespondOffer, onAdjustBudget, onImmediateSale, onClose, notify }: { player: InitialSquadPlayer; competition: CompetitionName; exclusiveMarket: boolean; budget: number; contract: PlayerContract; offers: PlayerOffer[]; onChangeContract: (contract: PlayerContract) => void; onCreateRivalOffer: () => void; onRespondOffer: (offerId: string, accept: boolean) => void; onAdjustBudget: (difference: number) => void; onImmediateSale: () => void; onClose: () => void; notify: (message: string) => void }) {
  const [panel, setPanel] = useState<"overview" | "clause" | "offers" | "history" | "sell">("overview");
  const [now, setNow] = useState(Date.now());
  const [confirmOfferId, setConfirmOfferId] = useState<string | null>(null);
  const trend = getCompetitionTrends(competition).find((item) => item.id === player.id);
  const blindActive = Boolean(contract.blindUntil && contract.blindUntil > Date.now());
  const immediateValue = Number((player.value * .5).toFixed(1));
  const activeOffers = offers.filter((offer) => offer.status === "active" && offer.expiresAt > now);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);

  function raiseClause(percent: number) {
    const nextClause = Number((contract.clause * (1 + percent / 100)).toFixed(1));
    const cost = Number(((nextClause - contract.clause) * .1).toFixed(1));
    if (cost > budget) { notify("No tienes saldo suficiente para esta mejora"); return; }
    onAdjustBudget(-cost);
    onChangeContract({ ...contract, clause: nextClause });
    setPanel("overview");
    notify(`Cláusula elevada a ${nextClause.toFixed(1).replace(".", ",")} M`);
  }

  function toggleListing() {
    const listed = !contract.listed;
    onChangeContract({ ...contract, listed, offers: listed ? contract.offers : 0 });
    if (listed) onCreateRivalOffer();
    notify(listed ? `${player.name} ya aparece en el mercado de la liga` : `${player.name} retirado del mercado`);
  }

  function toggleBlind() {
    const nextBlindUntil = blindActive ? undefined : Date.now() + 24 * 60 * 60 * 1000;
    onChangeContract({ ...contract, blindUntil: nextBlindUntil });
    notify(nextBlindUntil ? "Blindaje activado durante 24 horas" : "Blindaje retirado");
  }

  return <div className="player-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="player-detail-sheet bench-management-sheet" role="dialog" aria-modal="true" aria-labelledby="bench-player-title"><div className="sheet-handle" /><button className="player-sheet-close" onClick={onClose} aria-label="Cerrar ficha">×</button><div className="player-sheet-hero management-hero"><div className="player-sheet-photo">{player.photoUrl ? <img src={player.photoUrl} alt={`Foto de ${player.name}`} /> : <div className="player-photo-fallback"><strong>{player.initials}</strong><small>FOTO OFICIAL</small></div>}</div><div className="player-sheet-identity"><span className="position-chip">{player.position}</span><span className="bench-chip">BANQUILLO</span><p>{player.club}</p><h2 id="bench-player-title">{player.name}</h2><div className="player-market-value"><small>VALOR DE MERCADO</small><strong>{player.value.toFixed(1).replace(".", ",")} M</strong><span className={(trend?.changePercent ?? 0) >= 0 ? "positive" : "negative"}>{trend && `${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1).replace(".", ",")} %`}</span></div></div></div>

    {panel === "overview" && <><section className="contract-summary"><article><small>CLÁUSULA</small><strong>{contract.clause.toFixed(1).replace(".", ",")} M</strong><button onClick={() => setPanel("clause")}>Subir</button></article><article><small>ESTADO</small><strong>{blindActive ? "Blindado" : contract.listed ? "En venta" : "Disponible"}</strong><span>{contract.untouchable ? "Marcado intocable" : "Sin restricciones"}</span></article><article><small>OFERTAS VÁLIDAS</small><strong>{activeOffers.length}</strong><button onClick={() => setPanel("offers")}>Revisar</button></article></section>{!exclusiveMarket && <article className="fantasy-management-note"><span>∞</span><div><strong>Plantilla fantástica</strong><p>En esta modalidad los jugadores no son exclusivos, por lo que no existen cláusulas, blindajes ni ofertas entre propietarios.</p></div></article>}{exclusiveMarket && <section className="management-action-grid"><button onClick={() => setPanel("clause")}><span>↑</span><div><strong>Subir cláusula</strong><small>Protege su valor contractual</small></div></button><button className={contract.listed ? "active" : ""} onClick={toggleListing}><span>↗</span><div><strong>{contract.listed ? "Retirar del mercado" : "Poner en el mercado"}</strong><small>{contract.listed ? "Dejar de recibir ofertas" : "Recibir ofertas de rivales"}</small></div></button><button className={blindActive ? "active" : ""} onClick={toggleBlind}><span>◆</span><div><strong>{blindActive ? "Jugador blindado" : "Blindar 24 horas"}</strong><small>Impide cualquier clausulazo</small></div></button><button className="danger" onClick={() => setPanel("sell")}><span>−</span><div><strong>Venta inmediata</strong><small>Recibes {immediateValue.toFixed(1).replace(".", ",")} M</small></div></button></section>}<section className="secondary-management-actions"><button onClick={() => { onChangeContract({ ...contract, untouchable: !contract.untouchable }); notify(contract.untouchable ? "Marca de intocable retirada" : "Jugador marcado como intocable"); }}><span>☆</span>{contract.untouchable ? "Quitar intocable" : "Marcar intocable"}</button><button onClick={() => notify("Comparador de sustitutos preparado")}><span>↔</span>Comparar</button><button onClick={() => setPanel("history")}><span>◷</span>Historial</button></section></>}

    {panel === "clause" && <section className="management-panel"><button className="management-back" onClick={() => setPanel("overview")}>‹ Volver</button><p className="eyebrow">PROTECCIÓN CONTRACTUAL</p><h3>Subir cláusula</h3><p>La mejora se aplica inmediatamente y su pequeño coste se descuenta del saldo de esta liga.</p><div className="clause-options">{[10,25,50].map((percent) => { const next = Number((contract.clause * (1 + percent / 100)).toFixed(1)); const cost = Number(((next - contract.clause) * .1).toFixed(1)); return <button key={percent} onClick={() => raiseClause(percent)}><span>+{percent}%</span><strong>{next.toFixed(1).replace(".", ",")} M</strong><small>Coste {cost.toFixed(1).replace(".", ",")} M</small></button>; })}</div><small className="management-rule-note">Saldo disponible: {budget.toFixed(1).replace(".", ",")} M · el coste es demostrativo y quedará configurable.</small></section>}

    {panel === "offers" && <section className="management-panel offers-management-panel"><button className="management-back" onClick={() => setPanel("overview")}>‹ Volver</button><p className="eyebrow">OFERTAS RECIBIDAS</p><h3>{activeOffers.length} ofertas válidas</h3>{activeOffers.length ? <div className="player-offers-list detailed">{activeOffers.map((offer) => <article className={offer.source} key={offer.id}><span>{offer.bidderInitials}</span><div><strong>{offer.bidderName}</strong><small>{offer.source === "game" ? "Oferta generada por el juego" : "Usuario rival"}</small><em>Válida durante {offerValidityLabel(offer.expiresAt, now)}</em></div><b>{offer.amount.toFixed(1).replace(".", ",")} M</b><div className="offer-response-actions"><button onClick={() => onRespondOffer(offer.id, false)}>Rechazar</button><button onClick={() => setConfirmOfferId(offer.id)}>Aceptar</button></div>{confirmOfferId === offer.id && <div className="accept-offer-confirm"><p>Aceptar venderá al jugador y rechazará automáticamente las demás ofertas.</p><button onClick={() => setConfirmOfferId(null)}>Cancelar</button><button onClick={() => onRespondOffer(offer.id, true)}>Confirmar venta</button></div>}</article>)}</div> : <div className="no-replacements">{contract.listed ? "Aún no hay ofertas válidas. Los rivales pueden ofertar durante 24 horas y el juego lo evaluará en la próxima renovación." : "Pon al jugador en el mercado para recibir ofertas de otros participantes."}</div>}<p className="offers-validity-note">Las ofertas rivales caducan 24 horas después de crearse. Las del juego caducan en la siguiente renovación del mercado.</p></section>}

    {panel === "history" && <section className="management-panel"><button className="management-back" onClick={() => setPanel("overview")}>‹ Volver</button><p className="eyebrow">HISTORIAL DEL JUGADOR</p><h3>Contrato y valor</h3><div className="contract-history"><p><span>Hoy</span><strong>Valor actualizado a {player.value.toFixed(1).replace(".", ",")} M</strong></p><p><span>Hace 4 días</span><strong>Cláusula fijada en {contract.clause.toFixed(1).replace(".", ",")} M</strong></p><p><span>Inicio de liga</span><strong>Asignado a tu plantilla inicial</strong></p></div></section>}

    {panel === "sell" && <section className="management-panel immediate-sale-confirm"><button className="management-back" onClick={() => setPanel("overview")}>‹ Volver</button><span>!</span><h3>¿Vender inmediatamente?</h3><p>Recibirás el 50% de su valor: <strong>{immediateValue.toFixed(1).replace(".", ",")} M</strong>. El jugador abandonará tu banquillo y la operación no se puede deshacer.</p><button className="danger-confirm" onClick={onImmediateSale}>Confirmar venta por {immediateValue.toFixed(1).replace(".", ",")} M</button></section>}
  </section></div>;
}

function PlayerDetailSheet({ player, competition, captain = false, matchday = 1, scoringRules, bench = [], marketPlayers = [], readOnly = false, onClose, onSwap, onCaptain, notify = () => {} }: {
  player: InitialSquadPlayer;
  competition: CompetitionName;
  captain?: boolean;
  matchday?: number;
  scoringRules: ScoringRule[];
  bench?: InitialSquadPlayer[];
  marketPlayers?: MarketPlayer[];
  readOnly?: boolean;
  onClose: () => void;
  onSwap?: (incomingId: string) => void;
  onCaptain?: () => void;
  notify?: (message: string) => void;
}) {
  const [tab, setTab] = useState<"summary" | "points">(readOnly ? "points" : "summary");
  const [recommendationOpen, setRecommendationOpen] = useState(false);
  const fixture = getNextFixture(competition, player.club);
  const trend = getCompetitionTrends(competition).find((item) => item.id === player.id);
  const stats = playerDemoStats(player.id);
  const matchStats = demoPlayerMatchStats(`${player.id}_j${matchday}`, player.position);
  const matchScore = calculatePlayerPoints(matchStats, player.position, scoringRules);
  const compatibleBench = bench.filter((item) => item.position === player.position);
  const squadIds = new Set([player.id, ...bench.map((item) => item.id)]);
  const trendById = new Map(getCompetitionTrends(competition).map((item) => [item.id, item]));
  const compatibleMarket = marketPlayers.filter((item) => item.position === player.position && !squadIds.has(item.id));
  const bestBench = compatibleBench.map((item) => ({ player: item, score: playerDemoStats(item.id).form + item.value * 2 })).sort((a, b) => b.score - a.score)[0];
  const bestMarket = compatibleMarket.map((item) => ({ player: item, score: (trendById.get(item.id)?.performance ?? item.points) + item.price * 2 })).sort((a, b) => b.score - a.score)[0];
  const recommendation = bestBench && (!bestMarket || bestBench.score >= bestMarket.score)
    ? { source: "bench" as const, player: bestBench.player, score: Math.round(bestBench.score) }
    : bestMarket ? { source: "market" as const, player: bestMarket.player, score: Math.round(bestMarket.score) } : null;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="player-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`player-detail-sheet organized-player-sheet ${readOnly ? "read-only" : ""}`} role="dialog" aria-modal="true" aria-labelledby="player-sheet-title">
      <div className="sheet-handle" />
      <button className="player-sheet-close" onClick={onClose} aria-label="Cerrar ficha">×</button>
      <div className="player-sheet-hero">
        <div className="player-sheet-photo">{player.photoUrl ? <img src={player.photoUrl} alt={`Foto de ${player.name}`} /> : <div className="player-photo-fallback"><strong>{player.initials}</strong><small>FOTO OFICIAL</small></div>}</div>
        <div className="player-sheet-identity"><div className="player-sheet-chips"><span className="position-chip">{player.position}</span>{captain && <span className="captain-chip">CAPITÁN</span>}{readOnly && <span className="readonly-chip">SOLO CONSULTA</span>}</div><p>{player.club}</p><h2 id="player-sheet-title">{player.name}</h2><div className="player-hero-metrics"><div><small>VALOR</small><strong>{player.value.toFixed(1).replace(".", ",")} M</strong><span className={(trend?.changePercent ?? 0) >= 0 ? "positive" : "negative"}>{trend && `${trend.changePercent >= 0 ? "+" : ""}${trend.changePercent.toFixed(1).replace(".", ",")} %`}</span></div><div className="hero-match-points"><small>JORNADA {matchday}</small><strong className={matchScore.total >= 0 ? "positive" : "negative"}>{matchScore.total > 0 ? "+" : ""}{matchScore.total} pts</strong><button onClick={() => setTab("points")}>Ver desglose</button></div></div></div>
      </div>

      <nav className="player-detail-tabs" aria-label="Información del jugador"><button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>Resumen</button><button className={tab === "points" ? "active" : ""} onClick={() => setTab("points")}>Puntos <b>{matchScore.total > 0 ? "+" : ""}{matchScore.total}</b></button></nav>

      {tab === "summary" ? <div className="player-summary-layout">
        <article className="player-stats-card"><div className="sheet-card-heading"><div><p className="eyebrow">TEMPORADA</p><h3>Rendimiento acumulado</h3></div><small>DATOS DEMO</small></div><div className="player-stat-grid"><div><strong>{stats.points}</strong><small>Puntos</small></div><div><strong>{stats.matches}</strong><small>Partidos</small></div><div><strong>{stats.average}</strong><small>Media</small></div><div><strong>{stats.form}</strong><small>Forma</small></div></div>{trend && <TrendBars values={trend.history} />}</article>
        <article className={`next-fixture-card ${fixture?.venue === "Casa" ? "home" : "away"}`}><p className="eyebrow">PRÓXIMA JORNADA</p>{fixture ? <><div className="fixture-venue"><span>{fixture.venue === "Casa" ? "⌂" : "↗"}</span><div><small>JORNADA {fixture.matchday}</small><strong>Juega como {fixture.venue.toLowerCase()}</strong></div></div><div className="fixture-opponent"><small>{fixture.venue === "Casa" ? "RECIBE A" : "VISITA A"}</small><strong>{fixture.opponent}</strong><span>{fixture.dateLabel}</span></div></> : <div className="fixture-pending"><strong>Calendario pendiente</strong><p>Se mostrará al sincronizar el próximo partido oficial.</p></div>}</article>
      </div> : <article className="player-points-card organized"><div className="points-score-header"><div><p className="eyebrow">JORNADA {matchday} · PARTIDO FINALIZADO</p><h3>Cómo consiguió sus puntos</h3><small>Resultado oficial después de la confirmación de la API</small></div><strong className={matchScore.total >= 0 ? "positive" : "negative"}>{matchScore.total > 0 ? "+" : ""}{matchScore.total}<span>puntos</span></strong></div><div className="points-table-head"><span>Estadística</span><span>Dato</span><span>Puntos</span></div><div className="player-points-breakdown">{matchScore.breakdown.map((item) => <p key={item.key}><span>{item.label}<small>{scoringRules.find((rule) => rule.key === item.key)?.providerField}</small></span><b>{item.value}</b><strong className={item.points >= 0 ? "positive" : "negative"}>{item.points > 0 ? "+" : ""}{item.points}</strong></p>)}</div><footer><span>✓</span> Estadísticas y reglas guardadas para poder reproducir este cálculo.</footer></article>}

      {readOnly ? <article className="readonly-player-notice"><span>◉</span><div><strong>Vista informativa de Jornada</strong><p>Puedes consultar información y puntos, pero aquí no se permiten cambios de alineación ni operaciones sobre el jugador.</p></div></article> : <>
        <div className="player-sheet-actions"><button className={captain ? "secondary-button full" : "primary-button full"} onClick={() => onCaptain?.()}>{captain ? "✓ Es tu capitán" : "C Hacer capitán"}</button><button className="recommend-button" onClick={() => setRecommendationOpen(true)}><span>✦</span><div><strong>Recomendar sustituto</strong><small>Compara banquillo y mercado</small></div><b>→</b></button></div>
        {recommendationOpen && <article className="recommendation-card"><div className="sheet-card-heading"><div><p className="eyebrow">RECOMENDACIÓN</p><h3>{recommendation ? "Mejor alternativa compatible" : "Sin alternativas disponibles"}</h3></div><button onClick={() => setRecommendationOpen(false)} aria-label="Cerrar recomendación">×</button></div>{recommendation && <div className="recommended-player"><Avatar label={recommendation.player.initials} /><div><strong>{recommendation.player.name}</strong><small>{recommendation.player.position} · {recommendation.player.club}</small><p>{recommendation.source === "bench" ? "Puede entrar ahora: ya está en tu plantilla y tiene la mejor valoración estimada." : "Destaca en el mercado, pero primero debes ficharlo para poder alinearlo."}</p></div><span>{recommendation.score}<small>ÍNDICE</small></span></div>}{recommendation?.source === "bench" && <button className="primary-button full" onClick={() => onSwap?.(recommendation.player.id)}>Aplicar cambio</button>}{recommendation?.source === "market" && <button className="secondary-button full" onClick={() => notify(`${recommendation.player.name}: abre Mercado para iniciar su fichaje`)}>Ver opción de mercado</button>}</article>}
        <div className="compatible-replacements"><div className="sheet-card-heading"><div><p className="eyebrow">CAMBIO DIRECTO</p><h3>Jugadores {player.position} del banquillo</h3></div><small>{compatibleBench.length} DISPONIBLES</small></div>{compatibleBench.length ? <div className="replacement-list">{compatibleBench.map((candidate) => { const candidateStats = playerDemoStats(candidate.id); return <button key={candidate.id} onClick={() => onSwap?.(candidate.id)}><Avatar label={candidate.initials} /><div><strong>{candidate.name}</strong><small>{candidate.club} · {candidate.value.toFixed(1).replace(".", ",")} M</small></div><span><b>{candidateStats.form}</b><small>FORMA</small></span><em>Cambiar</em></button>; })}</div> : <div className="no-replacements">No tienes otro jugador de esta posición en el banquillo.</div>}</div>
        <p className="player-sheet-disclaimer">La recomendación es orientativa y nunca realiza fichajes ni cambios sin tu confirmación.</p>
      </>}
    </section>
  </div>;
}
function FormationChangeDialog({ currentFormation, targetFormation, targetQuotas, players, starterIds, onClose, onConfirm }: { currentFormation: string; targetFormation: string; targetQuotas: Record<PlayerPosition, number>; players: InitialSquadPlayer[]; starterIds: string[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [workingIds, setWorkingIds] = useState(starterIds);
  const counts = (Object.keys(targetQuotas) as PlayerPosition[]).reduce((result, position) => ({ ...result, [position]: players.filter((player) => workingIds.includes(player.id) && player.position === position).length }), {} as Record<PlayerPosition, number>);
  const excessPositions = (Object.keys(targetQuotas) as PlayerPosition[]).filter((position) => counts[position] > targetQuotas[position]);
  const missingPositions = (Object.keys(targetQuotas) as PlayerPosition[]).filter((position) => counts[position] < targetQuotas[position]);
  const removing = excessPositions.length > 0;
  const candidates = removing
    ? players.filter((player) => workingIds.includes(player.id) && excessPositions.includes(player.position))
    : players.filter((player) => !workingIds.includes(player.id) && missingPositions.includes(player.position));
  const valid = workingIds.length === 11 && excessPositions.length === 0 && missingPositions.length === 0;

  function choose(player: InitialSquadPlayer) {
    if (removing) setWorkingIds((ids) => ids.filter((id) => id !== player.id));
    else setWorkingIds((ids) => counts[player.position] < targetQuotas[player.position] ? [...ids, player.id] : ids);
  }

  return <div className="dialog-backdrop formation-backdrop" role="presentation"><section className="team-dialog formation-dialog" role="dialog" aria-modal="true" aria-labelledby="formation-dialog-title"><div className="dialog-header"><div><p className="eyebrow">CAMBIO DE FORMACIÓN</p><h2 id="formation-dialog-title">{currentFormation} → {targetFormation}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="formation-change-summary">{(["POR", "DEF", "MED", "DEL"] as PlayerPosition[]).map((position) => <div className={counts[position] === targetQuotas[position] ? "ready" : ""} key={position}><small>{position}</small><strong>{counts[position]} → {targetQuotas[position]}</strong></div>)}</div><div className="formation-change-step"><span>{removing ? "1" : "2"}</span><div><p className="eyebrow">{removing ? "PRIMERO, ELIGE QUIÉN SALE" : "AHORA, ELIGE QUIÉN ENTRA"}</p><h3>{removing ? "Retira los jugadores que sobran" : "Completa las nuevas posiciones"}</h3><p>{removing ? "Solo aparecen titulares de las líneas que disminuyen." : "Solo aparecen futbolistas disponibles de tu propio banquillo."}</p></div></div><div className="formation-player-grid">{candidates.map((player) => <button key={player.id} onClick={() => choose(player)}><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><b>{removing ? "Quitar" : "Añadir"}</b></button>)}</div>{valid && <div className="formation-ready"><span>✓</span><div><strong>Once completo</strong><small>Los 11 jugadores pertenecen a tu plantilla y cumplen el {targetFormation}.</small></div></div>}<div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={() => onConfirm(workingIds)}>Aplicar {targetFormation}</button></div></section></div>;
}

function nextMarketRenewal(hours: number) {
  const period = Math.max(1, hours) * 60 * 60 * 1000;
  return (Math.floor(Date.now() / period) + 1) * period;
}

function countdownLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function LeagueMarketView({ league, players, squad, budget, rules, bids, onChangeBids, ownedListings, receivedOffers, onRespondOffer, sentOffers, onChangeSentOffers, onGenerateSystemOffers, notify }: { league: LeagueSummary; players: MarketPlayer[]; squad?: InitialSquad; budget: number; rules: MarketRules; bids: MarketBid[]; onChangeBids: (bids: MarketBid[]) => void; ownedListings: { player: InitialSquadPlayer; contract: PlayerContract }[]; receivedOffers: { player: InitialSquadPlayer; offer: PlayerOffer }[]; onRespondOffer: (player: InitialSquadPlayer, offerId: string, accept: boolean) => void; sentOffers: SentOffer[]; onChangeSentOffers: (offers: SentOffer[]) => void; onGenerateSystemOffers: () => void; notify: (message: string) => void }) {
  const isFantasy = league.mode === "fantasy";
  const visiblePlayers = isFantasy ? players : players.slice(0, 5);
  const [area, setArea] = useState<"market" | "bids" | "offers" | "history">("market");
  const [selectedPlayer, setSelectedPlayer] = useState<MarketPlayer | null>(null);
  const [renewalAt, setRenewalAt] = useState(() => nextMarketRenewal(rules.renewalHours));
  const [remaining, setRemaining] = useState(() => renewalAt - Date.now());
  useEffect(() => { setRenewalAt(nextMarketRenewal(rules.renewalHours)); }, [rules.renewalHours]);
  useEffect(() => { const updateCountdown = () => { const difference = renewalAt - Date.now(); if (difference <= 0) { setRemaining(0); onGenerateSystemOffers(); setRenewalAt(nextMarketRenewal(rules.renewalHours)); } else setRemaining(difference); }; updateCountdown(); const timer = window.setInterval(updateCountdown, 1000); return () => window.clearInterval(timer); }, [renewalAt, rules.renewalHours, onGenerateSystemOffers]);
  const bidCommitment = bids.reduce((total, bid) => total + bid.amount, 0);
  const sentOfferCommitment = sentOffers.filter((offer) => offer.status === "active" && offer.expiresAt > Date.now()).reduce((total, offer) => total + offer.amount, 0);
  const committed = bidCommitment + sentOfferCommitment;
  const debtLimit = budget * rules.maxDebtPercent / 100;
  const spendingLimit = budget + debtLimit;
  const benchCount = Math.max(0, (squad?.players.length ?? 16) - 11);
  const availableBenchSlots = Math.max(0, rules.maxBenchPlayers - benchCount);
  const bidPlayers = bids.map((bid) => ({ bid, player: players.find((player) => player.id === bid.playerId) })).filter((item): item is { bid: MarketBid; player: MarketPlayer } => Boolean(item.player));
  const validReceivedOffers = receivedOffers.filter(({ offer }) => offer.status === "active" && offer.expiresAt > Date.now());
  const marketHistory: MarketHistoryEvent[] = [
    ...bids.map((bid) => { const player = players.find((item) => item.id === bid.playerId); return { id: `bid_${bid.playerId}_${bid.placedAt}`, type: "bid" as const, direction: "made" as const, title: "Puja realizada", detail: "Pendiente de la próxima renovación", playerName: player?.name ?? bid.playerId.replace(/_/g, " "), amount: bid.amount, status: "active" as const, createdAt: bid.placedAt }; }),
    ...sentOffers.map((offer) => ({ id: `sent_${offer.id}`, type: "offer" as const, direction: "made" as const, title: "Oferta enviada", detail: `A ${offer.targetTeamName}`, playerName: offer.targetPlayerName, amount: offer.amount, status: offer.status === "accepted" ? "completed" as const : offer.status === "rejected" ? "rejected" as const : offer.status === "cancelled" ? "cancelled" as const : offer.status === "expired" || offer.expiresAt <= Date.now() ? "expired" as const : "active" as const, createdAt: offer.createdAt })),
    ...receivedOffers.map(({ player, offer }) => ({ id: `received_${offer.id}`, type: "offer" as const, direction: offer.source === "game" ? "system" as const : "received" as const, title: offer.source === "game" ? "Oferta del juego recibida" : "Oferta rival recibida", detail: `De ${offer.bidderName}`, playerName: player.name, amount: offer.amount, status: offer.status === "accepted" ? "completed" as const : offer.status === "rejected" ? "rejected" as const : offer.status === "expired" || offer.expiresAt <= Date.now() ? "expired" as const : "active" as const, createdAt: offer.createdAt })),
    ...ownedListings.map(({ player }) => ({ id: `listing_${player.id}`, type: "listing" as const, direction: "made" as const, title: "Jugador puesto en venta", detail: "Visible para todos los participantes", playerName: player.name, status: "active" as const, createdAt: Date.now() - 4 * 3600000 })),
    { id: "history_transfer_demo", type: "transfer", direction: "made", title: "Puja ganada", detail: "Fichaje confirmado en la renovación", playerName: "Mikel Oyarzabal", amount: 10.8, status: "completed", createdAt: Date.now() - 2 * 86400000 },
    { id: "history_sale_demo", type: "sale", direction: "received", title: "Venta inmediata", detail: "El juego abonó el 50% de su valor", playerName: "Ander Barrenetxea", amount: 3.4, status: "completed", createdAt: Date.now() - 5 * 86400000 },
    { id: "history_clause_demo", type: "clause", direction: "received", title: "Cláusula pagada por un rival", detail: "El jugador cambió de propietario", playerName: "Álex Baena", amount: 15.2, status: "completed", createdAt: Date.now() - 8 * 86400000 },
  ].sort((a, b) => b.createdAt - a.createdAt);

  function saveBid(player: MarketPlayer, amount: number): string | null {
    const existing = bids.find((bid) => bid.playerId === player.id);
    const otherCommitted = committed - (existing?.amount ?? 0);
    if (amount < player.price) return `La puja mínima es ${player.price.toFixed(1).replace(".", ",")} M`;
    if (otherCommitted + amount > spendingLimit) return `Supera tu límite total de ${spendingLimit.toFixed(1).replace(".", ",")} M`;
    if (!existing && bids.length >= availableBenchSlots) return `No puedes superar las ${rules.maxBenchPlayers} plazas de banquillo`;
    const nextBid = { playerId: player.id, amount: Number(amount.toFixed(1)), placedAt: existing?.placedAt ?? Date.now() };
    onChangeBids(existing ? bids.map((bid) => bid.playerId === player.id ? nextBid : bid) : [...bids, nextBid]);
    setSelectedPlayer(null);
    notify(existing ? `Puja por ${player.name} actualizada` : `Puja por ${player.name} registrada`);
    return null;
  }

  function cancelBid(playerId: string) {
    const player = players.find((item) => item.id === playerId);
    onChangeBids(bids.filter((bid) => bid.playerId !== playerId));
    notify(`Puja por ${player?.name ?? "el jugador"} cancelada`);
  }

  function modifySentOffer(offerId: string, amount: number): string | null {
    const offer = sentOffers.find((item) => item.id === offerId);
    if (!offer || offer.status !== "active" || offer.expiresAt <= Date.now()) return "Esta oferta ya no está activa";
    const otherSentCommitment = sentOfferCommitment - offer.amount;
    const maximum = spendingLimit - bidCommitment - otherSentCommitment;
    if (!Number.isFinite(amount) || amount <= 0) return "Introduce un importe válido";
    if (amount > maximum) return `Supera tu límite disponible de ${maximum.toFixed(1).replace(".", ",")} M`;
    const now = Date.now();
    onChangeSentOffers(sentOffers.map((item) => item.id === offerId ? { ...item, amount: Number(amount.toFixed(1)), createdAt: now, expiresAt: now + 24 * 60 * 60 * 1000 } : item));
    notify(`Oferta por ${offer.targetPlayerName} actualizada`);
    return null;
  }

  function cancelSentOffer(offerId: string) {
    const offer = sentOffers.find((item) => item.id === offerId);
    onChangeSentOffers(sentOffers.map((item) => item.id === offerId ? { ...item, status: "cancelled" } : item));
    notify(`Oferta por ${offer?.targetPlayerName ?? "el jugador"} retirada`);
  }

  return <section className="league-tab-view"><div className="league-section-heading"><div><p className="eyebrow">{isFantasy ? "CATÁLOGO COMPLETO · JUGADORES REPETIBLES" : "FICHAJES EXCLUSIVOS"}</p><h2>{isFantasy ? "Todos los jugadores" : area === "bids" ? "Mis pujas" : area === "offers" ? "Centro de ofertas" : area === "history" ? "Historial de mercado" : "Mercado"}</h2><p>{isFantasy ? "El catálogo permanece completo durante toda la temporada y no se renueva por turnos." : area === "bids" ? "Gestiona el dinero comprometido antes de la próxima resolución." : area === "offers" ? "Consulta las recibidas y gestiona las propuestas que has enviado." : area === "history" ? "Consulta todas las operaciones que has realizado o que han afectado a tu plantilla." : "Puja, recibe ofertas y protege a tus jugadores."}</p></div>{isFantasy ? <div className="balance-box"><small>Presupuesto de plantilla</small><strong>{budget.toFixed(1).replace(".", ",")} M</strong></div> : <div className="balance-box market-balance-box"><div><small>SALDO REAL</small><strong>{budget.toFixed(1).replace(".", ",")} M</strong></div><div><small>SALDO RETENIDO</small><strong>{committed.toFixed(1).replace(".", ",")} M</strong></div><span>Incluye pujas y ofertas activas</span></div>}</div>{isFantasy ? <div className="fantasy-market-note"><span>∞</span><div><strong>Mercado permanente</strong><small>Todos los participantes pueden elegir al mismo futbolista. Los precios no dependen de que otro usuario lo tenga.</small></div><b>{players.length} jugadores cargados</b></div> : <><article className="market-renewal-card"><div><p className="eyebrow">PRÓXIMA RENOVACIÓN</p><strong>{countdownLabel(remaining)}</strong><small>{new Date(renewalAt).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · cada {rules.renewalHours} h</small></div><span>La puja más alta gana</span></article><div className="market-shortcuts"><button className={area === "bids" ? "active" : ""} onClick={() => setArea(area === "bids" ? "market" : "bids")}>Pujas <b>{bids.length}</b></button><button className={area === "offers" ? "active" : ""} onClick={() => setArea(area === "offers" ? "market" : "offers")}>Ofertas <b>{validReceivedOffers.length}</b></button><button onClick={() => notify("Blindajes")}>Blindajes <b>3</b></button><button className={area === "history" ? "active" : ""} onClick={() => setArea(area === "history" ? "market" : "history")}>Historial <b>›</b></button></div></>}{!isFantasy && area === "market" && ownedListings.length > 0 && <section className="owned-market-listings"><div><p className="eyebrow">TUS JUGADORES EN VENTA</p><h3>Visibles para toda la liga</h3><small>Los rivales pueden pujar y el juego evaluará ofertas en cada renovación.</small></div>{ownedListings.map(({ player, contract }) => <article key={player.id}><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><span><small>CLÁUSULA</small><b>{contract.clause.toFixed(1).replace(".", ",")} M</b></span><em>TUYO · EN VENTA</em></article>)}</section>}{!isFantasy && area === "history" ? <MarketHistoryView events={marketHistory} /> : !isFantasy && area === "offers" ? <MarketOffersCenter receivedOffers={receivedOffers} sentOffers={sentOffers} onRespondReceived={onRespondOffer} onModifySent={modifySentOffer} onCancelSent={cancelSentOffer} /> : !isFantasy && area === "bids" ? <div className="bids-area"><section className="bid-kpis"><article><small>DINERO COMPROMETIDO</small><strong>{committed.toFixed(1).replace(".", ",")} M</strong><span>de {spendingLimit.toFixed(1).replace(".", ",")} M máximos</span></article><article><small>MARGEN DE DEUDA</small><strong>{debtLimit.toFixed(1).replace(".", ",")} M</strong><span>{rules.maxDebtPercent}% del saldo</span></article><article><small>BANQUILLO</small><strong>{benchCount}/{rules.maxBenchPlayers}</strong><span>{availableBenchSlots} plazas disponibles</span></article></section>{bidPlayers.length ? <div className="active-bids-list"><div className="active-bids-head"><span>Jugador</span><span>Valor</span><span>Tu puja</span><span /></div>{bidPlayers.map(({ bid, player }) => <article key={player.id}><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><span><small>VALOR</small>{player.price.toFixed(1).replace(".", ",")} M</span><b><small>TU PUJA</small>{bid.amount.toFixed(1).replace(".", ",")} M</b><div><button onClick={() => setSelectedPlayer(player)}>Editar</button><button onClick={() => cancelBid(player.id)}>Cancelar</button></div></article>)}</div> : <div className="empty-bids"><span>↗</span><h3>Todavía no has pujado</h3><p>Vuelve al mercado y elige un jugador. Nunca podrás ofrecer menos que su valor.</p><button className="primary-button" onClick={() => setArea("market")}>Explorar jugadores</button></div>}<article className="bid-resolution-note"><span>✓</span><div><strong>Resolución automática y privada</strong><p>En la renovación gana la oferta más alta. El dinero y la plaza solo se descuentan cuando el backend confirma al ganador.</p></div></article></div> : <div className={`market-list ${isFantasy ? "full-fantasy-market" : ""}`}><div className="market-list-head"><span>Jugador</span><span>Puntos</span><span>Valor</span><span /></div>{visiblePlayers.map((player) => { const bid = bids.find((item) => item.playerId === player.id); return <article className="market-player" key={player.id}><Avatar label={player.initials} /><div className="player-identity"><strong>{player.name}</strong><small><b>{player.position}</b> {player.club}</small></div><div className="market-points"><strong>{player.points}</strong><small>puntos</small></div><div className="market-price"><strong>{player.price.toFixed(1).replace(".", ",")} M</strong><small>{bid ? `Tu puja: ${bid.amount.toFixed(1).replace(".", ",")} M` : player.trend}</small></div><button className={`offer-button ${bid ? "has-bid" : ""}`} onClick={() => isFantasy ? notify(`${player.name} añadido al borrador`) : setSelectedPlayer(player)}>{isFantasy ? "Elegir" : bid ? "Modificar" : "Pujar"}</button></article>; })}</div>}{selectedPlayer && <BidDialog player={selectedPlayer} existingBid={bids.find((bid) => bid.playerId === selectedPlayer.id)} committed={committed} budget={budget} spendingLimit={spendingLimit} debtPercent={rules.maxDebtPercent} onClose={() => setSelectedPlayer(null)} onSave={(amount) => saveBid(selectedPlayer, amount)} />}</section>;
}

function MarketHistoryView({ events }: { events: MarketHistoryEvent[] }) {
  const [direction, setDirection] = useState<"all" | MarketHistoryEvent["direction"]>("all");
  const [type, setType] = useState<"all" | MarketHistoryEvent["type"]>("all");
  const [status, setStatus] = useState<"all" | MarketHistoryEvent["status"]>("all");
  const [query, setQuery] = useState("");
  const visible = events.filter((event) => (direction === "all" || event.direction === direction) && (type === "all" || event.type === type) && (status === "all" || event.status === status) && `${event.playerName} ${event.title} ${event.detail}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const completedTotal = visible.filter((event) => event.status === "completed").reduce((total, event) => total + (event.amount ?? 0) * (event.direction === "received" ? 1 : -1), 0);
  return <section className="market-history-view"><div className="market-history-kpis"><article><small>OPERACIONES</small><strong>{events.length}</strong><span>Todo el historial</span></article><article><small>COMPLETADAS</small><strong>{events.filter((item) => item.status === "completed").length}</strong><span>Con cambio confirmado</span></article><article><small>BALANCE VISIBLE</small><strong className={completedTotal >= 0 ? "positive" : "negative"}>{completedTotal >= 0 ? "+" : ""}{completedTotal.toFixed(1).replace(".", ",")} M</strong><span>De los resultados filtrados</span></article></div><div className="market-history-toolbar"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jugador u operación" /></label><select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="all">Todas las direcciones</option><option value="made">Hechas por mí</option><option value="received">Recibidas</option><option value="system">Del juego</option></select><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="all">Todos los tipos</option><option value="bid">Pujas</option><option value="offer">Ofertas</option><option value="transfer">Fichajes</option><option value="listing">En venta</option><option value="clause">Clausulazos</option><option value="sale">Ventas</option></select><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Todos los estados</option><option value="active">Activas</option><option value="completed">Completadas</option><option value="rejected">Rechazadas</option><option value="cancelled">Canceladas</option><option value="expired">Caducadas</option></select></div><div className="market-history-head"><span>Operación</span><span>Jugador</span><span>Origen</span><span>Importe</span><span>Estado</span><span>Fecha</span></div><div className="market-history-list">{visible.map((event) => <article key={event.id}><span className={`history-type ${event.type}`}>{event.type === "bid" ? "↗" : event.type === "offer" ? "◇" : event.type === "clause" ? "⚡" : event.type === "blindage" ? "◆" : event.type === "sale" ? "−" : "↔"}</span><div><strong>{event.title}</strong><small>{event.detail}</small></div><b>{event.playerName}</b><span>{event.direction === "made" ? "Hecha por ti" : event.direction === "received" ? "Recibida" : "Juego"}</span><strong>{event.amount !== undefined ? `${event.amount.toFixed(1).replace(".", ",")} M` : "—"}</strong><em className={event.status}>{event.status === "active" ? "Activa" : event.status === "completed" ? "Completada" : event.status === "rejected" ? "Rechazada" : event.status === "cancelled" ? "Cancelada" : "Caducada"}</em><time>{new Date(event.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" })}</time></article>)}{visible.length === 0 && <div className="empty-bids compact"><span>◷</span><h3>No hay operaciones</h3><p>Cambia los filtros para consultar otro periodo.</p></div>}</div><footer><span>{visible.length} resultados</span><small>Las operaciones confirmadas no pueden borrarse del historial.</small></footer></section>;
}

function MarketOffersCenter({ receivedOffers, sentOffers, onRespondReceived, onModifySent, onCancelSent }: {
  receivedOffers: { player: InitialSquadPlayer; offer: PlayerOffer }[];
  sentOffers: SentOffer[];
  onRespondReceived: (player: InitialSquadPlayer, offerId: string, accept: boolean) => void;
  onModifySent: (offerId: string, amount: number) => string | null;
  onCancelSent: (offerId: string) => void;
}) {
  const [tab, setTab] = useState<"received" | "sent">("received");
  const [now, setNow] = useState(Date.now());
  const [confirmOfferId, setConfirmOfferId] = useState<string | null>(null);
  const [editingOffer, setEditingOffer] = useState<SentOffer | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);

  const activeReceived = receivedOffers.filter(({ offer }) => offer.status === "active" && offer.expiresAt > now);
  const closedReceived = receivedOffers.filter(({ offer }) => offer.status !== "active" || offer.expiresAt <= now);
  const receivedGroups = Array.from(activeReceived.reduce((groups, item) => {
    const current = groups.get(item.player.id);
    if (current) current.offers.push(item.offer);
    else groups.set(item.player.id, { player: item.player, offers: [item.offer] });
    return groups;
  }, new Map<string, { player: InitialSquadPlayer; offers: PlayerOffer[] }>()).values());
  const activeSent = sentOffers.filter((offer) => offer.status === "active" && offer.expiresAt > now);
  const closedSent = sentOffers.filter((offer) => offer.status !== "active" || offer.expiresAt <= now);

  return <section className="market-offers-center">
    <nav className="market-offers-tabs" aria-label="Tipos de ofertas">
      <button className={tab === "received" ? "active" : ""} onClick={() => setTab("received")}>Recibidas <b>{activeReceived.length}</b></button>
      <button className={tab === "sent" ? "active" : ""} onClick={() => setTab("sent")}>Hechas <b>{activeSent.length}</b></button>
    </nav>
    {tab === "received" ? <section className="market-received-offers">
      <div className="market-offers-summary"><div><p className="eyebrow">PROPUESTAS ACTIVAS</p><h3>{activeReceived.length} ofertas sobre {receivedGroups.length} jugadores</h3><p>Cada jugador aparece una vez, con todas sus propuestas agrupadas.</p></div><span>{activeReceived.length}</span></div>
      {receivedGroups.length ? <div className="received-offer-groups">{receivedGroups.map(({ player, offers }) => <article className="received-offer-group" key={player.id}>
        <header><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><span>{offers.length} {offers.length === 1 ? "oferta" : "ofertas"}</span></header>
        <div className="grouped-offer-list">{offers.map((offer) => <div className="grouped-offer-row" key={offer.id}>
          <div className="market-offer-bidder"><span>{offer.bidderInitials}</span><p><strong>{offer.bidderName}</strong><small>{offer.source === "game" ? "Oferta del juego" : "Usuario rival"}</small></p></div>
          <div className="market-offer-amount"><small>IMPORTE</small><strong>{offer.amount.toFixed(1).replace(".", ",")} M</strong></div>
          <div className="market-offer-validity"><small>VALIDEZ</small><strong>{offerValidityLabel(offer.expiresAt, now)}</strong><span>{offer.source === "game" ? "Hasta renovación" : "24 h desde creación"}</span></div>
          <div className="market-offer-actions"><button onClick={() => onRespondReceived(player, offer.id, false)}>Rechazar</button><button onClick={() => setConfirmOfferId(offer.id)}>Aceptar</button></div>
          {confirmOfferId === offer.id && <div className="market-accept-confirm"><p>Se venderá a {offer.bidderName} por {offer.amount.toFixed(1).replace(".", ",")} M y se rechazarán las demás ofertas del jugador.</p><button onClick={() => setConfirmOfferId(null)}>Cancelar</button><button onClick={() => onRespondReceived(player, offer.id, true)}>Confirmar venta</button></div>}
        </div>)}</div>
      </article>)}</div> : <div className="empty-bids compact"><span>◇</span><h3>No hay ofertas vigentes</h3><p>Cuando un rival o el juego haga una propuesta aparecerá aquí y en la ficha del jugador.</p></div>}
      {closedReceived.length > 0 && <details className="closed-offers"><summary>Ver ofertas recibidas finalizadas ({closedReceived.length})</summary>{closedReceived.map(({ player, offer }) => <p key={offer.id}><strong>{player.name}</strong><span>{offer.bidderName}</span><b>{offer.amount.toFixed(1).replace(".", ",")} M</b><em>{offer.status === "active" ? "Caducada" : offer.status === "accepted" ? "Aceptada" : "Rechazada"}</em></p>)}</details>}
    </section> : <section className="market-sent-offers">
      <div className="market-offers-summary sent"><div><p className="eyebrow">OFERTAS HECHAS</p><h3>{activeSent.length} propuestas activas</h3><p>Puedes modificar o retirar una oferta mientras siga vigente.</p></div><span>{activeSent.length}</span></div>
      {activeSent.length ? <div className="sent-offer-list">{activeSent.map((offer) => <article key={offer.id}>
        <div className="sent-offer-avatar">{offer.targetPlayerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
        <div><strong>{offer.targetPlayerName}</strong><small>{offer.targetTeamName} · Oferta privada</small></div>
        <span><small>IMPORTE</small><strong>{offer.amount.toFixed(1).replace(".", ",")} M</strong></span>
        <span><small>CADUCA EN</small><strong>{offerValidityLabel(offer.expiresAt, now)}</strong></span>
        <div><button onClick={() => setEditingOffer(offer)}>Modificar</button><button onClick={() => onCancelSent(offer.id)}>Eliminar</button></div>
      </article>)}</div> : <div className="empty-bids compact"><span>↗</span><h3>No has hecho ofertas</h3><p>Abre la plantilla de un rival desde el ranking y toca cualquiera de sus jugadores.</p></div>}
      {closedSent.length > 0 && <details className="closed-offers"><summary>Ver ofertas hechas finalizadas ({closedSent.length})</summary>{closedSent.map((offer) => <p key={offer.id}><strong>{offer.targetPlayerName}</strong><span>{offer.targetTeamName}</span><b>{offer.amount.toFixed(1).replace(".", ",")} M</b><em>{offer.status === "active" ? "Caducada" : offer.status === "cancelled" ? "Eliminada" : offer.status === "accepted" ? "Aceptada" : "Rechazada"}</em></p>)}</details>}
    </section>}
    <article className="bid-resolution-note"><span>▷</span><div><strong>Gestión protegida por el backend</strong><p>La validez, el saldo y la propiedad se comprueban de nuevo al modificar, cancelar o aceptar una oferta.</p></div></article>
    {editingOffer && <SentOfferEditDialog offer={editingOffer} onClose={() => setEditingOffer(null)} onSave={(amount) => { const error = onModifySent(editingOffer.id, amount); if (!error) setEditingOffer(null); return error; }} />}
  </section>;
}

function SentOfferEditDialog({ offer, onClose, onSave }: { offer: SentOffer; onClose: () => void; onSave: (amount: number) => string | null }) {
  const [amount, setAmount] = useState(offer.amount.toFixed(1));
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) { setError("Introduce una cantidad válida"); return; }
    const result = onSave(parsed);
    if (result) setError(result);
  }
  return <div className="dialog-backdrop bid-dialog-backdrop" role="presentation"><section className="team-dialog bid-dialog" role="dialog" aria-modal="true" aria-labelledby="sent-offer-dialog-title">
    <div className="dialog-header"><div><p className="eyebrow">MODIFICAR OFERTA</p><h2 id="sent-offer-dialog-title">{offer.targetPlayerName}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div>
    <div className="bid-player-summary"><div className="sent-offer-avatar">{offer.targetPlayerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div><div><strong>{offer.targetPlayerName}</strong><small>{offer.targetTeamName}</small></div><span><small>OFERTA ACTUAL</small><b>{offer.amount.toFixed(1).replace(".", ",")} M</b></span></div>
    <form onSubmit={submit}><label className="bid-amount-field"><span>Nuevo importe</span><div><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} autoFocus /><b>M</b></div><small>Al guardar comienza un nuevo plazo de 24 horas.</small></label>
    <p className="bid-privacy-note">La cantidad seguirá siendo privada para el resto de participantes.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button">Guardar cambio</button></div></form>
  </section></div>;
}
function BidDialog({ player, existingBid, committed, budget, spendingLimit, debtPercent, onClose, onSave }: { player: MarketPlayer; existingBid?: MarketBid; committed: number; budget: number; spendingLimit: number; debtPercent: number; onClose: () => void; onSave: (amount: number) => string | null }) {
  const [amount, setAmount] = useState((existingBid?.amount ?? player.price).toFixed(1));
  const [error, setError] = useState("");
  const otherCommitted = committed - (existingBid?.amount ?? 0);
  const maximum = Math.max(0, spendingLimit - otherCommitted);
  function submit(event: FormEvent) { event.preventDefault(); const parsed = Number(amount.replace(",", ".")); if (!Number.isFinite(parsed)) { setError("Introduce una cantidad válida"); return; } const result = onSave(parsed); if (result) setError(result); }
  return <div className="dialog-backdrop bid-dialog-backdrop" role="presentation"><section className="team-dialog bid-dialog" role="dialog" aria-modal="true" aria-labelledby="bid-dialog-title"><div className="dialog-header"><div><p className="eyebrow">{existingBid ? "MODIFICAR PUJA" : "NUEVA PUJA"}</p><h2 id="bid-dialog-title">{player.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="bid-player-summary"><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><span><small>VALOR MÍNIMO</small><b>{player.price.toFixed(1).replace(".", ",")} M</b></span></div><form onSubmit={submit}><label className="bid-amount-field"><span>Tu puja</span><div><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} autoFocus /><b>M</b></div><small>Entre {player.price.toFixed(1).replace(".", ",")} M y {maximum.toFixed(1).replace(".", ",")} M</small></label><div className="bid-budget-breakdown"><p><span>Saldo actual</span><strong>{budget.toFixed(1).replace(".", ",")} M</strong></p><p><span>Deuda permitida</span><strong>+{debtPercent}%</strong></p><p><span>Otras pujas</span><strong>-{otherCommitted.toFixed(1).replace(".", ",")} M</strong></p></div><p className="bid-privacy-note">Tu cantidad es privada. Los demás participantes no podrán verla antes de la resolución.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button">{existingBid ? "Guardar cambio" : "Confirmar puja"}</button></div></form></section></div>;
}

function LeagueMatchdayView({ squad, competition, scoringRules, settlementRules, onPrepareTeam, notify }: { squad?: InitialSquad; competition: CompetitionName; scoringRules: ScoringRule[]; settlementRules: MatchdaySettlementRules; onPrepareTeam: () => void; notify: (message: string) => void }) {
  const matchdays = [
    { number: 1, status: "Finalizada", date: "16 ago", rank: 9, previousRank: 12, leagueAverage: 47, bestScore: 79, formation: "4-4-2" },
    { number: 2, status: "Finalizada", date: "23 ago", rank: 6, previousRank: 9, leagueAverage: 52, bestScore: 84, formation: "4-3-3" },
    { number: 3, status: "Recalculada", date: "30 ago", rank: 4, previousRank: 6, leagueAverage: 49, bestScore: 81, formation: "4-4-2" },
    { number: 4, status: "Finalizada", date: "6 sep", rank: 3, previousRank: 4, leagueAverage: 51, bestScore: 86, formation: "3-4-3" },
    { number: 5, status: "Programada", date: "13 sep", rank: 4, previousRank: 4, leagueAverage: 0, bestScore: 0, formation: "4-4-2" },
  ];
  const [selectedMatchday, setSelectedMatchday] = useState(4);
  const [view, setView] = useState<"points" | "calendar">("points");
  const [selectedPlayer, setSelectedPlayer] = useState<InitialSquadPlayer | null>(null);
  const [expandedFixture, setExpandedFixture] = useState<string | null>(null);
  const selected = matchdays.find((item) => item.number === selectedMatchday) ?? matchdays[0];
  const finalized = selected.status === "Finalizada" || selected.status === "Recalculada";
  const starters = (squad?.players ?? []).filter((player) => squad?.startingPlayerIds.includes(player.id));
  const bench = (squad?.players ?? []).filter((player) => !squad?.startingPlayerIds.includes(player.id));
  const captain = starters.find((player) => player.position === "DEL") ?? starters[0];

  function pointsFor(player: InitialSquadPlayer, matchday: number) { return calculatePlayerPoints(demoPlayerMatchStats(`${player.id}_j${matchday}`, player.position), player.position, scoringRules).total; }
  function totalFor(matchday: number) { return starters.reduce((total, player) => total + pointsFor(player, matchday), 0); }

  const scoredPlayers = starters.map((player) => ({ player, score: finalized ? pointsFor(player, selected.number) : 0 })).sort((a, b) => b.score - a.score);
  const scoredBench = bench.map((player) => ({ player, score: finalized ? pointsFor(player, selected.number) : 0 })).sort((a, b) => b.score - a.score);
  const teamTotal = finalized ? totalFor(selected.number) : 0;
  const payout = Math.min(settlementRules.maximumPayout, Math.max(settlementRules.minimumPayout, Math.max(0, teamTotal) * settlementRules.moneyPerPoint));
  const positionChange = selected.previousRank - selected.rank;
  const clubs = Array.from(new Set(competitionPlayers[competition].map((player) => player.club)));
  const fixtures = Array.from({ length: Math.min(5, Math.max(1, clubs.length)) }, (_, index) => {
    const home = clubs[(index * 2 + selected.number) % clubs.length];
    const away = clubs[(index * 2 + selected.number + 1) % clubs.length];
    const id = `j${selected.number}_${index}`;
    const myPlayers = (squad?.players ?? []).filter((player) => player.club === home || player.club === away);
    return { id, home, away, time: ["Vie · 21:00", "Sáb · 16:15", "Sáb · 18:30", "Dom · 16:15", "Dom · 21:00"][index], homeGoals: (selected.number + index) % 4, awayGoals: (selected.number * 2 + index) % 3, myPlayers };
  });

  return <section className="league-tab-view matchday-history-view">
    <div className="league-section-heading"><div><p className="eyebrow">{competition.toUpperCase()} · HISTORIAL</p><h2>Jornada {selected.number}</h2><p>Consulta tu puntuación o el calendario completo de partidos.</p></div><span className={`matchday-status ${selected.status.toLowerCase()}`}>{selected.status === "Recalculada" ? "↻ " : ""}{selected.status.toUpperCase()}</span></div>
    <section className="overlapping-matchdays"><div className="overlap-heading"><p className="eyebrow">DOS JORNADAS ACTIVAS · CAMBIO DE CALENDARIO</p><h3>Consulta una mientras preparas la siguiente</h3></div><article className="current"><span>J4</span><div><small>CIERRE PROVISIONAL</small><strong>Un partido aplazado sigue pendiente</strong><p>El once está bloqueado y los puntos confirmados ya pueden consultarse.</p></div><button onClick={() => { setSelectedMatchday(4); setView("points"); }}>Ver puntos</button></article><i>+</i><article className="urgent"><span>J5</span><div><small>PARTIDO ADELANTADO · CIERRA HOY 18:30</small><strong>Prepara un once completo para la J5</strong><p>Se bloqueará al comenzar su primer encuentro, aunque la J4 siga abierta.</p></div><button onClick={onPrepareTeam}>Preparar equipo →</button></article><footer><span>⚡ Aviso urgente enviado</span><p>Si no guardas cambios, se aplicará el equipo de respaldo correspondiente a la modalidad.</p></footer></section>
    <nav className="matchday-selector" aria-label="Seleccionar jornada">{matchdays.map((matchday) => { const closed = matchday.status === "Finalizada" || matchday.status === "Recalculada"; const points = closed ? totalFor(matchday.number) : null; return <button className={selected.number === matchday.number ? "active" : ""} key={matchday.number} onClick={() => { setSelectedMatchday(matchday.number); setSelectedPlayer(null); setExpandedFixture(null); }}><small>J{matchday.number}</small><strong>{points === null ? "—" : points}</strong><span>{matchday.date}</span><i>{matchday.status}</i></button>; })}</nav>
    <nav className="matchday-view-tabs" aria-label="Vista de jornada"><button className={view === "points" ? "active" : ""} onClick={() => setView("points")}><span>◎</span><div><strong>Mi puntuación</strong><small>Once, puntos y clasificación</small></div></button><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}><span>▦</span><div><strong>Calendario</strong><small>Todos los partidos de la jornada</small></div></button></nav>

    {view === "calendar" ? <section className="matchday-calendar"><header><div><p className="eyebrow">CALENDARIO COMPLETO · JORNADA {selected.number}</p><h3>{fixtures.length} partidos</h3><p>Los jugadores de tu plantilla aparecen identificados en cada encuentro.</p></div><span>{finalized ? "Resultados definitivos" : selected.status === "Pendiente" ? "Partidos en curso" : "Horarios programados"}</span></header>{selected.number === 4 && <article className="schedule-exception-notice postponed"><span>↻</span><div><strong>Partido aplazado de esta jornada</strong><p>Sigue vinculado a la J4. Su resultado se incorporará aquí aunque se dispute durante otra jornada.</p></div><b>POLÍTICA: {settlementRules.postponedPolicy === "provisional" ? "CIERRE PROVISIONAL" : "ESPERAR"}</b></article>}{selected.number === 5 && <article className="schedule-exception-notice advanced"><span>⚡</span><div><strong>Un partido fue adelantado</strong><p>La J5 se bloquea con su propio once al comenzar su primer partido, aunque coincida con encuentros pendientes de la J4.</p></div><b>AVISO · {settlementRules.advanceNoticeHours} H</b></article>}<div className="fixture-calendar-list">{fixtures.map((fixture) => { const expanded = expandedFixture === fixture.id; const startersInMatch = fixture.myPlayers.filter((player) => squad?.startingPlayerIds.includes(player.id)); const benchInMatch = fixture.myPlayers.filter((player) => !squad?.startingPlayerIds.includes(player.id)); return <article className={fixture.myPlayers.length ? "has-my-players" : ""} key={fixture.id}><button onClick={() => setExpandedFixture(expanded ? null : fixture.id)}><time>{fixture.time}</time><div className="calendar-team"><span>{fixture.home.slice(0,2).toUpperCase()}</span><strong>{fixture.home}</strong></div><div className="calendar-score">{finalized ? <><b>{fixture.homeGoals}</b><em>FINAL</em><b>{fixture.awayGoals}</b></> : <><b>—</b><em>{selected.status === "Pendiente" ? "EN JUEGO" : "PRÓXIMO"}</em><b>—</b></>}</div><div className="calendar-team away"><strong>{fixture.away}</strong><span>{fixture.away.slice(0,2).toUpperCase()}</span></div><div className="calendar-my-players"><strong>{fixture.myPlayers.length}</strong><span>{fixture.myPlayers.length === 1 ? "jugador tuyo" : "jugadores tuyos"}</span></div><i>{expanded ? "⌃" : "⌄"}</i></button>{expanded && <div className="fixture-squad-detail"><div><p className="eyebrow">TUS JUGADORES EN ESTE PARTIDO</p><strong>{startersInMatch.length} titulares · {benchInMatch.length} suplentes</strong></div>{fixture.myPlayers.length ? <section>{fixture.myPlayers.map((player) => { const isStarter = squad?.startingPlayerIds.includes(player.id); const points = finalized ? pointsFor(player, selected.number) : null; return <button key={player.id} onClick={() => setSelectedPlayer(player)}><Avatar label={player.initials} /><span><strong>{player.name}</strong><small>{isStarter ? "TITULAR · SUMA" : "BANQUILLO · NO SUMA"}</small></span><em>{player.club === fixture.home ? "Local" : "Visitante"}</em><b>{points === null ? "Pendiente" : `${points > 0 ? "+" : ""}${points} pts`}</b></button>; })}</section> : <p className="calendar-no-players">No tienes jugadores de estos equipos.</p>}</div>}</article>; })}</div><article className="calendar-data-note"><span>API</span><div><strong>Calendario sincronizado</strong><p>Fechas, horarios, estados y resultados procederán del proveedor oficial. Cada partido conserva su jornada original aunque cambie de fecha.</p></div></article></section> : finalized ? <>
      <section className="matchday-result-hero"><div className="matchday-total-score"><small>PUNTOS JORNADA {selected.number}</small><strong>{teamTotal}</strong><span>{teamTotal >= selected.leagueAverage ? `+${teamTotal - selected.leagueAverage} sobre la media` : `${teamTotal - selected.leagueAverage} bajo la media`}</span></div><div className="matchday-result-kpis"><article><small>POSICIÓN JORNADA</small><strong>{selected.rank}.º</strong><span className={positionChange >= 0 ? "positive" : "negative"}>{positionChange > 0 ? `↑ ${positionChange} puestos` : positionChange < 0 ? `↓ ${Math.abs(positionChange)} puestos` : "Sin cambios"}</span></article><article><small>MEDIA DE LA LIGA</small><strong>{selected.leagueAverage}</strong><span>{teamTotal >= selected.leagueAverage ? "Por encima" : "Por debajo"}</span></article><article><small>MEJOR PUNTUACIÓN</small><strong>{selected.bestScore}</strong><span>{selected.bestScore - teamTotal} puntos de diferencia</span></article></div><div className="matchday-evolution"><p className="eyebrow">EVOLUCIÓN</p><div>{matchdays.filter((item) => item.number <= 4).map((item) => <span key={item.number}><i style={{ height: `${Math.max(18, totalFor(item.number))}%` }} /><b>{totalFor(item.number)}</b><small>J{item.number}</small></span>)}</div></div></section>
      <article className="matchday-settlement-receipt"><span>€</span><div><p className="eyebrow">LIQUIDACIÓN ECONÓMICA · JORNADA {selected.number}</p><h3>{teamTotal} puntos × {settlementRules.moneyPerPoint.toFixed(2).replace(".", ",")} M</h3><p>El importe se añade al saldo de esta liga, nunca al monedero general de monedas.</p></div><strong>+{payout.toFixed(1).replace(".", ",")} M<small>ABONADOS</small></strong><footer><b>✓ Pago único registrado</b><span>Máximo por jornada: {settlementRules.maximumPayout.toFixed(1).replace(".", ",")} M</span></footer></article>
      <article className="closed-lineup-banner"><span>✓</span><div><strong>Once confirmado · {selected.formation}</strong><p>Esta es la copia inmutable utilizada para calcular la jornada. Capitán: {captain?.name}.</p></div><em>VERSIÓN DE REGLAS #{selected.number}</em></article>
      <section className="matchday-roster-grid"><article className="matchday-starters-card"><div className="section-title compact"><div><p className="eyebrow">TITULARES · SUMAN</p><h2>Once de la jornada</h2></div><strong>{teamTotal} pts</strong></div><div className="matchday-player-points historical"><div className="matchday-points-head"><span>Jugador</span><span>Posición</span><span>Puntos</span><span /></div>{scoredPlayers.map(({ player, score }) => <button key={player.id} onClick={() => setSelectedPlayer(player)}><Avatar label={player.initials} /><span><strong>{player.name}{captain?.id === player.id && <em>C</em>}</strong><small>{player.club}</small></span><em>{player.position}</em><b className={score >= 0 ? "positive" : "negative"}>{score > 0 ? "+" : ""}{score} pts</b><i>Ver ficha ›</i></button>)}</div></article><aside className="matchday-bench-card"><div><p className="eyebrow">BANQUILLO · NO SUMA</p><h3>Puntos informativos</h3></div>{scoredBench.map(({ player, score }) => <button key={player.id} onClick={() => setSelectedPlayer(player)}><Avatar label={player.initials} /><span><strong>{player.name}</strong><small>{player.position} · {player.club}</small></span><b className={score >= 0 ? "positive" : "negative"}>{score > 0 ? "+" : ""}{score}</b></button>)}<footer>Los suplentes conservan sus puntos individuales, pero no se añaden al total del equipo.</footer></aside></section>
      {selected.status === "Recalculada" && <article className="matchday-recalculated-note"><span>↻</span><div><strong>Jornada recalculada</strong><p>La API corrigió una estadística. Se aplicó de nuevo la misma versión de reglas y se actualizó el resultado.</p></div></article>}
    </> : <section className="matchday-pending-state"><span>◷</span><h3>{selected.status === "Pendiente" ? "Jornada todavía en juego" : "Jornada aún no iniciada"}</h3><p>{selected.status === "Pendiente" ? "Los puntos permanecerán pendientes hasta que la API confirme todos los partidos como finalizados." : "El once confirmado y sus puntos aparecerán cuando llegue esta jornada."}</p><div><strong>{selected.formation}</strong><span>Formación preparada</span></div></section>}

    {selectedPlayer && <PlayerDetailSheet player={selectedPlayer} competition={competition} captain={captain?.id === selectedPlayer.id} matchday={selected.number} scoringRules={scoringRules} readOnly onClose={() => setSelectedPlayer(null)} notify={notify} />}
  </section>;
}
type RivalTeam = { id: string; initials: string; name: string; manager: string; matchdayPoints: number; totalPoints: number; value: number; position: number; previousPosition: number; form: number[]; rosterOffset: number };

const demoRivals: RivalTeam[] = [
  { id: "rival_cierzo", initials: "AC", name: "Atlético Cierzo", manager: "Marcos L.", matchdayPoints: 86, totalPoints: 86, value: 91.8, position: 1, previousPosition: 3, form: [48, 62, 57, 74, 86], rosterOffset: 0 },
  { id: "rival_blanco", initials: "RB", name: "Rayo Blanco", manager: "Lucía R.", matchdayPoints: 74, totalPoints: 74, value: 88.6, position: 2, previousPosition: 1, form: [67, 59, 71, 69, 74], rosterOffset: 2 },
  { id: "rival_violeta", initials: "UV", name: "Unión Violeta", manager: "Álex P.", matchdayPoints: 0, totalPoints: 0, value: 86.9, position: 4, previousPosition: 4, form: [44, 51, 68, 61, 0], rosterOffset: 4 },
  { id: "rival_dorada", initials: "CD", name: "Costa Dorada", manager: "Sara M.", matchdayPoints: 0, totalPoints: 0, value: 89.3, position: 5, previousPosition: 6, form: [55, 64, 70, 58, 0], rosterOffset: 1 },
];

function rivalRoster(competition: CompetitionName, offset: number) {
  const quotas: Record<PlayerPosition, number> = { POR: 2, DEF: 5, MED: 5, DEL: 4 };
  return (Object.keys(quotas) as PlayerPosition[]).flatMap((position) => {
    const candidates = competitionPlayers[competition].filter((player) => player.position === position);
    return Array.from({ length: quotas[position] }, (_, index) => candidates[(index + offset) % candidates.length]);
  });
}

function LeagueRankingView({ team, competition, budget, rules, bidCommitment, sentOffers, onChangeSentOffers, clausePurchases, matchdayStartAt, onClausePurchase, isPrivateLeague, currentUserIsAdmin, privateAdmin, onReport }: { team: FantasyTeamSummary; competition: CompetitionName; budget: number; rules: MarketRules; bidCommitment: number; sentOffers: SentOffer[]; onChangeSentOffers: (offers: SentOffer[]) => void; clausePurchases: ClausePurchase[]; matchdayStartAt: number; onClausePurchase: (rivalTeamId: string, player: InitialSquadPlayer, clause: number, blind: boolean) => string | null; isPrivateLeague: boolean; currentUserIsAdmin: boolean; privateAdmin?: PrivateLeagueParticipant; onReport: (rival: RivalTeam, category: ReportCategory, details: string) => string | null }) {
  const [selectedRival, setSelectedRival] = useState<RivalTeam | null>(null);
  const privateAdminRival = isPrivateLeague && !currentUserIsAdmin ? { ...demoRivals[0], name: privateAdmin?.teamName ?? demoRivals[0].name, manager: privateAdmin?.userName ?? demoRivals[0].manager } : demoRivals[0];
  const ranking = [privateAdminRival, demoRivals[1], { id: "my_team", initials: team.shortName, name: team.name, manager: "Tú", matchdayPoints: 0, totalPoints: 0, value: 0, position: 3, previousPosition: 3, form: [], rosterOffset: 0 }, demoRivals[2], demoRivals[3]];
  function saveOffer(rival: RivalTeam, player: InitialSquadPlayer, amount: number): string | null {
    const now = Date.now();
    const existing = sentOffers.find((offer) => offer.targetTeamId === rival.id && offer.targetPlayerId === player.id && offer.status === "active" && offer.expiresAt > now);
    const otherCommitment = sentOffers.filter((offer) => offer.status === "active" && offer.expiresAt > now && offer.id !== existing?.id).reduce((total, offer) => total + offer.amount, 0);
    const limit = budget * (1 + rules.maxDebtPercent / 100) - bidCommitment - otherCommitment;
    if (amount <= 0) return "La oferta debe ser superior a 0 M";
    if (amount > limit) return `Solo puedes comprometer ${Math.max(0, limit).toFixed(1).replace(".", ",")} M más`;
    const next: SentOffer = { id: existing?.id ?? `sent_${crypto.randomUUID()}`, targetPlayerId: player.id, targetPlayerName: player.name, targetTeamId: rival.id, targetTeamName: rival.name, amount: Number(amount.toFixed(1)), createdAt: now, expiresAt: now + 24 * 60 * 60 * 1000, status: "active" };
    onChangeSentOffers(existing ? sentOffers.map((offer) => offer.id === existing.id ? next : offer) : [...sentOffers, next]);
    return null;
  }
  return <section className="league-tab-view"><div className="league-section-heading"><div><p className="eyebrow">CLASIFICACIÓN GENERAL</p><h2>Ranking</h2><p>Toca un rival para hacer ofertas o pagar la cláusula de sus jugadores.</p></div><span className="ranking-round">Jornada 1</span></div><div className="ranking-table"><div className="ranking-head"><span>#</span><span>Equipo</span><span>Jornada</span><span>Total</span></div>{ranking.map((item) => { const mine = item.id === "my_team"; const isAdmin = isPrivateLeague && (currentUserIsAdmin ? mine : item.id === privateAdminRival.id); return <button className={`ranking-row ${mine ? "my-ranking" : ""}`} key={item.id} onClick={() => !mine && setSelectedRival(item)} disabled={mine}><strong>{item.position}</strong><span className="ranking-avatar">{item.initials}</span><p><strong>{item.name}{isAdmin && <span className="ranking-admin-badge">ADMIN</span>}</strong><small>{mine ? "Tu equipo" : `${item.manager} · Ver plantilla`}</small></p><span>{item.matchdayPoints}</span><b>{item.totalPoints} pts {mine ? "" : "›"}</b></button>; })}</div>{selectedRival && <RivalTeamSheet rival={selectedRival} competition={competition} budget={budget} sentOffers={sentOffers} clausePurchases={clausePurchases} matchdayStartAt={matchdayStartAt} onClausePurchase={(player, clause, blind) => onClausePurchase(selectedRival.id, player, clause, blind)} onSaveOffer={(player, amount) => saveOffer(selectedRival, player, amount)} onReport={isPrivateLeague ? (category, details) => onReport(selectedRival, category, details) : undefined} onClose={() => setSelectedRival(null)} />}</section>;
}

function RivalTeamSheet({ rival, competition, budget, sentOffers, clausePurchases, matchdayStartAt, onSaveOffer, onClausePurchase, onReport, onClose }: { rival: RivalTeam; competition: CompetitionName; budget: number; sentOffers: SentOffer[]; clausePurchases: ClausePurchase[]; matchdayStartAt: number; onSaveOffer: (player: InitialSquadPlayer, amount: number) => string | null; onClausePurchase: (player: InitialSquadPlayer, clause: number, blind: boolean) => string | null; onReport?: (category: ReportCategory, details: string) => string | null; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"plantilla" | "trayectoria">("plantilla");
  const [offerPlayer, setOfferPlayer] = useState<InitialSquadPlayer | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const roster = rivalRoster(competition, rival.rosterOffset).filter((player) => !clausePurchases.some((purchase) => purchase.playerId === player.id));
  const startingQuotas: Record<PlayerPosition, number> = { POR: 1, DEF: 4, MED: 4, DEL: 2 };
  const starters = (Object.keys(startingQuotas) as PlayerPosition[]).flatMap((position) => roster.filter((player) => player.position === position).slice(0, startingQuotas[position]));
  const bench = roster.filter((player) => !starters.some((starter) => starter.id === player.id));
  const captain = starters.find((player) => player.position === "DEL") ?? starters[0];

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="rival-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`rival-team-sheet ${expanded ? "expanded" : "summary"}`} role="dialog" aria-modal="true" aria-labelledby="rival-team-title"><div className="sheet-handle" /><header className="rival-sheet-header"><button className="rival-sheet-back" onClick={() => expanded ? setExpanded(false) : onClose()} aria-label={expanded ? "Volver al resumen" : "Cerrar"}>{expanded ? "‹" : "×"}</button><span className="rival-crest">{rival.initials}</span><div><p className="eyebrow">{competition} · RIVAL</p><h2 id="rival-team-title">{rival.name}</h2><small>{rival.manager}</small></div>{onReport && <button className="rival-report-button" onClick={() => setReportOpen(true)}>⚑ Denunciar</button>}<strong>{rival.position}.º</strong>{reportOpen && onReport && <ReportUserDialog rival={rival} onClose={() => setReportOpen(false)} onSubmit={(category, details) => { const error = onReport(category, details); if (!error) setReportOpen(false); return error; }} />}</header>

    {!expanded ? <><div className="rival-summary-kpis"><div><small>PUNTOS</small><strong>{rival.totalPoints}</strong></div><div><small>ÚLTIMA JORNADA</small><strong>{rival.matchdayPoints}</strong></div><div><small>VALOR</small><strong>{rival.value.toFixed(1).replace(".", ",")} M</strong></div></div><article className="rival-lineup-locked"><span>◷</span><div><strong>Próximo once protegido</strong><p>Hasta el cierre se muestra su última alineación ya confirmada, nunca el borrador de la siguiente jornada.</p></div></article><div className="rival-preview-row"><div><p className="eyebrow">ÚLTIMA FORMACIÓN</p><strong>4-4-2</strong><small>{captain?.name} · capitán</small></div><div className="rival-preview-avatars">{starters.slice(0, 5).map((player) => <Avatar key={player.id} label={player.initials} />)}<span>+6</span></div></div><button className="primary-button full rival-open-team" onClick={() => setExpanded(true)}>Ver plantilla completa <span>→</span></button></> : <><nav className="rival-tabs" aria-label="Detalle del rival"><button className={tab === "plantilla" ? "active" : ""} onClick={() => setTab("plantilla")}>Plantilla</button><button className={tab === "trayectoria" ? "active" : ""} onClick={() => setTab("trayectoria")}>Trayectoria</button></nav>{tab === "plantilla" ? <div className="rival-roster-layout"><article className="rival-pitch-card"><div className="rival-pitch-heading"><div><p className="eyebrow">ÚLTIMO ONCE CONFIRMADO</p><h3>4-4-2</h3></div><span>Jornada cerrada</span></div><div className="football-pitch rival-pitch"><div className="field-line center-line" /><div className="field-line center-circle" />{(["DEL", "MED", "DEF", "POR"] as PlayerPosition[]).map((position) => <div className="player-row" key={position}>{starters.filter((player) => player.position === position).map((player) => { const sent = sentOffers.find((offer) => offer.targetTeamId === rival.id && offer.targetPlayerId === player.id && offer.status === "active" && offer.expiresAt > Date.now()); return <button type="button" className="rival-pitch-player" key={player.id} onClick={() => setOfferPlayer(player)}><span>{player.initials}{captain?.id === player.id && <b>C</b>}</span><strong>{player.name}</strong><small>{sent ? "OFERTA HECHA" : "HACER OFERTA"}</small></button>; })}</div>)}</div></article><aside className="rival-bench"><div><p className="eyebrow">BANQUILLO</p><h3>5 jugadores</h3></div>{bench.map((player) => { const sent = sentOffers.find((offer) => offer.targetTeamId === rival.id && offer.targetPlayerId === player.id && offer.status === "active" && offer.expiresAt > Date.now()); return <button type="button" className="rival-bench-player" key={player.id} onClick={() => setOfferPlayer(player)}><Avatar label={player.initials} /><span><strong>{player.name}</strong><small>{player.position} · {player.club}</small></span><b>{sent ? "Modificar oferta" : `${player.value.toFixed(1).replace(".", ",")} M · Ofertar`}</b></button>; })}</aside></div> : <div className="rival-trajectory"><section className="rival-form-chart"><div><p className="eyebrow">PUNTOS POR JORNADA</p><h3>Evolución reciente</h3></div><div className="rival-bars">{rival.form.map((points, index) => <div key={index}><i style={{ height: `${Math.max(6, points)}%` }} /><strong>{points}</strong><small>J{index + 1}</small></div>)}</div></section><section className="rival-history-kpis"><article><small>POSICIÓN ACTUAL</small><strong>{rival.position}.º</strong><span className={rival.position < rival.previousPosition ? "positive" : rival.position > rival.previousPosition ? "negative" : ""}>{rival.position === rival.previousPosition ? "Sin cambios" : `${Math.abs(rival.position - rival.previousPosition)} puestos`}</span></article><article><small>MEDIA</small><strong>{(rival.form.reduce((sum, value) => sum + value, 0) / rival.form.length).toFixed(1)}</strong><span>puntos/jornada</span></article></section><section className="rival-movements"><div><p className="eyebrow">MOVIMIENTOS PÚBLICOS</p><h3>Actividad reciente</h3></div><p><span>↗</span><strong>Fichó a {roster[8]?.name}</strong><small>Hace 2 días</small></p><p><span>↔</span><strong>Vendió un jugador en el mercado</strong><small>Hace 4 días</small></p><p><span>◆</span><strong>Su plantilla subió 0,6 M</strong><small>Esta semana</small></p></section></div>}</>}{offerPlayer && <RivalOfferDialog player={offerPlayer} rival={rival} budget={budget} matchdayStartAt={matchdayStartAt} onClausePurchase={(clause, blind) => onClausePurchase(offerPlayer, clause, blind)} existingOffer={sentOffers.find((offer) => offer.targetTeamId === rival.id && offer.targetPlayerId === offerPlayer.id && offer.status === "active" && offer.expiresAt > Date.now())} onClose={() => setOfferPlayer(null)} onSave={(amount) => { const error = onSaveOffer(offerPlayer, amount); if (!error) setOfferPlayer(null); return error; }} />}</section></div>;
}

const reportCategoryLabels: Record<ReportCategory, string> = { cheating: "Posibles trampas", unsporting: "Conducta poco deportiva", harassment: "Acoso o mensajes ofensivos", other: "Otro motivo" };

function ReportUserDialog({ rival, onClose, onSubmit }: { rival: RivalTeam; onClose: () => void; onSubmit: (category: ReportCategory, details: string) => string | null }) {
  const [category, setCategory] = useState<ReportCategory>("cheating");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (details.trim().length < 10) { setError("Explica lo ocurrido con al menos 10 caracteres."); return; }
    const result = onSubmit(category, details);
    if (result) setError(result);
  }
  return <div className="dialog-backdrop report-dialog-backdrop" role="presentation"><section className="team-dialog report-user-dialog" role="dialog" aria-modal="true" aria-labelledby="report-user-title"><div className="dialog-header"><div><p className="eyebrow">DENUNCIA PRIVADA</p><h2 id="report-user-title">Denunciar a {rival.manager}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><p className="report-intro">El administrador de la liga revisará la denuncia y decidirá la resolución. El usuario denunciado no verá quién la ha enviado.</p><form onSubmit={submit}><label className="private-field"><span>Motivo</span><select value={category} onChange={(event) => setCategory(event.target.value as ReportCategory)}>{(Object.keys(reportCategoryLabels) as ReportCategory[]).map((value) => <option value={value} key={value}>{reportCategoryLabels[value]}</option>)}</select></label><label className="private-field"><span>Describe lo ocurrido</span><textarea value={details} maxLength={500} rows={5} placeholder="Incluye fechas, operaciones o comportamientos que ayuden a revisarlo…" onChange={(event) => { setDetails(event.target.value); setError(""); }} /><small>{details.length}/500</small></label><article className="report-privacy-note"><span>✓</span><div><strong>Revisión confidencial</strong><small>La denuncia no sanciona automáticamente. Queda registrada para que el administrador pueda advertir, archivar o expulsar.</small></div></article>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button">Enviar denuncia</button></div></form></section></div>;
}

function LeagueOptionsDialog({ league, isPrivateLeague, isAdmin, participants, reports, onResolveReport, onLeave, onClose }: { league: LeagueSummary; isPrivateLeague: boolean; isAdmin: boolean; participants: PrivateLeagueParticipant[]; reports: LeagueReport[]; onResolveReport: (reportId: string, resolution: ReportResolution) => void; onLeave: (successorId?: string) => Promise<string | null>; onClose: () => void }) {
  const successors = participants.filter((participant) => participant.role !== "admin");
  const [successorId, setSuccessorId] = useState(successors[0]?.id ?? "");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState("");
  const pendingReports = reports.filter((report) => report.status === "pending");
  async function leave() {
    const result = await onLeave(isPrivateLeague && isAdmin && successors.length ? successorId : undefined);
    if (result) { setError(result); return; }
    onClose();
  }
  return <div className="dialog-backdrop"><section className="team-dialog league-options-dialog" role="dialog" aria-modal="true" aria-labelledby="league-options-title"><div className="dialog-header"><div><p className="eyebrow">OPCIONES DE LA LIGA</p><h2 id="league-options-title">{league.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div>{isPrivateLeague && isAdmin && <section className="admin-report-inbox"><div className="options-section-title"><div><p className="eyebrow">MODERACIÓN</p><h3>Denuncias pendientes</h3></div><b>{pendingReports.length}</b></div>{pendingReports.length ? pendingReports.map((report) => <article key={report.id}><div><strong>{report.reportedTeamName}</strong><small>{report.reportedUserName} · {reportCategoryLabels[report.category]}</small><p>{report.details}</p><time>{new Date(report.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div><footer><button onClick={() => onResolveReport(report.id, "dismissed")}>Archivar</button><button onClick={() => onResolveReport(report.id, "warning")}>Advertir</button><button className="danger" onClick={() => onResolveReport(report.id, "expelled")}>Expulsar</button></footer></article>) : <div className="reports-empty"><span>✓</span><p><strong>Sin denuncias pendientes</strong><small>Las nuevas denuncias privadas aparecerán aquí.</small></p></div>}</section>}<section className="leave-league-zone"><p className="eyebrow">ABANDONAR COMPETICIÓN</p><h3>{isPrivateLeague && isAdmin && !successors.length ? "Cerrar y abandonar la liga" : "Abandonar la liga"}</h3><p>{league.mode === "fantasy" ? "Tu borrador dejará de estar activo y no participarás en próximas jornadas." : "Se cancelarán tus pujas y ofertas pendientes, y tus jugadores exclusivos volverán a quedar disponibles."}</p>{isPrivateLeague && isAdmin && successors.length > 0 && <label className="private-field"><span>Nuevo administrador</span><select value={successorId} onChange={(event) => setSuccessorId(event.target.value)}>{successors.map((participant) => <option value={participant.id} key={participant.id}>{participant.userName} · {participant.teamName}</option>)}</select><small>La transferencia y tu salida se confirmarán en una única operación.</small></label>}{isPrivateLeague && isAdmin && !successors.length && <p className="close-private-warning">Eres el único participante. Al salir se cerrará la liga y el código dejará de funcionar.</p>}{!confirmLeave ? <button className="leave-league-button" onClick={() => setConfirmLeave(true)}>Abandonar liga</button> : <div className="leave-confirm"><p><strong>¿Confirmas el abandono?</strong><small>Las jornadas ya cerradas se conservarán en el historial, pero no podrás deshacer esta operación.</small></p><div><button onClick={() => setConfirmLeave(false)}>Cancelar</button><button className="danger" onClick={leave}>Sí, abandonar</button></div></div>}{error && <p className="form-error" role="alert">{error}</p>}</section></section></div>;
}

function rivalClauseDetails(player: InitialSquadPlayer) {
  const seed = [...player.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return { clause: Number((player.value * (1.45 + (seed % 4) * .1)).toFixed(1)), blind: seed % 7 === 0 };
}

function RivalOfferDialog({ player, rival, budget, matchdayStartAt, existingOffer, onClausePurchase, onClose, onSave }: { player: InitialSquadPlayer; rival: RivalTeam; budget: number; matchdayStartAt: number; existingOffer?: SentOffer; onClausePurchase: (clause: number, blind: boolean) => string | null; onClose: () => void; onSave: (amount: number) => string | null }) {
  const [amount, setAmount] = useState((existingOffer?.amount ?? player.value).toFixed(1));
  const [error, setError] = useState("");
  const [confirmClause, setConfirmClause] = useState(false);
  const contract = rivalClauseDetails(player);
  const clauseDeadline = matchdayStartAt - 24 * 60 * 60 * 1000;
  const clauseWindowOpen = Date.now() < clauseDeadline;
  const canAffordClause = budget >= contract.clause;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) { setError("Introduce una cantidad válida"); return; }
    const result = onSave(parsed);
    if (result) setError(result);
  }

  function purchaseClause() {
    const result = onClausePurchase(contract.clause, contract.blind);
    if (result) { setError(result); setConfirmClause(false); return; }
    onClose();
  }

  return <div className="dialog-backdrop bid-dialog-backdrop rival-offer-backdrop" role="presentation"><section className="team-dialog bid-dialog rival-offer-dialog" role="dialog" aria-modal="true" aria-labelledby="rival-offer-dialog-title">
    <div className="dialog-header"><div><p className="eyebrow">FICHA DEL RIVAL</p><h2 id="rival-offer-dialog-title">{player.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div>
    <div className="bid-player-summary"><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.club}</small></div><span><small>VALOR</small><b>{player.value.toFixed(1).replace(".", ",")} M</b></span></div>
    <section className={`rival-clause-card ${contract.blind ? "is-blind" : ""}`}><div><span>{contract.blind ? "◆" : "⚡"}</span><p><small>CLÁUSULA DE RESCISIÓN</small><strong>{contract.clause.toFixed(1).replace(".", ",")} M</strong></p></div><em>{contract.blind ? "BLINDADO" : clauseWindowOpen ? "DISPONIBLE" : "PLAZO CERRADO"}</em><p>{contract.blind ? "El blindaje impide comprarlo mediante cláusula." : clauseWindowOpen ? `Puedes pagarla hasta ${new Date(clauseDeadline).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "Los clausulazos cerraron 24 horas antes del primer partido."}</p><button type="button" disabled={contract.blind || !clauseWindowOpen || !canAffordClause} onClick={() => { setConfirmClause(true); setError(""); }}>{!canAffordClause ? "Saldo insuficiente" : contract.blind ? "Jugador blindado" : !clauseWindowOpen ? "Plazo cerrado" : "Pagar cláusula y fichar"}</button></section>
    {confirmClause && <div className="clause-purchase-confirm"><p><strong>Compra inmediata e irreversible</strong><span>Se descontarán {contract.clause.toFixed(1).replace(".", ",")} M y {player.name} pasará directamente a tu banquillo. No requiere aceptación de {rival.name}.</span></p><div><button onClick={() => setConfirmClause(false)}>Cancelar</button><button onClick={purchaseClause}>Confirmar clausulazo</button></div></div>}
    <div className="rival-offer-separator"><span>o negocia con su propietario</span></div>
    <form onSubmit={submit}><label className="bid-amount-field"><span>{existingOffer ? "Modificar oferta" : `Tu oferta a ${rival.name}`}</span><div><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} /><b>M</b></div><small>La propuesta será válida durante 24 horas.</small></label>
    <p className="bid-privacy-note">El importe solo lo verá el propietario. Quedará retenido hasta que acepte, rechace, caduque o retires la oferta.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button">{existingOffer ? "Guardar oferta" : "Enviar oferta"}</button></div></form>
  </section></div>;
}
function ProfileView({ user, coins, teams, activeTeamId, onCreateTeam, onLogout, navigate, notify, isAdmin, preferences, onSavePreferences, achievements, claimedAchievements, onClaimAchievement, actions, claimedActions, onClaimAction, ledger, economyRules }: {
  user: FantasyBootstrapData["user"];
  coins: number;
  teams: FantasyTeamSummary[];
  activeTeamId: string;
  onCreateTeam: () => void;
  onLogout: () => void;
  navigate: (v: Section) => void;
  notify: (v: string) => void;
  isAdmin: boolean;
  preferences: UserPreferences;
  onSavePreferences: (preferences: UserPreferences) => void;
  achievements: AchievementDefinition[];
  claimedAchievements: string[];
  onClaimAchievement: (id: string) => void;
  actions: CoinAction[];
  claimedActions: string[];
  onClaimAction: (id: string) => void;
  ledger: CoinLedgerEntry[];
  economyRules: EconomyRules;
}) {
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [coinsOpen, setCoinsOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const unlocked = achievements.filter((item) => item.progress >= item.target);
  const featured = [...achievements].sort((a, b) => Number(b.progress >= b.target) - Number(a.progress >= a.target)).slice(0, 4);
  return (
    <>
      <section className="profile-hero"><Avatar label={user.initials} /><div><p className="eyebrow">PERFIL DE JUGADOR</p><h1>{user.displayName}</h1><p>España · Miembro desde 2026</p></div><button className="secondary-button" onClick={() => notify("Edición de perfil preparada")}>Editar perfil</button></section>
      <section className="profile-stats"><div><small>Puntos totales</small><strong>1.284</strong></div><div><small>Mejor posición</small><strong>3.º</strong></div><div><small>Ligas ganadas</small><strong>2</strong></div><div><small>Clubes</small><strong>{teams.length}</strong></div></section>
      <section className="profile-grid">
        <article className="wallet-card"><div><p className="eyebrow">MONEDERO DE PRUEBA</p><h2>{coins.toLocaleString("es-ES")} <span>◆</span></h2><p>Monedas generales, siempre separadas del presupuesto deportivo.</p></div><button onClick={() => setCoinsOpen(true)}>Cómo ganar monedas →</button></article>
        <article className="profile-panel"><div className="section-title compact"><div><p className="eyebrow">IDENTIDAD</p><h2>Mis clubes</h2></div><button className="icon-button" onClick={onCreateTeam} aria-label="Crear club">＋</button></div>{teams.map((item) => <button className="profile-team" key={item.id}><span>{item.shortName}</span><div><strong>{item.name}</strong><small>{item.competition}</small></div><b>{item.id === activeTeamId ? "Activo" : ""}</b></button>)}</article>
        <article className="profile-panel achievements achievement-showcase"><div className="section-title compact"><div><p className="eyebrow">LOGROS</p><h2>Tu vitrina</h2></div><b>{unlocked.length}/{achievements.length}</b></div><div className="achievement-showcase-grid">{featured.map((item) => <span key={item.id} className={`${item.progress >= item.target ? "unlocked" : "locked"} rarity-${item.rarity.toLocaleLowerCase("es")}`} title={item.title}><i>{item.icon}</i><small>{item.title}</small></span>)}</div><button className="secondary-button full" onClick={() => setAchievementsOpen(true)}>Ver todos los logros</button></article>
        <article className="profile-panel settings"><p className="eyebrow">CUENTA</p><button onClick={() => setPreferencesOpen(true)}>Preferencias <span>›</span></button><a href={withBasePath("/privacy")} target="_blank" rel="noreferrer">Política de privacidad <span>↗</span></a><a href={withBasePath("/terms")} target="_blank" rel="noreferrer">Condiciones generales <span>↗</span></a><button onClick={() => navigate("ayuda")}>Ayuda y reglas <span>›</span></button>{isAdmin && <button onClick={() => navigate("admin")}>Administración <span>›</span></button>}<button className="profile-logout" onClick={onLogout}>Cerrar sesión <span>→</span></button></article>
      </section>
      {achievementsOpen && <AchievementGalleryDialog achievements={achievements} claimed={claimedAchievements} onClaim={onClaimAchievement} onClose={() => setAchievementsOpen(false)} />}
      {coinsOpen && <CoinCenterDialog coins={coins} actions={actions} claimed={claimedActions} onClaim={onClaimAction} ledger={ledger} rules={economyRules} onClose={() => setCoinsOpen(false)} />}
      {preferencesOpen && <PreferencesDialog preferences={preferences} onSave={(next) => { onSavePreferences(next); setPreferencesOpen(false); }} onClose={() => setPreferencesOpen(false)} />}
    </>
  );
}

function PreferencesDialog({ preferences, onSave, onClose }: { preferences: UserPreferences; onSave: (preferences: UserPreferences) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<UserPreferences>({ ...preferences });
  const notificationOptions: { key: "marketNotifications" | "matchdayNotifications" | "achievementNotifications"; title: string; description: string }[] = [
    { key: "marketNotifications", title: "Mercado y operaciones", description: "Pujas resueltas, ofertas, ventas y clausulazos." },
    { key: "matchdayNotifications", title: "Jornadas y alineaciones", description: "Próximos cierres, partidos adelantados y puntuaciones." },
    { key: "achievementNotifications", title: "Logros y recompensas", description: "Nuevos logros, monedas disponibles y progreso." },
  ];
  return <div className="dialog-backdrop preferences-backdrop"><section className="team-dialog preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="preferences-title"><div className="dialog-header"><div><p className="eyebrow">CUENTA · AJUSTES PERSONALES</p><h2 id="preferences-title">Preferencias</h2><p>Personaliza el inicio, los avisos y la forma de ver Nexo.</p></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="preferences-content"><section><p className="eyebrow">EXPERIENCIA</p><label className="preferences-select"><span><strong>Competición inicial</strong><small>Será la primera que veas al volver a entrar.</small></span><select value={draft.defaultCompetition} onChange={(event) => setDraft({ ...draft, defaultCompetition: event.target.value as CompetitionName })}><option>Primera</option><option>Segunda</option><option>Liga F</option></select></label><PreferenceToggle active={draft.compactMode} title="Vista compacta" description="Reduce espacios para mostrar más información." onChange={() => setDraft({ ...draft, compactMode: !draft.compactMode })} /><PreferenceToggle active={draft.reducedMotion} title="Reducir animaciones" description="Evita movimientos y transiciones innecesarias." onChange={() => setDraft({ ...draft, reducedMotion: !draft.reducedMotion })} /></section><section><p className="eyebrow">NOTIFICACIONES DENTRO DE NEXO</p>{notificationOptions.map((option) => <PreferenceToggle key={option.key} active={draft[option.key]} title={option.title} description={option.description} onChange={() => setDraft({ ...draft, [option.key]: !draft[option.key] })} />)}<article className="preferences-device-note"><span>i</span><p><strong>Preferencias personales</strong><small>En este prototipo se guardan en este dispositivo. Al conectar la base de datos se sincronizarán con tu cuenta.</small></p></article></section></div><footer><button className="secondary-button" onClick={() => setDraft({ defaultCompetition: "Primera", marketNotifications: true, matchdayNotifications: true, achievementNotifications: true, reducedMotion: false, compactMode: false })}>Restablecer</button><div><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={() => onSave(draft)}>Guardar preferencias</button></div></footer></section></div>;
}

function PreferenceToggle({ active, title, description, onChange }: { active: boolean; title: string; description: string; onChange: () => void }) {
  return <button type="button" className={`preference-toggle ${active ? "active" : ""}`} role="switch" aria-checked={active} onClick={onChange}><span><i /></span><p><strong>{title}</strong><small>{description}</small></p><b>{active ? "ACTIVO" : "INACTIVO"}</b></button>;
}

function AchievementGalleryDialog({ achievements, claimed, onClaim, onClose }: { achievements: AchievementDefinition[]; claimed: string[]; onClaim: (id: string) => void; onClose: () => void }) {
  const [category, setCategory] = useState<"Todos" | AchievementCategory>("Todos");
  const visible = achievements.filter((item) => category === "Todos" || item.category === category);
  return <div className="dialog-backdrop achievement-dialog-backdrop"><section className="team-dialog achievement-dialog" role="dialog" aria-modal="true" aria-labelledby="achievement-dialog-title"><div className="dialog-header"><div><p className="eyebrow">PERFIL · COLECCIÓN PERMANENTE</p><h2 id="achievement-dialog-title">Vitrina de logros</h2><p>Desbloquea insignias y reclama su recompensa una sola vez.</p></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><div className="achievement-summary"><strong>{achievements.filter((item) => item.progress >= item.target).length}<small>desbloqueados</small></strong><span><b>{claimed.length}</b> recompensas reclamadas</span><span><b>{achievements.length}</b> logros totales</span></div><div className="achievement-filters">{(["Todos", "Primeros pasos", "Competición", "Mercado", "Clubes", "Comunidad"] as const).map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="achievement-catalog">{visible.map((item) => { const unlocked = item.progress >= item.target; const isClaimed = claimed.includes(item.id); return <article key={item.id} className={`${unlocked ? "unlocked" : "locked"} rarity-${item.rarity.toLocaleLowerCase("es")}`}><span className="achievement-medal">{unlocked ? item.icon : "?"}</span><div><small>{item.category} · {item.rarity}</small><h3>{item.title}</h3><p>{item.description}</p><div className="achievement-progress"><i><b style={{ width: `${Math.min(100, item.progress / item.target * 100)}%` }} /></i><span>{item.progress}/{item.target}</span></div></div><footer><strong>+{item.coinReward} ◆</strong>{isClaimed ? <span>Reclamado</span> : unlocked ? <button onClick={() => onClaim(item.id)}>Reclamar</button> : <span>Bloqueado</span>}</footer></article>; })}</div></section></div>;
}

function CoinCenterDialog({ coins, actions, claimed, onClaim, ledger, rules, onClose }: { coins: number; actions: CoinAction[]; claimed: string[]; onClaim: (id: string) => void; ledger: CoinLedgerEntry[]; rules: EconomyRules; onClose: () => void }) {
  const [tab, setTab] = useState<"actions" | "history">("actions");
  const today = new Date().toDateString();
  const earnedToday = ledger.filter((entry) => entry.source === "action" && entry.amount > 0 && new Date(entry.createdAt).toDateString() === today).reduce((total, entry) => total + entry.amount, 0);
  return <div className="dialog-backdrop coin-center-backdrop"><section className="team-dialog coin-center-dialog" role="dialog" aria-modal="true" aria-labelledby="coin-center-title"><div className="dialog-header"><div><p className="eyebrow">ECONOMÍA SIMULADA</p><h2 id="coin-center-title">Gana monedas jugando</h2><p>No aumentan el presupuesto de fichajes ni compran puntos.</p></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><article className="coin-balance-hero"><span>◆</span><div><small>SALDO DISPONIBLE</small><strong>{coins.toLocaleString("es-ES")}</strong></div><p><span>Recompensas diarias</span><b>{earnedToday}/{rules.dailyEarnCap}</b><i><em style={{ width: `${Math.min(100, earnedToday / rules.dailyEarnCap * 100)}%` }} /></i></p></article><nav className="coin-tabs"><button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>Retos y acciones</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Historial</button></nav>{tab === "actions" ? <div className="coin-action-list">{actions.map((action) => { const done = action.progress >= action.target; const isClaimed = claimed.includes(action.id); const reward = action.id === "daily_visit" ? rules.dailyLoginReward : action.id === "weekly_lineup" ? rules.weeklyLineupReward : action.id === "fair_play_week" ? rules.fairPlayReward : action.reward; return <article key={action.id}><span>{action.frequency.slice(0, 1)}</span><div><small>{action.frequency}</small><strong>{action.title}</strong><p>{action.description}</p><i><b style={{ width: `${Math.min(100, action.progress / action.target * 100)}%` }} /></i></div><footer><strong>+{reward} ◆</strong><button disabled={!done || isClaimed} onClick={() => onClaim(action.id)}>{isClaimed ? "Recibida" : done ? "Reclamar" : `${action.progress}/${action.target}`}</button></footer></article>; })}<p className="coin-system-note">Los logros permanentes se reclaman desde la vitrina y no consumen el límite diario. Las tareas repetibles sí lo respetan.</p></div> : <div className="coin-ledger"><div><span>Concepto</span><span>Fecha</span><span>Movimiento</span></div>{ledger.map((entry) => <article key={entry.id}><span><strong>{entry.concept}</strong><small>{entry.source === "achievement" ? "Logro" : entry.source === "spend" ? "Compra" : "Recompensa"}</small></span><time>{new Date(entry.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</time><b className={entry.amount >= 0 ? "positive" : "negative"}>{entry.amount >= 0 ? "+" : ""}{entry.amount} ◆</b></article>)}</div>}</section></div>;
}

function CreateTeamDialog({ competitions, teams, coins, freeLimit, additionalCost, defaultCompetition, onClose, onCreate }: {
  competitions: CompetitionSummary[];
  teams: FantasyTeamSummary[];
  coins: number;
  freeLimit: number;
  additionalCost: number;
  defaultCompetition: CompetitionName;
  onClose: () => void;
  onCreate: (input: CreateTeamInput) => string | null;
}) {
  const [name, setName] = useState("");
  const [selectedCompetition, setSelectedCompetition] = useState<CompetitionName>(defaultCompetition);
  const [error, setError] = useState("");
  const currentCount = teams.filter((item) => item.competition === selectedCompetition).length;
  const requiresCoins = currentCount >= freeLimit;
  const canAfford = !requiresCoins || coins >= additionalCost;
  const shortName = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase() || "XI";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = onCreate({ name, competition: selectedCompetition });
    if (result) setError(result);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="team-dialog" role="dialog" aria-modal="true" aria-labelledby="create-team-title">
        <div className="dialog-header">
          <div><p className="eyebrow">NUEVA IDENTIDAD</p><h2 id="create-team-title">Crea tu club</h2></div>
          <button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <form onSubmit={submit}>
          <div className="team-preview">
            <span>{shortName}</span>
            <div><small>VISTA PREVIA DEL CLUB</small><strong>{name.trim() || "Nombre del club"}</strong><p>{selectedCompetition}</p></div>
          </div>
          <article className="club-model-note"><span>↗</span><p><strong>El club agrupa tu carrera</strong><small>Al entrar en una liga se creará un equipo independiente con su propia plantilla, saldo y puntos.</small></p></article>

          <label className="field-label" htmlFor="team-name">Nombre del club</label>
          <input
            id="team-name"
            className="team-name-input"
            value={name}
            onChange={(event) => { setName(event.target.value); setError(""); }}
            maxLength={24}
            autoFocus
            placeholder="Ej. Los Invencibles"
          />
          <div className="input-hint"><span>Entre 3 y 24 caracteres</span><span>{name.length}/24</span></div>

          <span className="field-label">Competición del club</span>
          <div className="dialog-competitions" role="radiogroup" aria-label="Competición del club">
            {competitions.filter((item) => item.enabled).map((item) => {
              const count = teams.filter((team) => team.competitionId === item.id).length;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedCompetition === item.name}
                  className={selectedCompetition === item.name ? "active" : ""}
                  onClick={() => { setSelectedCompetition(item.name); setError(""); }}
                >
                  <strong>{item.name}</strong><small>{count}/{freeLimit} gratis</small>
                </button>
              );
            })}
          </div>

          <div className={`creation-cost ${requiresCoins ? "paid" : "free"}`}>
            <span>{requiresCoins ? "◆" : "✓"}</span>
            <div>
              <strong>{requiresCoins ? `${additionalCost.toLocaleString("es-ES")} monedas` : "Creación gratuita"}</strong>
              <small>{requiresCoins ? `Has utilizado las ${freeLimit} plazas gratuitas de ${selectedCompetition}.` : `Te quedan ${freeLimit - currentCount} plazas gratuitas en ${selectedCompetition}.`}</small>
            </div>
            <b>{coins.toLocaleString("es-ES")} ◆</b>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={!canAfford}>{canAfford ? "Crear club" : "Monedas insuficientes"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function JoinPublicLeagueDialog({ mode, initialEventId, competitions, teams, publicLeagues, fantasyEvents = [], participations, clubRules, onClose, onNeedTeam, onJoin }: {
  mode: "market" | "fantasy";
  initialEventId?: string | null;
  competitions: CompetitionSummary[];
  teams: FantasyTeamSummary[];
  publicLeagues: PublicLeagueSummary[];
  fantasyEvents?: FantasyEvent[];
  participations: LeagueParticipation[];
  clubRules: ClubRules;
  onClose: () => void;
  onNeedTeam: (competition: CompetitionName) => void;
  onJoin: (leagueId: string, teamId: string) => Promise<string | null>;
}) {
  const directEvent = publicLeagues.find((item) => item.id === initialEventId);
  const [step, setStep] = useState(directEvent ? 2 : 1);
  const [selectedCompetition, setSelectedCompetition] = useState<CompetitionName | null>(directEvent?.competition ?? null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(directEvent?.id ?? null);
  const [error, setError] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);
  const joinedLeagueIds = new Set(participations.map((item) => item.leagueId));
  const competitionTeams = selectedCompetition ? teams.filter((item) => item.competition === selectedCompetition) : [];
  const matchingLeagues = selectedCompetition
    ? publicLeagues.filter((item) => item.mode === mode && item.competition === selectedCompetition && !joinedLeagueIds.has(item.id) && (!directEvent || item.id === directEvent.id))
    : [];
  const selectedTeam = teams.find((item) => item.id === selectedTeamId);
  const selectedLeague = publicLeagues.find((item) => item.id === selectedLeagueId);

  function chooseCompetition(value: CompetitionName) {
    setSelectedCompetition(value);
    setSelectedTeamId(null);
    setSelectedLeagueId(null);
    setError("");
  }

  async function confirmJoin() {
    if (!selectedLeagueId || !selectedTeamId) return;
    setIsAssigning(true);
    setError("");
    const result = await onJoin(selectedLeagueId, selectedTeamId);
    if (result) setError(result);
    setIsAssigning(false);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="team-dialog join-dialog" role="dialog" aria-modal="true" aria-labelledby="join-league-title">
        <div className="dialog-header">
          <div><p className="eyebrow">{mode === "fantasy" ? "LIGA FANTÁSTICA · PRESUPUESTO" : "LIGA PÚBLICA · MERCADO"}</p><h2 id="join-league-title">{mode === "fantasy" ? "Únete a una fantástica" : "Únete a una liga"}</h2></div>
          <button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        <div className={`wizard-progress ${directEvent ? "direct-fantasy-progress" : ""}`} aria-label={directEvent ? `Paso ${step - 1} de 2` : `Paso ${step} de 3`}>
          {(directEvent ? ["Club", "Confirmación"] : ["Competición", "Club", "Liga"]).map((label, index) => (
            <div className={step >= index + (directEvent ? 2 : 1) ? "active" : ""} key={label}><span>{index + 1}</span><small>{label}</small></div>
          ))}
        </div>

        {step === 1 && (
          <div className="wizard-step">
            <div className="wizard-copy"><p className="eyebrow">PASO 1 DE 3</p><h3>Elige la competición</h3><p>Solo verás clubes y ligas compatibles con tu elección.</p></div>
            <div className="join-selection-list" role="radiogroup" aria-label="Seleccionar competición">
              {competitions.filter((item) => item.enabled).map((item) => {
                const teamCount = teams.filter((team) => team.competitionId === item.id).length;
                const leagueCount = publicLeagues.filter((league) => league.mode === mode && league.competitionId === item.id && !joinedLeagueIds.has(league.id)).length;
                return <button type="button" role="radio" aria-checked={selectedCompetition === item.name} className={selectedCompetition === item.name ? "active" : ""} key={item.id} onClick={() => chooseCompetition(item.name)}><span className="selection-mark">{item.name === "Primera" ? "1" : item.name === "Segunda" ? "2" : "F"}</span><div><strong>{item.displayName}</strong><small>{teamCount} clubes tuyos · {leagueCount} ligas disponibles</small></div><b>{selectedCompetition === item.name ? "✓" : "›"}</b></button>;
              })}
            </div>
            <div className="wizard-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!selectedCompetition} onClick={() => setStep(2)}>Continuar</button></div>
          </div>
        )}

        {step === 2 && selectedCompetition && (
          <div className="wizard-step">
            <div className="wizard-copy"><p className="eyebrow">{directEvent ? "PASO 1 DE 2 · COMPETICIÓN FIJADA" : "PASO 2 DE 3"}</p><h3>¿Con qué club competirás?</h3><p>{directEvent ? `${directEvent.name} pertenece a ${directEvent.competition}. Elige un club compatible y crearemos su equipo para este evento.` : mode === "fantasy" ? "El club aporta nombre, escudo e historial; el evento tendrá un once independiente." : "El club aporta la identidad; la liga creará una plantilla, saldo y mercado exclusivos."}</p></div>
            {competitionTeams.length > 0 ? (
              <div className="join-selection-list" role="radiogroup" aria-label="Seleccionar club">
                {competitionTeams.map((item) => { const used = participations.filter((entry) => entry.teamId === item.id).length; const exempt = directEvent && fantasyEvents.find((event) => event.id === directEvent.id)?.format === "partidazo" && !clubRules.singleMatchEventsConsumeSlot; const full = used >= clubRules.maxActiveTeams && !exempt; return <button type="button" role="radio" aria-checked={selectedTeamId === item.id} className={`${selectedTeamId === item.id ? "active" : ""} ${full ? "club-at-limit" : ""}`} disabled={full} key={item.id} onClick={() => { setSelectedTeamId(item.id); setError(""); }}><span className="selection-crest">{item.shortName}</span><div><strong>{item.name}</strong><small>{exempt ? `${used}/${clubRules.maxActiveTeams} equipos · este evento no ocupa plaza` : `${used}/${clubRules.maxActiveTeams} equipos activos`}</small></div><b>{full ? "LLENO" : selectedTeamId === item.id ? "✓" : "›"}</b></button>; })}
              </div>
            ) : (
              <div className="no-compatible-team"><span>＋</span><h3>Necesitas un club de {selectedCompetition}</h3><p>Puedes crearlo ahora y volverás automáticamente a este proceso.</p><button className="primary-button" onClick={() => onNeedTeam(selectedCompetition)}>Crear club</button></div>
            )}
            <div className="wizard-actions"><button className="secondary-button" onClick={() => directEvent ? onClose() : setStep(1)}>{directEvent ? "Cancelar" : "Atrás"}</button><button className="primary-button" disabled={!selectedTeamId} onClick={() => setStep(3)}>Continuar</button></div>
          </div>
        )}

        {step === 3 && selectedCompetition && selectedTeam && (
          <div className="wizard-step">
            <div className="wizard-copy"><p className="eyebrow">{directEvent ? "PASO 2 DE 2" : "PASO 3 DE 3"}</p><h3>{directEvent ? `Confirma tu inscripción en ${directEvent.name}` : "Selecciona una liga"}</h3><p>{directEvent ? `La competición ${directEvent.competition} y el evento ya están fijados por los equipos participantes.` : mode === "fantasy" ? "Todos los futbolistas pueden repetirse y dispondrás de un presupuesto nuevo en cada jornada." : "Todas utilizan mercado compartido y jugadores exclusivos."}</p></div>
            {matchingLeagues.length > 0 ? (
              <div className="join-selection-list league-options" role="radiogroup" aria-label="Seleccionar liga pública">
                {matchingLeagues.map((item) => { const event = fantasyEvents.find((candidate) => candidate.id === item.id); return <button type="button" role="radio" aria-checked={selectedLeagueId === item.id} className={`${selectedLeagueId === item.id ? "active" : ""} ${event?.featured ? "fantasy-featured-option" : ""}`} key={item.id} onClick={() => { setSelectedLeagueId(item.id); setError(""); }}><span className={`league-symbol ${item.accent}`}>{event?.featured ? "★" : item.name[0]}</span><div><strong>{item.name}{event?.featured && <em>EL PARTIDAZO</em>}</strong><small>{item.memberCount}/{item.capacity} jugadores · {event ? event.snapshot ? `${event.snapshot.budget.toFixed(1).replace(".", ",")} M congelados` : `presupuesto al cerrar J${event.previousMatchday}` : `${item.startingBudget} M ${mode === "fantasy" ? "por jornada" : "iniciales"}`}</small></div><b>{selectedLeagueId === item.id ? "✓" : "›"}</b></button>; })}
              </div>
            ) : <div className="no-compatible-team"><h3>No hay ligas disponibles</h3><p>Prueba con otra competición o vuelve más tarde.</p></div>}

            <div className="roster-policy-note"><span>{mode === "fantasy" ? "∞" : "↔"}</span><div><strong>{mode === "fantasy" ? "Equipo fantástico independiente" : "Equipo de liga independiente"}</strong><small>{mode === "fantasy" ? `${selectedTeam.name} conservará la identidad y sumará el resultado a su historial; el once del evento empieza vacío.` : `Crearemos para ${selectedTeam.name} una participación con plantilla, saldo y operaciones propias. Los jugadores no se comparten con otras ligas.`}</small></div></div>
            {selectedLeague && <div className="join-summary"><span>{selectedTeam.shortName}</span><div><small>CLUB</small><strong>{selectedTeam.name}</strong></div><b>→</b><div><small>NUEVO EQUIPO EN</small><strong>{selectedLeague.name}</strong></div></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="wizard-actions"><button className="secondary-button" disabled={isAssigning} onClick={() => setStep(2)}>Atrás</button><button className="primary-button" disabled={!selectedLeagueId || isAssigning} onClick={confirmJoin}>{isAssigning ? mode === "fantasy" ? "Creando participación…" : "Confirmando reparto…" : "Unirme a la liga"}</button></div>
          </div>
        )}
      </section>
    </div>
  );
}

function SquadAllocationScreen({ presentation, onFinish }: { presentation: AllocationPresentation; onFinish: () => void }) {
  const [phase, setPhase] = useState(0);
  const [ready, setReady] = useState(false);
  const phases = ["Abriendo el reparto confirmado", "Presentando tus 16 jugadores", "Preparando tu formación 4-4-2"];

  useEffect(() => {
    const first = window.setTimeout(() => setPhase(1), 900);
    const second = window.setTimeout(() => setPhase(2), 1800);
    const complete = window.setTimeout(() => setReady(true), 3000);
    return () => [first, second, complete].forEach((timer) => window.clearTimeout(timer));
  }, []);

  if (!ready) {
    return (
      <section className="allocation-screen allocating" aria-live="polite">
        <Brand />
        <div className="allocation-animation" aria-hidden="true">
          <div className="allocation-orbit"><span>POR</span><span>DEF</span><span>MED</span><span>DEL</span></div>
          <div className="allocation-ball">XI</div>
        </div>
        <p className="eyebrow">REPARTO CONFIRMADO</p>
        <h1>Tu plantilla<br />ya está decidida</h1>
        <p className="allocation-phase">{phases[phase]}<span className="loading-dots">•••</span></p>
        <div className="allocation-progress"><i style={{ width: `${(phase + 1) * 33.34}%` }} /></div>
        <small>La animación solo presenta el resultado confirmado por el servidor.</small>
      </section>
    );
  }

  const starters = presentation.squad.players.filter((player) => presentation.squad.startingPlayerIds.includes(player.id));
  const bench = presentation.squad.players.filter((player) => presentation.squad.benchPlayerIds.includes(player.id));
  const positionRows: PlayerPosition[] = ["DEL", "MED", "DEF", "POR"];

  return (
    <section className="allocation-screen result-screen">
      <header className="allocation-result-header">
        <div><p className="eyebrow">PLANTILLA ASIGNADA</p><h1>Este es tu equipo</h1><p>{presentation.team.name} · {presentation.league.name}</p></div>
        <div className="allocation-value"><small>Valor total</small><strong>{presentation.squad.totalValue.toFixed(1).replace(".", ",")} M</strong><span>Objetivo {presentation.squad.targetValue} M · dentro del ±10 %</span></div>
      </header>
      <div className="allocation-result-grid">
        <article className="allocation-pitch">
          <div className="allocation-formation"><span>ONCE INICIAL</span><strong>4 — 4 — 2</strong></div>
          <div className="football-pitch allocation-field">
            <div className="field-line center-line" /><div className="field-line center-circle" /><div className="field-line box top-box" /><div className="field-line box bottom-box" />
            {positionRows.map((position) => <AllocationPlayerRow key={position} players={starters.filter((player) => player.position === position)} />)}
          </div>
        </article>
        <aside className="allocation-bench">
          <div><p className="eyebrow">BANQUILLO</p><h2>5 suplentes</h2></div>
          {bench.map((player) => <div className="allocated-bench-player" key={player.id}><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.position} · {player.value.toFixed(1).replace(".", ",")} M</small></div></div>)}
          <div className="allocation-secure"><span>✓</span><p><strong>Reparto confirmado</strong><small>Los 16 jugadores ya están reservados exclusivamente para ti en esta liga.</small></p></div>
          <button className="primary-button full" onClick={onFinish}>Ver mi plantilla</button>
        </aside>
      </div>
    </section>
  );
}

function AllocationPlayerRow({ players }: { players: InitialSquadPlayer[] }) {
  return <div className="player-row">{players.map((player) => <div className="pitch-player allocated-player" key={player.id}><span>{player.initials}</span><strong>{player.name}</strong><small>{player.value.toFixed(1).replace(".", ",")} M</small></div>)}</div>;
}

function HelpView() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const categories = ["Todas", ...Array.from(new Set(helpRules.map((rule) => rule.category)))];
  const filteredRules = helpRules.filter((rule) => {
    const matchesCategory = category === "Todas" || rule.category === category;
    const haystack = `${rule.title} ${rule.summary} ${rule.rules.join(" ")}`.toLocaleLowerCase("es");
    return matchesCategory && haystack.includes(query.toLocaleLowerCase("es"));
  });

  return (
    <>
      <section className="help-hero">
        <p className="eyebrow">CENTRO DE AYUDA</p>
        <h1>Reglas claras,<br />juego limpio.</h1>
        <p>Aquí reunimos todas las decisiones del juego. Esta sección crecerá con cada función nueva.</p>
        <label className="help-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar una regla" aria-label="Buscar en la ayuda" /></label>
      </section>
      <div className="help-categories">{categories.map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <section className="help-rules-list">
        {filteredRules.map((rule, index) => (
          <details key={rule.id} open={index === 0 && !query}>
            <summary><span className="help-rule-number">{String(helpRules.indexOf(rule) + 1).padStart(2, "0")}</span><div><small>{rule.category}</small><strong>{rule.title}</strong><p>{rule.summary}</p></div><b>＋</b></summary>
            <div className="help-rule-content"><ul>{rule.rules.map((item) => <li key={item}>{item}</li>)}</ul><small>Actualizado: {rule.updatedAt}</small></div>
          </details>
        ))}
        {filteredRules.length === 0 && <div className="empty-state"><strong>No encontramos esa regla</strong><p>Prueba con otra palabra o categoría.</p></div>}
      </section>
    </>
  );
}

type AdminSection = "overview" | "users" | "clubs" | "leagues" | "markets" | "players" | "scoring" | "audit";

const adminDemoUsers = [
  { id: "usr_1", initials: "BC", name: "Beto C.", email: "beto@nexo.demo", teams: 5, leagues: 7, status: "Activo", lastSeen: "Ahora" },
  { id: "usr_2", initials: "ML", name: "Marcos L.", email: "marcos@nexo.demo", teams: 3, leagues: 4, status: "Activo", lastSeen: "Hace 4 min" },
  { id: "usr_3", initials: "SR", name: "Sara R.", email: "sara@nexo.demo", teams: 4, leagues: 6, status: "Activo", lastSeen: "Hace 18 min" },
  { id: "usr_4", initials: "DP", name: "Dani P.", email: "dani@nexo.demo", teams: 2, leagues: 3, status: "Revisión", lastSeen: "Hace 2 h" },
  { id: "usr_5", initials: "LA", name: "Lucía A.", email: "lucia@nexo.demo", teams: 3, leagues: 5, status: "Activo", lastSeen: "Ayer" },
];

const adminDemoActivity = [
  { id: "act_1", userId: "usr_2", action: "Puja creada", target: "Pedri · Primera Abierta", detail: "7,6 M · pendiente", time: "Hace 3 min", level: "normal" },
  { id: "act_2", userId: "usr_3", action: "Alineación guardada", target: "Liga F Privada", detail: "4-3-3 · jornada 1", time: "Hace 11 min", level: "normal" },
  { id: "act_3", userId: "usr_1", action: "Jugador puesto en venta", target: "Ferran Torres", detail: "Primera Abierta", time: "Hace 26 min", level: "normal" },
  { id: "act_4", userId: "usr_4", action: "Oferta retirada", target: "Aitana Bonmatí", detail: "Modificada 4 veces", time: "Hace 41 min", level: "review" },
  { id: "act_5", userId: "usr_5", action: "Blindaje activado", target: "Kylian Mbappé", detail: "Válido durante 7 días", time: "Hace 1 h", level: "normal" },
  { id: "act_6", userId: "usr_2", action: "Oferta aceptada", target: "Jude Bellingham", detail: "Transferencia confirmada", time: "Hace 2 h", level: "important" },
];

function FantasyEventsAdminPanel({ events, onCreate, onSnapshot }: { events: FantasyEvent[]; onCreate: (event: Omit<FantasyEvent, "id" | "memberCount" | "status" | "snapshot">) => void; onSnapshot: (eventId: string) => void }) {
  const [creatorOpen, setCreatorOpen] = useState(false);
  return <section className="admin-panel fantasy-events-admin"><div className="section-title"><div><p className="eyebrow">EVENTOS FANTÁSTICOS</p><h2>Partidazos, partidos y jornadas</h2><p>Crea eventos ahora y publica precios solo cuando cierre su jornada anterior.</p></div><button className="primary-button" onClick={() => setCreatorOpen(true)}>＋ Crear evento</button></div><div className="fantasy-admin-event-list">{events.map((event) => <article className={event.featured ? "featured" : ""} key={event.id}><span>{event.format === "partidazo" ? "★" : event.format === "matches" ? "◆" : "J"}</span><div><small>{event.featured ? "DESTACADO · " : ""}{event.format.toUpperCase()}</small><strong>{event.name}</strong><p>{event.fixtures.map((fixture) => `${fixture.home}–${fixture.away}`).join(" · ") || `Jornadas ${event.matchdays.join(", ")}`}</p></div><div className="fantasy-admin-snapshot"><small>{event.snapshot ? "SNAPSHOT PUBLICADO" : `ESPERANDO CIERRE J${event.previousMatchday}`}</small><strong>{event.snapshot ? `${event.snapshot.budget.toFixed(1).replace(".", ",")} M` : "Presupuesto pendiente"}</strong><span>{event.snapshot ? `${Object.keys(event.snapshot.playerPrices).length} precios · P${event.snapshot.percentile}` : `${event.memberCount} inscritos`}</span></div>{!event.snapshot ? <button onClick={() => onSnapshot(event.id)}>Simular cierre y calcular</button> : <b>✓ BLOQUEADO</b>}</article>)}</div>{creatorOpen && <CreateFantasyEventDialog onClose={() => setCreatorOpen(false)} onCreate={(event) => { onCreate(event); setCreatorOpen(false); }} />}</section>;
}

function buildFantasyFixtureCalendar(competition: CompetitionName): FantasyEventFixture[] {
  const clubs = Array.from(new Set(competitionPlayers[competition].map((player) => player.club))).slice(0, 10);
  const times = ["Vie · 21:00", "Sáb · 16:15", "Sáb · 18:30", "Dom · 18:30", "Dom · 21:00"];
  return [6, 7, 8].flatMap((matchday) => {
    const rotation = matchday - 5;
    const fixtureCount = Math.floor(clubs.length / 2);
    return Array.from({ length: fixtureCount }, (_, index) => {
      const home = clubs[index];
      const away = clubs[fixtureCount + ((index + rotation - 1) % fixtureCount)];
      if (!home || !away || home === away) return null;
      return { id: `calendar_${competition}_${matchday}_${index}`, home, away, matchday, kickoffLabel: times[index % times.length] } satisfies FantasyEventFixture;
    }).filter((fixture): fixture is FantasyEventFixture => fixture !== null);
  });
}

function CreateFantasyEventDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (event: Omit<FantasyEvent, "id" | "memberCount" | "status" | "snapshot">) => void }) {
  const [format, setFormat] = useState<FantasyEventFormat>("partidazo");
  const [competition, setCompetition] = useState<CompetitionName>("Primera");
  const clubs = useMemo(() => Array.from(new Set(competitionPlayers[competition].map((player) => player.club))), [competition]);
  const calendar = useMemo(() => buildFantasyFixtureCalendar(competition), [competition]);
  const [name, setName] = useState("El Partidazo");
  const [home, setHome] = useState(clubs[0]);
  const [away, setAway] = useState(clubs[1] ?? clubs[0]);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<string[]>([]);
  const [previousMatchday, setPreviousMatchday] = useState(5);
  const [endMatchday, setEndMatchday] = useState(8);
  const [percentile, setPercentile] = useState(60);
  const [maxPlayersPerClub, setMaxPlayersPerClub] = useState(6);
  const [capacity, setCapacity] = useState(500);
  const [lineupPolicy, setLineupPolicy] = useState<"fixed" | "per_matchday">("fixed");
  const [featured, setFeatured] = useState(true);
  const [error, setError] = useState("");
  const selectedFixtures = calendar.filter((fixture) => selectedFixtureIds.includes(fixture.id));
  const selectedMatchdays = Array.from(new Set(selectedFixtures.map((fixture) => fixture.matchday))).sort((a, b) => a - b);
  const selectedClubs = new Set(selectedFixtures.flatMap((fixture) => [fixture.home, fixture.away]));
  const snapshotAfterMatchday = format === "matches" && selectedMatchdays.length ? selectedMatchdays[0] - 1 : previousMatchday;

  function changeCompetition(value: CompetitionName) {
    const nextClubs = Array.from(new Set(competitionPlayers[value].map((player) => player.club)));
    setCompetition(value);
    setHome(nextClubs[0]);
    setAway(nextClubs[1] ?? nextClubs[0]);
    setSelectedFixtureIds([]);
    setError("");
  }
  function changeFormat(value: FantasyEventFormat) {
    setFormat(value);
    setError("");
    if (value === "partidazo") setName("El Partidazo");
    if (value === "matches" && name === "El Partidazo") setName("Partidos de la semana");
  }
  function toggleFixture(fixtureId: string) {
    setSelectedFixtureIds((current) => current.includes(fixtureId) ? current.filter((id) => id !== fixtureId) : [...current, fixtureId]);
    setError("");
  }
  function toggleMatchday(matchday: number) {
    const ids = calendar.filter((fixture) => fixture.matchday === matchday).map((fixture) => fixture.id);
    setSelectedFixtureIds((current) => ids.every((id) => current.includes(id)) ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids])));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 3) { setError("Escribe un nombre válido."); return; }
    if (format === "partidazo" && home === away) { setError("Los dos equipos del partido deben ser distintos."); return; }
    if (format === "matches" && selectedFixtures.length < 2) { setError("Selecciona al menos dos partidos del calendario."); return; }
    const competitionId = competition === "Primera" ? "comp_primera" : competition === "Segunda" ? "comp_segunda" : "comp_liga_f";
    const fixtures: FantasyEventFixture[] = format === "partidazo" ? [{ id: `fixture_${crypto.randomUUID()}`, home, away, matchday: previousMatchday + 1, kickoffLabel: `Jornada ${previousMatchday + 1}` }] : format === "matches" ? selectedFixtures : [];
    const matchdays = format === "matchdays" ? Array.from({ length: Math.max(1, endMatchday - previousMatchday) }, (_, index) => previousMatchday + 1 + index) : format === "matches" ? selectedMatchdays : [previousMatchday + 1];
    const effectiveLineupPolicy = format === "partidazo" || (format === "matches" && matchdays.length === 1) ? "fixed" : lineupPolicy;
    onCreate({ name: name.trim(), description: format === "partidazo" ? `${home} contra ${away}. Un partido, un once, una clasificación.` : format === "matches" ? `${fixtures.length} partidos seleccionados de ${matchdays.length} ${matchdays.length === 1 ? "jornada" : "jornadas"}.` : "Competición fantástica de varias jornadas.", competition, competitionId, format, fixtures, matchdays, lineupPolicy: effectiveLineupPolicy, maxPlayersPerClub, capacity, featured: format === "partidazo" && featured, previousMatchday: snapshotAfterMatchday, budgetPercentile: percentile });
  }

  return <div className="dialog-backdrop fantasy-event-creator-backdrop"><section className="team-dialog fantasy-event-creator" role="dialog" aria-modal="true" aria-labelledby="fantasy-event-creator-title"><div className="dialog-header"><div><p className="eyebrow">ADMINISTRACIÓN · NUEVO EVENTO</p><h2 id="fantasy-event-creator-title">Crear liga fantástica</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><form onSubmit={submit}>
    <div className="fantasy-event-format-tabs">{(["partidazo","matches","matchdays"] as FantasyEventFormat[]).map((item) => <button type="button" className={format === item ? "active" : ""} key={item} onClick={() => changeFormat(item)}>{item === "partidazo" ? "★ El Partidazo" : item === "matches" ? "Varios partidos" : "Varias jornadas"}</button>)}</div>
    <div className="fantasy-event-form-grid"><label><span>Nombre</span><input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label><label><span>Competición</span><select value={competition} onChange={(event) => changeCompetition(event.target.value as CompetitionName)}>{(["Primera","Segunda","Liga F"] as CompetitionName[]).map((item) => <option key={item}>{item}</option>)}</select></label>{format === "partidazo" && <><label><span>Local</span><select value={home} onChange={(event) => setHome(event.target.value)}>{clubs.map((club) => <option key={club}>{club}</option>)}</select></label><label><span>Visitante</span><select value={away} onChange={(event) => setAway(event.target.value)}>{clubs.map((club) => <option key={club}>{club}</option>)}</select></label></>}{format !== "matches" && <label><span>Jornada anterior</span><input type="number" min="1" max="37" value={previousMatchday} onChange={(event) => setPreviousMatchday(Number(event.target.value))} /></label>}{format === "matchdays" && <label><span>Última jornada incluida</span><input type="number" min={previousMatchday + 1} max="38" value={endMatchday} onChange={(event) => setEndMatchday(Number(event.target.value))} /></label>}<label><span>Percentil del presupuesto</span><input type="number" min="20" max="90" step="5" value={percentile} onChange={(event) => setPercentile(Number(event.target.value))} /></label><label><span>Máximo por club</span><input type="number" min="1" max="11" value={maxPlayersPerClub} onChange={(event) => setMaxPlayersPerClub(Number(event.target.value))} /></label><label><span>Capacidad</span><input type="number" min="2" max="5000" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></label>{(format !== "partidazo" && (format !== "matches" || selectedMatchdays.length > 1)) && <label><span>Alineación</span><select value={lineupPolicy} onChange={(event) => setLineupPolicy(event.target.value as "fixed" | "per_matchday")}><option value="fixed">Una para todo el evento</option><option value="per_matchday">Nueva en cada jornada</option></select></label>}</div>
    {format === "matches" && <section className="fantasy-fixture-picker"><header><div><p className="eyebrow">CALENDARIO · {competition.toUpperCase()}</p><h3>Selecciona los encuentros</h3><p>Puedes combinar partidos de una o varias jornadas.</p></div><strong>{selectedFixtures.length}<small>seleccionados</small></strong></header><div className="fantasy-calendar-matchdays">{[6,7,8].map((matchday) => { const fixtures = calendar.filter((fixture) => fixture.matchday === matchday); const allSelected = fixtures.length > 0 && fixtures.every((fixture) => selectedFixtureIds.includes(fixture.id)); return <article key={matchday}><div><span>J{matchday}</span><p><strong>Jornada {matchday}</strong><small>{fixtures.length} partidos disponibles</small></p><button type="button" onClick={() => toggleMatchday(matchday)}>{allSelected ? "Quitar todos" : "Seleccionar jornada"}</button></div><section>{fixtures.map((fixture) => { const active = selectedFixtureIds.includes(fixture.id); return <button type="button" className={active ? "active" : ""} key={fixture.id} onClick={() => toggleFixture(fixture.id)} aria-pressed={active}><span>{active ? "✓" : ""}</span><time>{fixture.kickoffLabel}</time><p><strong>{fixture.home}</strong><em>vs</em><strong>{fixture.away}</strong></p></button>; })}</section></article>; })}</div></section>}
    {format === "matches" && selectedFixtures.length > 0 && <article className="fantasy-selection-summary"><span>◆</span><div><p className="eyebrow">RESUMEN DEL EVENTO</p><strong>{selectedFixtures.length} partidos · {selectedClubs.size} clubes · {selectedMatchdays.length} {selectedMatchdays.length === 1 ? "jornada" : "jornadas"}</strong><small>{selectedMatchdays.length === 1 ? "Se utilizará una única alineación." : lineupPolicy === "fixed" ? "Una alineación puntuará durante todo el evento." : "Se podrá preparar una alineación por jornada."}</small></div><b>Precios tras J{snapshotAfterMatchday}</b></article>}
    {format === "partidazo" && <button type="button" className={`fantasy-feature-toggle ${featured ? "active" : ""}`} onClick={() => setFeatured(!featured)}><span>{featured ? "✓" : ""}</span><p><strong>Destacar en Inicio y Ligas</strong><small>Solo habrá un evento fantástico destacado a la vez.</small></p></button>}
    <article className="snapshot-pending-preview"><span>◷</span><p><strong>Se publicará con presupuesto pendiente</strong><small>Los valores y el presupuesto se congelarán para todos cuando se cierre la Jornada {snapshotAfterMatchday}.</small></p></article>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Crear y publicar</button></div>
  </form></section></div>;
}

function AdminView({ marketRules, setMarketRules, clubRules, setClubRules, economyRules, setEconomyRules, settlementRules, setSettlementRules, onboardingConfig, onForceOnboarding, legalConfig, onPublishLegalVersion, scoringRules, onChangeScoringRules, teams, leagues, participations, squads, bids, playerContracts, playerOffers, sentOffers, playerCatalog, onChangePlayerCatalog, fantasyEvents, onCreateFantasyEvent, onSnapshotFantasyEvent, onOpenLeague, onRenewMarket, notify }: {
  marketRules: MarketRules;
  setMarketRules: (rules: MarketRules) => void;
  clubRules: ClubRules;
  setClubRules: (rules: ClubRules) => void;
  economyRules: EconomyRules;
  setEconomyRules: (rules: EconomyRules) => void;
  settlementRules: MatchdaySettlementRules;
  setSettlementRules: (rules: MatchdaySettlementRules) => void;
  onboardingConfig: OnboardingConfig;
  onForceOnboarding: (reason: string) => void;
  legalConfig: LegalConfig;
  onPublishLegalVersion: (kind: "privacy" | "terms", changeSummary: string) => void;
  scoringRules: ScoringRule[];
  onChangeScoringRules: (rules: ScoringRule[]) => void;
  teams: FantasyTeamSummary[];
  leagues: LeagueSummary[];
  participations: LeagueParticipation[];
  squads: Record<string, InitialSquad>;
  bids: Record<string, MarketBid[]>;
  playerContracts: Record<string, PlayerContract>;
  playerOffers: Record<string, PlayerOffer[]>;
  sentOffers: Record<string, SentOffer[]>;
  playerCatalog: Record<CompetitionName, CompetitionPlayer[]>;
  onChangePlayerCatalog: (catalog: Record<CompetitionName, CompetitionPlayer[]>) => void;
  fantasyEvents: FantasyEvent[];
  onCreateFantasyEvent: (event: Omit<FantasyEvent, "id" | "memberCount" | "status" | "snapshot">) => void;
  onSnapshotFantasyEvent: (eventId: string) => void;
  onOpenLeague: (leagueId: string) => void;
  onRenewMarket: (leagueId: string) => void;
  notify: (v: string) => void;
}) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [selectedUserId, setSelectedUserId] = useState(adminDemoUsers[0].id);
  const [selectedLeagueId, setSelectedLeagueId] = useState(leagues[0]?.id ?? "");
  const [playerCompetition, setPlayerCompetition] = useState<CompetitionName>("Primera");
  const [playerQuery, setPlayerQuery] = useState("");
  const [adminMatchday, setAdminMatchday] = useState(1);
  const [editingPlayer, setEditingPlayer] = useState<CompetitionPlayer | null>(null);
  const allReceivedOffers = Object.values(playerOffers).flat();
  const allSentOffers = Object.values(sentOffers).flat();
  const allBids = Object.values(bids).flat();
  const listedCount = Object.values(playerContracts).filter((contract) => contract.listed).length;
  const selectedUser = adminDemoUsers.find((user) => user.id === selectedUserId) ?? adminDemoUsers[0];
  const userActivity = adminDemoActivity.filter((item) => item.userId === selectedUser.id);
  const selectedLeague = leagues.find((league) => league.id === selectedLeagueId) ?? leagues[0];
  const selectedParticipationIds = participations.filter((item) => item.leagueId === selectedLeague?.id).map((item) => item.id);
  const selectedReceivedOffers = Object.entries(playerOffers).filter(([key]) => selectedParticipationIds.some((id) => key.startsWith(`${id}:`))).flatMap(([, offers]) => offers);
  const selectedBids = bids[selectedLeague?.id ?? ""] ?? [];
  const selectedSentOffers = sentOffers[selectedLeague?.id ?? ""] ?? [];
  const selectedListedPlayers = selectedParticipationIds.flatMap((participationId) => (squads[participationId]?.players ?? []).filter((player) => playerContracts[`${participationId}:${player.id}`]?.listed));
  const visiblePlayers = playerCatalog[playerCompetition].filter((player) => `${player.name} ${player.club}`.toLocaleLowerCase("es").includes(playerQuery.toLocaleLowerCase("es")));

  function savePlayer(nextPlayer: CompetitionPlayer) {
    onChangePlayerCatalog({ ...playerCatalog, [playerCompetition]: playerCatalog[playerCompetition].map((player) => player.id === nextPlayer.id ? nextPlayer : player) });
    setEditingPlayer(null);
    notify(`Ficha de ${nextPlayer.name} actualizada`);
  }

  return <>
    <section className="page-heading admin-heading"><div><p className="eyebrow">CONTROL TOTAL Y AUDITABLE</p><h1>Administración</h1><p>Supervisa toda la plataforma y opera dentro de cualquier liga.</p></div><span className="admin-badge">SUPERADMIN</span></section>
    <nav className="admin-console-nav" aria-label="Áreas de administración">{[
      ["overview", "Resumen", "⌂"], ["users", "Usuarios", "●"], ["clubs", "Clubes", "C"], ["leagues", "Ligas", "◫"], ["markets", "Mercados", "↗"], ["players", "Jugadores", "♙"], ["scoring", "Puntuación", "+"], ["audit", "Actividad", "≡"]
    ].map(([id, label, icon]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id as AdminSection)}><span>{icon}</span>{label}</button>)}</nav>

    {section === "overview" && <>
      <section className="admin-overview"><div><small>Usuarios</small><strong>24</strong><span>3 activos ahora</span></div><div><small>Ligas existentes</small><strong>{leagues.length}</strong><span>{participations.length} participaciones</span></div><div><small>Operaciones abiertas</small><strong>{allBids.length + allReceivedOffers.filter((offer) => offer.status === "active").length + allSentOffers.filter((offer) => offer.status === "active").length}</strong><span>Pujas y ofertas</span></div><div><small>Jugadores</small><strong>{Object.values(playerCatalog).flat().length}</strong><span>3 competiciones</span></div></section>
      <section className="admin-control-grid">
        <article className="admin-command-card dark"><div><p className="eyebrow">VISTA GLOBAL</p><h2>Todo lo que ocurre, en un solo lugar.</h2><p>Consulta usuarios, ligas y operaciones sin depender de pertenecer a una competición concreta.</p></div><button onClick={() => setSection("audit")}>Abrir registro completo →</button></article>
        <article className="admin-health-card"><p className="eyebrow">ESTADO OPERATIVO</p><div><span className="positive">●</span><strong>Mercados</strong><b>{listedCount} anuncios</b></div><div><span className="positive">●</span><strong>Pujas</strong><b>{allBids.length} activas</b></div><div><span className="positive">●</span><strong>Ofertas</strong><b>{allReceivedOffers.length + allSentOffers.length} registradas</b></div><div><span>◷</span><strong>Próxima renovación</strong><b>Cada {marketRules.renewalHours} h</b></div></article>
      </section>
      <FantasyEventsAdminPanel events={fantasyEvents} onCreate={onCreateFantasyEvent} onSnapshot={onSnapshotFantasyEvent} />
      <MatchdaySettlementAdminPanel rules={settlementRules} onChange={setSettlementRules} notify={notify} />
      <OnboardingAdminPanel config={onboardingConfig} onForce={onForceOnboarding} />
      <LegalVersionsAdminPanel config={legalConfig} onPublish={onPublishLegalVersion} />
      <section className="admin-grid"><ClubRulesAdminPanel rules={clubRules} onChange={setClubRules} notify={notify} /><AchievementEconomyAdminPanel rules={economyRules} onChange={setEconomyRules} notify={notify} /><MarketRulesAdminPanel rules={marketRules} onChange={setMarketRules} notify={notify} /><FantasyRulesAdminPanel rules={marketRules} onChange={setMarketRules} notify={notify} /><MarketAlgorithmAdminPanel notify={notify} /></section>
    </>}

    {section === "users" && <section className="admin-master-detail"><article className="admin-panel admin-user-list"><div className="section-title compact"><div><p className="eyebrow">CUENTAS</p><h2>Todos los usuarios</h2></div><span>{adminDemoUsers.length} mostrados</span></div>{adminDemoUsers.map((user) => <button key={user.id} className={selectedUser.id === user.id ? "active" : ""} onClick={() => setSelectedUserId(user.id)}><Avatar label={user.initials} /><span><strong>{user.name}</strong><small>{user.email}</small></span><em className={user.status === "Revisión" ? "review" : ""}>{user.status}</em><b>›</b></button>)}</article><article className="admin-panel admin-user-detail"><header><Avatar label={selectedUser.initials} /><div><p className="eyebrow">EXPEDIENTE COMPLETO</p><h2>{selectedUser.name}</h2><small>{selectedUser.email} · visto {selectedUser.lastSeen.toLowerCase()}</small></div><button onClick={() => notify(`Acciones de cuenta de ${selectedUser.name}`)}>•••</button></header><div className="admin-user-kpis"><span><small>EQUIPOS</small><strong>{selectedUser.teams}</strong></span><span><small>LIGAS</small><strong>{selectedUser.leagues}</strong></span><span><small>ESTADO</small><strong>{selectedUser.status}</strong></span></div><div className="admin-user-actions"><button onClick={() => notify("Monedas concedidas de forma simulada")}>Conceder monedas</button><button onClick={() => notify("Sesiones del usuario revisadas")}>Ver sesiones</button><button className="danger" onClick={() => notify("Revisión de cuenta preparada")}>Poner en revisión</button></div><div className="admin-user-activity"><p className="eyebrow">TODO LO QUE HA HECHO</p>{userActivity.length ? userActivity.map((item) => <div key={item.id}><span className={item.level} /><p><strong>{item.action}</strong><small>{item.target} · {item.detail}</small></p><time>{item.time}</time></div>) : <div className="admin-empty-line">Sin actividad reciente</div>}</div></article></section>}

    {section === "leagues" && <section className="admin-panel admin-leagues-table"><div className="section-title compact"><div><p className="eyebrow">DIRECTORIO GLOBAL</p><h2>Todas las ligas</h2></div><span className="active-tag">{leagues.length} activas</span></div><div className="admin-table-head"><span>Liga</span><span>Competición</span><span>Tipo</span><span>Participantes</span><span>Operaciones</span><span /></div>{leagues.map((league) => { const leagueOperations = (bids[league.id]?.length ?? 0) + (sentOffers[league.id]?.filter((offer) => offer.status === "active").length ?? 0); return <article key={league.id}><span className="league-avatar" style={{ background: league.accent }}>{league.name.slice(0,1)}</span><div><strong>{league.name}</strong><small>ID · {league.id}</small></div><span>{league.competition}</span><span>{league.type}</span><span>{league.members}</span><b>{leagueOperations}</b><div><button onClick={() => onOpenLeague(league.id)}>Entrar como admin</button><button onClick={() => { setSelectedLeagueId(league.id); setSection("markets"); }}>Ver mercado</button></div></article>; })}</section>}

    {section === "markets" && <section className="admin-market-console"><aside className="admin-panel admin-market-leagues"><div><p className="eyebrow">MERCADOS</p><h2>Selecciona una liga</h2></div>{leagues.map((league) => <button key={league.id} className={selectedLeague?.id === league.id ? "active" : ""} onClick={() => setSelectedLeagueId(league.id)}><span style={{ background: league.accent }}>{league.name.slice(0,1)}</span><p><strong>{league.name}</strong><small>{league.competition} · {league.type}</small></p><b>›</b></button>)}</aside>{selectedLeague && <article className="admin-panel admin-market-detail"><header><div><p className="eyebrow">{selectedLeague.competition} · CONTROL DE MERCADO</p><h2>{selectedLeague.name}</h2><small>El administrador puede inspeccionar y ejecutar las mismas operaciones que un participante.</small></div><div><button className="secondary-button" onClick={() => onOpenLeague(selectedLeague.id)}>Entrar en la liga</button><button className="primary-button" onClick={() => onRenewMarket(selectedLeague.id)}>Renovar mercado ahora</button></div></header><div className="admin-market-kpis"><span><small>EN VENTA</small><strong>{selectedListedPlayers.length}</strong></span><span><small>PUJAS</small><strong>{selectedBids.length}</strong></span><span><small>OFERTAS RECIBIDAS</small><strong>{selectedReceivedOffers.length}</strong></span><span><small>OFERTAS HECHAS</small><strong>{selectedSentOffers.length}</strong></span></div><div className="admin-operation-stream"><div className="admin-operation-head"><span>Tipo</span><span>Jugador / origen</span><span>Importe</span><span>Estado</span></div>{selectedBids.map((bid) => <p key={`bid_${bid.playerId}`}><em>PUJA</em><strong>{bid.playerId.replace(/_/g, " ")}</strong><b>{bid.amount.toFixed(1).replace(".", ",")} M</b><span>Activa</span></p>)}{selectedReceivedOffers.map((offer) => <p key={offer.id}><em>RECIBIDA</em><strong>{offer.bidderName}</strong><b>{offer.amount.toFixed(1).replace(".", ",")} M</b><span>{offer.status}</span></p>)}{selectedSentOffers.map((offer) => <p key={offer.id}><em>HECHA</em><strong>{offer.targetPlayerName}</strong><b>{offer.amount.toFixed(1).replace(".", ",")} M</b><span>{offer.status}</span></p>)}{!selectedBids.length && !selectedReceivedOffers.length && !selectedSentOffers.length && <div className="admin-empty-line">No hay operaciones registradas todavía.</div>}</div><article className="admin-renewal-note"><span>↻</span><div><strong>Renovación administrativa</strong><p>Resuelve la ventana y genera ofertas automáticas del juego sobre los jugadores que sus propietarios hayan puesto en venta. La acción quedará auditada.</p></div></article></article>}</section>}

    {section === "players" && <section className="admin-panel admin-player-catalog"><div className="section-title"><div><p className="eyebrow">CATÁLOGO MAESTRO</p><h2>Jugadores de todas las divisiones</h2></div><span className="active-tag">{Object.values(playerCatalog).flat().length} fichas</span></div><div className="admin-player-toolbar"><CompetitionTabs value={playerCompetition} onChange={setPlayerCompetition} /><label className="search-box"><span>⌕</span><input value={playerQuery} onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Buscar jugador o club" /></label><label className="admin-matchday-select"><span>Jornada</span><select value={adminMatchday} onChange={(event) => setAdminMatchday(Number(event.target.value))}>{[1,2,3,4,5].map((matchday) => <option key={matchday} value={matchday}>Jornada {matchday}</option>)}</select></label></div><div className="admin-player-head"><span>Jugador</span><span>Posición</span><span>Club</span><span>Valor</span><span>Puntos J{adminMatchday}</span><span /></div><div className="admin-player-list">{visiblePlayers.map((player) => { const jornadaPoints = calculatePlayerPoints(demoPlayerMatchStats(`${player.id}_j${adminMatchday}`, player.position), player.position, scoringRules).total; return <article key={player.id}><Avatar label={player.initials} /><div><strong>{player.name}</strong><small>{player.id}</small></div><span>{player.position}</span><span>{player.club}</span><b>{player.value.toFixed(1).replace(".", ",")} M</b><strong className={jornadaPoints >= 0 ? "positive" : "negative"}>{jornadaPoints > 0 ? "+" : ""}{jornadaPoints} pts</strong><button onClick={() => setEditingPlayer(player)}>Editar</button></article>; })}</div></section>}

    {section === "scoring" && <ScoringAdminPanel rules={scoringRules} onChange={onChangeScoringRules} notify={notify} />}
    {section === "audit" && <section className="admin-panel admin-audit"><div className="section-title"><div><p className="eyebrow">TRAZABILIDAD</p><h2>Registro de actividad</h2><p>Acciones de usuarios, procesos automáticos y administradores.</p></div><button className="secondary-button" onClick={() => notify("Exportación del registro preparada")}>Exportar</button></div><div className="admin-audit-filters"><button className="active">Todo</button><button>Usuarios</button><button>Mercado</button><button>Administración</button><button>Alertas</button></div>{adminDemoActivity.map((item) => { const user = adminDemoUsers.find((candidate) => candidate.id === item.userId); return <article key={item.id}><span className={item.level} /><Avatar label={user?.initials} /><div><strong>{item.action}</strong><small>{user?.name} · {item.target} · {item.detail}</small></div><time>{item.time}</time><button onClick={() => notify(`Detalle de ${item.action.toLowerCase()}`)}>Ver detalle</button></article>; })}<article className="admin-audit-system"><span>ADM</span><div><strong>Renovación manual del mercado</strong><small>Administrador · operación simulada y registrada con fecha, liga y resultado</small></div><time>Preparada</time></article></section>}
    {section === "clubs" && <section className="admin-panel admin-club-directory"><div className="section-title"><div><p className="eyebrow">IDENTIDADES Y CARRERA</p><h2>Clubes de los usuarios</h2><p>Consulta qué equipos ha creado cada club en las diferentes ligas.</p></div><span className="active-tag">{teams.length} clubes</span></div><div className="admin-club-head"><span>Club</span><span>Competición</span><span>Equipos</span><span>Modalidades</span><span>Estado</span></div><div className="admin-club-list">{teams.map((club) => { const clubParticipations = participations.filter((item) => item.teamId === club.id); const clubLeagues = clubParticipations.map((item) => leagues.find((league) => league.id === item.leagueId)).filter((league): league is LeagueSummary => Boolean(league)); return <article key={club.id}><span className="selection-crest">{club.shortName}</span><div><strong>{club.name}</strong><small>ID · {club.id}</small></div><b>{club.competition}</b><span>{clubParticipations.length}</span><p>{clubLeagues.length ? Array.from(new Set(clubLeagues.map((league) => league.mode === "fantasy" ? "Fantástica" : league.type.includes("Privada") ? "Privada" : "Pública"))).join(" · ") : "Sin equipos"}</p><em>{clubParticipations.length ? "Activo" : "Sin competir"}</em><div>{clubLeagues.slice(0,2).map((league) => <button key={league.id} onClick={() => onOpenLeague(league.id)}>{league.name} →</button>)}</div></article>; })}</div><article className="admin-club-model-note"><span>CLUB</span><p><strong>Separación preparada para base de datos</strong><small>El club conserva identidad, carrera y palmarés. Cada participación enlaza el club con una liga y contiene el equipo deportivo independiente.</small></p></article></section>}
    {editingPlayer && <AdminPlayerEditor player={editingPlayer} onClose={() => setEditingPlayer(null)} onSave={savePlayer} />}
  </>;
}

function AdminPlayerEditor({ player, onClose, onSave }: { player: CompetitionPlayer; onClose: () => void; onSave: (player: CompetitionPlayer) => void }) {
  const [name, setName] = useState(player.name);
  const [club, setClub] = useState(player.club);
  const [position, setPosition] = useState<PlayerPosition>(player.position);
  const [value, setValue] = useState(player.value.toFixed(1));
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsedValue = Number(value.replace(",", "."));
    if (name.trim().length < 2 || club.trim().length < 2 || !Number.isFinite(parsedValue) || parsedValue <= 0) { setError("Revisa el nombre, el club y el valor de mercado"); return; }
    onSave({ ...player, name: name.trim(), club: club.trim(), position, value: Number(parsedValue.toFixed(1)), initials: name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() });
  }
  return <div className="dialog-backdrop admin-player-editor-backdrop" role="presentation"><section className="team-dialog admin-player-editor" role="dialog" aria-modal="true" aria-labelledby="admin-player-editor-title"><div className="dialog-header"><div><p className="eyebrow">EDITAR CATÁLOGO MAESTRO</p><h2 id="admin-player-editor-title">{player.name}</h2></div><button className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button></div><form onSubmit={submit}><label><span>Nombre del jugador</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>Club</span><input value={club} onChange={(event) => setClub(event.target.value)} /></label><div className="admin-player-form-row"><label><span>Posición</span><select value={position} onChange={(event) => setPosition(event.target.value as PlayerPosition)}>{["POR","DEF","MED","DEL"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Valor de mercado</span><div className="admin-value-input"><input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /><b>M</b></div></label></div><p className="bid-privacy-note">El cambio queda preparado para publicarse de forma global y versionada en todas las ligas.</p>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button">Guardar cambios</button></div></form></section></div>;
}
function ScoringAdminPanel({ rules, onChange, notify }: { rules: ScoringRule[]; onChange: (rules: ScoringRule[]) => void; notify: (value: string) => void }) {
  const groups = Array.from(new Set(rules.map((rule) => rule.group)));
  function updateRule(key: ScoringRule["key"], updater: (rule: ScoringRule) => ScoringRule) { onChange(rules.map((rule) => rule.key === key ? updater(rule) : rule)); }
  return <section className="admin-panel scoring-admin-panel"><div className="section-title"><div><p className="eyebrow">REGLAS BASADAS EN LA API</p><h2>Sistema de puntuación</h2><p>Solo pueden utilizarse estadísticas que el proveedor confirme como disponibles.</p></div><div className="scoring-admin-status"><span>{rules.filter((rule) => rule.available && rule.enabled).length} activas</span><b>{rules.filter((rule) => !rule.available).length} no disponibles</b></div></div><article className="scoring-provider-card"><span>API</span><div><strong>Catálogo provisional del proveedor</strong><p>Cada regla está vinculada al nombre técnico del campo que recibiremos. Cuando elijamos la API, esta lista se sincronizará con sus capacidades reales.</p></div><button onClick={() => notify("Comprobación de capacidades preparada para conectar la API")}>Comprobar campos</button></article>{groups.map((group) => <section className="scoring-rule-group" key={group}><header><h3>{group}</h3><span>{rules.filter((rule) => rule.group === group && rule.available).length} estadísticas disponibles</span></header><div className="scoring-rule-head"><span>Estado y estadística</span><span>Campo API</span><span>Cada</span><span>POR</span><span>DEF</span><span>MED</span><span>DEL</span></div>{rules.filter((rule) => rule.group === group).map((rule) => <article className={!rule.available ? "unavailable" : ""} key={rule.key}><label className="scoring-toggle"><input type="checkbox" checked={rule.enabled} disabled={!rule.available} onChange={(event) => updateRule(rule.key, (current) => ({ ...current, enabled: event.target.checked }))} /><span /><div><strong>{rule.label}</strong><small>{rule.available ? rule.enabled ? "Incluida en el cálculo" : "Disponible · desactivada" : "La API no ofrece este dato"}</small></div></label><code>{rule.providerField}</code><label className="scoring-every"><input type="number" min="1" value={rule.every} disabled={!rule.available} onChange={(event) => updateRule(rule.key, (current) => ({ ...current, every: Math.max(1, Number(event.target.value)) }))} /></label>{(["POR", "DEF", "MED", "DEL"] as PlayerPosition[]).map((position) => <label className="scoring-point-input" key={position}><input type="number" step="0.5" value={rule.points[position]} disabled={!rule.available || !rule.enabled} onChange={(event) => updateRule(rule.key, (current) => ({ ...current, points: { ...current.points, [position]: Number(event.target.value) } }))} /></label>)}</article>)}</section>)}<footer className="scoring-admin-footer"><p><strong>Versionado obligatorio</strong><span>Los cambios se aplicarán a partidos futuros. Cada jornada conservará la versión con la que fue calculada.</span></p><button className="primary-button" onClick={() => notify("Reglas de puntuación guardadas para la siguiente jornada")}>Guardar nueva versión</button></footer></section>;
}

function LegalVersionsAdminPanel({ config, onPublish }: { config: LegalConfig; onPublish: (kind: "privacy" | "terms", changeSummary: string) => void }) {
  const [kind, setKind] = useState<"privacy" | "terms">("terms");
  const [changeSummary, setChangeSummary] = useState("");
  const [confirm, setConfirm] = useState(false);
  const privacy = config.privacyVersions.at(-1)!;
  const terms = config.termsVersions.at(-1)!;
  const selectedCurrent = kind === "privacy" ? privacy : terms;
  const history = [...config.privacyVersions.map((item) => ({ ...item, kind: "Privacidad" })), ...config.termsVersions.map((item) => ({ ...item, kind: "Condiciones" }))].sort((a, b) => b.publishedAt - a.publishedAt);
  function publish() {
    if (!changeSummary.trim()) return;
    onPublish(kind, changeSummary);
    setChangeSummary("");
    setConfirm(false);
  }
  return <section className="admin-panel legal-versions-admin"><div className="section-title"><div><p className="eyebrow">DOCUMENTOS LEGALES · CONTROL DE VERSIONES</p><h2>Privacidad y condiciones</h2><p>Cada publicación conserva su historial y obliga a aceptar la nueva versión antes de volver al juego.</p></div><span className="active-tag">AUDITABLE</span></div><div className="legal-current-grid"><article><span>P</span><div><small>POLÍTICA DE PRIVACIDAD</small><strong>Versión {privacy.version}</strong><p>{privacy.changeSummary}</p></div><a href={`${withBasePath("/privacy")}?version=${privacy.version}`} target="_blank" rel="noreferrer">Ver documento ↗</a></article><article><span>C</span><div><small>CONDICIONES GENERALES</small><strong>Versión {terms.version}</strong><p>{terms.changeSummary}</p></div><a href={`${withBasePath("/terms")}?version=${terms.version}`} target="_blank" rel="noreferrer">Ver documento ↗</a></article></div><div className="legal-admin-body"><section className="legal-version-history"><header><strong>Historial publicado</strong><span>{history.length} versiones</span></header>{history.map((item) => <article key={item.id}><span>{item.kind[0]}</span><div><strong>{item.kind} · v{item.version}</strong><small>{new Date(item.publishedAt).toLocaleDateString("es-ES")} · {item.changeSummary}</small></div><b>PUBLICADA</b></article>)}</section><section className="legal-version-editor"><p className="eyebrow">CREAR NUEVA VERSIÓN</p><div className="legal-kind-switch"><button className={kind === "terms" ? "active" : ""} onClick={() => { setKind("terms"); setConfirm(false); }}>Condiciones</button><button className={kind === "privacy" ? "active" : ""} onClick={() => { setKind("privacy"); setConfirm(false); }}>Privacidad</button></div><label><span>Resumen de cambios</span><textarea value={changeSummary} maxLength={240} onChange={(event) => { setChangeSummary(event.target.value); setConfirm(false); }} placeholder="Explica brevemente qué cambia para los usuarios" /></label><div className="legal-next-version"><span>Versión actual</span><strong>v{selectedCurrent.version}</strong><i>→</i><span>Nueva versión</span><strong>v{selectedCurrent.version + 1}</strong></div>{!confirm ? <button className="primary-button full" disabled={!changeSummary.trim()} onClick={() => setConfirm(true)}>Preparar publicación</button> : <article className="legal-publish-warning"><p><strong>La publicación es global</strong><small>Todos los usuarios deberán aceptar esta versión al iniciar o reanudar su sesión. La versión anterior no se modifica.</small></p><div><button onClick={() => setConfirm(false)}>Cancelar</button><button onClick={publish}>Publicar y solicitar aceptación</button></div></article>}</section></div></section>;
}

function OnboardingAdminPanel({ config, onForce }: { config: OnboardingConfig; onForce: (reason: string) => void }) {
  const [reason, setReason] = useState("Nuevas reglas de cierre, aplazamientos y jornadas adelantadas");
  const [confirm, setConfirm] = useState(false);
  return <section className="admin-panel onboarding-admin-panel"><div><p className="eyebrow">ACCESO Y PRIMERA EXPERIENCIA</p><h2>Onboarding de usuarios</h2><p>La guía se muestra tras el registro y queda completada por versión.</p></div><section><article><small>VERSIÓN ACTUAL</small><strong>v{config.version}</strong><span>5 pasos publicados</span></article><article><small>COBERTURA</small><strong>100%</strong><span>Nuevos registros</span></article><article><small>REPETICIÓN</small><strong>{config.forceReason ? "Programada" : "Solo una vez"}</strong><span>{config.forceReason || "Sin campaña activa"}</span></article></section><div className="onboarding-admin-flow"><span>Registro completado</span><i>→</i><span>Guía obligatoria</span><i>→</i><span>Versión guardada</span><i>→</i><span>Inicio del juego</span></div><label><span>Motivo que verá el usuario al repetir la guía</span><input value={reason} maxLength={120} onChange={(event) => setReason(event.target.value)} /></label><article className="onboarding-force-warning"><span>!</span><p><strong>Forzar una nueva versión</strong><small>Incrementa la versión global. Cada usuario volverá a verla una vez en su siguiente sesión, aunque hubiera completado versiones anteriores.</small></p>{!confirm ? <button onClick={() => setConfirm(true)}>Volver a mostrar a todos</button> : <div><button onClick={() => setConfirm(false)}>Cancelar</button><button onClick={() => { onForce(reason); setConfirm(false); }}>Confirmar nueva versión</button></div>}</article></section>;
}

function MatchdaySettlementAdminPanel({ rules, onChange, notify }: { rules: MatchdaySettlementRules; onChange: (rules: MatchdaySettlementRules) => void; notify: (value: string) => void }) {
  const examplePoints = 58;
  const examplePayout = Math.min(rules.maximumPayout, Math.max(rules.minimumPayout, examplePoints * rules.moneyPerPoint));
  return <section className="admin-panel settlement-admin-panel"><div className="section-title"><div><p className="eyebrow">CIERRE DE JORNADA · REGLAS GLOBALES</p><h2>Liquidación, calendario y activación</h2><p>Cada jornada conserva su propio estado aunque sus partidos cambien de fecha.</p></div><span className="active-tag">VERSIÓN 1</span></div><div className="settlement-process"><article className="done"><span>1</span><p><strong>Bloquear y puntuar</strong><small>Once inmutable y estadísticas finales.</small></p></article><i>→</i><article><span>2</span><p><strong>Resolver aplazados</strong><small>Esperar o liquidar provisionalmente.</small></p></article><i>→</i><article><span>3</span><p><strong>Abonar saldo</strong><small>Un movimiento económico único.</small></p></article><i>→</i><article><span>4</span><p><strong>Activar eventos</strong><small>Partidazos de la siguiente jornada.</small></p></article></div><div className="settlement-admin-grid"><article><p className="eyebrow">CONVERSIÓN ECONÓMICA</p><label><span>Millones por punto</span><div><input type="number" min="0" max="1" step="0.01" value={rules.moneyPerPoint} onChange={(event) => onChange({ ...rules, moneyPerPoint: Math.max(0, Number(event.target.value)) })} /><b>M</b></div></label><div className="settlement-limits"><label><span>Pago mínimo</span><input type="number" min="0" step="0.5" value={rules.minimumPayout} onChange={(event) => onChange({ ...rules, minimumPayout: Math.max(0, Number(event.target.value)) })} /></label><label><span>Pago máximo</span><input type="number" min="0" step="0.5" value={rules.maximumPayout} onChange={(event) => onChange({ ...rules, maximumPayout: Math.max(0, Number(event.target.value)) })} /></label></div><div className="settlement-example"><span>58 PTS</span><b>× {rules.moneyPerPoint.toFixed(2).replace(".", ",")} M</b><strong>= {examplePayout.toFixed(1).replace(".", ",")} M</strong></div></article><article><p className="eyebrow">PARTIDOS APLAZADOS</p><label><span>Margen para esperar</span><select value={rules.postponedGraceHours} onChange={(event) => onChange({ ...rules, postponedGraceHours: Number(event.target.value) })}><option value={24}>24 horas</option><option value={48}>48 horas</option><option value={72}>72 horas</option><option value={168}>7 días</option></select></label><label><span>Al terminar el margen</span><select value={rules.postponedPolicy} onChange={(event) => onChange({ ...rules, postponedPolicy: event.target.value as MatchdaySettlementRules["postponedPolicy"] })}><option value="provisional">Cierre provisional + ajuste posterior</option><option value="wait">Esperar a todos los partidos</option></select></label><small>Recomendado: cierre provisional para no detener la competición.</small></article><article><p className="eyebrow">PARTIDOS ADELANTADOS</p><label><span>Aviso mínimo esperado</span><select value={rules.advanceNoticeHours} onChange={(event) => onChange({ ...rules, advanceNoticeHours: Number(event.target.value) })}><option value={6}>6 horas</option><option value={12}>12 horas</option><option value={24}>24 horas</option><option value={48}>48 horas</option></select></label><div className="advance-policy-note"><span>⚡</span><p><strong>Bloqueo por jornada</strong><small>La alineación se congela al iniciar el primer partido asignado a esa jornada, aunque otra jornada siga en juego.</small></p></div></article></div><section className="settlement-fallback-rules"><div><span>M</span><p><strong>Ligas de mercado</strong><small>Último borrador válido → último once confirmado → once inicial válido.</small></p></div><div><span>F</span><p><strong>Ligas fantásticas</strong><small>Solo un equipo guardado. Sin equipo válido, la jornada puntúa cero.</small></p></div><div><span>P</span><p><strong>El Partidazo</strong><small>Once propio y cierre al comenzar su único encuentro.</small></p></div></section><button type="button" className={`fantasy-feature-toggle ${rules.activateNextFantasyEvents ? "active" : ""}`} onClick={() => onChange({ ...rules, activateNextFantasyEvents: !rules.activateNextFantasyEvents })}><span>{rules.activateNextFantasyEvents ? "✓" : ""}</span><p><strong>Activar automáticamente los Partidazos siguientes</strong><small>Al cerrar una jornada se congelan sus valores y se abren los eventos configurados para la siguiente.</small></p><b>{rules.activateNextFantasyEvents ? "ACTIVO" : "INACTIVO"}</b></button><footer><div><strong>Simulación de cierre · J4</strong><span>58 puntos → +{examplePayout.toFixed(1).replace(".", ",")} M · 2 Partidazos preparados para J5</span></div><button className="secondary-button" onClick={() => notify(`Simulación completada: +${examplePayout.toFixed(1).replace(".", ",")} M y eventos J5 activados`)}>Simular cierre</button><button className="primary-button" onClick={() => notify("Reglas de cierre guardadas para jornadas futuras")}>Guardar reglas</button></footer></section>;
}

function AchievementEconomyAdminPanel({ rules, onChange, notify }: { rules: EconomyRules; onChange: (rules: EconomyRules) => void; notify: (value: string) => void }) {
  return <article className="admin-panel economy-rules-admin"><div className="section-title compact"><div><p className="eyebrow">LOGROS Y MONEDAS</p><h2>Economía de recompensas</h2></div><span className="active-tag">SIMULADA</span></div><p className="admin-panel-intro">Controla las recompensas generales sin alterar el saldo deportivo de ninguna liga.</p><div className="economy-admin-summary"><span><strong>{achievementCatalog.length}</strong><small>logros</small></span><span><strong>{new Set(achievementCatalog.map((item) => item.category)).size}</strong><small>categorías</small></span><span><strong>{achievementCatalog.reduce((total, item) => total + item.coinReward, 0)}</strong><small>monedas base</small></span></div><div className="market-rule-controls"><label><span>Límite diario repetible</span><strong>{rules.dailyEarnCap} ◆</strong><input type="range" min="50" max="1000" step="25" value={rules.dailyEarnCap} onChange={(event) => onChange({ ...rules, dailyEarnCap: Number(event.target.value) })} /></label><label><span>Multiplicador de logros</span><strong>× {rules.achievementMultiplier.toFixed(1)}</strong><input type="range" min="0.5" max="2" step="0.1" value={rules.achievementMultiplier} onChange={(event) => onChange({ ...rules, achievementMultiplier: Number(event.target.value) })} /></label><label><span>Acceso diario</span><strong>{rules.dailyLoginReward} ◆</strong><input type="range" min="0" max="100" step="5" value={rules.dailyLoginReward} onChange={(event) => onChange({ ...rules, dailyLoginReward: Number(event.target.value) })} /></label><label><span>Alineación semanal</span><strong>{rules.weeklyLineupReward} ◆</strong><input type="range" min="0" max="250" step="5" value={rules.weeklyLineupReward} onChange={(event) => onChange({ ...rules, weeklyLineupReward: Number(event.target.value) })} /></label><label><span>Juego limpio semanal</span><strong>{rules.fairPlayReward} ◆</strong><input type="range" min="0" max="200" step="5" value={rules.fairPlayReward} onChange={(event) => onChange({ ...rules, fairPlayReward: Number(event.target.value) })} /></label></div><article className="admin-fantasy-validation"><span>!</span><p><strong>Recompensa única y auditable</strong><small>El backend usará una clave única por usuario, periodo y acción para impedir dobles cobros.</small></p></article><button className="primary-button full" onClick={() => notify("Reglas de logros y monedas guardadas")}>Guardar economía</button></article>;
}

function ClubRulesAdminPanel({ rules, onChange, notify }: { rules: ClubRules; onChange: (rules: ClubRules) => void; notify: (value: string) => void }) {
  return <article className="admin-panel club-rules-admin"><div className="section-title compact"><div><p className="eyebrow">CLUBES Y RANKING</p><h2>Límites competitivos</h2></div><span className="active-tag">GLOBAL</span></div><p className="admin-panel-intro">Controla cuántos equipos puede mantener un club y cómo se calcula su clasificación.</p><div className="club-rule-controls"><label><span><strong>Equipos activos por club</strong><b>{rules.maxActiveTeams}</b></span><input type="range" min="3" max="25" value={rules.maxActiveTeams} onChange={(event) => onChange({ ...rules, maxActiveTeams: Number(event.target.value) })} /><small>Las ligas finalizadas liberan plaza.</small></label><label><span><strong>Resultados que puntúan</strong><b>Mejores {rules.maxRankingResults}</b></span><input type="range" min="1" max="10" value={rules.maxRankingResults} onChange={(event) => onChange({ ...rules, maxRankingResults: Number(event.target.value) })} /><small>Evita premiar simplemente participar más.</small></label><label><span><strong>Desbloquear plaza extra</strong><b>{rules.extraTeamSlotCost} ◆</b></span><input type="range" min="0" max="1000" step="50" value={rules.extraTeamSlotCost} onChange={(event) => onChange({ ...rules, extraTeamSlotCost: Number(event.target.value) })} /><small>Coste simulado por ampliación.</small></label></div><button className={`fantasy-feature-toggle ${!rules.singleMatchEventsConsumeSlot ? "active" : ""}`} onClick={() => onChange({ ...rules, singleMatchEventsConsumeSlot: !rules.singleMatchEventsConsumeSlot })}><span>{!rules.singleMatchEventsConsumeSlot ? "✓" : ""}</span><p><strong>Partidazos sin ocupar plaza</strong><small>Los eventos de un solo encuentro quedan fuera del límite activo.</small></p></button><button className="primary-button full" onClick={() => notify("Reglas de clubes y ranking guardadas")}>Guardar reglas de clubes</button></article>;
}

function MarketRulesAdminPanel({ rules, onChange, notify }: { rules: MarketRules; onChange: (rules: MarketRules) => void; notify: (value: string) => void }) {
  function update<K extends keyof MarketRules>(key: K, value: MarketRules[K]) { onChange({ ...rules, [key]: value }); }
  return <article className="admin-panel market-rules-admin"><div className="section-title compact"><div><p className="eyebrow">REGLAS DE PUJAS</p><h2>Mercado de ligas</h2></div><span className="active-tag">Aplicadas</span></div><p className="algorithm-description">Estos límites se validarán de nuevo en el backend al crear una puja y al resolver cada renovación.</p><div className="market-rule-controls"><label><span>Deuda máxima</span><strong>{rules.maxDebtPercent}% del saldo</strong><input type="range" min="0" max="50" step="5" value={rules.maxDebtPercent} onChange={(event) => update("maxDebtPercent", Number(event.target.value))} /></label><label><span>Jugadores en banquillo</span><strong>{rules.maxBenchPlayers} máximo</strong><input type="range" min="5" max="30" value={rules.maxBenchPlayers} onChange={(event) => update("maxBenchPlayers", Number(event.target.value))} /></label><label><span>Renovación del mercado</span><strong>Cada {rules.renewalHours} horas</strong><select value={rules.renewalHours} onChange={(event) => update("renewalHours", Number(event.target.value))}><option value={12}>12 horas</option><option value={24}>24 horas</option><option value={48}>48 horas</option></select></label><label><span>Presupuesto fantástico por jornada</span><strong>{rules.fantasyMatchdayBudget} M</strong><input type="range" min="50" max="200" step="5" value={rules.fantasyMatchdayBudget} onChange={(event) => update("fantasyMatchdayBudget", Number(event.target.value))} /></label></div><button className="primary-button" onClick={() => notify("Reglas de pujas guardadas para todas las ligas")}>Guardar reglas</button></article>;
}

function FantasyRulesAdminPanel({ rules, onChange, notify }: { rules: MarketRules; onChange: (rules: MarketRules) => void; notify: (value: string) => void }) {
  const options: { key: keyof Pick<MarketRules, "fantasyAllowCopyPrevious" | "fantasyAllowRandomWithinBudget" | "fantasyAllowRandomUnlimited" | "fantasyAllowClear">; label: string; description: string }[] = [
    { key: "fantasyAllowCopyPrevious", label: "Copiar jornada anterior", description: "Permite reutilizar voluntariamente el último once válido." },
    { key: "fantasyAllowRandomWithinBudget", label: "Aleatorio con presupuesto", description: "Genera un once completo que nunca supera el saldo." },
    { key: "fantasyAllowRandomUnlimited", label: "Aleatorio sin límite", description: "Permite generar un borrador por encima del saldo, pero no guardarlo." },
    { key: "fantasyAllowClear", label: "Vaciar equipo", description: "Devuelve el borrador a cero jugadores y saldo completo." },
  ];
  return <article className="admin-panel fantasy-rules-admin"><div className="section-title compact"><div><p className="eyebrow">LIGAS FANTÁSTICAS</p><h2>Herramientas de creación</h2></div><span className="active-tag">Globales</span></div><p className="algorithm-description">Define qué ayudas están disponibles para preparar el once de cada jornada.</p><div className="fantasy-admin-option-list">{options.map((option) => <button className={rules[option.key] ? "active" : ""} key={option.key} onClick={() => onChange({ ...rules, [option.key]: !rules[option.key] })}><span>{rules[option.key] ? "✓" : ""}</span><p><strong>{option.label}</strong><small>{option.description}</small></p><b>{rules[option.key] ? "ACTIVA" : "INACTIVA"}</b></button>)}</div><article className="admin-fantasy-validation"><span>!</span><p><strong>El presupuesto siempre se valida al guardar</strong><small>Aunque se permita generar sin límite, el usuario debe ajustar su once antes del cierre.</small></p></article><button className="primary-button" onClick={() => notify("Herramientas fantásticas guardadas para la siguiente jornada abierta")}>Guardar configuración</button></article>;
}

function MarketAlgorithmAdminPanel({ notify }: { notify: (value: string) => void }) {
  const [config, setConfig] = useState<MarketValueConfig>(defaultMarketValueConfig);
  function update<K extends keyof MarketValueConfig>(key: K, value: MarketValueConfig[K]) { setConfig((current) => ({ ...current, [key]: value })); }
  return <article className="admin-panel algorithm-admin"><div className="section-title compact"><div><p className="eyebrow">ALGORITMO GLOBAL</p><h2>Valores de mercado</h2></div><button className={`algorithm-freeze ${config.frozen ? "active" : ""}`} onClick={() => update("frozen", !config.frozen)}>{config.frozen ? "Congelado" : "En funcionamiento"}</button></div><p className="algorithm-description">Una configuración común calcula el mismo valor para todas las ligas. Los cambios se publican por lotes cada 6 horas.</p><div className="algorithm-controls"><label><span>Ventana de actividad <b>{config.windowHours} h</b></span><select value={config.windowHours} onChange={(event) => update("windowHours", Number(event.target.value))}><option value={24}>24 horas</option><option value={72}>72 horas</option><option value={168}>7 días</option></select></label><label><span>Sensibilidad <b>{Math.round(config.sensitivity * 100)} %</b></span><input type="range" min="1" max="20" value={config.sensitivity * 100} onChange={(event) => update("sensitivity", Number(event.target.value) / 100)} /></label><label><span>Cambio máximo por cálculo <b>±{config.maxChangePercent} %</b></span><input type="range" min="1" max="12" value={config.maxChangePercent} onChange={(event) => update("maxChangePercent", Number(event.target.value))} /></label><label><span>Muestra mínima <b>{config.minimumDistinctLeagues} ligas</b></span><input type="range" min="2" max="30" value={config.minimumDistinctLeagues} onChange={(event) => update("minimumDistinctLeagues", Number(event.target.value))} /></label></div><div className="algorithm-weights"><p className="eyebrow">PESO DE LAS SEÑALES</p>{[["Demanda", "demandWeight"], ["Altas netas", "netTransfersWeight"], ["Prima de pujas", "bidPremiumWeight"]] .map(([label, key]) => <label key={key}><span>{label}</span><input type="range" min="0" max="100" value={Math.round(config[key as keyof MarketValueConfig] as number * 100)} onChange={(event) => update(key as "demandWeight" | "netTransfersWeight" | "bidPremiumWeight", Number(event.target.value) / 100)} /><b>{Math.round(config[key as keyof MarketValueConfig] as number * 100)} %</b></label>)}</div><div className="algorithm-footer"><div><span>Valor mínimo <strong>{config.minimumValue.toFixed(1).replace(".", ",")} M</strong></span><span>Redondeo <strong>{config.roundingStep.toFixed(1).replace(".", ",")} M</strong></span><span>Publicación <strong>Cada 6 h</strong></span></div><button className="primary-button" onClick={() => notify("Configuración del algoritmo guardada para la próxima base de datos")}>Guardar configuración</button></div></article>;
}
