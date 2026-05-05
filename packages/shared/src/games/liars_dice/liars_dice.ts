import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";

export type LDAction =
  | { type: "ld:bid"; quantity: number; face: number }
  | { type: "ld:challenge" };

export type LDState = {
  key: "liars_dice";
  phase: "bidding" | "resolving" | "settled";
  playerIds: string[];
  dice: Record<string, number[]>;
  eliminated: Set<string>;
  currentBid: { quantity: number; face: number } | null;
  lastBidder: string | null;
  turnIndex: number;
  roundResult: { loser: string; allDice: Record<string, number[]>; bidMet: boolean } | null;
  winner: string | null;
};

export type LDPublicState = {
  phase: LDState["phase"];
  playerIds: string[];
  diceCount: Record<string, number>;
  yourDice: number[];
  currentBid: { quantity: number; face: number } | null;
  lastBidder: string | null;
  turnPlayerId: string | null;
  eliminated: string[];
  roundResult: { loser: string; allDice: Record<string, number[]>; bidMet: boolean } | null;
  winner: string | null;
};

function rollDice(count: number, rng: () => number): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * 6));
}

function activePlayers(s: LDState): string[] {
  return s.playerIds.filter(pid => !s.eliminated.has(pid));
}

function nextActiveIndex(s: LDState, from: number): number {
  const active = activePlayers(s);
  if (active.length === 0) return from;
  const pid = s.playerIds[from];
  const pos = active.indexOf(pid);
  const next = (pos + 1) % active.length;
  return s.playerIds.indexOf(active[next]);
}

function bidIsHigher(current: { quantity: number; face: number }, prev: { quantity: number; face: number }): boolean {
  if (current.quantity > prev.quantity) return true;
  if (current.quantity === prev.quantity && current.face > prev.face) return true;
  return false;
}

function startRound(s: LDState, rngSeed: number): void {
  const rng = mulberry32(rngSeed + Date.now());
  for (const pid of activePlayers(s)) {
    const count = s.dice[pid]?.length ?? 0;
    s.dice[pid] = rollDice(count, rng);
  }
  s.currentBid = null;
  s.lastBidder = null;
  s.roundResult = null;
  s.phase = "bidding";
}

