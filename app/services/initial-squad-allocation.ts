import type { CompetitionName, InitialSquad } from "../data/contracts";
import { allocateDemoInitialSquad } from "../domain/initial-squad";

export interface InitialSquadAllocationRequest {
  leagueId: string;
  teamId: string;
  competition: CompetitionName;
  targetValue: number;
  squadSize?: number;
  idempotencyKey: string;
}

export interface ConfirmedInitialSquadAllocation {
  allocationId: string;
  idempotencyKey: string;
  confirmedAt: string;
  squad: InitialSquad;
}

export interface InitialSquadAllocationGateway {
  allocate(request: InitialSquadAllocationRequest): Promise<ConfirmedInitialSquadAllocation>;
}

// Se sustituirá por una llamada a la API conservando este contrato:
// la interfaz recibe un reparto confirmado y solo entonces puede presentarlo.
export function createDemoAllocationGateway(excludedPlayerIds: ReadonlySet<string>): InitialSquadAllocationGateway {
  return {
    async allocate(request) {
      const squad = allocateDemoInitialSquad(request.competition, request.targetValue, excludedPlayerIds, request.squadSize);
      return {
        allocationId: `allocation_demo_${crypto.randomUUID()}`,
        idempotencyKey: request.idempotencyKey,
        confirmedAt: new Date().toISOString(),
        squad,
      };
    },
  };
}
