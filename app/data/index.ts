import type { FantasyRepository } from "./contracts";
import { demoFantasyRepository } from "./demo-repository";

// Este es el único punto que cambiará cuando conectemos Supabase.
export const fantasyRepository: FantasyRepository = demoFantasyRepository;

export type {
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
} from "./contracts";
