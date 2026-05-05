import React, { useState } from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";

type Piece = 0 | 1 | 2 | 3 | 4;

const PIECE_LABEL: Record<number, string> = { 0: "", 1: "🔴", 2: "🔴👑", 3: "⚫", 4: "⚫👑" };

function pieceColor(p: Piece): "red" | "black" | null {
  if (p === 1 || p === 2) return "red";
  if (p === 3 || p === 4) return "black";
  return null;
}

export function CheckersTable() {
  const { publicState, lastResult, clearLastResult, room, userId } = useApp();
  const socket = getSocket();
  const [selected, setSelected] = useState<[number, number] | null>(null);

  const board: Piece[][] = publicState?.board ?? Array.from({ length: 8 }, () => Array(8).fill(0));
  const turn: "red" | "black" = publicState?.turn ?? "red";
  const turnPlayerId: string | null = publicState?.turnPlayerId ?? null;
  const winner: string | null = publicState?.winner ?? null;
  const legalMoves: { from: [number, number]; to: [number, number] }[] = publicState?.legalMoves ?? [];
  const mustContinueFrom: [number, number] | null = publicState?.mustContinueFrom ?? null;
  const seats = room?.seats ?? [];

  const isMyTurn = turnPlayerId === userId;
  const myColor = seats.find(s => s.userId === userId)?.seatIndex === 0 ? "red" : "black";

  const selectedMoves = selected ? legalMoves.filter(m => m.from[0] === selected[0] && m.from[1] === selected[1]) : [];

  const handleSquareClick = (r: number, c: number) => {
    if (!isMyTurn) return;

    // If a destination for selected piece
    if (selected) {
      const move = selectedMoves.find(m => m.to[0] === r && m.to[1] === c);
      if (move) {
        socket?.emit("evt", { type: "game:action", action: { type: "chk:move", from: move.from, to: move.to } });
        setSelected(null);
        return;
      }
    }

    // Select own piece
    const p = board[r][c];
    if (pieceColor(p) === myColor) {
      const hasMoves = legalMoves.some(m => m.from[0] === r && m.from[1] === c);
      if (hasMoves) setSelected([r, c]);
    } else {
      setSelected(null);
    }
  };

  const isSelectable = (r: number, c: number) =>
    isMyTurn && pieceColor(board[r][c]) === myColor && legalMoves.some(m => m.from[0] === r && m.from[1] === c);
  const isTarget = (r: number, c: number) =>
    !!selectedMoves.find(m => m.to[0] === r && m.to[1] === c);

  const outcomeLabel = lastResult?.outcome === "win" ? "You Win!" : lastResult?.outcome === "lose" ? "You Lose" : lastResult?.outcome === "push" ? "Draw" : "";

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Checkers</div>
        <div className="panel-subtle">
          {isMyTurn ? "Your turn" : `${seats.find(s => s.userId === turnPlayerId)?.displayName ?? "Opponent"}'s turn`}
          {mustContinueFrom ? " — must continue jump" : ""}
        </div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>

            {/* Player labels */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              {seats.map(s => (
                <div key={s.seatIndex} className={`panel px-2 py-1 text-center ${s.userId === turnPlayerId ? "badge-glow" : ""}`}>
                  <span style={{ marginRight: 4 }}>{s.seatIndex === 0 ? "🔴" : "⚫"}</span>
                  <span className="panel-subtle" style={{ fontSize: 11 }}>{s.displayName}</span>
                </div>
              ))}
            </div>

            {/* Board */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", width: "min(280px, 90vw)", aspectRatio: "1", border: "2px solid #555" }}>
              {board.map((row, r) =>
                row.map((piece, c) => {
                  const isDark = (r + c) % 2 === 1;
                  const isSel = selected?.[0] === r && selected?.[1] === c;
                  const isT = isTarget(r, c);
                  const isSrc = isSelectable(r, c);
                  return (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => isDark && handleSquareClick(r, c)}
                      style={{
                        background: isSel ? "#b58900" : isT ? "#268bd2" : isDark ? "#5a3825" : "#d4c5a9",
                        cursor: isDark && (isSrc || isT) ? "pointer" : "default",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "clamp(12px, 4vw, 22px)",
                        userSelect: "none",
                        transition: "background 0.1s"
                      }}
                    >
                      {piece !== 0 ? PIECE_LABEL[piece] : (isT ? "·" : "")}
                    </div>
                  );
                })
              )}
            </div>

            {winner && (
              <div className="panel px-3 py-2 text-center">
                <div className="panel-title">🏆 {seats.find(s => s.userId === winner)?.displayName ?? "Winner"}!</div>
              </div>
            )}

            {isMyTurn && !selected && legalMoves.length > 0 && (
              <div className="panel-subtle" style={{ fontSize: 11 }}>Tap a {myColor} piece to select</div>
            )}
          </div>

          {lastResult && (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <div className="panel px-4 py-3 text-center max-w-[240px]">
                <div className="text-lg font-black">{outcomeLabel}</div>
                <div className="panel-subtle mt-1">Balance: {lastResult.newBalance}</div>
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
        <div className="panel-subtle px-2">You are {myColor === "red" ? "🔴 Red" : "⚫ Black"}</div>
        {isMyTurn && (
          <button className="btn-red" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "chk:resign" } })}>Resign</button>
        )}
      </div>
    </div>
  );
}
