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
  playerId: string;
  dealer: BJHand;
  player: BJHand;
  shoeSeed: number;
};

export type BJPublicState = {
  phase: BJState["phase"];
  dealerUpCard: BJCard | null;
  dealerCardsCount: number;
  playerCards: BJCard[];
  playerTotal: number;
  playerSoft: boolean;
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

  createInitialState: ({ rngSeed }) => {
    const shoe = freshShoe(rngSeed);
    const draw = () => shoe.pop()!;
    const playerId = "P1"; // server maps actual userId; plugin stays generic
    const player: BJHand = { cards: [draw(), draw()], stood: false, busted: false, doubled: false };
    const dealer: BJHand = { cards: [draw(), draw()], stood: false, busted: false, doubled: false };
    return {
      key: "blackjack",
      phase: "playerTurn",
      playerId,
      dealer,
      player,
      shoeSeed: rngSeed
    };
  },

  getCurrentTurnPlayerId: (s) => (s.phase === "playerTurn" ? s.playerId : null),

  getLegalActions: (s, playerId) => {
    if (s.phase !== "playerTurn") return [];
    if (playerId !== s.playerId) return [];
    if (s.player.busted || s.player.stood) return [];
    const actions: BJAction[] = [{ type: "bj:hit" }, { type: "bj:stand" }];
    if (s.player.cards.length === 2) actions.push({ type: "bj:double" });
    return actions;
  },

  applyAction: (s, action, ctx) => {
    const shoe = freshShoe(s.shoeSeed); // deterministic shoe reconstruction
    // Consume the same amount of draws as initial deal + subsequent draws already made.
    // For v1: we replay from seed each time for determinism; store drawCount in a real impl.
    // TODO: store and advance a persistent shoe index rather than replaying.
    const drawFrom = (n: number) => {
      for (let i=0;i<n;i++) shoe.pop();
      return shoe.pop()!;
    };

    const events: any[] = [];

    const initialConsumed = 4; // player2 + dealer2
    let consumed = initialConsumed + (s.player.cards.length - 2) + (s.dealer.cards.length - 2);

    const draw = () => {
      const c = drawFrom(consumed);
      consumed += 1;
      return c;
    };

    if (s.phase !== "playerTurn") return { state: s, events };

    if (action.type === "bj:hit") {
      s.player.cards.push(draw());
      const { total } = handTotal(s.player.cards);
      if (total > 21) {
        s.player.busted = true;
        s.phase = "dealerTurn";
        events.push({ t: "player:bust" });
      }
    } else if (action.type === "bj:stand") {
      s.player.stood = true;
      s.phase = "dealerTurn";
    } else if (action.type === "bj:double") {
      // Take exactly one card then stand. :contentReference[oaicite:4]{index=4}
      s.player.doubled = true;
      s.player.cards.push(draw());
      const { total } = handTotal(s.player.cards);
      if (total > 21) s.player.busted = true;
      s.player.stood = true;
      s.phase = "dealerTurn";
      events.push({ t: "player:double" });
    }

    // Dealer turn if needed
    if (s.phase === "dealerTurn") {
      // Dealer checks blackjack as part of settle (simplified).
      while (!s.player.busted && dealerShouldHit(s.dealer.cards)) {
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

  getPublicState: (s) => {
    const { total, soft } = handTotal(s.player.cards);
    return {
      phase: s.phase,
      dealerUpCard: s.dealer.cards[0] ?? null,
      dealerCardsCount: s.phase === "playerTurn" ? 1 : s.dealer.cards.length,
      playerCards: s.player.cards,
      playerTotal: total,
      playerSoft: soft
    };
  },

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const pBJ = isBlackjack(s.player.cards);
    const dBJ = isBlackjack(s.dealer.cards);
    const pTotal = handTotal(s.player.cards).total;
    const dTotal = handTotal(s.dealer.cards).total;

    let outcome: "win" | "lose" | "push" = "push";
    if (pBJ && !dBJ) outcome = "win";
    else if (!pBJ && dBJ) outcome = "lose";
    else if (s.player.busted) outcome = "lose";
    else if (s.dealer.busted) outcome = "win";
    else if (pTotal > dTotal) outcome = "win";
    else if (pTotal < dTotal) outcome = "lose";
    else outcome = "push";

    return {
      winners: outcome === "win" ? [s.playerId] : [],
      outcomeByPlayer: { [s.playerId]: outcome }
    };
  },

  botChooseAction: (s) => {
    // Single-player Blackjack: no bot player actions (dealer is system).
    return { type: "bj:stand" };
  }
};
