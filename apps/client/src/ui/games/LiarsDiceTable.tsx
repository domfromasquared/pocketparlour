import React from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";

const FACE_EMOJI = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function LiarsDiceTable() {
  const { publicState, lastResult, clearLastResult, room, userId } = useApp();
  const socket = getSocket();
  const [bidQty, setBidQty] = React.useState(1);
  const [bidFace, setBidFace] = React.useState(1);

  const phase = publicState?.phase ?? "bidding";
  const yourDice: number[] = publicState?.yourDice ?? [];
  const diceCount: Record<string, number> = publicState?.diceCount ?? {};
  const currentBid: { quantity: number; face: number } | null = publicState?.currentBid ?? null;
  const turnPlayerId: string | null = publicState?.turnPlayerId ?? null;
  const eliminated: string[] = publicState?.eliminated ?? [];
  const roundResult = publicState?.roundResult ?? null;
  const winner: string | null = publicState?.winner ?? null;
  const seats = room?.seats ?? [];

  const isMyTurn = turnPlayerId === userId;
  const canChallenge = isMyTurn && !!currentBid;

  const minQty = currentBid ? currentBid.quantity : 1;
  const minFace = currentBid && bidQty === currentBid.quantity ? currentBid.face + 1 : 1;

  const sendBid = () => {
    if (bidFace > 6) return;
    socket?.emit("evt", { type: "game:action", action: { type: "ld:bid", quantity: bidQty, face: bidFace } });
  };
  const sendChallenge = () => {
    socket?.emit("evt", { type: "game:action", action: { type: "ld:challenge" } });
  };

  const outcomeLabel = lastResult?.outcome === "win" ? "You Win!" : lastResult?.outcome === "lose" ? "You Lose" : lastResult?.outcome === "push" ? "Tie" : "";

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Liar's Dice</div>
        <div className="panel-subtle">{phase === "bidding" ? (isMyTurn ? "Your turn" : "Waiting…") : phase}</div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>

            {/* Players */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
              {seats.map(s => {
                const isElim = eliminated.includes(s.userId ?? "");
                const count = diceCount[s.userId ?? ""] ?? 0;
                return (
                  <div key={s.seatIndex} className={`panel px-3 py-2 text-center ${s.userId === turnPlayerId ? "badge-glow" : ""} ${isElim ? "opacity-40" : ""}`} style={{ minWidth: 80 }}>
                    <div className="panel-subtle" style={{ fontSize: 11 }}>{s.displayName}</div>
                    <div style={{ fontSize: 18 }}>{Array.from({ length: count }, (_, i) => "🎲").join("")}</div>
                    <div className="panel-subtle">{isElim ? "Out" : `${count} dice`}</div>
                  </div>
                );
              })}
            </div>

            {/* Current bid */}
            <div className="panel px-3 py-2 text-center">
              {currentBid ? (
                <>
                  <div className="panel-subtle">Current Bid</div>
                  <div style={{ fontSize: 28, fontWeight: 900 }}>
                    {currentBid.quantity}× {FACE_EMOJI[currentBid.face]}
                  </div>
                </>
              ) : (
                <div className="panel-subtle">No bid yet — place the first bid</div>
              )}
            </div>

            {/* Your dice */}
            <div className="panel px-3 py-2 text-center">
              <div className="panel-subtle">Your Dice</div>
              <div style={{ fontSize: 32, letterSpacing: 4 }}>
                {yourDice.map((d, i) => <span key={i}>{FACE_EMOJI[d]}</span>)}
                {yourDice.length === 0 && <span className="panel-subtle">—</span>}
              </div>
            </div>

            {/* Round result reveal */}
            {roundResult && (
              <div className="panel px-3 py-2 text-center">
                <div className="panel-title">{roundResult.bidMet ? "Bid Met!" : "Liar!"}</div>
                <div className="panel-subtle">{seats.find(s => s.userId === roundResult.loser)?.displayName ?? roundResult.loser} loses a die</div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  {Object.entries(roundResult.allDice as Record<string, number[]>).map(([pid, dice]) => (
                    <div key={pid}>{seats.find(s => s.userId === pid)?.displayName ?? pid}: {(dice as number[]).map(d => FACE_EMOJI[d]).join(" ")}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Winner */}
            {winner && (
              <div className="panel px-3 py-2 text-center">
                <div className="panel-title">🏆 {seats.find(s => s.userId === winner)?.displayName ?? "Winner"}!</div>
              </div>
            )}

            {/* Bid controls */}
            {isMyTurn && phase === "bidding" && (
              <div className="panel px-3 py-2" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div className="panel-subtle">Quantity</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-ghost" onClick={() => setBidQty(q => Math.max(minQty, q - 1))}>−</button>
                      <span style={{ minWidth: 28, textAlign: "center", fontWeight: 900 }}>{bidQty}</span>
                      <button className="btn-ghost" onClick={() => setBidQty(q => q + 1)}>+</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div className="panel-subtle">Face</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-ghost" onClick={() => setBidFace(f => Math.max(1, f - 1))}>−</button>
                      <span style={{ minWidth: 28, textAlign: "center", fontSize: 20 }}>{FACE_EMOJI[bidFace]}</span>
                      <button className="btn-ghost" onClick={() => setBidFace(f => Math.min(6, f + 1))}>+</button>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <button className="btn-blue" onClick={sendBid} disabled={bidFace > 6 || (currentBid ? !((bidQty > currentBid.quantity) || (bidQty === currentBid.quantity && bidFace > currentBid.face)) : false)}>
                    Bid {bidQty}× {FACE_EMOJI[bidFace]}
                  </button>
                  {canChallenge && (
                    <button className="btn-red" onClick={sendChallenge}>Liar!</button>
                  )}
                </div>
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
