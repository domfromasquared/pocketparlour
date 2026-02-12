import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";

export type HERank = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
export type HESuit = "S" | "H" | "D" | "C";
export type HECard = `${HERank}${HESuit}`;

export type HEAction =
  | { type: "he:fold" }
  | { type: "he:check" }
  | { type: "he:call" }
  | { type: "he:raise"; amount: number };

export type HEPhase = "preflop" | "flop" | "turn" | "river" | "showdown" | "settled";

export type HEState = {
  key: "holdem";
  phase: HEPhase;
  players: string[]; // in order
  currentIndex: number;
  dealerIndex: number;
  community: HECard[];
  hole: Record<string, HECard[]>;
  folded: Record<string, boolean>;
  bet: Record<string, number>;
  pot: number;
  currentBet: number;
  minRaise: number;
  acted: string[];
  deck: HECard[];
};

export type HEPublicPlayer = {
  playerId: string;
  folded: boolean;
  bet: number;
};

export type HEPublicState = {
  phase: HEPhase;
  community: HECard[];
  pot: number;
  currentBet: number;
  toAct: string | null;
  dealerIndex: number;
  players: HEPublicPlayer[];
  yourHand: HECard[];
  legalActions: HEAction[];
  minRaise: number;
  callAmount: number;
};

const ranks: HERank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const suits: HESuit[] = ["S", "H", "D", "C"];

function freshDeck(seed: number): HECard[] {
  const rng = mulberry32(seed);
  const deck: HECard[] = [];
  for (const r of ranks) for (const s of suits) deck.push(`${r}${s}`);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function nextActiveIndex(state: HEState, start: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (start + i) % n;
    const pid = state.players[idx];
    if (!state.folded[pid]) return idx;
  }
  return start;
}

function activePlayers(state: HEState): string[] {
  return state.players.filter(p => !state.folded[p]);
}

function roundComplete(state: HEState): boolean {
  const actives = activePlayers(state);
  if (actives.length <= 1) return true;
  return actives.every(p => state.bet[p] === state.currentBet && state.acted.includes(p));
}

function dealCommunity(state: HEState, count: number) {
  for (let i = 0; i < count; i++) {
    const c = state.deck.shift();
    if (c) state.community.push(c);
  }
}

function resetBets(state: HEState) {
  for (const p of state.players) state.bet[p] = 0;
  state.currentBet = 0;
  state.acted = [];
}

function advancePhase(state: HEState) {
  if (state.phase === "preflop") {
    state.phase = "flop";
    dealCommunity(state, 3);
  } else if (state.phase === "flop") {
    state.phase = "turn";
    dealCommunity(state, 1);
  } else if (state.phase === "turn") {
    state.phase = "river";
    dealCommunity(state, 1);
  } else if (state.phase === "river") {
    state.phase = "showdown";
  }
  resetBets(state);
}

function rankValue(r: HERank): number {
  if (r === "A") return 14;
  if (r === "K") return 13;
  if (r === "Q") return 12;
  if (r === "J") return 11;
  return Number(r);
}

function evaluate5(cards: HECard[]): { rank: number; tiebreak: number[] } {
  const ranksVals = cards.map(c => rankValue(c.slice(0, c.length - 1) as HERank)).sort((a, b) => b - a);
  const suitsVals = cards.map(c => c.slice(c.length - 1) as HESuit);
  const counts = new Map<number, number>();
  for (const r of ranksVals) counts.set(r, (counts.get(r) ?? 0) + 1);
  const unique = Array.from(counts.keys()).sort((a, b) => b - a);
  const isFlush = suitsVals.every(s => s === suitsVals[0]);
  const sorted = Array.from(new Set(ranksVals)).sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (sorted.length >= 5) {
    for (let i = 0; i <= sorted.length - 5; i++) {
      const window = sorted.slice(i, i + 5);
      if (window[0] - window[4] === 4) {
        isStraight = true;
        straightHigh = window[0];
        break;
      }
    }
    // wheel
    if (!isStraight && sorted.includes(14) && sorted.includes(5) && sorted.includes(4) && sorted.includes(3) && sorted.includes(2)) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const groups = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  if (isStraight && isFlush) return { rank: 8, tiebreak: [straightHigh] };
  if (groups[0][1] === 4) return { rank: 7, tiebreak: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { rank: 6, tiebreak: [groups[0][0], groups[1][0]] };
  if (isFlush) return { rank: 5, tiebreak: ranksVals };
  if (isStraight) return { rank: 4, tiebreak: [straightHigh] };
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a);
    return { rank: 3, tiebreak: [groups[0][0], ...kickers] };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairHigh = Math.max(groups[0][0], groups[1][0]);
    const pairLow = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return { rank: 2, tiebreak: [pairHigh, pairLow, kicker] };
  }
  if (groups[0][1] === 2) {
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a);
    return { rank: 1, tiebreak: [groups[0][0], ...kickers] };
  }
  return { rank: 0, tiebreak: ranksVals };
}

function bestHand(cards: HECard[]): { rank: number; tiebreak: number[] } {
  let best: { rank: number; tiebreak: number[] } | null = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const hand = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best) best = hand;
            else if (hand.rank > best.rank) best = hand;
            else if (hand.rank === best.rank) {
              for (let i = 0; i < hand.tiebreak.length; i++) {
                if ((hand.tiebreak[i] ?? 0) > (best.tiebreak[i] ?? 0)) {
                  best = hand;
                  break;
                } else if ((hand.tiebreak[i] ?? 0) < (best.tiebreak[i] ?? 0)) {
                  break;
                }
              }
            }
          }
        }
      }
    }
  }
  return best ?? { rank: 0, tiebreak: [] };
}

