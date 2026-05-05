import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";

export type SolRank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type SolSuit = "S" | "H" | "D" | "C";
export type SolCard = { rank: SolRank; suit: SolSuit; faceUp: boolean };

export type SolFromSpec =
  | { pile: "waste" }
  | { pile: "tableau"; col: number; idx: number }
  | { pile: "foundation"; suit: SolSuit };

export type SolToSpec =
  | { pile: "tableau"; col: number }
  | { pile: "foundation"; suit: SolSuit };

export type SolAction =
  | { type: "sol:draw" }
  | { type: "sol:move"; from: SolFromSpec; to: SolToSpec }
  | { type: "sol:giveUp" };

export type SolState = {
  key: "solitaire";
  phase: "playing" | "won" | "settled";
  playerIds: string[];
  stock: SolCard[];
  waste: SolCard[];
  foundations: Record<SolSuit, SolCard[]>;
  tableau: SolCard[][];
  drawCount: number;
};

export type SolPublicState = {
  phase: SolState["phase"];
  stockCount: number;
  wasteTop: SolCard | null;
  foundations: Record<SolSuit, SolCard[]>;
  tableau: SolCard[][];
  turnPlayerId: string | null;
  won: boolean;
};

const RANKS: SolRank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: SolSuit[] = ["S", "H", "D", "C"];
const RED_SUITS: SolSuit[] = ["H", "D"];

function rankIndex(r: SolRank): number { return RANKS.indexOf(r); }
function isRed(s: SolSuit): boolean { return RED_SUITS.includes(s); }

function buildDeck(rng: () => number): SolCard[] {
  const deck: SolCard[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, faceUp: false });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function canPlaceOnFoundation(card: SolCard, foundation: SolCard[]): boolean {
  if (foundation.length === 0) return card.rank === "A";
  const top = foundation[foundation.length - 1];
  return top.suit === card.suit && rankIndex(card.rank) === rankIndex(top.rank) + 1;
}

function canPlaceOnTableau(card: SolCard, col: SolCard[]): boolean {
  if (col.length === 0) return card.rank === "K";
  const top = col[col.length - 1];
  if (!top.faceUp) return false;
  return isRed(card.suit) !== isRed(top.suit) && rankIndex(card.rank) === rankIndex(top.rank) - 1;
}

function isWon(s: SolState): boolean {
  return SUITS.every(suit => s.foundations[suit].length === 13);
}

export const solitairePlugin: GamePlugin<SolState, SolAction, SolPublicState> = {
  key: "solitaire",

  createInitialState: ({ rngSeed }) => {
    const rng = mulberry32(rngSeed);
    const deck = buildDeck(rng);
    const tableau: SolCard[][] = Array.from({ length: 7 }, () => []);
    let idx = 0;
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const card = { ...deck[idx++] };
        card.faceUp = row === col;
        tableau[col].push(card);
      }
    }
    const stock = deck.slice(idx).map(c => ({ ...c, faceUp: false }));
    const foundations: Record<SolSuit, SolCard[]> = { S: [], H: [], D: [], C: [] };

    return {
      key: "solitaire",
      phase: "playing",
      playerIds: ["P1"],
      stock,
      waste: [],
      foundations,
      tableau,
      drawCount: 0
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase !== "playing") return null;
    return s.playerIds[0] ?? null;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase !== "playing" || s.playerIds[0] !== playerId) return [];
    const actions: SolAction[] = [];

    // Draw
    actions.push({ type: "sol:draw" });
    actions.push({ type: "sol:giveUp" });

    // From waste
    const wasteTop = s.waste.length > 0 ? s.waste[s.waste.length - 1] : null;
    if (wasteTop) {
      for (const suit of SUITS) {
        if (canPlaceOnFoundation(wasteTop, s.foundations[suit])) {
          actions.push({ type: "sol:move", from: { pile: "waste" }, to: { pile: "foundation", suit } });
        }
      }
      for (let col = 0; col < 7; col++) {
        if (canPlaceOnTableau(wasteTop, s.tableau[col])) {
          actions.push({ type: "sol:move", from: { pile: "waste" }, to: { pile: "tableau", col } });
        }
      }
    }

    // From tableau
    for (let col = 0; col < 7; col++) {
      for (let idx = 0; idx < s.tableau[col].length; idx++) {
        const card = s.tableau[col][idx];
        if (!card.faceUp) continue;
        for (const suit of SUITS) {
          if (idx === s.tableau[col].length - 1 && canPlaceOnFoundation(card, s.foundations[suit])) {
            actions.push({ type: "sol:move", from: { pile: "tableau", col, idx }, to: { pile: "foundation", suit } });
          }
        }
        for (let tc = 0; tc < 7; tc++) {
          if (tc === col) continue;
          if (canPlaceOnTableau(card, s.tableau[tc])) {
            actions.push({ type: "sol:move", from: { pile: "tableau", col, idx }, to: { pile: "tableau", col: tc } });
          }
        }
      }
    }

    return actions;
  },

  applyAction: (s, action) => {
    const events: any[] = [];

    if (action.type === "sol:giveUp") {
      s.phase = "settled";
      events.push({ t: "giveUp" });
      return { state: s, events };
    }

    if (action.type === "sol:draw") {
      if (s.stock.length === 0) {
        // Flip waste back to stock
        s.stock = s.waste.reverse().map(c => ({ ...c, faceUp: false }));
        s.waste = [];
        s.drawCount++;
      } else {
        const card = s.stock.pop()!;
        card.faceUp = true;
        s.waste.push(card);
      }
      events.push({ t: "draw" });
      return { state: s, events };
    }

    if (action.type === "sol:move") {
      const { from, to } = action;
      let cards: SolCard[] = [];

      // Pick up cards
      if (from.pile === "waste") {
        if (s.waste.length === 0) return { state: s, events };
        cards = [s.waste.pop()!];
      } else if (from.pile === "tableau") {
        const col = s.tableau[from.col];
        if (from.idx < 0 || from.idx >= col.length) return { state: s, events };
        cards = col.splice(from.idx);
        // Flip newly exposed card
        const exposed = col[col.length - 1];
        if (exposed && !exposed.faceUp) exposed.faceUp = true;
      } else if (from.pile === "foundation") {
        const found = s.foundations[from.suit];
        if (found.length === 0) return { state: s, events };
        cards = [found.pop()!];
      }

      if (cards.length === 0) return { state: s, events };

      // Place cards
      if (to.pile === "tableau") {
        for (const c of cards) s.tableau[to.col].push({ ...c, faceUp: true });
      } else if (to.pile === "foundation") {
        if (cards.length !== 1) return { state: s, events };
        s.foundations[to.suit].push({ ...cards[0], faceUp: true });
      }

      events.push({ t: "move", from, to });

      if (isWon(s)) {
        s.phase = "won";
        events.push({ t: "won" });
      }
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => ({
    phase: s.phase,
    stockCount: s.stock.length,
    wasteTop: s.waste.length > 0 ? s.waste[s.waste.length - 1] : null,
    foundations: s.foundations,
    tableau: s.tableau,
    turnPlayerId: s.phase === "playing" ? (s.playerIds[0] ?? null) : null,
    won: s.phase === "won"
  }),

  isGameOver: (s) => s.phase === "won" || s.phase === "settled",

  getWinners: (s) => {
    const pid = s.playerIds[0] ?? "P1";
    if (s.phase === "won") {
      return { winners: [pid], outcomeByPlayer: { [pid]: "win" } };
    }
    return { winners: [], outcomeByPlayer: { [pid]: "lose" } };
  },

  botChooseAction: () => ({ type: "sol:giveUp" })
};