export const liarsDicePlugin: GamePlugin<LDState, LDAction, LDPublicState> = {
  key: "liars_dice",

  createInitialState: ({ seats, rngSeed }) => {
    const rng = mulberry32(rngSeed);
    const playerIds = Array.from({ length: seats }, (_, i) => `P${i + 1}`);
    const dice: Record<string, number[]> = {};
    for (const pid of playerIds) {
      dice[pid] = rollDice(5, rng);
    }
    return {
      key: "liars_dice",
      phase: "bidding",
      playerIds,
      dice,
      eliminated: new Set(),
      currentBid: null,
      lastBidder: null,
      turnIndex: 0,
      roundResult: null,
      winner: null
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase !== "bidding") return null;
    return s.playerIds[s.turnIndex] ?? null;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase !== "bidding") return [];
    if (s.playerIds[s.turnIndex] !== playerId) return [];
    const actions: LDAction[] = [];
    const prev = s.currentBid;
    if (prev) {
      actions.push({ type: "ld:challenge" });
    }
    // All valid bids higher than current
    for (let face = 1; face <= 6; face++) {
      for (let qty = 1; qty <= 30; qty++) {
        const bid = { quantity: qty, face };
        if (!prev || bidIsHigher(bid, prev)) {
          actions.push({ type: "ld:bid", quantity: qty, face });
        }
      }
    }
    return actions;
  },

  applyAction: (s, action, ctx) => {
    const events: any[] = [];

    if (s.phase === "bidding") {
      const currentPid = s.playerIds[s.turnIndex];

      if (action.type === "ld:bid") {
        if (s.currentBid && !bidIsHigher(action, s.currentBid)) return { state: s, events };
        s.currentBid = { quantity: action.quantity, face: action.face };
        s.lastBidder = currentPid;
        s.turnIndex = nextActiveIndex(s, s.turnIndex);
        events.push({ t: "bid", playerId: currentPid, bid: s.currentBid });
      }

      if (action.type === "ld:challenge") {
        if (!s.currentBid || !s.lastBidder) return { state: s, events };
        const challenger = currentPid;
        const bid = s.currentBid;

        // Count matching dice across all active players
        const allActive = activePlayers(s);
        let count = 0;
        const allDice: Record<string, number[]> = {};
        for (const pid of allActive) {
          allDice[pid] = s.dice[pid] ?? [];
          count += (s.dice[pid] ?? []).filter(d => d === bid.face).length;
        }

        const bidMet = count >= bid.quantity;
        const loser = bidMet ? challenger : s.lastBidder;

        s.roundResult = { loser, allDice, bidMet };
        s.phase = "resolving";
        events.push({ t: "challenge", challenger, bidMet, loser });

        // Resolve: loser loses one die
        const loserDice = s.dice[loser] ?? [];
        if (loserDice.length > 0) {
          s.dice[loser] = loserDice.slice(1);
        }
        if ((s.dice[loser] ?? []).length === 0) {
          s.eliminated.add(loser);
        }

        const remaining = activePlayers(s);
        if (remaining.length <= 1) {
          s.winner = remaining[0] ?? null;
          s.phase = "settled";
        } else {
          // Loser goes first next round (if still alive), else next active player
          const loserIdx = s.playerIds.indexOf(loser);
          if (s.eliminated.has(loser)) {
            s.turnIndex = nextActiveIndex(s, loserIdx);
          } else {
            s.turnIndex = loserIdx;
          }
          startRound(s, ctx.rngSeed);
        }
      }
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => ({
    phase: s.phase,
    playerIds: s.playerIds,
    diceCount: Object.fromEntries(s.playerIds.map(pid => [pid, s.dice[pid]?.length ?? 0])),
    yourDice: s.dice[forPlayerId] ?? [],
    currentBid: s.currentBid,
    lastBidder: s.lastBidder,
    turnPlayerId: s.phase === "bidding" ? (s.playerIds[s.turnIndex] ?? null) : null,
    eliminated: Array.from(s.eliminated),
    roundResult: s.roundResult,
    winner: s.winner
  }),

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const outcomeByPlayer: Record<string, "win" | "lose" | "push"> = {};
    for (const pid of s.playerIds) {
      outcomeByPlayer[pid] = s.winner === pid ? "win" : "lose";
    }
    return { winners: s.winner ? [s.winner] : [], outcomeByPlayer };
  },

  botChooseAction: (s, botId, difficulty, rng) => {
    if (s.phase !== "bidding") return { type: "ld:bid", quantity: 1, face: 1 };
    const prev = s.currentBid;

    // Decide whether to challenge
    if (prev) {
      const active = activePlayers(s);
      const totalDice = active.reduce((sum, pid) => sum + (s.dice[pid]?.length ?? 0), 0);
      const expectedCount = totalDice / 6;
      const suspicion = prev.quantity / Math.max(1, expectedCount);
      const threshold = difficulty >= 3 ? 1.4 : difficulty === 2 ? 1.7 : 2.0;
      if (suspicion > threshold) return { type: "ld:challenge" };
    }

    // Make a bid
    const myDice = s.dice[botId] ?? [];
    const faceCounts: Record<number, number> = {};
    for (const d of myDice) faceCounts[d] = (faceCounts[d] ?? 0) + 1;

    const bestFace = Object.entries(faceCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const face = bestFace ? Number(bestFace[0]) : 1 + Math.floor(rng() * 6);
    const myCount = faceCounts[face] ?? 1;

    if (!prev) return { type: "ld:bid", quantity: myCount, face };

    if (face > prev.face || myCount > prev.quantity) {
      return { type: "ld:bid", quantity: Math.max(prev.quantity, myCount), face };
    }
    return { type: "ld:bid", quantity: prev.quantity + 1, face: prev.face };
  }
};
