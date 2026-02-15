// packages/shared/src/games/blackjack/blackjack.ts
import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";

export type BJRank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type BJSuit = "S" | "H" | "D" | "C";
export type BJCard = `${BJRank}${BJSuit}`;

export type BJAction =
  | { type: "bj:hit" }
  | { type: "bj:stand" }
  | { type: "bj:double" }; // v1: allow if exactly 2 cards and enough stake locked (handled server-side as part of same stake)

export type BJHand = { cards: BJCard[]; stood: boolean; busted: boolean; doubled: boolean };

export type BJState = {
  key: "blackjack";
  phase: "playerTurn" | "dealerTurn" | "settled";
  playerIds: string[];
  currentPlayerIndex: number;
  dealer: BJHand;
  players: Record<string, BJHand>;
  shoeSeed: number;
  drawCount: number;
};

export type BJPublicPlayer = {
  playerId: string;
  cards: BJCard[];
  total: number;
  soft: boolean;
  stood: boolean;
  busted: boolean;
  doubled: boolean;
};

export type BJPublicState = {
  phase: BJState["phase"];
  currentTurnPlayerId: string | null;
  yourPlayerId: string;
  dealerUpCard: BJCard | null;
  dealerCards: BJCard[];
  dealerCardsCount: number;
  players: BJPublicPlayer[];
  yourCards: BJCard[];
  yourTotal: number;
  yourSoft: boolean;
};

