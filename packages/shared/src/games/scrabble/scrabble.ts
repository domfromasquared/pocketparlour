import type { GamePlugin } from "../../gameInterface.js";
import { mulberry32 } from "../../rng.js";
import { isValidWord } from "./wordlist.js";

export type ScrAction =
  | { type: "scr:place"; tiles: { letter: string; row: number; col: number }[] }
  | { type: "scr:exchange"; letters: string[] }
  | { type: "scr:pass" };

export type ScrState = {
  key: "scrabble";
  phase: "playing" | "settled";
  playerIds: string[];
  board: (string | null)[][];
  bag: string[];
  racks: Record<string, string[]>;
  scores: Record<string, number>;
  turnIndex: number;
  consecutivePasses: number;
  winner: string | null;
  lastPlay: { playerId: string; word: string; score: number } | null;
};

export type ScrPublicState = {
  phase: ScrState["phase"];
  board: (string | null)[][];
  yourRack: string[];
  rackSizes: Record<string, number>;
  bagCount: number;
  scores: Record<string, number>;
  turnPlayerId: string | null;
  lastPlay: { playerId: string; word: string; score: number } | null;
  winner: string | null;
};

// Tile distribution and point values
const TILE_DIST: [string, number, number][] = [
  ["A",9,1],["B",2,3],["C",2,3],["D",4,2],["E",12,1],["F",2,4],["G",3,2],["H",2,4],
  ["I",9,1],["J",1,8],["K",1,5],["L",4,1],["M",2,3],["N",6,1],["O",8,1],["P",2,3],
  ["Q",1,10],["R",6,1],["S",4,1],["T",6,1],["U",4,1],["V",2,4],["W",2,4],["X",1,8],
  ["Y",2,4],["Z",1,10],["?",2,0]
];

const TILE_POINTS: Record<string, number> = Object.fromEntries(
  TILE_DIST.map(([l,,p]) => [l, p])
);

function buildBag(rng: () => number): string[] {
  const bag: string[] = [];
  for (const [letter, count] of TILE_DIST) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// Premium square types: TW=triple word, DW=double word, TL=triple letter, DL=double letter
type Premium = "TW" | "DW" | "TL" | "DL" | null;
const PREMIUM_MAP: Record<string, Premium> = {};
const TW = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
const DW = [[1,1],[2,2],[3,3],[4,4],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1],[7,7]];
const TL = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]];
const DL = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]];
for (const [r,c] of TW) PREMIUM_MAP[`${r},${c}`] = "TW";
for (const [r,c] of DW) PREMIUM_MAP[`${r},${c}`] = "DW";
for (const [r,c] of TL) PREMIUM_MAP[`${r},${c}`] = "TL";
for (const [r,c] of DL) PREMIUM_MAP[`${r},${c}`] = "DL";

function premium(r: number, c: number): Premium {
  return PREMIUM_MAP[`${r},${c}`] ?? null;
}

function emptyBoard(): (string | null)[][] {
  return Array.from({ length: 15 }, () => Array(15).fill(null));
}

function hasNeighbor(board: (string | null)[][], r: number, c: number): boolean {
  return (
    (r > 0 && board[r-1][c] !== null) ||
    (r < 14 && board[r+1][c] !== null) ||
    (c > 0 && board[r][c-1] !== null) ||
    (c < 14 && board[r][c+1] !== null)
  );
}

type PlacedTile = { letter: string; row: number; col: number };

