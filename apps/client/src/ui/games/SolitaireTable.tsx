import React, { useState } from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";
import { cardLabelToAssetUrl, CARD_BACK_1 } from "../assets/cardAssets";

type SolCard = { rank: string; suit: string; faceUp: boolean };
type SolFromSpec = { pile: "waste" } | { pile: "tableau"; col: number; idx: number } | { pile: "foundation"; suit: string };
type SolToSpec = { pile: "tableau"; col: number } | { pile: "foundation"; suit: string };

const SUITS = ["S", "H", "D", "C"];
const SUIT_EMOJI: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

function cardLabel(c: SolCard): string {
  return `${c.rank}${c.suit}`;
}

function SolCardImg({ card, small }: { card: SolCard; small?: boolean }) {
  const sz = small ? 36 : 48;
  if (!card.faceUp) {
    return <img src={CARD_BACK_1} style={{ width: sz, height: sz * 1.4, borderRadius: 4 }} draggable={false} />;
  }
  const label = cardLabel(card);
  const src = cardLabelToAssetUrl(label);
  if (src) return <img src={src} style={{ width: sz, height: sz * 1.4, borderRadius: 4 }} draggable={false} alt={label} />;
  return (
    <div style={{ width: sz, height: sz * 1.4, borderRadius: 4, background: "white", color: ["H", "D"].includes(card.suit) ? "red" : "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: sz * 0.28, fontWeight: 900, border: "1px solid #aaa" }}>
      {card.rank}{SUIT_EMOJI[card.suit]}
    </div>
  );
}

export function SolitaireTable() {
  const { publicState, lastResult, clearLastResult } = useApp();
  const socket = getSocket();
  const [fromSpec, setFromSpec] = useState<SolFromSpec | null>(null);

  const stockCount: number = publicState?.stockCount ?? 0;
  const wasteTop: SolCard | null = publicState?.wasteTop ?? null;
  const foundations: Record<string, SolCard[]> = publicState?.foundations ?? { S: [], H: [], D: [], C: [] };
  const tableau: SolCard[][] = publicState?.tableau ?? Array.from({ length: 7 }, () => []);
  const won: boolean = publicState?.won ?? false;
  const phase: string = publicState?.phase ?? "playing";

  const sendMove = (to: SolToSpec) => {
    if (!fromSpec) return;
    socket?.emit("evt", { type: "game:action", action: { type: "sol:move", from: fromSpec, to } });
    setFromSpec(null);
  };

  const selectWaste = () => {
    if (!wasteTop) return;
    setFromSpec({ pile: "waste" });
  };

  const selectTableau = (col: number, idx: number) => {
    const card = tableau[col][idx];
    if (!card?.faceUp) return;
    setFromSpec({ pile: "tableau", col, idx });
  };

  const targetTableau = (col: number) => {
    if (fromSpec) { sendMove({ pile: "tableau", col }); return; }
  };

  const targetFoundation = (suit: string) => {
    if (fromSpec) { sendMove({ pile: "foundation", suit: suit as any }); return; }
  };

  const outcomeLabel = lastResult?.outcome === "win" ? "You Win!" : lastResult?.outcome === "lose" ? "Gave Up" : "";

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Solitaire</div>
        <div className="panel-subtle">{won ? "🎉 Congratulations!" : phase === "settled" ? "Game over" : "Klondike"}</div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>

            {/* Top row: stock + waste + foundations */}
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", justifyContent: "center" }}>
              {/* Stock */}
              <button
                onClick={() => { setFromSpec(null); socket?.emit("evt", { type: "game:action", action: { type: "sol:draw" } }); }}
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                {stockCount > 0
                  ? <img src={CARD_BACK_1} style={{ width: 42, height: 58, borderRadius: 4 }} draggable={false} />
                  : <div style={{ width: 42, height: 58, borderRadius: 4, border: "2px dashed #555", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 20 }}>↺</div>
                }
                <div style={{ fontSize: 9, color: "#aaa", textAlign: "center" }}>{stockCount}</div>
              </button>

              {/* Waste */}
              <button
                onClick={() => { setFromSpec(null); selectWaste(); }}
                style={{ background: "transparent", border: "none", cursor: wasteTop ? "pointer" : "default", outline: fromSpec?.pile === "waste" ? "2px solid gold" : "none" }}
              >
                {wasteTop
                  ? <SolCardImg card={wasteTop} small />
                  : <div style={{ width: 42, height: 58, borderRadius: 4, border: "2px dashed #555" }} />
                }
              </button>

              <div style={{ flex: 1 }} />

              {/* Foundations */}
              {SUITS.map(suit => {
                const found = foundations[suit] ?? [];
                const top = found[found.length - 1] ?? null;
                return (
                  <button
                    key={suit}
                    onClick={() => targetFoundation(suit)}
                    style={{ background: "transparent", border: "none", cursor: fromSpec ? "pointer" : "default", outline: "none" }}
                  >
                    {top
                      ? <SolCardImg card={top} small />
                      : <div style={{ width: 42, height: 58, borderRadius: 4, border: "2px dashed #555", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 16 }}>{SUIT_EMOJI[suit]}</div>
                    }
                    <div style={{ fontSize: 9, color: "#aaa", textAlign: "center" }}>{found.length}</div>
                  </button>
                );
              })}
            </div>

            {/* Tableau */}
            <div style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "flex-start", flex: 1 }}>
              {tableau.map((col, colIdx) => (
                <div
                  key={colIdx}
                  onClick={() => { if (!fromSpec) return; targetTableau(colIdx); }}
                  style={{ position: "relative", minHeight: 60, width: 44, cursor: fromSpec ? "pointer" : "default" }}
                >
                  {col.length === 0 && (
                    <div style={{ width: 42, height: 58, borderRadius: 4, border: "2px dashed #555" }} />
                  )}
                  {col.map((card, idx) => (
                    <div
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); if (fromSpec) { targetTableau(colIdx); } else { selectTableau(colIdx, idx); } }}
                      style={{
                        position: idx === 0 ? "relative" : "absolute",
                        top: idx === 0 ? 0 : idx * 18,
                        outline: fromSpec && fromSpec.pile === "tableau" && (fromSpec as any).col === colIdx && (fromSpec as any).idx === idx ? "2px solid gold" : "none",
                        cursor: card.faceUp ? "pointer" : "default"
                      }}
                    >
                      <SolCardImg card={card} small />
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Cancel selection */}
            {fromSpec && (
              <div style={{ textAlign: "center" }}>
                <button className="btn-ghost" onClick={() => setFromSpec(null)}>Cancel</button>
              </div>
            )}
          </div>

          {lastResult && (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <div className="panel px-4 py-3 text-center max-w-[240px]">
                <div className="text-lg font-black">{outcomeLabel}</div>
                <div className="panel-subtle mt-1">Balance: {lastResult.newBalance}</div>
                <div className="flex gap-2 mt-3 justify-center">
                  <button className="btn-green" onClick={() => { clearLastResult(); socket?.emit("evt", { type: "room:next" }); }}>New Game</button>
                  <button className="btn-ghost" onClick={clearLastResult}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="action-bar">
        <div className="panel-subtle px-2">Foundation: {SUITS.map(s => (foundations[s] ?? []).length).join("-")}</div>
        <button className="btn-red" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "sol:giveUp" } })}>Give Up</button>
      </div>
    </div>
  );
}
