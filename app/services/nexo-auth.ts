import type { CompetitionName, FantasyTeamSummary } from "../data";
import { getSupabaseClient } from "../lib/supabase-client";

export type NexoAuthUser = {
  id: string;
  displayName: string;
  email: string;
  initials: string;
  role: "admin" | "user";
};

export type NexoRegistration = {
  email: string;
  password: string;
  username: string;
  displayName: string;
  country: string;
  favoriteCompetition: CompetitionName;
};

export type NexoIdentity = {
  user: NexoAuthUser;
  coins: number;
  onboardingVersion: number;
  activeClubId: string | null;
  teams: FantasyTeamSummary[];
};

const competitionIds: Record<CompetitionName, string> = {
  Primera: "primera",
  Segunda: "segunda",
  "Liga F": "liga_f",
};

const competitionNames: Record<string, CompetitionName> = {
  primera: "Primera",
  segunda: "Segunda",
  liga_f: "Liga F",
};

const competitionUiIds: Record<string, string> = {
  primera: "comp_primera",
  segunda: "comp_segunda",
  liga_f: "comp_liga_f",
};

function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase todavía no está configurado en este entorno.");
  return client;
}

function nexoAppRootUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${basePath}/`;
}

export async function loadNexoIdentity(): Promise<NexoIdentity | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return null;

  const [{ data: profile, error: profileError }, { data: teamRows, error: teamsError }] = await Promise.all([
    client.from("profiles").select("id,email,display_name,initials,role,coins,onboarding_version,active_club_id").eq("id", authData.user.id).single(),
    client.from("teams").select("id,name,short_name,competition_id").eq("owner_id", authData.user.id).eq("active", true).order("created_at"),
  ]);
  if (profileError) throw profileError;
  if (teamsError) throw teamsError;

  return {
    user: {
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      initials: profile.initials,
      role: profile.role,
    },
    coins: profile.coins,
    onboardingVersion: profile.onboarding_version,
    activeClubId: profile.active_club_id,
    teams: (teamRows ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.short_name,
      competitionId: competitionUiIds[team.competition_id] ?? team.competition_id,
      competition: competitionNames[team.competition_id] ?? "Primera",
    })),
  };
}

export async function signInToNexo(email: string, password: string): Promise<NexoIdentity> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "El correo o la contraseña no son correctos." : error.message);
  const identity = await loadNexoIdentity();
  if (!identity) throw new Error("No se ha podido cargar tu perfil.");
  return identity;
}

export async function registerInNexo(input: NexoRegistration): Promise<{ identity: NexoIdentity | null; confirmationRequired: boolean }> {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: nexoAppRootUrl(),
      data: {
        username: input.username,
        display_name: input.displayName,
        country: input.country,
        favorite_competition_id: competitionIds[input.favoriteCompetition],
        accepted_legal: true,
      },
    },
  });
  if (error) throw new Error(error.message);
  if (!data.session) return { identity: null, confirmationRequired: true };
  return { identity: await loadNexoIdentity(), confirmationRequired: false };
}

export async function sendNexoPasswordReset(email: string): Promise<void> {
  const client = requireClient();
  const redirectTo = nexoAppRootUrl();
  const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
  if (error) throw new Error(error.message);
}

export async function signOutFromNexo(): Promise<void> {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
}

export async function completeNexoOnboarding(version: number): Promise<void> {
  const client = getSupabaseClient();
  if (client) await client.rpc("complete_my_onboarding", { new_version: version });
}

export async function acceptNexoLegalDocuments(): Promise<void> {
  const client = getSupabaseClient();
  if (client) await client.rpc("accept_current_legal");
}

export async function createNexoTeam(input: { clubId: string; name: string; shortName: string; competition: CompetitionName }): Promise<FantasyTeamSummary> {
  const client = requireClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw new Error("Tu sesión ha caducado.");
  const competitionId = competitionIds[input.competition];
  const { data, error } = await client.from("teams").insert({
    club_id: input.clubId,
    owner_id: authData.user.id,
    competition_id: competitionId,
    name: input.name,
    short_name: input.shortName,
  }).select("id,name,short_name,competition_id").single();
  if (error) throw error;
  return { id: data.id, name: data.name, shortName: data.short_name, competitionId: competitionUiIds[data.competition_id] ?? data.competition_id, competition: input.competition };
}
