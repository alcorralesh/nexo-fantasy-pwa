export type CompetitionName = "Primera" | "Segunda" | "Liga F";
export type PlayerPosition = "POR" | "DEF" | "MED" | "DEL";
export type LeagueMode = "market" | "fantasy";
export type RosterPolicy = "exclusive" | "repeatable";

export interface CompetitionSummary {
  id: string;
  name: CompetitionName;
  displayName: string;
  enabled: boolean;
}

export interface FantasyTeamSummary {
  id: string;
  name: string;
  shortName: string;
  competitionId: string;
  competition: CompetitionName;
}

export interface LeagueSummary {
  id: string;
  name: string;
  competitionId: string;
  competition: CompetitionName;
  mode: LeagueMode;
  rosterPolicy: RosterPolicy;
  type: string;
  rank: string;
  members: string;
  accent: "lime" | "blue" | "violet";
}

export interface PublicLeagueSummary {
  id: string;
  name: string;
  competitionId: string;
  competition: CompetitionName;
  mode: LeagueMode;
  rosterPolicy: RosterPolicy;
  memberCount: number;
  capacity: number;
  startingBudget: number;
  targetSquadValue: number;
  accent: "lime" | "blue" | "violet";
}

export interface LeagueParticipation {
  id: string;
  leagueId: string;
  teamId: string;
  rosterId: string;
  budget: number;
}

export interface InitialSquadPlayer {
  id: string;
  name: string;
  initials: string;
  position: PlayerPosition;
  value: number;
  club?: string;
  photoUrl?: string;
  availabilityStatus?: "active" | "out_of_competition" | "changed_competition";
}

export interface InitialSquad {
  formation: "4-4-2";
  players: InitialSquadPlayer[];
  startingPlayerIds: string[];
  benchPlayerIds: string[];
  totalValue: number;
  targetValue: number;
}

export interface MarketPlayer {
  id: string;
  initials: string;
  name: string;
  clubId: string;
  club: string;
  position: PlayerPosition;
  points: number;
  price: number;
  trend: string;
  photoUrl?: string;
  availabilityStatus?: "active" | "out_of_competition";
}

export interface LineupPlayer {
  id: string;
  name: string;
  value: string;
  initials: string;
}

export interface LineupData {
  forwards: LineupPlayer[];
  midfielders: LineupPlayer[];
  defenders: LineupPlayer[];
  goalkeeper: LineupPlayer[];
}

export interface FantasyBootstrapData {
  user: {
    id: string;
    displayName: string;
    initials: string;
    coins: number;
  };
  activeTeamId: string;
  competitions: CompetitionSummary[];
  teams: FantasyTeamSummary[];
  leagues: LeagueSummary[];
  publicLeagues: PublicLeagueSummary[];
  participations: LeagueParticipation[];
  marketPlayers: MarketPlayer[];
  lineup: LineupData;
  rules: {
    freeTeamsPerCompetition: number;
    additionalTeamCost: number;
  };
}

export interface FantasyRepository {
  getBootstrap(userId?: string): Promise<FantasyBootstrapData>;
}
