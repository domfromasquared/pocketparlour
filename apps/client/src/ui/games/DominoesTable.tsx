import React from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";

type Domino = [number, number];

function DominoTile({ d, small }: { d: Domino; small?: boolean }) {
  const sz = small ? 20 : 28;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", background: "white", borderRadius: 4, padding: "2px 4px", color: "#111", fontWeight: 900, fontSize: sz / 2, lineHeight: 1, gap: 1, border: "1px solid #333", userSelect: "none" }}>
      <span>{d[0]}</span>
      <span style={{ borderTop: "1px solid #555", paddingTop: 1, width: "100%", textAlign: "center" }}>{d[1]}</span>
    </div>
  );
}

export function DominoesTable() {
  const { publicState, lastResult, clearLastResult, room, userId } = useApp();
  const socket = getSocket();
  const [selected, setSelected] = React.useState<Domino | null>(null);

  const phase = publicState?.phase ?? "playing";
  const yourHand: Domino[] = publicState?.yourHand ?? [];
  const handCounts: Record<string, number> = publicState?.handCounts ?? {};
  const boneyardCount: number = publicState?.boneyardCount ?? 0;
  const board = publicState?.board ?? null;
  const turnPlayerId: string | null = publicState?.turnPlayerId ?? null;
  const scores: Record<string, number> = publicState?.scores ?? {};
  const winner: string | null = publicState?.winner ?? null;
  const seats = room?.seats ?? [];

  const isMyTurn = turnPlayerId === userId;
  const outcomeLabel = lastResult?.outcome === "win" ? "You Win!" : lastResult?.outcome === "lose" ? "You Lose" : "";

  const play = (domino: Domino, end: "left" | "right") => {
    const endVal = end === "left" ? board?.leftEnd : board?.rightEnd;
    const flip = endVal !== undefined && domino[0] !== endVal;
    socket?.emit("evt", { type: "game:action", action: { type: "dom:play", domino, end, flip } });
    setSelected(null);
  };

  const canPlayLeft = (d: Domino) => board && (d[0] === board.leftEnd || d[1] === board.leftEnd);
  const canPlayRight = (d: Domino) => board && (d[0] === board.rightEnd || d[1] === board.rightEnd);
  const canPlayAny = (d: Domino) => !board || canPlayLeft(d) || canPlayRight(d);

  const hasPlayable = yourHand.some(d => canPlayAny(d));

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Dominoes</div>
        <div className="panel-subtle">{isMyTurn ? "Your turn" : "Waiting…"} | Boneyard: {boneyardCount}</div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>

            {/* Opponents */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {seats.filter(s => s.userId !== userId).map(s => (
                <div key={s.seatIndex} className={`panel px-2 py-1 text-center ${s.userId === turnPlayerId ? "badge-glow" : ""}`}>
                  <div className="panel-subtle" style={{ fontSize: 11 }}>{s.displayName}</div>
                  <div style={{ fontWeight: 900 }}>{handCounts[s.userId ?? ""] ?? 0} tiles</div>
                  <div className="panel-subtle" style={{ fontSize: 11 }}>Score: {scores[s.userId ?? ""] ?? 0}</div>
                </div>
              ))}
            </div>

            {/* Board */}
            <div className="panel px-2 py-2" style={{ minHeight: 60, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
              {board ? (
                <>
                  <span className="panel-subtle" style={{ fontSize: 11 }}>←{board.leftEnd}</span>
                  {(board.chain as Domino[]).slice(0, 7).map((d, i) => <DominoTile key={i} d={d} small />)}
                  {board.chain.length > 7 && <span className="panel-subtle">…({board.chain.length})</span>}
                  <span className="panel-subtle" style={{ fontSize: 11 }}>{board.rightEnd}→</span>
                </>
              ) : (
                <span className="panel-subtle">No tiles played yet</span>
              )}
            </div>

            {/* Your hand */}
            <div className="panel px-2 py-2">
              <div className="panel-subtle mb-1">Your tiles (Score: {scores[userId ?? ""] ?? 0})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {yourHand.map((d, i) => {
                  const playable = canPlayAny(d);
                  const isSel = selected && selected[0] === d[0] && selected[1] === d[1];
                  return (
                    <button
                      key={i}
                      onClick={() => isMyTurn && playable && setSelected(isSel ? null : d)}
                      style={{ opacity: playable && isMyTurn ? 1 : 0.4, outline: isSel ? "2px solid gold" : "none", background: "transparent", border: "none", cursor: isMyTurn && playable ? "pointer" : "default" }}
                    >
                      <DominoTile d={d} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            {isMyTurn && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {selected && (
                  <>
                    {canPlayLeft(selected) && (
                      <button className="btn-blue" onClick={() => play(selected, "left")}>Play Left</button>
                    )}
                    {canPlayRight(selected) && (
                      <button className="btn-green" onClick={() => play(selected, "right")}>Play Right</button>
                    )}
                  </>
                )}
                {!hasPlayable && boneyardCount > 0 && (
                  <button className="btn-gold" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "dom:draw" } })}>Draw</button>
                )}
                {!hasPlayable && boneyardCount === 0 && (
                  <button className="btn-ghost" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "dom:pass" } })}>Pass</button>
                )}
                {!selected && hasPlayable && <div className="panel-subtle">Tap a tile to select it</div>}
              </div>
            )}

            {winner && (
              <div className="panel px-3 py-2 text-center">
                <div className="panel-title">🏆 {seats.find(s => s.userId === winner)?.displayName ?? "Winner"}!</div>
                <div className="panel-subtle">Scores: {Object.entries(scores).map(([pid, sc]) => `${seats.find(s => s.userId === pid)?.displayName ?? pid}: ${sc}`).join(" | ")}</div>
              </div>
            )}
          </div>

          {lastResult && (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <div className="panel px-4 py-3 text-center max-w-[240px]">
                <div className="text-lg font-black">{outcomeLabel}</div>
                <div className="panel-subtle mt-1">Balance: {lastResult.newBalance}</div>
                <button className="btn-green mt-3" onClick={() => { clearLastResult(); socket?.emit("evt", { type: "room:next" }); }}>Play Again</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
