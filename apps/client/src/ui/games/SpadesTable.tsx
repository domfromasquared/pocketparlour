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
  const trickHistory: { winnerId: string; plays: { playerId: string; card: string }[] }[] =
    publicState?.trickHistory ?? [];

  const canBid = phase === "bidding" && isYourTurn;
  const canPlay = phase === "playing" && isYourTurn;

  const sortedHand = useMemo(() => yourHand.slice(), [yourHand]);

  const nameFor = (pid: string) => room?.seats.find(s => s.userId === pid)?.displayName ?? pid;
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
  const totalSeats = seats.length || 4;
  const myIndex =
    (youSeatIndex != null ? youSeatIndex : seats.find(s => s.userId === userId)?.seatIndex) ?? 0;

  const relSeatClass = (seatIndex: number) => {
    const rel = (seatIndex - myIndex + totalSeats) % totalSeats;
    if (totalSeats === 1) return rel === 0 ? "seat-bottom" : "seat-top";
    if (totalSeats === 2) return rel === 0 ? "seat-bottom" : "seat-top";
    if (totalSeats === 3) return rel === 0 ? "seat-bottom" : rel === 1 ? "seat-left" : "seat-right";
    return "";
  };

  const relSeatStyle = (seatIndex: number): React.CSSProperties | undefined => {
    if (totalSeats < 4) return undefined;
    const rel = (seatIndex - myIndex + totalSeats) % totalSeats;
    const radius = 34; // percent
    const angle = Math.PI / 2 + (2 * Math.PI * rel) / totalSeats; // bottom is rel 0
    const left = 50 + radius * Math.cos(angle);
    const top = 50 + radius * Math.sin(angle);
    return { left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" };
  };

  const relRotation = (seatIndex: number) => {
    const rel = (seatIndex - myIndex + totalSeats) % totalSeats;
    if (totalSeats === 1) return rel === 1 ? 180 : 0;
    if (totalSeats === 2) return rel === 1 ? 180 : 0;
    if (totalSeats === 3) return rel === 1 ? -90 : rel === 2 ? 90 : 0;
    if (totalSeats >= 4) {
      const angle = (360 * rel) / totalSeats;
      return angle;
    }
    return 0;
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="panel px-3 py-2 flex items-center justify-between">
        <div className="panel-title">Spades</div>
        <div className="panel-subtle">{phase === "bidding" ? "Bidding" : phase === "playing" ? "Play" : "Ended"}</div>
      </div>

      <div className="flex-1 min-h-0 mt-2 grid grid-rows-[1fr_auto_auto] gap-2">
        <div className="table-wood relative p-2">
          <div className="table-felt relative h-full w-full p-2">
            <div className="table-center">
              <div className="panel px-3 py-2">
                <div className="panel-subtle text-center">Current Trick</div>
                <div className="flex items-center justify-center gap-2 mt-2">
                  {trickPlays.length === 0 && <div className="panel-subtle">No cards played yet</div>}
                  {trickPlays.map((p, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <CardFace label={p.card} />
                      <div className="panel-subtle text-[10px]">{nameFor(p.playerId)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {seats.map((s) => {
              const isMe = s.userId === userId;
              const seatClass = relSeatClass(s.seatIndex);
              const seatStyle = relSeatStyle(s.seatIndex);
              const rotation = relRotation(s.seatIndex);
              const seatHand = isMe ? sortedHand : Array.from({ length: Math.min(7, sortedHand.length || 7) });

              return (
                <div key={s.seatIndex} className={`seat ${seatClass}`} style={seatStyle}>
                  <div className={`seat-badge ${isMe ? "badge-glow" : ""}`}>{s.displayName}</div>
                  <div
                    className="hand-row"
                    style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
                  >
                    {isMe
                      ? sortedHand.slice(0, 9).map((c, i) => (
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
                        ))
                      : seatHand.map((_, i) => <CardBack key={i} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel px-3 py-2 flex items-center justify-between gap-2">
          <div className="panel-subtle">Team A tricks: {team0Tricks}</div>
          <div className="panel-subtle">Team B tricks: {team1Tricks}</div>
          {winnerTeam && <div className="panel-subtle">Winner: {winnerTeam}</div>}
        </div>

        <div className="panel px-3 py-2 flex items-center justify-between gap-2">
          <div className="panel-title">Bid</div>
          <div className="flex items-center gap-2">
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
