import type { GamePlugin } from "../../gameInterface.js";

export type ChessColor = "w" | "b";
export type ChessPieceType = "K" | "Q" | "R" | "B" | "N" | "P";
export type ChessPiece = `${ChessColor}${ChessPieceType}` | "";

export type ChessAction =
  | { type: "chess:move"; from: [number, number]; to: [number, number]; promotion?: ChessPieceType }
  | { type: "chess:resign" };

export type ChessMove = {
  from: [number, number];
  to: [number, number];
  promotion?: ChessPieceType;
};

export type ChessState = {
  key: "chess";
  phase: "playing" | "check" | "checkmate" | "stalemate" | "draw" | "settled";
  playerIds: string[];
  board: ChessPiece[][];
  turn: ChessColor;
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  enPassant: [number, number] | null;
  halfmove: number;
  fullmove: number;
  winner: string | null;
};

export type ChessPublicState = {
  phase: ChessState["phase"];
  board: ChessPiece[][];
  turn: ChessColor;
  turnPlayerId: string | null;
  winner: string | null;
  legalMoves: ChessMove[];
  enPassant: [number, number] | null;
  check: boolean;
};

function emptyBoard(): ChessPiece[][] {
  return Array.from({ length: 8 }, () => Array(8).fill("") as ChessPiece[]);
}

function initialBoard(): ChessPiece[][] {
  const b = emptyBoard();
  const back: ChessPieceType[] = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let c = 0; c < 8; c++) {
    b[0][c] = `b${back[c]}` as ChessPiece;
    b[1][c] = "bP";
    b[6][c] = "wP";
    b[7][c] = `w${back[c]}` as ChessPiece;
  }
  return b;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function colorOf(p: ChessPiece): ChessColor | null {
  if (!p) return null;
  return p[0] as ChessColor;
}

function typeOf(p: ChessPiece): ChessPieceType | null {
  if (!p) return null;
  return p[1] as ChessPieceType;
}

function opponent(c: ChessColor): ChessColor {
  return c === "w" ? "b" : "w";
}

function isAttacked(board: ChessPiece[][], r: number, c: number, byColor: ChessColor): boolean {
  // Pawns
  const pawnDir = byColor === "w" ? 1 : -1;
  for (const dc of [-1, 1]) {
    const pr = r + pawnDir;
    const pc = c + dc;
    if (inBounds(pr, pc) && board[pr][pc] === `${byColor}P`) return true;
  }
  // Knights
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as [number,number][]) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === `${byColor}N`) return true;
  }
  // King
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] as [number,number][]) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === `${byColor}K`) return true;
  }
  // Sliding pieces
  const diags: [number,number][] = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const straights: [number,number][] = [[-1,0],[1,0],[0,-1],[0,1]];
  for (const [dr, dc] of diags) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === "B" || typeOf(p) === "Q")) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  for (const [dr, dc] of straights) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === "R" || typeOf(p) === "Q")) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return false;
}

function findKing(board: ChessPiece[][], color: ChessColor): [number, number] | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === `${color}K`) return [r, c];
    }
  }
  return null;
}

function isInCheck(board: ChessPiece[][], color: ChessColor): boolean {
  const kp = findKing(board, color);
  if (!kp) return false;
  return isAttacked(board, kp[0], kp[1], opponent(color));
}

function applyMoveOnBoard(board: ChessPiece[][], from: [number,number], to: [number,number], promotion?: ChessPieceType, enPassant?: [number,number] | null): ChessPiece[][] {
  const b = board.map(row => row.slice() as ChessPiece[]);
  const [fr, fc] = from;
  const [tr, tc] = to;
  const piece = b[fr][fc];

  // En passant capture
  if (typeOf(piece) === "P" && enPassant && tr === enPassant[0] && tc === enPassant[1]) {
    const capturedRow = fr;
    b[capturedRow][tc] = "";
  }

  // Castling move
  if (typeOf(piece) === "K" && Math.abs(tc - fc) === 2) {
    if (tc === 6) { // Kingside
      b[tr][5] = b[tr][7];
      b[tr][7] = "";
    } else { // Queenside
      b[tr][3] = b[tr][0];
      b[tr][0] = "";
    }
  }

  b[fr][fc] = "";
  b[tr][tc] = promotion ? `${colorOf(piece)}${promotion}` as ChessPiece : piece;
  return b;
}

