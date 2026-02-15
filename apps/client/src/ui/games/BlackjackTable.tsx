// apps/client/src/ui/games/BlackjackTable.tsx
import React from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";
import { CARD_BACK_1, cardLabelToAssetUrl } from "../assets/cardAssets";

export function BlackjackTable() {
  const { publicState, lastResult, clearLastResult, room, userId, youSeatIndex } = useApp();
  const socket = getSocket();

  const dealerCards: string[] = publicState?.dealerCards ?? [];
  const turnPlayerId: string | null = publicState?.currentTurnPlayerId ?? null;
  const players: Array<{ playerId: string; cards: string[]; total: number; soft: boolean; stood: boolean; busted: boolean }> =
    publicState?.players ?? [];
  const seats = room?.seats ?? [];

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
          {publicState?.phase === "playerTurn" ? "Player Turn" : publicState?.phase === "dealerTurn" ? "Dealer Turn" : "Settled"}
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
                {(dealerCards.length ? dealerCards : [publicState?.dealerUpCard]).filter(Boolean).map((c: string, i: number) => (
                  <CardFace key={`${c}-${i}`} label={c} />
                ))}
                {publicState?.phase === "playerTurn" && publicState?.dealerCardsCount > 1 && <CardBack />}
              </div>
            </div>

            <div className="bj-side-col bj-side-left">
              {seatForSide("left", seats, userId, youSeatIndex).map((s) => (
                <OpponentSeat
                  key={s.seatIndex}
                  name={s.displayName}
                  hand={players.find((p) => p.playerId === s.userId)}
                  isTurn={turnPlayerId === s.userId}
                  settled={publicState?.phase === "settled"}
                />
              ))}
            </div>

            <div className="bj-side-col bj-side-right">
              {seatForSide("right", seats, userId, youSeatIndex).map((s) => (
                <OpponentSeat
                  key={s.seatIndex}
                  name={s.displayName}
                  hand={players.find((p) => p.playerId === s.userId)}
                  isTurn={turnPlayerId === s.userId}
                  settled={publicState?.phase === "settled"}
                />
              ))}
            </div>

            <div className="bj-player-seat">
              <div className={`seat-badge badge-glow ${turnPlayerId === userId ? "is-turn" : ""}`}>You</div>
              <div className="panel-subtle">
                Total {publicState?.yourTotal ?? 0} {publicState?.yourSoft ? "(soft)" : ""}
              </div>
              <div className="bj-hand-bottom">
                {(publicState?.yourCards ?? []).map((c: string, i: number) => (
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

function seatForSide(
  side: "left" | "right",
  seats: Array<{ seatIndex: number; userId?: string; displayName: string }>,
  userId: string | null,
  youSeatIndex: number | null
) {
  const mine =
    youSeatIndex != null && youSeatIndex >= 0
      ? youSeatIndex
      : seats.find((s) => s.userId === userId)?.seatIndex ?? 0;
  const occupied = seats.filter((s) => s.userId && s.userId !== userId);
  const ordered = occupied
    .map((s) => {
      const rel = (s.seatIndex - mine + seats.length) % Math.max(1, seats.length);
      return { ...s, rel };
    })
    .sort((a, b) => a.rel - b.rel);
  const mid = Math.ceil(ordered.length / 2);
  return side === "left" ? ordered.slice(0, mid) : ordered.slice(mid);
}

function OpponentSeat({
  name,
  hand,
  isTurn,
  settled
}: {
  name: string;
  hand?: { cards: string[]; total: number; soft: boolean; stood: boolean; busted: boolean };
  isTurn: boolean;
  settled: boolean;
}) {
  return (
    <div className="bj-opp-seat">
      <div className={`seat-badge ${isTurn ? "is-turn" : ""}`}>{name}</div>
      {hand && <div className="panel-subtle">{hand.total}{hand.soft ? " soft" : ""}</div>}
      <div className="bj-side-stack">
        {(hand?.cards ?? []).map((c, i) =>
          settled ? <CardFace key={`${c}-${i}`} label={c} /> : <CardBack key={`${name}-${i}`} />
        )}
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
