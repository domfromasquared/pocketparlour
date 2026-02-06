import type { GameKey } from "./types.js";

export type GameContext = {
  now: number;
  rngSeed: number;
  turnMs: number;
};

export type GamePlugin<State, Action, PublicState> = {
  key: GameKey;
  createInitialState: (config: { seats: number; stakeAmount: bigint; rngSeed: number }) => State;
  getCurrentTurnPlayerId: (state: State) => string | null; // null => no turn (dealer/bots/system)
  getLegalActions: (state: State, playerId: string) => Action[];
  applyAction: (state: State, action: Action, ctx: GameContext) => { state: State; events: any[] };
  getPublicState: (state: State, forPlayerId: string) => PublicState;
  isGameOver: (state: State) => boolean;
  getWinners: (state: State) => { winners: string[]; outcomeByPlayer: Record<string, "win" | "lose" | "push"> };
  botChooseAction: (state: State, botId: string, difficulty: number, rng: () => number) => Action;
};