function getPseudoMoves(board: ChessPiece[][], r: number, c: number, castling: ChessState["castling"], enPassant: [number,number] | null): [number,number][] {
  const piece = board[r][c];
  if (!piece) return [];
  const color = colorOf(piece)!;
  const type = typeOf(piece)!;
  const moves: [number,number][] = [];

  if (type === "P") {
    const dir = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const nr = r + dir;
    if (inBounds(nr, c) && !board[nr][c]) {
      moves.push([nr, c]);
      if (r === startRow && !board[r + dir * 2][c]) moves.push([r + dir * 2, c]);
    }
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      if (colorOf(board[nr][nc]) === opponent(color)) moves.push([nr, nc]);
      if (enPassant && nr === enPassant[0] && nc === enPassant[1]) moves.push([nr, nc]);
    }
  }

  if (type === "N") {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as [number,number][]) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && colorOf(board[nr][nc]) !== color) moves.push([nr, nc]);
    }
  }

  if (type === "K") {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] as [number,number][]) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && colorOf(board[nr][nc]) !== color) moves.push([nr, nc]);
    }
    // Castling
    const row = color === "w" ? 7 : 0;
    if (r === row && c === 4 && !isInCheck(board, color)) {
      const kRight = color === "w" ? castling.wK : castling.bK;
      const kLeft = color === "w" ? castling.wQ : castling.bQ;
      if (kRight && !board[row][5] && !board[row][6] &&
          !isAttacked(board, row, 5, opponent(color)) && !isAttacked(board, row, 6, opponent(color))) {
        moves.push([row, 6]);
      }
      if (kLeft && !board[row][3] && !board[row][2] && !board[row][1] &&
          !isAttacked(board, row, 3, opponent(color)) && !isAttacked(board, row, 2, opponent(color))) {
        moves.push([row, 2]);
      }
    }
  }

  const sliding: [ChessPieceType[], [number,number][]][] = [
    [["B", "Q"], [[-1,-1],[-1,1],[1,-1],[1,1]]],
    [["R", "Q"], [[-1,0],[1,0],[0,-1],[0,1]]]
  ];
  for (const [types, dirs] of sliding) {
    if (!types.includes(type)) continue;
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push([nr, nc]);
        } else {
          if (colorOf(target) !== color) moves.push([nr, nc]);
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }

  return moves;
}

function getLegalMoves(s: ChessState): ChessMove[] {
  const moves: ChessMove[] = [];
  const color = s.turn;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (colorOf(s.board[r][c]) !== color) continue;
      const targets = getPseudoMoves(s.board, r, c, s.castling, s.enPassant);
      for (const [tr, tc] of targets) {
        const newBoard = applyMoveOnBoard(s.board, [r, c], [tr, tc], undefined, s.enPassant);
        if (isInCheck(newBoard, color)) continue;
        const piece = s.board[r][c];
        if (typeOf(piece) === "P" && (tr === 0 || tr === 7)) {
          for (const promo of ["Q", "R", "B", "N"] as ChessPieceType[]) {
            const promoBoard = applyMoveOnBoard(s.board, [r, c], [tr, tc], promo, s.enPassant);
            if (!isInCheck(promoBoard, color)) {
              moves.push({ from: [r, c], to: [tr, tc], promotion: promo });
            }
          }
        } else {
          moves.push({ from: [r, c], to: [tr, tc] });
        }
      }
    }
  }
  return moves;
}

function updateCastlingRights(castling: ChessState["castling"], from: [number,number], to: [number,number]): ChessState["castling"] {
  const c = { ...castling };
  const [fr, fc] = from;
  const [tr, tc] = to;
  if (fr === 7 && fc === 4) { c.wK = false; c.wQ = false; }
  if (fr === 0 && fc === 4) { c.bK = false; c.bQ = false; }
  if (fr === 7 && fc === 7) c.wK = false;
  if (fr === 7 && fc === 0) c.wQ = false;
  if (fr === 0 && fc === 7) c.bK = false;
  if (fr === 0 && fc === 0) c.bQ = false;
  if (tr === 7 && tc === 7) c.wK = false;
  if (tr === 7 && tc === 0) c.wQ = false;
  if (tr === 0 && tc === 7) c.bK = false;
  if (tr === 0 && tc === 0) c.bQ = false;
  return c;
}

