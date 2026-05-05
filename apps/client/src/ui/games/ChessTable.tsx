import React, { useState } from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";

type ChessPiece = string;

const PIECE_UNICODE: Record<string, string> = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟"
};

const PROMO_PIECES = ["Q", "R", "B", "N"] as const;

export function ChessTable() {
  const { publicState, lastResult, clearLastResult, room, userId } = useApp();
  const socket = getSocket();
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [promoTarget, setPromoTarget] = useState<{ from: [number, number]; to: [number, number] } | null>(null);

  const board: ChessPiece[][] = publicState?.board ?? Array.from({ length: 8 }, () => Array(8).fill(""));
  const turn: "w" | "b" = publicState?.turn ?? "w";
  const turnPlayerId: string | null = publicState?.turnPlayerId ?? null;
  const legalMoves: { from: [number, number]; to: [number, number]; promotion?: string }[] = publicState?.legalMoves ?? [];
  const winner: string | null = publicState?.winner ?? null;
  const check: boolean = publicState?.check ?? false;
  const phase: string = publicState?.phase ?? "playing";
  const seats = room?.seats ?? [];

  const isMyTurn = turnPlayerId === userId;
  const myColor: "w" | "b" = seats.find(s => s.userId === userId)?.seatIndex === 0 ? "w" : "b";
  const flipped = myColor === "b";

  const selectedMoves = selected ? legalMoves.filter(m => m.from[0] === selected[0] && m.from[1] === selected[1]) : [];

  const sendMove = (from: [number, number], to: [number, number], promotion?: string) => {
    socket?.emit("evt", { type: "game:action", action: { type: "chess:move", from, to, promotion } });
    setSelected(null);
    setPromoTarget(null);
  };

  const handleSquare = (r: number, c: number) => {
    if (!isMyTurn) return;
    if (promoTarget) return;

    if (selected) {
      const move = selectedMoves.find(m => m.to[0] === r && m.to[1] === c);
      if (move) {
        if (move.promotion) {
          setPromoTarget({ from: selected, to: [r, c] });
        } else {
          sendMove(selected, [r, c]);
        }
        return;
      }
    }

    const piece = board[r][c];
    if (piece && piece[0] === myColor) {
      const hasMoves = legalMoves.some(m => m.from[0] === r && m.from[1] === c);
      if (hasMoves) { setSelected([r, c]); return; }
    }
    setSelected(null);
  };

  const displayR = (r: number) => flipped ? 7 - r : r;
  const displayC = (c: number) => flipped ? 7 - c : c;
  const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

  const outcomeLabel = lastResult?.outcome === "win" ? "You Win!" : lastResult?.outcome === "lose" ? "You Lose" : lastResult?.outcome === "push" ? "Draw" : "";

  const gameOverMsg = phase === "checkmate" ? "Checkmate" : phase === "stalemate" ? "Stalemate" : phase === "draw" ? "Draw (50-move rule)" : "";

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Chess {check && !winner ? "— Check!" : ""}</div>
        <div className="panel-subtle">
          {gameOverMsg || (isMyTurn ? "Your turn" : `${seats.find(s => s.userId === turnPlayerId)?.displayName ?? "Opponent"}'s turn`)}
        </div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 6 }}>

            {/* Opponent label */}
            {(() => {
              const opp = seats.find(s => s.userId !== userId);
              return opp ? (
                <div className={`panel px-2 py-1 text-center ${opp.userId === turnPlayerId ? "badge-glow" : ""}`}>
                  <span>{flipped ? "♙ " : "♟ "}</span>
                  <span className="panel-subtle" style={{ fontSize: 11 }}>{opp.displayName}</span>
                </div>
              ) : null;
            })()}

            {/* Board */}
            <div style={{ position: "relative" }}>
              <div style={{ display: "grid", gridTemplateColumns: "16px repeat(8, 1fr)", gridTemplateRows: "repeat(8, 1fr) 16px", width: "min(300px, 92vw)", aspectRatio: "1" }}>
                {Array.from({ length: 8 }, (_, ri) => {
                  const r = displayR(ri);
                  return (
                    <React.Fragment key={ri}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#aaa" }}>{RANKS[flipped ? 7 - r : r]}</div>
                      {Array.from({ length: 8 }, (_, ci) => {
                        const c = displayC(ci);
                        const piece = board[r][c];
                        const isDark = (r + c) % 2 === 1;
                        const isSel = selected?.[0] === r && selected?.[1] === c;
                        const isT = selectedMoves.some(m => m.to[0] === r && m.to[1] === c);
                        return (
                          <div
                            key={ci}
                            onClick={() => handleSquare(r, c)}
                            style={{
                              background: isSel ? "#b58900" : isT ? "rgba(38,139,210,0.7)" : isDark ? "#769656" : "#eeeed2",
                              cursor: isMyTurn ? "pointer" : "default",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "clamp(14px, 4.5vw, 26px)",
                              userSelect: "none",
                              position: "relative"
                            }}
                          >
                            {isT && !piece && <div style={{ width: "30%", height: "30%", borderRadius: "50%", background: "rgba(38,139,210,0.5)" }} />}
                            {piece ? PIECE_UNICODE[piece] ?? piece : ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                <div />
                {Array.from({ length: 8 }, (_, ci) => (
                  <div key={ci} style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#aaa" }}>{FILES[flipped ? 7 - ci : ci]}</div>
                ))}
              </div>

              {/* Promotion picker */}
              {promoTarget && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                  <div className="panel-title">Promote to:</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {PROMO_PIECES.map(p => (
                      <button key={p} className="btn-gold" style={{ fontSize: 24 }} onClick={() => sendMove(promoTarget.from, promoTarget.to, p)}>
                        {PIECE_UNICODE[`${myColor}${p}`]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* My label */}
            {(() => {
              const me = seats.find(s => s.userId === userId);
              return me ? (
                <div className={`panel px-2 py-1 text-center ${me.userId === turnPlayerId ? "badge-glow" : ""}`}>
                  <span>{flipped ? "♟ " : "♙ "}</span>
                  <span className="panel-subtle" style={{ fontSize: 11 }}>{me.displayName} (You)</span>
                </div>
              ) : null;
            })()}
          </div>

          {lastResult && (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <div className="panel px-4 py-3 text-center max-w-[240px]">
                <div className="text-lg font-black">{outcomeLabel}</div>
                <div className="panel-subtle mt-1">{gameOverMsg}</div>
                <div className="panel-subtle">Balance: {lastResult.newBalance}</div>
                <div className="flex gap-2 mt-3 justify-center">
                  <button className="btn-green" onClick={() => { clearLastResult(); socket?.emit("evt", { type: "room:next" }); }}>Play Again</button>
                  <button className="btn-ghost" onClick={clearLastResult}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="action-bar">
        <div className="panel-subtle px-2">You are {myColor === "w" ? "♙ White" : "♟ Black"}</div>
        {isMyTurn && (
          <button className="btn-red" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "chess:resign" } })}>Resign</button>
        )}
      </div>
    </div>
  );
}
