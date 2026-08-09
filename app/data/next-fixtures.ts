import type { CompetitionName } from "./contracts";

export interface NextFixture {
  competition: CompetitionName;
  club: string;
  opponent: string;
  venue: "Casa" | "Visitante";
  dateLabel: string;
  matchday: number;
}

const fixtures: NextFixture[] = [
  { competition: "Primera", club: "Real Madrid", opponent: "Real Sociedad", venue: "Casa", dateLabel: "Mié 26 ago · 21:00", matchday: 1 },
  { competition: "Primera", club: "FC Barcelona", opponent: "Athletic Club", venue: "Casa", dateLabel: "Jue 27 ago · 21:00", matchday: 1 },
  { competition: "Primera", club: "Athletic Club", opponent: "FC Barcelona", venue: "Visitante", dateLabel: "Jue 27 ago · 21:00", matchday: 1 },
  { competition: "Segunda", club: "UD Las Palmas", opponent: "Albacete BP", venue: "Casa", dateLabel: "Dom 16 ago · 21:30", matchday: 1 },
  { competition: "Segunda", club: "UD Almería", opponent: "CD Eldense", venue: "Casa", dateLabel: "Lun 17 ago · 21:30", matchday: 1 },
  { competition: "Segunda", club: "Real Sporting", opponent: "CE Sabadell", venue: "Casa", dateLabel: "Lun 17 ago · 19:00", matchday: 1 },
  { competition: "Segunda", club: "Real Valladolid", opponent: "RCD Mallorca", venue: "Visitante", dateLabel: "Sáb 15 ago · 21:30", matchday: 1 },
  { competition: "Segunda", club: "CD Castellón", opponent: "R. Sociedad B", venue: "Visitante", dateLabel: "Vie 14 ago · 20:30", matchday: 1 },
  { competition: "Liga F", club: "FC Barcelona", opponent: "Costa Adeje Tenerife", venue: "Casa", dateLabel: "Dom 30 ago", matchday: 1 },
  { competition: "Liga F", club: "Real Madrid CF", opponent: "Atlético de Madrid", venue: "Casa", dateLabel: "Dom 30 ago", matchday: 1 },
];

export function getNextFixture(competition: CompetitionName, club?: string) {
  return fixtures.find((fixture) => fixture.competition === competition && fixture.club === club);
}

