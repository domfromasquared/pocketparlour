import React, { useMemo, useState } from "react";
import { useApp } from "../../state/store";
import { getSocket } from "../../lib/socket";
import { cardLabelToAssetUrl, CARD_BACK_2 } from "../assets/cardAssets";

export function SpadesTable() {
  const { publicState, userId, room, youSeatIndex } = useApp();
  const socket = getSocket();
  const [bid, setBid] = useState(4);

  const phase = publicState?.phase;
  const yourHand: string[] = publicState?.yourHand ?? [];
  const turnPlayerId: string | null = publicState?.turnPlayerId ?? null;
  const isYourTurn = turnPlayerId && userId && turnPlayerId === userId;

  const trickPlays: { playerId: string; card: string }[] = publicState?.trick?.plays ?? [];

  const canBid = phase === "bidding" && isYourTurn;
  const canPlay = phase === "playing" && isYourTurn;

  const sortedHand = useMemo(() => yourHand.slice(), [yourHand]);

  const team0Tricks = room?.seats
    .filter(s => s.seatIndex % 2 === 0)
    .reduce((sum, s) => sum + (publicState?.tricksWon?.[s.userId ?? ""] ?? 0), 0);
  const team1Tricks = room?.seats
    .filter(s => s.seatIndex % 2 === 1)
    .reduce((sum, s) => sum + (publicState?.tricksWon?.[s.userId ?? ""] ?? 0), 0);
  const winnerTeam =
    phase === "settled"
      ? publicState?.teamScores?.team0 === publicState?.teamScores?.team1
        ? "Tie"
        : publicState?.teamScores?.team0 > publicState?.teamScores?.team1
          ? "Team A"
          : "Team B"
      : null;

  const seats = room?.seats ?? [];
  const totalSeats = Math.max(1, Math.min(4, seats.length || 4));
  const myIndex =
    (youSeatIndex != null ? youSeatIndex : seats.find(s => s.userId === userId)?.seatIndex) ?? 0;

  const relFromSeatIndex = (seatIndex: number) =>
    (seatIndex - myIndex + totalSeats) % totalSeats;

  const seatPosition = (rel: number): "bottom" | "left" | "top" | "right" => {
    if (totalSeats <= 1) return "bottom";
    if (totalSeats === 2) return rel === 0 ? "bottom" : "top";
    if (totalSeats === 3) return rel === 0 ? "bottom" : rel === 1 ? "left" : "right";
    return rel === 0 ? "bottom" : rel === 1 ? "left" : rel === 2 ? "top" : "right";
  };

  const seatClassForRel = (rel: number) => {
    const pos = seatPosition(rel);
    return `spades-seat spades-seat-${pos}`;
  };

  const trickClassForRel = (rel: number) => {
    const pos = seatPosition(rel);
    return `spades-trick-card spades-trick-${pos}`;
  };

  const seatsForLayout = useMemo(() => {
    const slotMap: Record<"bottom" | "left" | "top" | "right", typeof seats[number] | null> = {
      bottom: null,
      left: null,
      top: null,
      right: null
    };
    for (const s of seats.slice(0, 4)) {
      const rel = relFromSeatIndex(s.seatIndex);
      slotMap[seatPosition(rel)] = s;
    }
    return slotMap;
  }, [seats, totalSeats, myIndex]);

  const seatByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of seats) {
      if (s.userId) map.set(s.userId, s.seatIndex);
    }
    return map;
  }, [seats]);

  const relSeatClass = (seatIndex: number) => {
    const rel = (seatIndex - myIndex + totalSeats) % totalSeats;
    return seatClassForRel(rel);
  };

  return (
    <div className="spades-root">
      <div className="panel spades-header">
        <div className="panel-title">Spades</div>
        <div className="panel-subtle">
          {phase === "bidding" ? "Bidding" : phase === "playing" ? "Play" : "Ended"}
        </div>
      </div>

      <div className="spades-content">
        <div className="table-wood spades-stage-wrap">
          <div className="table-felt spades-layout">
            <div className="spades-table-center">
              {trickPlays.length === 0 && <div className="panel-subtle">No cards played yet</div>}
              {trickPlays.map((p, i) => {
                const seatIndex = seatByPlayerId.get(p.playerId);
                const rel = seatIndex == null ? 0 : relFromSeatIndex(seatIndex);
                return (
                  <div key={i} className={trickClassForRel(rel)}>
                    <CardFace label={p.card} />
                  </div>
                );
              })}
            </div>

            {Object.values(seatsForLayout)
              .filter((s): s is NonNullable<typeof s> => Boolean(s))
              .map((s) => {
                const isMe = s.userId === userId;
                const rel = relFromSeatIndex(s.seatIndex);
                const seatClass = relSeatClass(s.seatIndex);
                const isTop = seatPosition(rel) === "top";
                const isSide = seatPosition(rel) === "left" || seatPosition(rel) === "right";
                const stackCount = Math.max(4, Math.min(10, sortedHand.length || 10));

                return (
                  <div key={s.seatIndex} className={seatClass}>
                    <div className={`seat-badge ${isMe ? "badge-glow" : ""}`}>{s.displayName}</div>
                    {isMe ? (
                      <div className="spades-hand-bottom">
                        {sortedHand.slice(0, 13).map((c, i) => (
                          <button
                            key={`${c}-${i}`}
                            className="rounded-xl border border-white/10 hover:glow-ring"
                            onClick={() =>
                              canPlay && socket?.emit("evt", { type: "game:action", action: { type: "spades:play", card: c } })
                            }
                            disabled={!canPlay}
                            aria-label={`Play ${c}`}
                          >
                            <CardFace label={c} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={isTop ? "spades-hand-top" : isSide ? "spades-hand-side" : "spades-hand-top"}>
                        {Array.from({ length: stackCount }).map((_, i) => (
                          <CardBack key={i} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        <div className="panel spades-meta-row">
          <div className="panel-subtle">Team A tricks: {team0Tricks}</div>
          <div className="panel-subtle">Team B tricks: {team1Tricks}</div>
          {winnerTeam && <div className="panel-subtle">Winner: {winnerTeam}</div>}
        </div>

        <div className="panel spades-bid-row">
          <div className="panel-title">Bid</div>
          <div className="spades-bid-controls">
            <input
              className="input-field h-10 w-20"
              type="number"
              min={0}
              max={13}
              value={bid}
              onChange={(e) => setBid(Number(e.target.value))}
              disabled={!canBid}
            />
            <button
              className={canBid ? "btn-green" : "btn-ghost"}
              onClick={() => canBid && socket?.emit("evt", { type: "game:action", action: { type: "spades:bid", bid } })}
              disabled={!canBid}
            >
              Submit
            </button>
          </div>
        </div>
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
      src={CARD_BACK_2}
      alt="Card back"
    />
  );
}
