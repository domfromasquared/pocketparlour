import type { GamePlugin } from "../../gameInterface.js";

// Board: 8x8. Pieces use dark squares only.
// 0=empty, 1=red, 2=red king, 3=black, 4=black king
export type CkPiece = 0 | 1 | 2 | 3 | 4;
export type CkBoard = CkPiece[][];

export type CkAction =
  | { type: "chk:move"; from: [number, number]; to: [number, number] }
  | { type: "chk:resign" };

export type CkMove = {
  from: [number, number];
  to: [number, number];
  captures: [number, number][];
};

export type CkState = {
  key: "checkers";
  phase: "playing" | "settled";
  playerIds: string[];
  board: CkBoard;
  turn: "red" | "black";
  mustContinueFrom: [number, number] | null;
  winner: string | null;
  moveCount: number;
};

export type CkPublicState = {
  phase: CkState["phase"];
  board: CkBoard;
  turn: "red" | "black";
  turnPlayerId: string | null;
  winner: string | null;
  legalMoves: CkMove[];
  mustContinueFrom: [number, number] | null;
};

function emptyBoard(): CkBoard {
  return Array.from({ length: 8 }, () => Array(8).fill(0) as CkPiece[]);
}

function initialBoard(): CkBoard {
  const b = emptyBoard();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = 3; // black on top rows
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = 1; // red on bottom rows
    }
  }
  return b;
}

function isRed(p: CkPiece): boolean { return p === 1 || p === 2; }
function isBlack(p: CkPiece): boolean { return p === 3 || p === 4; }
function isKing(p: CkPiece): boolean { return p === 2 || p === 4; }
function isMine(p: CkPiece, turn: "red" | "black"): boolean {
  return turn === "red" ? isRed(p) : isBlack(p);
}
function isOpponent(p: CkPiece, turn: "red" | "black"): boolean {
  return turn === "red" ? isBlack(p) : isRed(p);
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function getJumps(board: CkBoard, r: number, c: number, turn: "red" | "black"): CkMove[] {
  const piece = board[r][c];
  const dirs: [number, number][] = [];
  if (turn === "red" || isKing(piece)) dirs.push([-1, -1], [-1, 1]);
  if (turn === "black" || isKing(piece)) dirs.push([1, -1], [1, 1]);

  const jumps: CkMove[] = [];
  for (const [dr, dc] of dirs) {
    const mr = r + dr;
    const mc = c + dc;
    const lr = r + dr * 2;
    const lc = c + dc * 2;
    if (!inBounds(lr, lc)) continue;
    if (isOpponent(board[mr][mc], turn) && board[lr][lc] === 0) {
      jumps.push({ from: [r, c], to: [lr, lc], captures: [[mr, mc]] });
    }
  }
  return jumps;
}

function getSimpleMoves(board: CkBoard, r: number, c: number, turn: "red" | "black"): CkMove[] {
  const piece = board[r][c];
  const dirs: [number, number][] = [];
  if (turn === "red" || isKing(piece)) dirs.push([-1, -1], [-1, 1]);
  if (turn === "black" || isKing(piece)) dirs.push([1, -1], [1, 1]);

  const moves: CkMove[] = [];
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    if (board[nr][nc] === 0) {
      moves.push({ from: [r, c], to: [nr, nc], captures: [] });
    }
  }
  return moves;
}

function getAllLegalMoves(board: CkBoard, turn: "red" | "black", fromSquare: [number, number] | null): CkMove[] {
  const jumps: CkMove[] = [];
  const simples: CkMove[] = [];

  const squares: [number, number][] = fromSquare ? [fromSquare] : [];
  if (!fromSquare) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (isMine(board[r][c], turn)) squares.push([r, c]);
      }
    }
  }

  for (const [r, c] of squares) {
    jumps.push(...getJumps(board, r, c, turn));
    simples.push(...getSimpleMoves(board, r, c, turn));
  }

  return jumps.length > 0 ? jumps : simples;
}

function applyMove(board: CkBoard, move: CkMove): CkBoard {
  const b: CkBoard = board.map(row => row.slice() as CkPiece[]);
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = b[fr][fc];
  b[fr][fc] = 0;
  b[tr][tc] = piece;
  for (const [cr, cc] of move.captures) {
    b[cr][cc] = 0;
  }
  // King promotion
  if (piece === 1 && tr === 0) b[tr][tc] = 2;
  if (piece === 3 && tr === 7) b[tr][tc] = 4;
  return b;
}

function hasAnyMoves(board: CkBoard, turn: "red" | "black"): boolean {
  return getAllLegalMoves(board, turn, null).length > 0;
}