export const chessPlugin: GamePlugin<ChessState, ChessAction, ChessPublicState> = {
  key: "chess",

  createInitialState: ({ seats }) => {
    const playerIds = Array.from({ length: Math.max(2, seats) }, (_, i) => `P${i + 1}`).slice(0, 2);
    return {
      key: "chess",
      phase: "playing",
      playerIds,
      board: initialBoard(),
      turn: "w",
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      halfmove: 0,
      fullmove: 1,
      winner: null
    };
  },

  getCurrentTurnPlayerId: (s) => {
    if (s.phase === "settled" || s.phase === "checkmate" || s.phase === "stalemate" || s.phase === "draw") return null;
    return s.turn === "w" ? (s.playerIds[0] ?? null) : (s.playerIds[1] ?? null);
  },

  getLegalActions: (s, playerId) => {
    const currentPid = s.turn === "w" ? s.playerIds[0] : s.playerIds[1];
    if (currentPid !== playerId) return [];
    return getLegalMoves(s).map(m => ({ type: "chess:move" as const, ...m }));
  },

  applyAction: (s, action) => {
    const events: any[] = [];

    if (action.type === "chess:resign") {
      const loserColor = s.turn;
      const winnerIdx = loserColor === "w" ? 1 : 0;
      s.winner = s.playerIds[winnerIdx] ?? null;
      s.phase = "settled";
      events.push({ t: "resign" });
      return { state: s, events };
    }

    if (action.type === "chess:move") {
      const legal = getLegalMoves(s);
      const match = legal.find(m =>
        m.from[0] === action.from[0] && m.from[1] === action.from[1] &&
        m.to[0] === action.to[0] && m.to[1] === action.to[1] &&
        (m.promotion ?? null) === (action.promotion ?? null)
      );
      if (!match) return { state: s, events };

      const piece = s.board[action.from[0]][action.from[1]];
      const isCapture = !!s.board[action.to[0]][action.to[1]];
      const isPawn = typeOf(piece) === "P";

      s.board = applyMoveOnBoard(s.board, action.from, action.to, action.promotion, s.enPassant);
      s.castling = updateCastlingRights(s.castling, action.from, action.to);

      // En passant target
      if (isPawn && Math.abs(action.to[0] - action.from[0]) === 2) {
        s.enPassant = [(action.from[0] + action.to[0]) / 2, action.from[1]];
      } else {
        s.enPassant = null;
      }

      s.halfmove = isPawn || isCapture ? 0 : s.halfmove + 1;
      if (s.turn === "b") s.fullmove++;

      events.push({ t: "move", from: action.from, to: action.to, promotion: action.promotion });

      const nextTurn = opponent(s.turn);
      s.turn = nextTurn;

      const nextLegal = getLegalMoves(s);
      const nextInCheck = isInCheck(s.board, nextTurn);

      if (nextLegal.length === 0) {
        if (nextInCheck) {
          s.phase = "checkmate";
          const winnerIdx = nextTurn === "w" ? 1 : 0;
          s.winner = s.playerIds[winnerIdx] ?? null;
          events.push({ t: "checkmate", winner: s.winner });
        } else {
          s.phase = "stalemate";
          events.push({ t: "stalemate" });
        }
      } else if (s.halfmove >= 100) {
        s.phase = "draw";
        events.push({ t: "draw50move" });
      } else if (nextInCheck) {
        s.phase = "check";
      } else {
        s.phase = "playing";
      }
    }

    return { state: s, events };
  },

  getPublicState: (s, forPlayerId) => {
    const currentPid = s.turn === "w" ? s.playerIds[0] : s.playerIds[1];
    const isGameOver = s.phase === "settled" || s.phase === "checkmate" || s.phase === "stalemate" || s.phase === "draw";
    const legalMoves = (!isGameOver && currentPid === forPlayerId) ? getLegalMoves(s) : [];
    return {
      phase: s.phase,
      board: s.board,
      turn: s.turn,
      turnPlayerId: isGameOver ? null : currentPid ?? null,
      winner: s.winner,
      legalMoves,
      enPassant: s.enPassant,
      check: s.phase === "check"
    };
  },

  isGameOver: (s) => s.phase === "checkmate" || s.phase === "stalemate" || s.phase === "draw" || s.phase === "settled",

  getWinners: (s) => {
    if (s.phase === "stalemate" || s.phase === "draw") {
      return {
        winners: [],
        outcomeByPlayer: Object.fromEntries(s.playerIds.map(pid => [pid, "push" as const]))
      };
    }
    const outcomeByPlayer: Record<string, "win" | "lose" | "push"> = {};
    for (const pid of s.playerIds) {
      outcomeByPlayer[pid] = s.winner === pid ? "win" : s.winner === null ? "push" : "lose";
    }
    return { winners: s.winner ? [s.winner] : [], outcomeByPlayer };
  },

  botChooseAction: (s, botId) => {
    const color = s.playerIds[0] === botId ? "w" : "b";
    if (s.turn !== color) return { type: "chess:move", from: [0, 0], to: [0, 0] };
    const moves = getLegalMoves(s);
    if (moves.length === 0) return { type: "chess:resign" };

    // Prefer captures, then checks, then random
    const captures = moves.filter(m => !!s.board[m.to[0]][m.to[1]]);
    const pool = captures.length > 0 ? captures : moves;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { type: "chess:move", from: pick.from, to: pick.to, promotion: pick.promotion };
  }
};