function validatePlacement(board: (string | null)[][], tiles: PlacedTile[]): { valid: boolean; reason?: string; words: { word: string; score: number }[] } {
  if (tiles.length === 0) return { valid: false, reason: "No tiles placed", words: [] };

  // Check all on same row or same column
  const rows = [...new Set(tiles.map(t => t.row))];
  const cols = [...new Set(tiles.map(t => t.col))];
  const isHorizontal = rows.length === 1;
  const isVertical = cols.length === 1;
  if (!isHorizontal && !isVertical && tiles.length > 1) {
    return { valid: false, reason: "Tiles must be in a row or column", words: [] };
  }

  // Check no overlap with existing tiles
  for (const t of tiles) {
    if (board[t.row][t.col] !== null) return { valid: false, reason: "Tile already placed there", words: [] };
  }

  // Check first move covers center (7,7)
  const isEmpty = board.every(row => row.every(c => c === null));
  if (isEmpty) {
    if (!tiles.some(t => t.row === 7 && t.col === 7)) {
      return { valid: false, reason: "First move must cover center square", words: [] };
    }
  } else {
    // Must connect to existing tile
    const connects = tiles.some(t => hasNeighbor(board, t.row, t.col) || board[t.row][t.col] !== null);
    if (!connects) return { valid: false, reason: "Tiles must connect to existing tiles", words: [] };
  }

  // Build temp board
  const tmp = board.map(row => row.slice());
  for (const t of tiles) tmp[t.row][t.col] = t.letter;

  // Collect words formed
  const words: { word: string; score: number; placedIndices: Set<string> }[] = [];
  const placedSet = new Set(tiles.map(t => `${t.row},${t.col}`));

  const getWord = (startR: number, startC: number, dr: number, dc: number): { word: string; score: number; placedIndices: Set<string> } | null => {
    // Walk to beginning
    let r = startR;
    let c = startC;
    while (r - dr >= 0 && r - dr < 15 && c - dc >= 0 && c - dc < 15 && tmp[r-dr][c-dc] !== null) {
      r -= dr; c -= dc;
    }
    let word = "";
    let score = 0;
    let wordMult = 1;
    const indices = new Set<string>();
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && tmp[r][c] !== null) {
      const letter = tmp[r][c]!;
      const key = `${r},${c}`;
      const isNew = placedSet.has(key);
      let pts = TILE_POINTS[letter] ?? 0;
      if (isNew) {
        indices.add(key);
        const p = premium(r, c);
        if (p === "TL") pts *= 3;
        else if (p === "DL") pts *= 2;
        else if (p === "TW") wordMult *= 3;
        else if (p === "DW") wordMult *= 2;
      }
      word += letter;
      score += pts;
      r += dr; c += dc;
    }
    if (word.length < 2) return null;
    return { word, score: score * wordMult, placedIndices: indices };
  };

  if (isHorizontal || tiles.length === 1) {
    const w = getWord(tiles[0].row, tiles[0].col, 0, 1);
    if (w && w.word.length >= 2) words.push(w);
    // Perpendicular words
    for (const t of tiles) {
      const vw = getWord(t.row, t.col, 1, 0);
      if (vw && vw.word.length >= 2) words.push(vw);
    }
  }
  if (isVertical) {
    const w = getWord(tiles[0].row, tiles[0].col, 1, 0);
    if (w && w.word.length >= 2) words.push(w);
    for (const t of tiles) {
      const hw = getWord(t.row, t.col, 0, 1);
      if (hw && hw.word.length >= 2) words.push(hw);
    }
  }

  // Validate all words
  for (const w of words) {
    if (!isValidWord(w.word)) {
      return { valid: false, reason: `"${w.word}" is not a valid word`, words: [] };
    }
  }

  // 50-point bingo bonus for using all 7 tiles
  const totalScore = words.reduce((s, w) => s + w.score, 0) + (tiles.length === 7 ? 50 : 0);
  return { valid: true, words: words.map(w => ({ word: w.word, score: w.score })) };
}

function draw(bag: string[], rack: string[], count: number): void {
  const needed = Math.min(count, bag.length);
  for (let i = 0; i < needed; i++) {
    rack.push(bag.pop()!);
  }
}