function hasPieces(board: CkBoard, turn: "red" | "black"): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isMine(board[r][c], turn)) return true;
    }
  }
  return false;
}

export const checkersPlugin: GamePlugin<CkState, CkAction, CkPublicState> = {
  key: "checkers",

  createInitialState: ({ seats }) => {
    const playerIds = Array.from({ length: Math.max(2, seats) }, (_, i) => `P${i + 1}`).slice(0, 2);
    return {
      key: "checkers",
      phase: "playing",
      playerIds,
      board: initialBoard(),
      turn: "red",
      mustContinueFrom: null,
      winner: null,
      moveCount: 0
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase !== "playing") return null;
    // Red = seat 0, Black = seat 1
    return s.turn === "red" ? (s.playerIds[0] ?? null) : (s.playerIds[1] ?? null);
  },

  getLegalActions: (s, playerId) => {
    if (s.phase !== "playing") return [];
    const currentPid = s.turn === "red" ? s.playerIds[0] : s.playerIds[1];
    if (currentPid !== playerId) return [];
    const moves = getAllLegalMoves(s.board, s.turn, s.mustContinueFrom);
    return moves.map(m => ({ type: "chk:move" as const, from: m.from, to: m.to }));
  },

  applyAction: (s, action) => {
    const events: any[] = [];

    if (action.type === "chk:resign") {
      const loserTurn = s.turn;
      const winnerIdx = loserTurn === "red" ? 1 : 0;
      s.winner = s.playerIds[winnerIdx] ?? null;
      s.phase = "settled";
      events.push({ t: "resign" });
      return { state: s, events };
    }

    if (action.type === "chk:move") {
      const legal = getAllLegalMoves(s.board, s.turn, s.mustContinueFrom);
      const match = legal.find(m => m.from[0] === action.from[0] && m.from[1] === action.from[1] &&
        m.to[0] === action.to[0] && m.to[1] === action.to[1]);
      if (!match) return { state: s, events };

      s.board = applyMove(s.board, match);
      s.moveCount++;
      events.push({ t: "move", from: match.from, to: match.to, captures: match.captures });

      const wasJump = match.captures.length > 0;
      if (wasJump) {
        // Check for further jumps from landing square
        const furtherJumps = getJumps(s.board, match.to[0], match.to[1], s.turn);
        if (furtherJumps.length > 0) {
          s.mustContinueFrom = match.to;
          return { state: s, events };
        }
      }

      s.mustContinueFrom = null;
      const nextTurn: "red" | "black" = s.turn === "red" ? "black" : "red";

      // Check win conditions
      if (!hasPieces(s.board, nextTurn) || !hasAnyMoves(s.board, nextTurn)) {
        const winnerIdx = s.turn === "red" ? 0 : 1;
        s.winner = s.playerIds[winnerIdx] ?? null;
        s.phase = "settled";
        events.push({ t: "win", winner: s.winner });
      } else {
        s.turn = nextTurn;
      }
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => {
    const legalMoves = s.phase === "playing"
      ? getAllLegalMoves(s.board, s.turn, s.mustContinueFrom)
      : [];
    const currentPid = s.turn === "red" ? s.playerIds[0] : s.playerIds[1];
    return {
      phase: s.phase,
      board: s.board,
      turn: s.turn,
      turnPlayerId: s.phase === "playing" ? currentPid ?? null : null,
      winner: s.winner,
      legalMoves: currentPid === forPlayerId ? legalMoves : [],
      mustContinueFrom: s.mustContinueFrom
    };
  },

  isGameOver: (s) => s.phase === "settled",

  getWinners: (s) => {
    const outcomeByPlayer: Record<string, "win" | "lose" | "push"> = {};
    for (const pid of s.playerIds) {
      outcomeByPlayer[pid] = s.winner === pid ? "win" : s.winner === null ? "push" : "lose";
    }
    return { winners: s.winner ? [s.winner] : [], outcomeByPlayer };
  },

  botChooseAction: (s, botId, difficulty, rng) => {
    const botColor = s.playerIds[0] === botId ? "red" : "black";
    const moves = getAllLegalMoves(s.board, botColor, s.mustContinueFrom);
    if (moves.length === 0) return { type: "chk:resign" };

    // Prefer captures; among those prefer kings
    const jumps = moves.filter(m => m.captures.length > 0);
    const pool = jumps.length > 0 ? jumps : moves;

    if (difficulty >= 3) {
      // Pick move that captures the most pieces
      const best = pool.slice().sort((a, b) => b.captures.length - a.captures.length)[0];
      return { type: "chk:move", from: best.from, to: best.to };
    }
    const pick = pool[Math.floor(rng() * pool.length)];
    return { type: "chk:move", from: pick.from, to: pick.to };
  }
};
