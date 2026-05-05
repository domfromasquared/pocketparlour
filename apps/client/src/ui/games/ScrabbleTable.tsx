import React, { useState } from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";

type Placement = { letter: string; row: number; col: number };

const PREMIUM: Record<string, string> = {};
const TW = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
const DW = [[1,1],[2,2],[3,3],[4,4],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1],[7,7]];
const TL = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]];
const DL = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]];
for (const [r,c] of TW) PREMIUM[`${r},${c}`] = "TW";
for (const [r,c] of DW) PREMIUM[`${r},${c}`] = "DW";
for (const [r,c] of TL) PREMIUM[`${r},${c}`] = "TL";
for (const [r,c] of DL) PREMIUM[`${r},${c}`] = "DL";

const PRM_BG: Record<string, string> = { TW: "#d33", DW: "#e77", TL: "#33a", DL: "#77a", "": "#2a5c36" };
const PRM_LBL: Record<string, string> = { TW: "TW", DW: "DW", TL: "TL", DL: "DL", "": "" };

const TILE_PTS: Record<string, number> = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10,"?":0 };

export function ScrabbleTable() {
  const { publicState, lastResult, clearLastResult, room, userId } = useApp();
  const socket = getSocket();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selectedRackIdx, setSelectedRackIdx] = useState<number | null>(null);

  const board: (string | null)[][] = publicState?.board ?? Array.from({ length: 15 }, () => Array(15).fill(null));
  const yourRack: string[] = publicState?.yourRack ?? [];
  const rackSizes: Record<string, number> = publicState?.rackSizes ?? {};
  const bagCount: number = publicState?.bagCount ?? 0;
  const scores: Record<string, number> = publicState?.scores ?? {};
  const turnPlayerId: string | null = publicState?.turnPlayerId ?? null;
  const lastPlay = publicState?.lastPlay ?? null;
  const seats = room?.seats ?? [];

  const isMyTurn = turnPlayerId === userId;

  // Effective board = server board + current placements
  const effectiveBoard = board.map(row => row.slice());
  for (const p of placements) effectiveBoard[p.row][p.col] = p.letter;

  // Rack minus placed letters
  const placedLetters = placements.map(p => p.letter);
  const remainingRack = yourRack.slice();
  for (const l of placedLetters) {
    const i = remainingRack.indexOf(l);
    if (i !== -1) remainingRack.splice(i, 1);
  }

  const handleSquareClick = (r: number, c: number) => {
    if (!isMyTurn) return;
    if (board[r][c] !== null) return; // already occupied

    // If already a placement here, remove it
    const existing = placements.findIndex(p => p.row === r && p.col === c);
    if (existing !== -1) {
      setPlacements(prev => prev.filter((_, i) => i !== existing));
      return;
    }

    if (selectedRackIdx === null) return;
    const letter = remainingRack[selectedRackIdx];
    if (!letter) return;
    setPlacements(prev => [...prev, { letter, row: r, col: c }]);
    setSelectedRackIdx(null);
  };

  const commitPlay = () => {
    if (placements.length === 0) return;
    socket?.emit("evt", { type: "game:action", action: { type: "scr:place", tiles: placements } });
    setPlacements([]);
    setSelectedRackIdx(null);
  };

  const cancelPlay = () => { setPlacements([]); setSelectedRackIdx(null); };

  const pass = () => {
    socket?.emit("evt", { type: "game:action", action: { type: "scr:pass" } });
    cancelPlay();
  };

  const outcomeLabel = lastResult?.outcome === "win" ? "You Win!" : lastResult?.outcome === "lose" ? "You Lose" : lastResult?.outcome === "push" ? "Draw" : "";

  const cellSize = "min(calc((100vw - 40px) / 15), 28px)";

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Scrabble</div>
        <div className="panel-subtle">
          {isMyTurn ? "Your turn" : `${seats.find(s => s.userId === turnPlayerId)?.displayName ?? "…"}'s turn`} | Bag: {bagCount}
          {lastPlay ? ` | Last: ${lastPlay.word} (+${lastPlay.score})` : ""}
        </div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>

            {/* Scores */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {seats.map(s => (
                <div key={s.seatIndex} className={`panel px-2 py-1 text-center ${s.userId === turnPlayerId ? "badge-glow" : ""}`} style={{ fontSize: 11 }}>
                  <div className="panel-subtle">{s.displayName}</div>
                  <div style={{ fontWeight: 900 }}>{scores[s.userId ?? ""] ?? 0} pts</div>
                  <div className="panel-subtle">{rackSizes[s.userId ?? ""] ?? 0} tiles</div>
                </div>
              ))}
            </div>

            {/* Board */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(15, ${cellSize})`, gap: 1, alignSelf: "center", background: "#1a3a24" }}>
              {effectiveBoard.map((row, r) =>
                row.map((cell, c) => {
                  const prm = PREMIUM[`${r},${c}`] ?? "";
                  const isPlaced = placements.some(p => p.row === r && p.col === c);
                  const isCenter = r === 7 && c === 7;
                  return (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => handleSquareClick(r, c)}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        background: cell ? (isPlaced ? "#f4c430" : "#faf0e6") : (PRM_BG[prm] ?? "#2a5c36"),
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: cell ? "clamp(8px, 2.5vw, 13px)" : "clamp(5px, 1.5vw, 8px)",
                        fontWeight: 900,
                        color: cell ? "#111" : "#fff",
                        cursor: isMyTurn && !board[r][c] ? "pointer" : "default",
                        borderRadius: 1,
                        userSelect: "none",
                        border: isCenter && !cell ? "1px solid gold" : "none"
                      }}
                    >
                      {cell ?? (isCenter ? "★" : PRM_LBL[prm])}
                    </div>
                  );
                })
              )}
            </div>

            {/* Rack */}
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {remainingRack.map((letter, i) => (
                <button
                  key={i}
                  onClick={() => isMyTurn && setSelectedRackIdx(selectedRackIdx === i ? null : i)}
                  style={{
                    width: 34, height: 38, background: selectedRackIdx === i ? "#f4c430" : "#f0d080",
                    color: "#111", fontWeight: 900, fontSize: 16, borderRadius: 4,
                    border: selectedRackIdx === i ? "2px solid gold" : "1px solid #888",
                    cursor: isMyTurn ? "pointer" : "default",
                    position: "relative"
                  }}
                >
                  {letter}
                  <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: 8, fontWeight: 400 }}>{TILE_PTS[letter] ?? 0}</span>
                </button>
              ))}
              {placements.map((p, i) => (
                <div key={`placed-${i}`} style={{ width: 34, height: 38, background: "#f4c430", color: "#111", fontWeight: 900, fontSize: 16, borderRadius: 4, border: "2px solid gold", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.6 }}>
                  {p.letter}
                </div>
              ))}
            </div>

            {/* Controls */}
            {isMyTurn && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                {placements.length > 0 && (
                  <>
                    <button className="btn-green" onClick={commitPlay}>Play</button>
                    <button className="btn-ghost" onClick={cancelPlay}>Cancel</button>
                  </>
                )}
                {placements.length === 0 && (
                  <button className="btn-ghost" onClick={pass}>Pass</button>
                )}
              </div>
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
    </div>
  );
}
