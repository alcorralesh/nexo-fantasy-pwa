import type { CompetitionName, InitialSquadPlayer, PlayerPosition } from "./contracts";

export interface CompetitionPlayer extends InitialSquadPlayer {
  competition: CompetitionName;
  club: string;
  catalogVersion: "2026-08-08";
}

type Seed = [name: string, position: PlayerPosition, club: string, value: number];

const seeds: Record<CompetitionName, Seed[]> = {
  Primera: [
    ["Thibaut Courtois", "POR", "Real Madrid", 6.2], ["Joan García", "POR", "FC Barcelona", 5.6], ["Unai Simón", "POR", "Athletic Club", 5.1],
    ["Trent Alexander-Arnold", "DEF", "Real Madrid", 7.2], ["Dean Huijsen", "DEF", "Real Madrid", 6.8], ["Éder Militão", "DEF", "Real Madrid", 6.4], ["Antonio Rüdiger", "DEF", "Real Madrid", 6.0], ["Jules Koundé", "DEF", "FC Barcelona", 6.7], ["Ronald Araújo", "DEF", "FC Barcelona", 6.3], ["Pau Cubarsí", "DEF", "FC Barcelona", 6.6], ["Alejandro Balde", "DEF", "FC Barcelona", 5.9],
    ["Jude Bellingham", "MED", "Real Madrid", 8.0], ["Federico Valverde", "MED", "Real Madrid", 7.7], ["Eduardo Camavinga", "MED", "Real Madrid", 6.8], ["Aurélien Tchouaméni", "MED", "Real Madrid", 6.9], ["Arda Güler", "MED", "Real Madrid", 7.3], ["Pedri", "MED", "FC Barcelona", 8.1], ["Frenkie de Jong", "MED", "FC Barcelona", 7.0], ["Gavi", "MED", "FC Barcelona", 6.9],
    ["Kylian Mbappé", "DEL", "Real Madrid", 9.4], ["Vinícius Júnior", "DEL", "Real Madrid", 8.8], ["Lamine Yamal", "DEL", "FC Barcelona", 9.3], ["Raphinha", "DEL", "FC Barcelona", 8.1], ["Ferran Torres", "DEL", "FC Barcelona", 6.8], ["Robert Lewandowski", "DEL", "FC Barcelona", 7.3],
  ],
  Segunda: [
    ["Dinko Horkaš", "POR", "UD Las Palmas", 4.9], ["Fernando Martínez", "POR", "UD Almería", 4.8], ["Rubén Yáñez", "POR", "Real Sporting", 4.7],
    ["Álex Muñoz", "DEF", "UD Las Palmas", 5.4], ["Mika Mármol", "DEF", "UD Las Palmas", 5.8], ["Marvin Park", "DEF", "UD Las Palmas", 5.3], ["Chumi", "DEF", "UD Almería", 5.5], ["Edgar González", "DEF", "UD Almería", 5.7], ["Guille Rosas", "DEF", "Real Sporting", 5.4], ["Javi Sánchez", "DEF", "Real Valladolid", 5.6], ["Lucas Rosa", "DEF", "Real Valladolid", 5.3],
    ["Kirian Rodríguez", "MED", "UD Las Palmas", 6.9], ["Manu Fuster", "MED", "UD Las Palmas", 6.6], ["Sergio Arribas", "MED", "UD Almería", 7.1], ["Gonzalo Melero", "MED", "UD Almería", 6.1], ["Víctor Meseguer", "MED", "Real Valladolid", 6.2], ["Mario Martín", "MED", "Real Valladolid", 6.0], ["Nacho Martín", "MED", "Real Sporting", 5.9], ["Gaspar Campos", "MED", "Real Sporting", 6.2],
    ["Jesé Rodríguez", "DEL", "UD Las Palmas", 6.4], ["Leo Baptistao", "DEL", "UD Almería", 6.7], ["Jonathan Dubasin", "DEL", "Real Sporting", 6.5], ["Juan Otero", "DEL", "Real Sporting", 6.2], ["Marcos André", "DEL", "Real Valladolid", 6.1], ["Álex Calatrava", "DEL", "CD Castellón", 6.3],
  ],
  "Liga F": [
    ["Cata Coll", "POR", "FC Barcelona", 5.7], ["Gemma Font", "POR", "FC Barcelona", 4.8], ["Merle Frohms", "POR", "Real Madrid CF", 5.4],
    ["Irene Paredes", "DEF", "FC Barcelona", 6.5], ["Marta Torrejón", "DEF", "FC Barcelona", 6.1], ["Mapi León", "DEF", "FC Barcelona", 6.8], ["Ona Batlle", "DEF", "FC Barcelona", 6.7], ["Laia Aleixandri", "DEF", "FC Barcelona", 6.4], ["Esmee Brugts", "DEF", "FC Barcelona", 6.2], ["Maëlle Lakrar", "DEF", "Real Madrid CF", 6.3], ["María Méndez", "DEF", "Real Madrid CF", 6.0],
    ["Alexia Putellas", "MED", "FC Barcelona", 8.2], ["Patri Guijarro", "MED", "FC Barcelona", 7.5], ["Aitana Bonmatí", "MED", "FC Barcelona", 8.8], ["Vicky López", "MED", "FC Barcelona", 7.0], ["Sydney Schertenleib", "MED", "FC Barcelona", 6.2], ["Andreia Jacinto", "MED", "Real Madrid CF", 6.4], ["Sara Däbritz", "MED", "Real Madrid CF", 6.7], ["Sandie Toletti", "MED", "Real Madrid CF", 6.6],
    ["Ewa Pajor", "DEL", "FC Barcelona", 8.5], ["Caroline Graham Hansen", "DEL", "FC Barcelona", 8.4], ["Claudia Pina", "DEL", "FC Barcelona", 7.6], ["Salma Paralluelo", "DEL", "FC Barcelona", 7.8], ["Linda Caicedo", "DEL", "Real Madrid CF", 7.9], ["Athenea del Castillo", "DEL", "Real Madrid CF", 7.2],
  ],
};

function idFor(competition: CompetitionName, name: string) {
  return `${competition}_${name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export const competitionPlayers: Record<CompetitionName, CompetitionPlayer[]> = Object.fromEntries(
  Object.entries(seeds).map(([competition, players]) => [competition, players.map(([name, position, club, value]) => ({
    id: idFor(competition as CompetitionName, name),
    name,
    initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    position,
    club,
    value,
    competition: competition as CompetitionName,
    catalogVersion: "2026-08-08" as const,
  }))]),
) as Record<CompetitionName, CompetitionPlayer[]>;

export const competitionCatalogSummary = [
  { competition: "Primera" as const, players: competitionPlayers.Primera.length, status: "Provisional hasta cierre de mercado" },
  { competition: "Segunda" as const, players: competitionPlayers.Segunda.length, status: "Provisional hasta cierre de mercado" },
  { competition: "Liga F" as const, players: competitionPlayers["Liga F"].length, status: "Plantillas oficiales disponibles" },
];

