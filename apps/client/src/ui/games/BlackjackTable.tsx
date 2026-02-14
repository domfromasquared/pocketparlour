// apps/client/src/ui/games/BlackjackTable.tsx
import React from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";
import { CARD_BACK_1, cardLabelToAssetUrl } from "../assets/cardAssets";

export function BlackjackTable() {
  const { publicState, lastResult, clearLastResult } = useApp();
  const socket = getSocket();

  const dealerCount = publicState?.dealerCardsCount ?? 0;
  const dealerUp = publicState?.dealerUpCard ?? null;

  const outcomeLabel =
    lastResult?.outcome === "win"
      ? "You Win!"
      : lastResult?.outcome === "lose"
        ? "You Lose"
        : lastResult?.outcome === "push"
          ? "Push"
          : lastResult?.outcome === "cancelled"
            ? "Cancelled"
          : "";

  return (
    <div className="bj-root">
      <div className="panel bj-header">
        <div className="panel-title">Blackjack</div>
        <div className="panel-subtle">
          {publicState?.phase === "playerTurn" ? "Your Turn" : publicState?.phase === "dealerTurn" ? "Dealer Turn" : "Settled"}
        </div>
      </div>

      <div className="bj-content">
        <div className="table-wood bj-stage-wrap">
          <div className="table-felt bj-layout">
            <div className="table-center">
              <div className="panel px-3 py-2">
                <div className="panel-title text-center">Blackjack</div>
                <div className="panel-subtle text-center">Dealer stands on soft 17</div>
              </div>
            </div>

            <div className="bj-dealer-seat">
              <div className="seat-badge">Dealer</div>
              <div className="hand-row">
                <CardFace label={dealerUp ? dealerUp : "??"} />
                {Array.from({ length: Math.max(0, dealerCount - 1) }).map((_, i) => (
                  <CardBack key={i} />
                ))}
              </div>
            </div>

            <div className="bj-side-col bj-side-left">
              <OpponentSeat name="CPU 1" />
              <OpponentSeat name="CPU 2" />
            </div>

            <div className="bj-side-col bj-side-right">
              <OpponentSeat name="CPU 3" />
              <OpponentSeat name="CPU 4" />
            </div>

            <div className="bj-player-seat">
              <div className="seat-badge badge-glow">You</div>
              <div className="panel-subtle">
                Total {publicState?.playerTotal ?? 0} {publicState?.playerSoft ? "(soft)" : ""}
              </div>
              <div className="bj-hand-bottom">
                {(publicState?.playerCards ?? []).map((c: string, i: number) => (
                  <div key={i} className="bj-player-card-wrap" style={{ zIndex: i + 1 }}>
                    <CardFace label={c} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {lastResult && (
            <div className="absolute inset-0 grid place-items-center bg-black/60">
              <div className="panel px-4 py-3 text-center max-w-[240px]">
                <div className="text-lg font-black text-shadow">{outcomeLabel}</div>
                <div className="panel-subtle mt-1">Delta: {lastResult.delta}</div>
                <div className="panel-subtle">Balance: {lastResult.newBalance}</div>
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    className="btn-green"
                    onClick={() => {
                      clearLastResult();
                      socket?.emit("evt", { type: "room:next" });
                    }}
                  >
                    Play Again
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      clearLastResult();
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OpponentSeat({ name }: { name: string }) {
  return (
    <div className="bj-opp-seat">
      <div className="seat-badge">{name}</div>
      <div className="bj-side-stack">
        {Array.from({ length: 8 }).map((_, i) => (
          <CardBack key={i} />
        ))}
      </div>
    </div>
  );
}

function CardFace({ label }: { label: string }) {
  const src = cardLabelToAssetUrl(label);
  if (!src) {
    return (
      <div
        className="card bg-white/10 grid place-items-center font-black tracking-tight"
      >
        {label}
      </div>
    );
  }
  return (
    <img
      className="card"
      src={src}
      alt={label}
      draggable={false}
    />
  );
}

function CardBack() {
  return (
    <img
      className="card"
      src={CARD_BACK_1}
      alt="Card back"
    />
  );
}
