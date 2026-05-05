import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";

export type Domino = [number, number];

export type DomAction =
  | { type: "dom:play"; domino: Domino; end: "left" | "right"; flip: boolean }
  | { type: "dom:draw" }
  | { type: "dom:pass" };

export type DomBoard = {
  chain: Domino[];
  leftEnd: number;
  rightEnd: number;
} | null;

export type DomState = {
  key: "dominoes";
  phase: "playing" | "settled";
  playerIds: string[];
  hands: Record<string, Domino[]>;
  boneyard: Domino[];
  board: DomBoard;
  turnIndex: number;
  consecutivePasses: number;
  scores: Record<string, number>;
  winner: string | null;
};

export type DomPublicState = {
  phase: DomState["phase"];
  yourHand: Domino[];
  handCounts: Record<string, number>;
  boneyardCount: number;
  board: DomBoard;
  turnPlayerId: string | null;
  scores: Record<string, number>;
  winner: string | null;
};

function buildSet(): Domino[] {
  const tiles: Domino[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      tiles.push([i, j]);
    }
  }
  return tiles;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pipCount(hand: Domino[]): number {
  return hand.reduce((sum, [a, b]) => sum + a + b, 0);
}

function canPlay(domino: Domino, end: number): boolean {
  return domino[0] === end || domino[1] === end;
}

function getPlayable(hand: Domino[], board: DomBoard): Domino[] {
  if (!board) return hand;
  return hand.filter(d => canPlay(d, board.leftEnd) || canPlay(d, board.rightEnd));
}

function startingPlayer(playerIds: string[], hands: Record<string, Domino[]>): { playerId: string; domino: Domino } | null {
  // Find the highest double
  let best: { playerId: string; domino: Domino; val: number } | null = null;
  for (const pid of playerIds) {
    for (const d of hands[pid] ?? []) {
      if (d[0] === d[1]) {
        if (!best || d[0] > best.val) {
          best = { playerId: pid, domino: d, val: d[0] };
        }
      }
    }
  }
  return best ? { playerId: best.playerId, domino: best.domino } : null;
}