export const scrabblePlugin: GamePlugin<ScrState, ScrAction, ScrPublicState> = {
  key: "scrabble",

  createInitialState: ({ seats, rngSeed }) => {
    const rng = mulberry32(rngSeed);
    const playerIds = Array.from({ length: seats }, (_, i) => `P${i + 1}`);
    const bag = buildBag(rng);
    const racks: Record<string, string[]> = {};
    for (const pid of playerIds) {
      racks[pid] = [];
      draw(bag, racks[pid], 7);
    }
    return {
      key: "scrabble",
      phase: "playing",
      playerIds,
      board: emptyBoard(),
      bag,
      racks,
      scores: Object.fromEntries(playerIds.map(pid => [pid, 0])),
      turnIndex: 0,
      consecutivePasses: 0,
      winner: null,
      lastPlay: null
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase !== "playing") return null;
    return s.playerIds[s.turnIndex] ?? null;
  },

  getLegalActions: (s, playerId) => {
    if (s.phase !== "playing" || s.playerIds[s.turnIndex] !== playerId) return [];
    const rack = s.racks[playerId] ?? [];
    const actions: ScrAction[] = [{ type: "scr:pass" }];
    if (rack.length > 0 && s.bag.length >= rack.length) {
      actions.push({ type: "scr:exchange", letters: rack.slice(0, 1) });
    }
    return actions;
  },

  applyAction: (s, action) => {
    const events: any[] = [];
    const pid = s.playerIds[s.turnIndex];

    if (action.type === "scr:pass") {
      s.consecutivePasses++;
      s.lastPlay = null;
      events.push({ t: "pass", playerId: pid });

      if (s.consecutivePasses >= s.playerIds.length * 2) {
        endGame(s);
        events.push({ t: "end" });
      } else {
        s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      }
    }

    if (action.type === "scr:exchange") {
      const rack = s.racks[pid];
      if (!rack || s.bag.length < action.letters.length) return { state: s, events };
      for (const letter of action.letters) {
        const idx = rack.indexOf(letter);
        if (idx !== -1) rack.splice(idx, 1);
      }
      draw(s.bag, rack, action.letters.length);
      s.bag.push(...action.letters);
      s.consecutivePasses++;
      s.lastPlay = null;
      events.push({ t: "exchange", playerId: pid });
      s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
    }

    if (action.type === "scr:place") {
      const rack = s.racks[pid];
      if (!rack) return { state: s, events };

      const { valid, reason, words } = validatePlacement(s.board, action.tiles);
      if (!valid) {
        events.push({ t: "invalid", reason });
        return { state: s, events };
      }

      const turnScore = words.reduce((sum, w) => sum + w.score, 0) + (action.tiles.length === 7 ? 50 : 0);

      // Remove tiles from rack
      const usedLetters = action.tiles.map(t => t.letter);
      for (const letter of usedLetters) {
        const idx = rack.indexOf(letter);
        if (idx !== -1) rack.splice(idx, 1);
      }

      // Place on board
      for (const t of action.tiles) {
        s.board[t.row][t.col] = t.letter;
      }

      // Draw replacement tiles
      draw(s.bag, rack, usedLetters.length);

      s.scores[pid] = (s.scores[pid] ?? 0) + turnScore;
      s.consecutivePasses = 0;
      const mainWord = words[0]?.word ?? "";
      s.lastPlay = { playerId: pid, word: mainWord, score: turnScore };
      events.push({ t: "place", playerId: pid, tiles: action.tiles, score: turnScore, word: mainWord });

      // Check if this player emptied rack and bag is empty
      if (rack.length === 0 && s.bag.length === 0) {
        endGame(s, pid);
        events.push({ t: "end" });
      } else {
        s.turnIndex = (s.turnIndex + 1) % s.playerIds.length;
      }
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => ({
    phase: s.phase,
    board: s.board,
    yourRack: s.racks[forPlayerId] ?? [],
    rackSizes: Object.fromEntries(s.playerIds.map(pid => [pid, (s.racks[pid] ?? []).length])),
    bagCount: s.bag.length,
    scores: s.scores,
    turnPlayerId: s.phase === "playing" ? (s.playerIds[s.turnIndex] ?? null) : null,
    lastPlay: s.lastPlay,
    winner: s.winner
  }),

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const outcomeByPlayer: Record<string, "win" | "lose" | "push"> = {};
    for (const pid of s.playerIds) {
      outcomeByPlayer[pid] = s.winner === pid ? "win" : s.winner === null ? "push" : "lose";
    }
    return { winners: s.winner ? [s.winner] : [], outcomeByPlayer };
  },

  botChooseAction: (s, botId) => {
    const rack = s.racks[botId] ?? [];
    if (rack.length > 0 && s.bag.length >= rack.length) {
      return { type: "scr:exchange", letters: rack.slice(0, Math.min(3, rack.length)) };
    }
    return { type: "scr:pass" };
  }
};

function endGame(s: ScrState, outPlayerId?: string): void {
  // Deduct remaining rack values; if outPlayerId, they get sum of others' racks
  let bonusForOut = 0;
  for (const pid of s.playerIds) {
    const rackVal = (s.racks[pid] ?? []).reduce((sum, l) => sum + (TILE_POINTS[l] ?? 0), 0);
    if (pid !== outPlayerId) {
      s.scores[pid] = (s.scores[pid] ?? 0) - rackVal;
      bonusForOut += rackVal;
    }
  }
  if (outPlayerId) {
    s.scores[outPlayerId] = (s.scores[outPlayerId] ?? 0) + bonusForOut;
  }

  const sorted = s.playerIds.slice().sort((a, b) => (s.scores[b] ?? 0) - (s.scores[a] ?? 0));
  s.winner = sorted[0] ?? null;
  s.phase = "settled";
}
