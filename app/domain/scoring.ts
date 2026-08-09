import type { PlayerPosition } from "../data";

export type ScoringStatKey = "played" | "played60" | "goal" | "assist" | "cleanSheet" | "save" | "penaltySaved" | "goalsConceded" | "yellowCard" | "redCard" | "ownGoal" | "penaltyMissed" | "tackleWon" | "interception" | "keyPass" | "bigChanceCreated" | "playerOfMatch";

export type ScoringRule = {
  key: ScoringStatKey;
  label: string;
  group: "Participación" | "Ataque" | "Defensa" | "Disciplina" | "Avanzadas";
  providerField: string;
  available: boolean;
  enabled: boolean;
  every: number;
  points: Record<PlayerPosition, number>;
};

const same = (value: number): Record<PlayerPosition, number> => ({ POR: value, DEF: value, MED: value, DEL: value });

export const defaultScoringRules: ScoringRule[] = [
  { key: "played", label: "Jugar hasta 59 minutos", group: "Participación", providerField: "minutes", available: true, enabled: true, every: 1, points: same(1) },
  { key: "played60", label: "Jugar 60 minutos o más", group: "Participación", providerField: "minutes", available: true, enabled: true, every: 1, points: same(2) },
  { key: "goal", label: "Gol", group: "Ataque", providerField: "goals", available: true, enabled: true, every: 1, points: { POR: 8, DEF: 6, MED: 5, DEL: 4 } },
  { key: "assist", label: "Asistencia", group: "Ataque", providerField: "assists", available: true, enabled: true, every: 1, points: same(3) },
  { key: "cleanSheet", label: "Portería a cero con 60+ min", group: "Defensa", providerField: "clean_sheet", available: true, enabled: true, every: 1, points: { POR: 4, DEF: 4, MED: 1, DEL: 0 } },
  { key: "save", label: "Cada 2 paradas", group: "Defensa", providerField: "saves", available: true, enabled: true, every: 2, points: { POR: 1, DEF: 0, MED: 0, DEL: 0 } },
  { key: "penaltySaved", label: "Penalti detenido", group: "Defensa", providerField: "penalties_saved", available: true, enabled: true, every: 1, points: { POR: 5, DEF: 5, MED: 5, DEL: 5 } },
  { key: "goalsConceded", label: "Cada 2 goles encajados", group: "Defensa", providerField: "goals_conceded", available: true, enabled: true, every: 2, points: { POR: -1, DEF: -1, MED: 0, DEL: 0 } },
  { key: "yellowCard", label: "Tarjeta amarilla", group: "Disciplina", providerField: "yellow_cards", available: true, enabled: true, every: 1, points: same(-1) },
  { key: "redCard", label: "Tarjeta roja", group: "Disciplina", providerField: "red_cards", available: true, enabled: true, every: 1, points: same(-3) },
  { key: "ownGoal", label: "Gol en propia puerta", group: "Disciplina", providerField: "own_goals", available: true, enabled: true, every: 1, points: same(-2) },
  { key: "penaltyMissed", label: "Penalti fallado", group: "Disciplina", providerField: "penalties_missed", available: true, enabled: true, every: 1, points: same(-2) },
  { key: "tackleWon", label: "Cada 3 entradas ganadas", group: "Avanzadas", providerField: "tackles_won", available: true, enabled: true, every: 3, points: same(1) },
  { key: "interception", label: "Cada 3 intercepciones", group: "Avanzadas", providerField: "interceptions", available: true, enabled: true, every: 3, points: same(1) },
  { key: "keyPass", label: "Cada 2 pases clave", group: "Avanzadas", providerField: "key_passes", available: true, enabled: true, every: 2, points: same(1) },
  { key: "bigChanceCreated", label: "Gran ocasión creada", group: "Avanzadas", providerField: "big_chances_created", available: true, enabled: true, every: 1, points: same(1) },
  { key: "playerOfMatch", label: "Mejor jugador del partido", group: "Avanzadas", providerField: "player_of_match", available: false, enabled: false, every: 1, points: same(3) },
];

export type PlayerMatchStats = Record<ScoringStatKey, number>;

export function demoPlayerMatchStats(playerId: string, position: PlayerPosition): PlayerMatchStats {
  void playerId;
  void position;
  return {
    played: 0,
    played60: 0,
    goal: 0,
    assist: 0,
    cleanSheet: 0,
    save: 0,
    penaltySaved: 0,
    goalsConceded: 0,
    yellowCard: 0,
    redCard: 0,
    ownGoal: 0,
    penaltyMissed: 0,
    tackleWon: 0,
    interception: 0,
    keyPass: 0,
    bigChanceCreated: 0,
    playerOfMatch: 0,
  };
}

export function calculatePlayerPoints(stats: PlayerMatchStats, position: PlayerPosition, rules: ScoringRule[]) {
  const breakdown = rules.filter((rule) => rule.available && rule.enabled && stats[rule.key] > 0).map((rule) => {
    const occurrences = Math.floor(stats[rule.key] / Math.max(1, rule.every));
    return { key: rule.key, label: rule.label, value: stats[rule.key], occurrences, points: occurrences * rule.points[position] };
  }).filter((item) => item.occurrences > 0 && item.points !== 0);
  return { total: breakdown.reduce((total, item) => total + item.points, 0), breakdown };
}
