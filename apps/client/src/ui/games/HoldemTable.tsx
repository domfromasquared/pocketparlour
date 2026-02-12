import React, { useMemo } from "react";
import { useApp } from "../../state/store";
import { cardLabelToAssetUrl, CARD_BACK_2 } from "../assets/cardAssets";

export function HoldemTable() {
  const { publicState, userId, room, youSeatIndex } = useApp();

  const seats = room?.seats ?? [];
  const totalSeats = seats.length || 2;
  const myIndex = (youSeatIndex != null ? youSeatIndex : seats.find(s => s.userId === userId)?.seatIndex) ?? 0;

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
    const radius = 34;
    const angle = Math.PI / 2 + (2 * Math.PI * rel) / totalSeats;
    const left = 50 + radius * Math.cos(angle);
    const top = 50 + radius * Math.sin(angle);
    return { left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" };
  };

  const relRotation = (seatIndex: number) => {
    const rel = (seatIndex - myIndex + totalSeats) % totalSeats;
    if (totalSeats === 1) return rel === 1 ? 180 : 0;
    if (totalSeats === 2) return rel === 1 ? 180 : 0;
    if (totalSeats === 3) return rel === 1 ? -90 : rel === 2 ? 90 : 0;
    if (totalSeats >= 4) return (360 * rel) / totalSeats;
    return 0;
  };

  const community: string[] = publicState?.community ?? [];
  const yourHand: string[] = publicState?.yourHand ?? [];
  const pot = publicState?.pot ?? 0;

  const seatOrder = useMemo(() => seats, [seats]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="table-wood flex-1 min-h-0 p-2">
        <div className="table-felt relative h-full w-full p-2">
          <div className="table-center">
            <div className="panel px-3 py-2">
              <div className="panel-title text-center">Hold ’Em</div>
              <div className="panel-subtle text-center">Pot: {pot}</div>
              <div className="hand-row tight mt-2" style={{ justifyContent: "center" }}>
                {community.length === 0 && <div className="panel-subtle">Waiting on flop</div>}
                {community.map((c, i) => (
                  <CardFace key={`${c}-${i}`} label={c} />
                ))}
              </div>
            </div>
          </div>

          {seatOrder.map((s) => {
            const isMe = s.userId === userId;
            const seatClass = relSeatClass(s.seatIndex);
            const seatStyle = relSeatStyle(s.seatIndex);
            const rotation = relRotation(s.seatIndex);
            const folded = publicState?.players?.find((p: any) => p.playerId === s.userId)?.folded ?? false;

            return (
              <div key={s.seatIndex} className={`seat ${seatClass}`} style={seatStyle}>
                <div className={`seat-badge ${isMe ? "badge-glow" : ""}`}>{s.displayName}</div>
                <div
                  className="hand-row"
                  style={rotation ? { transform: `rotate(${rotation}deg)`, opacity: folded ? 0.4 : 1 } : { opacity: folded ? 0.4 : 1 }}
                >
                  {isMe
                    ? yourHand.map((c, i) => <CardFace key={`${c}-${i}`} label={c} />)
                    : [0, 1].map((i) => <CardBack key={i} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CardFace({ label }: { label: string }) {
  const src = cardLabelToAssetUrl(label);
  if (!src) {
    return (
      <div className="card bg-white/10 grid place-items-center font-black tracking-tight">
        {label}
      </div>
    );
  }
  return <img className="card" src={src} alt={label} draggable={false} />;
}

function CardBack() {
  return <img className="card" src={CARD_BACK_2} alt="Card back" />;
}
