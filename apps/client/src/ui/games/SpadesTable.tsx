import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const trickHistory: { winnerId: string; plays: { playerId: string; card: string }[] }[] =
    publicState?.trickHistory ?? [];

  const canBid = phase === "bidding" && isYourTurn;
  const canPlay = phase === "playing" && isYourTurn;

  const sortedHand = useMemo(() => yourHand.slice(), [yourHand]);

  const team0Tricks = room?.seats
    .filter(s => s.seatIndex % 2 === 0)
    .reduce((sum, s) => sum + (publicState?.tricksWon?.[s.userId ?? ""] ?? 0), 0);
  const team1Tricks = room?.seats
    .filter(s => s.seatIndex % 2 === 1)
    .reduce((sum, s) => sum + (publicState?.tricksWon?.[s.userId ?? ""] ?? 0), 0);
  const seats = room?.seats ?? [];
  const totalSeats = Math.max(1, Math.min(4, seats.length || 4));
  const myIndex =
    (youSeatIndex != null ? youSeatIndex : seats.find(s => s.userId === userId)?.seatIndex) ?? 0;
  const myTeamParity = myIndex % 2;

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

  const yourTeamTricksRaw = myTeamParity === 0 ? team0Tricks : team1Tricks;
  const opponentTeamTricksRaw = myTeamParity === 0 ? team1Tricks : team0Tricks;

  const [displayTrickPlays, setDisplayTrickPlays] = useState<{ playerId: string; card: string }[]>(trickPlays);
  const [displayYourTeamTricks, setDisplayYourTeamTricks] = useState(yourTeamTricksRaw);
  const [displayOpponentTricks, setDisplayOpponentTricks] = useState(opponentTeamTricksRaw);
  const prevHistoryLen = useRef(trickHistory.length);
  const trickDelayTimer = useRef<number | null>(null);

  useEffect(() => {
    const trickJustCompleted = trickHistory.length > prevHistoryLen.current && trickPlays.length === 0;
    prevHistoryLen.current = trickHistory.length;

    if (trickJustCompleted) {
      const lastTrick = trickHistory[trickHistory.length - 1]?.plays ?? [];
      setDisplayTrickPlays(lastTrick);
      if (trickDelayTimer.current) window.clearTimeout(trickDelayTimer.current);
      trickDelayTimer.current = window.setTimeout(() => {
        setDisplayTrickPlays([]);
        setDisplayYourTeamTricks(yourTeamTricksRaw);
        setDisplayOpponentTricks(opponentTeamTricksRaw);
      }, 2400);
      return;
    }

    if (trickPlays.length > 0) {
      if (trickDelayTimer.current) {
        window.clearTimeout(trickDelayTimer.current);
        trickDelayTimer.current = null;
      }
      setDisplayTrickPlays(trickPlays);
      setDisplayYourTeamTricks(yourTeamTricksRaw);
      setDisplayOpponentTricks(opponentTeamTricksRaw);
      return;
    }

    if (!trickDelayTimer.current) {
      setDisplayTrickPlays([]);
      setDisplayYourTeamTricks(yourTeamTricksRaw);
      setDisplayOpponentTricks(opponentTeamTricksRaw);
    }
  }, [trickPlays, trickHistory, yourTeamTricksRaw, opponentTeamTricksRaw]);

  useEffect(() => {
    return () => {
      if (trickDelayTimer.current) window.clearTimeout(trickDelayTimer.current);
    };
  }, []);

  const winnerLabel =
    phase === "settled"
      ? publicState?.teamScores?.team0 === publicState?.teamScores?.team1
        ? "Tie"
        : (publicState?.teamScores?.team0 ?? 0) > (publicState?.teamScores?.team1 ?? 0)
          ? (myTeamParity === 0 ? "Your Team" : "Opponents")
          : (myTeamParity === 1 ? "Your Team" : "Opponents")
      : null;

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
              {displayTrickPlays.length === 0 && <div className="panel-subtle">No cards played yet</div>}
              {displayTrickPlays.map((p, i) => {
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
                            className="spades-player-card-btn"
                            style={{ zIndex: i + 1 }}
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
          <div className="panel-subtle">Your team tricks: {displayYourTeamTricks}</div>
          <div className="panel-subtle">Opponent tricks: {displayOpponentTricks}</div>
          {winnerLabel && <div className="panel-subtle">Winner: {winnerLabel}</div>}
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

        {phase === "settled" && (
          <div className="panel spades-end-row">
            <div className="panel-title">Round Complete</div>
            <div className="spades-end-actions">
              <button
                className="start-btn start-btn-create spades-end-btn"
                onClick={() => socket?.emit("evt", { type: "room:next" })}
              >
                Play Again
              </button>
              <button
                className="start-btn start-btn-join spades-end-btn"
                onClick={() => socket?.emit("evt", { type: "room:leave" })}
              >
                Exit Lobby
              </button>
            </div>
          </div>
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
      src={CARD_BACK_2}
      alt="Card back"
    />
  );
}
