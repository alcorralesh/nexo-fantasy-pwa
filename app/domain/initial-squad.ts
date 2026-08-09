import type {
  CompetitionName,
  InitialSquad,
  InitialSquadPlayer,
  PlayerPosition,
} from "../data/contracts";
import { competitionPlayers } from "../data/competition-players";

function shuffled<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

const startingQuotas: Record<PlayerPosition, number> = { POR: 1, DEF: 4, MED: 4, DEL: 2 };

function squadQuotasFor(size: number): Record<PlayerPosition, number> {
  const quotas = { ...startingQuotas };
  const extraOrder: PlayerPosition[] = ["POR", "DEF", "MED", "DEL", "DEF", "MED", "DEL", "POR", "DEF"];
  for (let index = 0; index < Math.max(0, Math.min(20, size) - 11); index += 1) quotas[extraOrder[index % extraOrder.length]] += 1;
  return quotas;
}

export function allocateDemoInitialSquad(
  competition: CompetitionName,
  targetValue: number,
  excludedPlayerIds: ReadonlySet<string>,
  squadSize = 16,
): InitialSquad {
  const available: InitialSquadPlayer[] = competitionPlayers[competition].filter((player) => !excludedPlayerIds.has(player.id));
  const desiredSize = Math.max(11, Math.min(20, squadSize));
  const squadQuotas = squadQuotasFor(desiredSize);

  for (let attempt = 0; attempt < 250; attempt += 1) {
    const selected = (Object.keys(squadQuotas) as PlayerPosition[]).flatMap((position) =>
      shuffled(available.filter((player) => player.position === position)).slice(0, squadQuotas[position]),
    );
    if (selected.length !== desiredSize) continue;

    const totalValue = Number(selected.reduce((sum, player) => sum + player.value, 0).toFixed(1));
    if (totalValue < targetValue * 0.9 || totalValue > targetValue * 1.1) continue;

    const startingPlayerIds = (Object.keys(startingQuotas) as PlayerPosition[]).flatMap((position) =>
      selected.filter((player) => player.position === position).slice(0, startingQuotas[position]).map((player) => player.id),
    );
    return {
      formation: "4-4-2",
      players: selected,
      startingPlayerIds,
      benchPlayerIds: selected.filter((player) => !startingPlayerIds.includes(player.id)).map((player) => player.id),
      totalValue,
      targetValue,
    };
  }

  throw new Error("No se puede formar una plantilla equilibrada con los jugadores disponibles.");
}