export const holdemPlugin: GamePlugin<HEState, HEAction, HEPublicState> = {
  key: "holdem",

  createInitialState: ({ seats, rngSeed }) => {
    const deck = freshDeck(rngSeed);
    const players = Array.from({ length: seats }, (_, i) => `P${i + 1}`);
    const hole: Record<string, HECard[]> = {};
    const folded: Record<string, boolean> = {};
    const bet: Record<string, number> = {};
    for (const p of players) {
      hole[p] = [deck.shift()!, deck.shift()!];
      folded[p] = false;
      bet[p] = 0;
    }
    return {
      key: "holdem",
      phase: "preflop",
      players,
      currentIndex: 0,
      dealerIndex: 0,
      community: [],
      hole,
      folded,
      bet,
      pot: 0,
      currentBet: 0,
      minRaise: 100,
      acted: [],
      deck
    };
  },

  getCurrentTurnPlayerId: (s) => {
    const pid = s.players[s.currentIndex];
    return s.folded[pid] ? null : pid;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase === "settled" || s.phase === "showdown") return [];
    const current = s.players[s.currentIndex];
    if (current !== playerId) return [];
    if (s.folded[playerId]) return [];
    const actions: HEAction[] = [{ type: "he:fold" }];
    const callAmt = s.currentBet - s.bet[playerId];
    if (callAmt <= 0) actions.push({ type: "he:check" });
    else actions.push({ type: "he:call" });
    actions.push({ type: "he:raise", amount: s.minRaise });
    return actions;
  },

  applyAction: (s, action) => {
    const events: any[] = [];
    if (s.phase === "settled") return { state: s, events };
    const playerId = s.players[s.currentIndex];
    if (s.folded[playerId]) return { state: s, events };

    const callAmt = Math.max(0, s.currentBet - s.bet[playerId]);

    if (action.type === "he:fold") {
      s.folded[playerId] = true;
    } else if (action.type === "he:check") {
      if (callAmt > 0) return { state: s, events };
    } else if (action.type === "he:call") {
      if (callAmt > 0) {
        s.bet[playerId] += callAmt;
        s.pot += callAmt;
      }
    } else if (action.type === "he:raise") {
      const raiseBy = Math.max(s.minRaise, action.amount || s.minRaise);
      const total = callAmt + raiseBy;
      s.bet[playerId] += total;
      s.pot += total;
      s.currentBet = s.bet[playerId];
      s.acted = [];
    }

    if (!s.acted.includes(playerId)) s.acted.push(playerId);

    const actives = activePlayers(s);
    if (actives.length <= 1) {
      s.phase = "settled";
      return { state: s, events };
    }

    if (roundComplete(s)) {
      if (s.phase === "river") {
        s.phase = "showdown";
        s.phase = "settled";
      } else {
        advancePhase(s);
      }
    }

    s.currentIndex = nextActiveIndex(s, s.currentIndex);
    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => {
    const current = s.players[s.currentIndex];
    const callAmt = Math.max(0, s.currentBet - (s.bet[forPlayerId] ?? 0));
    return {
      phase: s.phase,
      community: s.community,
      pot: s.pot,
      currentBet: s.currentBet,
      toAct: s.folded[current] ? null : current,
      dealerIndex: s.dealerIndex,
      players: s.players.map(p => ({ playerId: p, folded: s.folded[p], bet: s.bet[p] })),
      yourHand: s.hole[forPlayerId] ?? [],
      legalActions: holdemPlugin.getLegalActions(s, forPlayerId),
      minRaise: s.minRaise,
      callAmount: callAmt
    };
  },

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const actives = activePlayers(s);
    if (actives.length === 1) {
      return { winners: [actives[0]], outcomeByPlayer: { [actives[0]]: "win" } };
    }
    const scores = actives.map(p => ({ p, score: bestHand([...s.community, ...s.hole[p]]) }));
    scores.sort((a, b) => {
      if (b.score.rank !== a.score.rank) return b.score.rank - a.score.rank;
      for (let i = 0; i < b.score.tiebreak.length; i++) {
        const diff = (b.score.tiebreak[i] ?? 0) - (a.score.tiebreak[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    const best = scores[0].score;
    const winners = scores.filter(s2 => {
      if (s2.score.rank !== best.rank) return false;
      for (let i = 0; i < best.tiebreak.length; i++) {
        if ((s2.score.tiebreak[i] ?? 0) !== (best.tiebreak[i] ?? 0)) return false;
      }
      return true;
    }).map(s2 => s2.p);

    const outcomeByPlayer: Record<string, "win" | "lose" | "push"> = {};
    for (const p of actives) outcomeByPlayer[p] = winners.includes(p) ? "win" : "lose";
    if (winners.length > 1) {
      for (const p of winners) outcomeByPlayer[p] = "push";
    }
    return { winners, outcomeByPlayer };
  },

  botChooseAction: (s, botId, _difficulty, rng) => {
    const legal = holdemPlugin.getLegalActions(s, botId);
    if (legal.length === 0) return { type: "he:check" };
    // Simple bot: mostly call/check, occasional raise
    const raise = legal.find(a => a.type === "he:raise") as HEAction | undefined;
    const call = legal.find(a => a.type === "he:call") as HEAction | undefined;
    const check = legal.find(a => a.type === "he:check") as HEAction | undefined;
    const fold = legal.find(a => a.type === "he:fold") as HEAction | undefined;
    const r = rng();
    if (raise && r > 0.85) return raise;
    if (call) return call;
    if (check) return check;
    return fold ?? { type: "he:check" };
  }
};