export const dominoesPlugin: GamePlugin<DomState, DomAction, DomPublicState> = {
  key: "dominoes",

  createInitialState: ({ seats, rngSeed }) => {
    const rng = mulberry32(rngSeed);
    const playerIds = Array.from({ length: seats }, (_, i) => `P${i + 1}`);
    const tiles = shuffle(buildSet(), rng);
    const perPlayer = seats <= 2 ? 7 : 5;
    const hands: Record<string, Domino[]> = {};
    let idx = 0;
    for (const pid of playerIds) {
      hands[pid] = tiles.slice(idx, idx + perPlayer);
      idx += perPlayer;
    }
    const boneyard = tiles.slice(idx);

    // Find starting player (highest double)
    const start = startingPlayer(playerIds, hands);
    let turnIndex = 0;
    let board: DomBoard = null;
    if (start) {
      turnIndex = playerIds.indexOf(start.playerId);
      // Auto-place the starting double
      const hand = hands[start.playerId];
      const di = hand.findIndex(d => d[0] === start.domino[0] && d[1] === start.domino[1]);
      hand.splice(di, 1);
      board = { chain: [start.domino], leftEnd: start.domino[0], rightEnd: start.domino[1] };
      turnIndex = (turnIndex + 1) % playerIds.length;
    }

    return {
      key: "dominoes",
      phase: "playing",
      playerIds,
      hands,
      boneyard,
      board,
      turnIndex,
      consecutivePasses: 0,
      scores: Object.fromEntries(playerIds.map(pid => [pid, 0])),
      winner: null
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase !== "playing") return null;
    return s.playerIds[s.turnIndex] ?? null;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase !== "playing") return [];
    if (s.playerIds[s.turnIndex] !== playerId) return [];
    const hand = s.hands[playerId] ?? [];
    const playable = getPlayable(hand, s.board);

    if (playable.length > 0) {
      const actions: DomAction[] = [];
      for (const d of playable) {
        if (!s.board) {
          actions.push({ type: "dom:play", domino: d, end: "right", flip: false });
        } else {
          if (canPlay(d, s.board.leftEnd)) {
            actions.push({ type: "dom:play", domino: d, end: "left", flip: d[1] === s.board.leftEnd });
          }
          if (canPlay(d, s.board.rightEnd)) {
            actions.push({ type: "dom:play", domino: d, end: "right", flip: d[0] === s.board.rightEnd });
          }
        }
      }
      return actions;
    }
    if (s.boneyard.length > 0) return [{ type: "dom:draw" }];
    return [{ type: "dom:pass" }];
  },

  applyAction: (s, action) => {
    const events: any[] = [];
    const pid = s.playerIds[s.turnIndex];

    if (action.type === "dom:play") {
      const hand = s.hands[pid] ?? [];
      const di = hand.findIndex(d => d[0] === action.domino[0] && d[1] === action.domino[1]);
      if (di === -1) return { state: s, events };

      const tile: Domino = action.flip ? [action.domino[1], action.domino[0]] : action.domino;
      hand.splice(di, 1);
      s.consecutivePasses = 0;

      if (!s.board) {
        s.board = { chain: [tile], leftEnd: tile[0], rightEnd: tile[1] };
      } else if (action.end === "left") {
        s.board.chain.unshift(tile);
        s.board.leftEnd = tile[0];
      } else {
        s.board.chain.push(tile);
        s.board.rightEnd = tile[1];
      }

      events.push({ t: "play", playerId: pid, domino: tile });

      // Check win
      if (hand.length === 0) {
        s.winner = pid;
        // Score: sum of all opponents' pips
        let score = 0;
        for (const [opPid, opHand] of Object.entries(s.hands)) {
          if (opPid !== pid) score += pipCount(opHand);
        }
        s.scores[pid] = (s.scores[pid] ?? 0) + score;
        s.phase = "settled";
        events.push({ t: "win", playerId: pid, score });
      } else {
        s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      }
    }

    if (action.type === "dom:draw") {
      if (s.boneyard.length === 0) return { state: s, events };
      const drawn = s.boneyard.pop()!;
      (s.hands[pid] ?? []).push(drawn);
      events.push({ t: "draw", playerId: pid });
      // If now playable, stay on this player's turn; else advance
      const hand = s.hands[pid] ?? [];
      const playable = getPlayable(hand, s.board);
      if (playable.length === 0) {
        s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      }
    }

    if (action.type === "dom:pass") {
      s.consecutivePasses++;
      events.push({ t: "pass", playerId: pid });

      if (s.consecutivePasses >= s.playerIds.length) {
        // Blocked: lowest pip count wins
        const pipCounts = s.playerIds.map(p => ({ pid: p, pips: pipCount(s.hands[p] ?? []) }));
        pipCounts.sort((a, b) => a.pips - b.pips);
        s.winner = pipCounts[0].pid;
        s.phase = "settled";
        events.push({ t: "blocked", winner: s.winner });
      } else {
        s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      }
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => ({
    phase: s.phase,
    yourHand: s.hands[forPlayerId] ?? [],
    handCounts: Object.fromEntries(s.playerIds.map(pid => [pid, (s.hands[pid] ?? []).length])),
    boneyardCount: s.boneyard.length,
    board: s.board,
    turnPlayerId: s.phase === "playing" ? (s.playerIds[s.turnIndex] ?? null) : null,
    scores: s.scores,
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
    const hand = s.hands[botId] ?? [];
    const playable = getPlayable(hand, s.board);

    if (playable.length > 0) {
      const sorted = playable.slice().sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]));
      const pick = difficulty >= 2 ? sorted[0] : sorted[Math.floor(rng() * sorted.length)];
      if (!s.board) return { type: "dom:play", domino: pick, end: "right", flip: false };
      if (canPlay(pick, s.board.leftEnd)) {
        return { type: "dom:play", domino: pick, end: "left", flip: pick[1] === s.board.leftEnd };
      }
      return { type: "dom:play", domino: pick, end: "right", flip: pick[0] === s.board.rightEnd };
    }
    if (s.boneyard.length > 0) return { type: "dom:draw" };
    return { type: "dom:pass" };
  }
};
