import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";

export type SpadesSuit = "S" | "H" | "D" | "C";
export type SpadesRank = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
export type SpadesCard = `${SpadesRank}${SpadesSuit}`;

export type SpadesAction =
  | { type: "spades:bid"; bid: number }
  | { type: "spades:play"; card: SpadesCard };

export type SpadesState = {
  key: "spades";
  phase: "bidding" | "playing" | "settled";
  playerIds: string[];
  hands: Record<string, SpadesCard[]>;
  bids: Record<string, number>;
  turnIndex: number;
  trick: { leadSuit: SpadesSuit | null; plays: { playerId: string; card: SpadesCard }[] };
  trickHistory: { winnerId: string; plays: { playerId: string; card: SpadesCard }[] }[];
  spadesBroken: boolean;
  tricksWon: Record<string, number>;
  teamBags: { team0: number; team1: number };
  teamScores: { team0: number; team1: number };
};

export type SpadesPublicState = {
  phase: SpadesState["phase"];
  yourHand: SpadesCard[];
  turnPlayerId: string | null;
  bids: Record<string, number>;
  trick: { leadSuit: SpadesSuit | null; plays: { playerId: string; card: SpadesCard }[] };
  trickHistory: { winnerId: string; plays: { playerId: string; card: SpadesCard }[] }[];
  spadesBroken: boolean;
  tricksWon: Record<string, number>;
  teamScores: { team0: number; team1: number };
};

const rankOrder: SpadesRank[] = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const rankValue = (r: SpadesRank) => rankOrder.indexOf(r);

function buildDeck(): SpadesCard[] {
  const ranks: SpadesRank[] = ["A","K","Q","J","10","9","8","7","6","5","4","3","2"];
  const suits: SpadesSuit[] = ["S","H","D","C"];
  const deck: SpadesCard[] = [];
  for (const s of suits) for (const r of ranks) deck.push(`${r}${s}`);
  return deck;
}

