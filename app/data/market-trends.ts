import type { CompetitionName } from "./contracts";
import { competitionPlayers, type CompetitionPlayer } from "./competition-players";

export interface PlayerTrend extends CompetitionPlayer {
  changePercent: number;
  signings: number;
  performance: number;
  demandIndex: number;
  lineupSelections: number;
  captainSelections: number;
  offersReceived: number;
  bidsReceived: number;
  protections: number;
  marketListings: number;
  transfers: number;
  history: number[];
}

function seedFor(value: string) {
  return [...value].reduce((total, character, index) => total + character.charCodeAt(0) * (index + 3), 0);
}

export function getCompetitionTrends(competition: CompetitionName): PlayerTrend[] {
  return competitionPlayers[competition].map((player) => {
    const seed = seedFor(player.id);
    const changePercent = Number((((seed % 101) - 42) / 10).toFixed(1));
    const startValue = player.value / (1 + changePercent / 100);
    const history = Array.from({ length: 12 }, (_, index) => {
      if (index === 11) return player.value;
      const progress = index / 11;
      const wave = (((seed + index * 17) % 9) - 4) * 0.006;
      return Number((startValue + (player.value - startValue) * progress + player.value * wave).toFixed(2));
    });
    return {
      ...player,
      changePercent,
      signings: 18 + (seed % 164),
      performance: 35 + (seed % 91),
      demandIndex: 40 + (seed % 61),
      lineupSelections: 120 + (seed % 1480),
      captainSelections: 8 + ((seed * 3) % 310),
      offersReceived: 15 + ((seed * 5) % 430),
      bidsReceived: 24 + ((seed * 7) % 590),
      protections: 3 + ((seed * 11) % 170),
      marketListings: 10 + ((seed * 13) % 280),
      transfers: 12 + ((seed * 17) % 360),
      history,
    };
  });
}
