import type { FantasyBootstrapData, FantasyRepository } from "./contracts";

const demoData: FantasyBootstrapData = {
  user: {
    id: "usr_demo_beto",
    displayName: "Beto",
    initials: "BC",
    coins: 2480,
  },
  activeTeamId: "team_barrio_xi",
  competitions: [
    { id: "comp_primera", name: "Primera", displayName: "Primera División", enabled: true },
    { id: "comp_segunda", name: "Segunda", displayName: "Segunda División", enabled: true },
    { id: "comp_liga_f", name: "Liga F", displayName: "Liga F", enabled: true },
  ],
  teams: [
    { id: "team_barrio_xi", name: "Barrio XI", shortName: "XI", competitionId: "comp_primera", competition: "Primera" },
    { id: "team_distrito_90", name: "Distrito 90", shortName: "D9", competitionId: "comp_primera", competition: "Primera" },
    { id: "team_norte_1905", name: "Norte 1905", shortName: "N05", competitionId: "comp_segunda", competition: "Segunda" },
    { id: "team_fenix_f", name: "Fénix F", shortName: "FF", competitionId: "comp_liga_f", competition: "Liga F" },
  ],
  leagues: [
    { id: "league_primera_publica", name: "Primera Abierta", competitionId: "comp_primera", competition: "Primera", mode: "market", rosterPolicy: "exclusive", type: "Pública · Mercado", rank: "12.º", members: "16/16", accent: "blue" },
    { id: "league_primera_privada", name: "Los del barrio", competitionId: "comp_primera", competition: "Primera", mode: "market", rosterPolicy: "exclusive", type: "Privada · Mercado", rank: "3.º", members: "8/10", accent: "lime" },
    { id: "league_primera_fantasy", name: "Fantástica Primera", competitionId: "comp_primera", competition: "Primera", mode: "fantasy", rosterPolicy: "repeatable", type: "Fantástica · Presupuesto", rank: "6.º", members: "14/16", accent: "violet" },
    { id: "league_segunda_publica", name: "Segunda Abierta", competitionId: "comp_segunda", competition: "Segunda", mode: "market", rosterPolicy: "exclusive", type: "Pública · Mercado", rank: "9.º", members: "12/16", accent: "blue" },
    { id: "league_segunda_privada", name: "La Peña de Plata", competitionId: "comp_segunda", competition: "Segunda", mode: "market", rosterPolicy: "exclusive", type: "Privada · Mercado", rank: "2.º", members: "7/10", accent: "lime" },
    { id: "league_segunda_fantasy", name: "Fantástica Segunda", competitionId: "comp_segunda", competition: "Segunda", mode: "fantasy", rosterPolicy: "repeatable", type: "Fantástica · Presupuesto", rank: "5.º", members: "11/16", accent: "violet" },
    { id: "league_f_publica", name: "Liga F Abierta", competitionId: "comp_liga_f", competition: "Liga F", mode: "market", rosterPolicy: "exclusive", type: "Pública · Mercado", rank: "8.º", members: "14/16", accent: "blue" },
    { id: "league_f_privada", name: "Reinas del Fútbol", competitionId: "comp_liga_f", competition: "Liga F", mode: "market", rosterPolicy: "exclusive", type: "Privada · Mercado", rank: "1.º", members: "9/10", accent: "lime" },
    { id: "league_f_fantasy", name: "Fantástica Liga F", competitionId: "comp_liga_f", competition: "Liga F", mode: "fantasy", rosterPolicy: "repeatable", type: "Fantástica · Presupuesto", rank: "4.º", members: "13/16", accent: "violet" },
  ],
  publicLeagues: [
    { id: "public_primera_01", name: "Primera Abierta 01", competitionId: "comp_primera", competition: "Primera", mode: "market", rosterPolicy: "exclusive", memberCount: 12, capacity: 16, startingBudget: 100, targetSquadValue: 104, accent: "lime" },
    { id: "public_segunda_01", name: "Segunda de Acero", competitionId: "comp_segunda", competition: "Segunda", mode: "market", rosterPolicy: "exclusive", memberCount: 7, capacity: 12, startingBudget: 100, targetSquadValue: 104, accent: "blue" },
    { id: "public_liga_f_01", name: "Liga F Total", competitionId: "comp_liga_f", competition: "Liga F", mode: "market", rosterPolicy: "exclusive", memberCount: 9, capacity: 14, startingBudget: 100, targetSquadValue: 104, accent: "violet" },
    { id: "fantasy_primera_open", name: "Fantástica Global Primera", competitionId: "comp_primera", competition: "Primera", mode: "fantasy", rosterPolicy: "repeatable", memberCount: 184, capacity: 500, startingBudget: 100, targetSquadValue: 100, accent: "violet" },
    { id: "fantasy_segunda_open", name: "Fantástica Global Segunda", competitionId: "comp_segunda", competition: "Segunda", mode: "fantasy", rosterPolicy: "repeatable", memberCount: 96, capacity: 500, startingBudget: 100, targetSquadValue: 100, accent: "blue" },
    { id: "fantasy_liga_f_open", name: "Fantástica Global Liga F", competitionId: "comp_liga_f", competition: "Liga F", mode: "fantasy", rosterPolicy: "repeatable", memberCount: 123, capacity: 500, startingBudget: 100, targetSquadValue: 100, accent: "lime" },
  ],
  participations: [
    { id: "entry_primera_publica", leagueId: "league_primera_publica", teamId: "team_barrio_xi", rosterId: "roster_primera_publica", budget: 11.6 },
    { id: "entry_primera_privada", leagueId: "league_primera_privada", teamId: "team_barrio_xi", rosterId: "roster_primera_privada", budget: 11.6 },
    { id: "entry_primera_fantasy", leagueId: "league_primera_fantasy", teamId: "team_barrio_xi", rosterId: "roster_primera_fantasy", budget: 100 },
    { id: "entry_segunda_publica", leagueId: "league_segunda_publica", teamId: "team_norte_1905", rosterId: "roster_segunda_publica", budget: 14.2 },
    { id: "entry_segunda_privada", leagueId: "league_segunda_privada", teamId: "team_norte_1905", rosterId: "roster_segunda_privada", budget: 14.2 },
    { id: "entry_segunda_fantasy", leagueId: "league_segunda_fantasy", teamId: "team_norte_1905", rosterId: "roster_segunda_fantasy", budget: 100 },
    { id: "entry_f_publica", leagueId: "league_f_publica", teamId: "team_fenix_f", rosterId: "roster_f_publica", budget: 12.8 },
    { id: "entry_f_privada", leagueId: "league_f_privada", teamId: "team_fenix_f", rosterId: "roster_f_privada", budget: 12.8 },
    { id: "entry_f_fantasy", leagueId: "league_f_fantasy", teamId: "team_fenix_f", rosterId: "roster_f_fantasy", budget: 100 },
  ],
  marketPlayers: [
    { id: "player_mateo_rios", initials: "MR", name: "Mateo Ríos", clubId: "club_costa", club: "Costa CF", position: "DEL", points: 42, price: 12.4, trend: "+0,6 M" },
    { id: "player_adrian_beltran", initials: "AB", name: "Adrián Beltrán", clubId: "club_union_norte", club: "Unión Norte", position: "MED", points: 38, price: 9.8, trend: "+0,3 M" },
    { id: "player_leo_navarro", initials: "LN", name: "Leo Navarro", clubId: "club_atletico_sur", club: "Atlético Sur", position: "DEF", points: 35, price: 7.1, trend: "+0,2 M" },
    { id: "player_sara_campos", initials: "SC", name: "Sara Campos", clubId: "club_marina_f", club: "Marina F", position: "MED", points: 47, price: 10.6, trend: "+0,8 M" },
    { id: "player_irene_gil", initials: "IG", name: "Irene Gil", clubId: "club_capital_f", club: "Capital F", position: "DEL", points: 44, price: 11.2, trend: "+0,5 M" },
  ],
  lineup: {
    forwards: [
      { id: "player_mateo_rios", name: "M. Ríos", value: "12,4 M", initials: "MR" },
      { id: "player_diego_soler", name: "D. Soler", value: "8,1 M", initials: "DS" },
      { id: "player_nico_vela", name: "N. Vela", value: "10,7 M", initials: "NV" },
    ],
    midfielders: [
      { id: "player_adrian_beltran", name: "A. Beltrán", value: "9,8 M", initials: "AB" },
      { id: "player_ivan_cruz", name: "I. Cruz", value: "6,5 M", initials: "IC" },
      { id: "player_javi_mena", name: "J. Mena", value: "7,9 M", initials: "JM" },
      { id: "player_pablo_rey", name: "P. Rey", value: "5,2 M", initials: "PR" },
    ],
    defenders: [
      { id: "player_leo_navarro", name: "L. Navarro", value: "7,1 M", initials: "LN" },
      { id: "player_raul_sanz", name: "R. Sanz", value: "4,8 M", initials: "RS" },
      { id: "player_toni_vidal", name: "T. Vidal", value: "6,3 M", initials: "TV" },
    ],
    goalkeeper: [{ id: "player_alex_sierra", name: "Á. Sierra", value: "3,9 M", initials: "AS" }],
  },
  rules: {
    freeTeamsPerCompetition: 3,
    additionalTeamCost: 500,
  },
};

export const demoFantasyRepository: FantasyRepository = {
  async getBootstrap() {
    return structuredClone(demoData);
  },
};