function shuffle(deck: SpadesCard[], seed: number): SpadesCard[] {
  const rng = mulberry32(seed);
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function suitOf(c: SpadesCard): SpadesSuit {
  return c[c.length - 1] as SpadesSuit;
}

function rankOf(c: SpadesCard): SpadesRank {
  return c.slice(0, c.length - 1) as SpadesRank;
}

function sortHand(hand: SpadesCard[]): SpadesCard[] {
  return hand.slice().sort((a, b) => {
    const sa = suitOf(a);
    const sb = suitOf(b);
    if (sa !== sb) return sa.localeCompare(sb);
    return rankValue(rankOf(a)) - rankValue(rankOf(b));
  });
}

function trickWinner(trick: { leadSuit: SpadesSuit | null; plays: { playerId: string; card: SpadesCard }[] }): string {
  const lead = trick.leadSuit;
  let winning = trick.plays[0];
  for (const play of trick.plays.slice(1)) {
    const winSuit = suitOf(winning.card);
    const playSuit = suitOf(play.card);
    if (playSuit === "S") {
      if (winSuit !== "S" || rankValue(rankOf(play.card)) > rankValue(rankOf(winning.card))) {
        winning = play;
      }
      continue;
    }
    if (winSuit === "S") continue;
    if (lead && playSuit === lead && rankValue(rankOf(play.card)) > rankValue(rankOf(winning.card))) {
      winning = play;
    }
  }
  return winning.playerId;
}

function teamOf(playerId: string, playerIds: string[]): 0 | 1 {
  const idx = playerIds.indexOf(playerId);
  return (idx % 2) as 0 | 1;
}

function finalizeScores(s: SpadesState) {
  let team0Bid = 0;
  let team1Bid = 0;
  let team0Tricks = 0;
  let team1Tricks = 0;

  for (const pid of s.playerIds) {
    const t = teamOf(pid, s.playerIds);
    const bid = s.bids[pid] ?? 0;
    const tricks = s.tricksWon[pid] ?? 0;
    if (t === 0) {
      team0Bid += bid;
      team0Tricks += tricks;
    } else {
      team1Bid += bid;
      team1Tricks += tricks;
    }
  }

  const scoreTeam = (bid: number, tricks: number) => {
    if (tricks >= bid) return bid * 10 + (tricks - bid);
    return -bid * 10;
  };

  let team0Score = scoreTeam(team0Bid, team0Tricks);
  let team1Score = scoreTeam(team1Bid, team1Tricks);

  // Nil bonuses/penalties
  for (const pid of s.playerIds) {
    if ((s.bids[pid] ?? 0) !== 0) continue;
    const tricks = s.tricksWon[pid] ?? 0;
    const delta = tricks === 0 ? 100 : -100;
    if (teamOf(pid, s.playerIds) === 0) team0Score += delta;
    else team1Score += delta;
  }

  s.teamScores = { team0: team0Score, team1: team1Score };
  s.teamBags = {
    team0: Math.max(0, team0Tricks - team0Bid),
    team1: Math.max(0, team1Tricks - team1Bid)
  };
}

function legalCards(state: SpadesState, playerId: string): SpadesCard[] {
  const hand = state.hands[playerId] ?? [];
  if (state.phase !== "playing") return [];
  const lead = state.trick.leadSuit;
  if (!lead) {
    // Lead: cannot lead spades unless broken or only spades.
    if (state.spadesBroken) return hand;
    const nonSpades = hand.filter(c => suitOf(c) !== "S");
    return nonSpades.length > 0 ? nonSpades : hand;
  }
  const follow = hand.filter(c => suitOf(c) === lead);
  return follow.length > 0 ? follow : hand;
}

function estimateBid(hand: SpadesCard[]): number {
  let bid = 0;
  for (const c of hand) {
    const r = rankOf(c);
    const s = suitOf(c);
    if (s === "S") {
      if (r === "A" || r === "K" || r === "Q") bid += 1;
      else if (r === "J" || r === "10") bid += 0.5;
      else bid += 0.2;
    } else {
      if (r === "A") bid += 1;
      else if (r === "K") bid += 0.6;
      else if (r === "Q") bid += 0.4;
    }
  }
  return Math.max(0, Math.min(13, Math.round(bid)));
}

export const spadesPlugin: GamePlugin<SpadesState, SpadesAction, SpadesPublicState> = {
  key: "spades",

  createInitialState: ({ rngSeed, seats }) => {
    const playerIds = Array.from({ length: seats }, (_, i) => `P${i + 1}`);
    const deck = shuffle(buildDeck(), rngSeed);
    const hands: Record<string, SpadesCard[]> = {};
    for (let i = 0; i < seats; i++) {
      hands[playerIds[i]] = sortHand(deck.slice(i * 13, i * 13 + 13));
    }
    return {
      key: "spades",
      phase: "bidding",
      playerIds,
      hands,
      bids: {},
      turnIndex: 0,
      trick: { leadSuit: null, plays: [] },
      trickHistory: [],
      spadesBroken: false,
      tricksWon: Object.fromEntries(playerIds.map(id => [id, 0])),
      teamBags: { team0: 0, team1: 0 },
      teamScores: { team0: 0, team1: 0 }
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase === "settled") return null;
    return s.playerIds[s.turnIndex] ?? null;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase === "bidding") {
      if (s.playerIds[s.turnIndex] !== playerId) return [];
      return Array.from({ length: 14 }, (_, i) => ({ type: "spades:bid", bid: i }));
    }
    if (s.phase === "playing") {
      if (s.playerIds[s.turnIndex] !== playerId) return [];
      return legalCards(s, playerId).map(card => ({ type: "spades:play", card }));
    }
    return [];
  },

  applyAction: (s, action) => {
    const events: any[] = [];

    if (s.phase === "bidding" && action.type === "spades:bid") {
      const playerId = s.playerIds[s.turnIndex];
      s.bids[playerId] = Math.max(0, Math.min(13, action.bid));
      s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      if (Object.keys(s.bids).length === s.playerIds.length) {
        s.phase = "playing";
        s.turnIndex = 0;
      }
      return { state: s, events };
    }

    if (s.phase === "playing" && action.type === "spades:play") {
      const playerId = s.playerIds[s.turnIndex];
      const hand = s.hands[playerId] ?? [];
      const idx = hand.indexOf(action.card);
      if (idx === -1) return { state: s, events };
      const legal = legalCards(s, playerId);
      if (!legal.includes(action.card)) return { state: s, events };

      hand.splice(idx, 1);
      s.hands[playerId] = hand;

      if (!s.trick.leadSuit) s.trick.leadSuit = suitOf(action.card);
      s.trick.plays.push({ playerId, card: action.card });
      if (suitOf(action.card) === "S") {
        s.spadesBroken = true;
      }

      if (s.trick.plays.length === s.playerIds.length) {
        const winnerId = trickWinner(s.trick);
        s.tricksWon[winnerId] = (s.tricksWon[winnerId] ?? 0) + 1;
        s.trickHistory.push({ winnerId, plays: s.trick.plays.slice() });
        s.turnIndex = s.playerIds.indexOf(winnerId);
        s.trick = { leadSuit: null, plays: [] };
      } else {
        s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      }

      const remaining = s.playerIds.some(id => (s.hands[id] ?? []).length > 0);
      if (!remaining) {
        s.phase = "settled";
        finalizeScores(s);
      }

      return { state: s, events };
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => ({
    phase: s.phase,
    yourHand: s.hands[forPlayerId] ?? [],
    turnPlayerId: s.playerIds[s.turnIndex] ?? null,
    bids: s.bids,
    trick: s.trick,
    trickHistory: s.trickHistory,
    spadesBroken: s.spadesBroken,
    tricksWon: s.tricksWon,
    teamScores: s.teamScores
  }),

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const t0 = s.teamScores.team0;
    const t1 = s.teamScores.team1;
    if (t0 > t1) {
      const winners = s.playerIds.filter(pid => teamOf(pid, s.playerIds) === 0);
      return { winners, outcomeByPlayer: Object.fromEntries(s.playerIds.map(pid => [pid, teamOf(pid, s.playerIds) === 0 ? "win" : "lose"])) };
    }
    if (t1 > t0) {
      const winners = s.playerIds.filter(pid => teamOf(pid, s.playerIds) === 1);
      return { winners, outcomeByPlayer: Object.fromEntries(s.playerIds.map(pid => [pid, teamOf(pid, s.playerIds) === 1 ? "win" : "lose"])) };
    }
    return { winners: [], outcomeByPlayer: Object.fromEntries(s.playerIds.map(pid => [pid, "push"])) };
  },

  botChooseAction: (s, botId, difficulty, rng) => {
    if (s.phase === "bidding") {
      const bid = estimateBid(s.hands[botId] ?? []);
      return { type: "spades:bid", bid };
    }
    const legal = legalCards(s, botId);
    if (legal.length === 0) return { type: "spades:play", card: (s.hands[botId] ?? [])[0] };
    // Choose a low card most of the time; higher difficulty means slightly more aggressive.
    const sorted = legal.slice().sort((a, b) => rankValue(rankOf(a)) - rankValue(rankOf(b)));
    if (difficulty >= 3 && rng() > 0.6) return { type: "spades:play", card: sorted[sorted.length - 1] };
    return { type: "spades:play", card: sorted[0] };
  }
};