function freshShoe(seed: number): BJCard[] {
  const rng = mulberry32(seed);
  const ranks: BJRank[] = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const suits: BJSuit[] = ["S","H","D","C"];
  // 6-deck shoe (common casino baseline) :contentReference[oaicite:2]{index=2}
  const deck: BJCard[] = [];
  for (let d=0; d<6; d++) for (const r of ranks) for (const s of suits) deck.push(`${r}${s}`);
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(r: BJRank): number {
  if (r === "A") return 11;
  if (r === "K" || r === "Q" || r === "J") return 10;
  return Number(r);
}

export function handTotal(cards: BJCard[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = c.slice(0, c.length - 1) as BJRank;
    total += cardValue(r);
    if (r === "A") aces++;
  }
  // reduce aces from 11 -> 1 as needed
  let soft = aces > 0;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  if (aces === 0) soft = false;
  return { total, soft };
}

function isBlackjack(cards: BJCard[]): boolean {
  if (cards.length !== 2) return false;
  const ranks = cards.map(c => c.slice(0, c.length - 1));
  const hasAce = ranks.includes("A");
  const hasTen = ranks.some(r => r === "10" || r === "J" || r === "Q" || r === "K");
  return hasAce && hasTen;
}

function dealerShouldHit(cards: BJCard[]): boolean {
  const { total, soft } = handTotal(cards);
  // Default: stand on soft 17 (S17) baseline. :contentReference[oaicite:3]{index=3}
  if (total < 17) return true;
  if (total > 17) return false;
  // total === 17
  if (soft) return false; // S17
  return false;
}

export const blackjackPlugin: GamePlugin<BJState, BJAction, BJPublicState> = {
  key: "blackjack",

  createInitialState: ({ seats, rngSeed }) => {
    const shoe = freshShoe(rngSeed);
    const draw = () => shoe.pop()!;
    const playerIds = Array.from({ length: seats }, (_, i) => `P${i + 1}`);
    const players: Record<string, BJHand> = {};
    // Deal one card to each player twice (round-robin)
    for (const pid of playerIds) {
      players[pid] = { cards: [draw()], stood: false, busted: false, doubled: false };
    }
    for (const pid of playerIds) {
      players[pid].cards.push(draw());
    }
    const dealer: BJHand = { cards: [draw(), draw()], stood: false, busted: false, doubled: false };
    return {
      key: "blackjack",
      phase: "playerTurn",
      playerIds,
      currentPlayerIndex: 0,
      dealer,
      players,
      shoeSeed: rngSeed
      ,
      drawCount: playerIds.length * 2 + 2
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase !== "playerTurn") return null;
    for (let i = 0; i < s.playerIds.length; i++) {
      const idx = (s.currentPlayerIndex + i) % s.playerIds.length;
      const pid = s.playerIds[idx];
      const hand = s.players[pid];
      if (!hand.stood && !hand.busted) return pid;
    }
    return null;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase !== "playerTurn") return [];
    const current = blackjackPlugin.getCurrentTurnPlayerId(s);
    if (playerId !== current) return [];
    const hand = s.players[playerId];
    if (!hand || hand.busted || hand.stood) return [];
    const actions: BJAction[] = [{ type: "bj:hit" }, { type: "bj:stand" }];
    if (hand.cards.length === 2) actions.push({ type: "bj:double" });
    return actions;
  },

  applyAction: (s, action, ctx) => {
    const shoe = freshShoe(s.shoeSeed);
    const draw = () => {
      for (let i = 0; i < s.drawCount; i++) shoe.pop();
      const next = shoe.pop();
      if (!next) throw new Error("Shoe empty");
      s.drawCount += 1;
      return next;
    };

    const events: any[] = [];

    if (s.phase !== "playerTurn") return { state: s, events };
    const playerId = blackjackPlugin.getCurrentTurnPlayerId(s);
    if (!playerId) {
      s.phase = "dealerTurn";
      return { state: s, events };
    }
    const hand = s.players[playerId];
    if (!hand) return { state: s, events };

    if (action.type === "bj:hit") {
      hand.cards.push(draw());
      const { total } = handTotal(hand.cards);
      if (total > 21) {
        hand.busted = true;
        events.push({ t: "player:bust" });
      }
    } else if (action.type === "bj:stand") {
      hand.stood = true;
    } else if (action.type === "bj:double") {
      // Take exactly one card then stand. :contentReference[oaicite:4]{index=4}
      hand.doubled = true;
      hand.cards.push(draw());
      const { total } = handTotal(hand.cards);
      if (total > 21) hand.busted = true;
      hand.stood = true;
      events.push({ t: "player:double" });
    }

    const nextCurrent = blackjackPlugin.getCurrentTurnPlayerId(s);
    if (!nextCurrent) s.phase = "dealerTurn";
    else s.currentPlayerIndex = s.playerIds.indexOf(nextCurrent);

    // Dealer turn if needed
    if (s.phase === "dealerTurn") {
      // Dealer checks blackjack as part of settle (simplified).
      const anyLivePlayer = s.playerIds.some((pid) => !s.players[pid].busted);
      while (anyLivePlayer && dealerShouldHit(s.dealer.cards)) {
        s.dealer.cards.push(draw());
      }
      const dTotal = handTotal(s.dealer.cards).total;
      if (dTotal > 21) s.dealer.busted = true;
      s.dealer.stood = true;
      s.phase = "settled";
      events.push({ t: "dealer:done" });
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => {
    const currentTurnPlayerId = blackjackPlugin.getCurrentTurnPlayerId(s);
    const yourHand = s.players[forPlayerId] ?? { cards: [], stood: false, busted: false, doubled: false };
    const your = handTotal(yourHand.cards);
    const players: BJPublicPlayer[] = s.playerIds.map((pid) => {
      const hand = s.players[pid];
      const { total, soft } = handTotal(hand.cards);
      return {
        playerId: pid,
        cards: hand.cards,
        total,
        soft,
        stood: hand.stood,
        busted: hand.busted,
        doubled: hand.doubled
      };
    });
    return {
      phase: s.phase,
      currentTurnPlayerId,
      yourPlayerId: forPlayerId,
      dealerUpCard: s.dealer.cards[0] ?? null,
      dealerCards: s.phase === "playerTurn" ? [s.dealer.cards[0]].filter(Boolean) as BJCard[] : s.dealer.cards,
      dealerCardsCount: s.phase === "playerTurn" ? 1 : s.dealer.cards.length,
      players,
      yourCards: yourHand.cards,
      yourTotal: your.total,
      yourSoft: your.soft
    };
  },

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const dBJ = isBlackjack(s.dealer.cards);
    const dTotal = handTotal(s.dealer.cards).total;
    const outcomeByPlayer: Record<string, "win" | "lose" | "push"> = {};
    const winners: string[] = [];
    for (const pid of s.playerIds) {
      const hand = s.players[pid];
      const pBJ = isBlackjack(hand.cards);
      const pTotal = handTotal(hand.cards).total;
      let outcome: "win" | "lose" | "push" = "push";
      if (pBJ && !dBJ) outcome = "win";
      else if (!pBJ && dBJ) outcome = "lose";
      else if (hand.busted) outcome = "lose";
      else if (s.dealer.busted) outcome = "win";
      else if (pTotal > dTotal) outcome = "win";
      else if (pTotal < dTotal) outcome = "lose";
      else outcome = "push";
      outcomeByPlayer[pid] = outcome;
      if (outcome === "win") winners.push(pid);
    }

    return {
      winners,
      outcomeByPlayer
    };
  },

  botChooseAction: (s) => {
    // Single-player Blackjack: no bot player actions (dealer is system).
    return { type: "bj:stand" };
  }
};
