// apps/client/src/ui/LobbyOrGame.tsx
import React, { useMemo } from "react";
import { useApp } from "../state/store";
import { getSocket } from "../lib/socket";
import { BlackjackTable } from "./games/BlackjackTable";
import { SpadesTable } from "./games/SpadesTable";
import { HoldemTable } from "./games/HoldemTable";

export function LobbyOrGame() {
  const { room, youSeatIndex } = useApp();
  if (!room) return null;

  const leave = () => {
    getSocket()?.emit("evt", { type: "room:leave" });
  };

  const isActive = room.status === "active";
  const isEnded = room.status === "ended";
  const queued = youSeatIndex === -1;

  return (
    <div className="screen">
      <div className="panel px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="panel-title">Game</div>
            <div className="text-lg font-black capitalize text-shadow">{room.gameKey.replace("_", " ")}</div>
            <div className="panel-subtle">Stake: {room.stakeAmount}</div>
            {queued && (
              <div className="queue-badge mt-1">
                Queued for next seat {room.waitingCount > 0 ? `(${room.waitingCount} waiting)` : ""}
              </div>
            )}
          </div>
          <button className="start-btn start-btn-join game-top-btn" onClick={leave}>Exit</button>
        </div>
      </div>

      <div className="panel flex-1 min-h-0 p-2 game-panel">
        {!isActive && !isEnded && <Lobby />}
        {room.gameKey === "blackjack" && <BlackjackTable />}
        {room.gameKey === "spades" && <SpadesTable />}
        {room.gameKey === "holdem" && <HoldemTable />}
        {room.gameKey !== "blackjack" && room.gameKey !== "spades" && room.gameKey !== "holdem" && (
          <div className="h-full grid place-items-center text-white/70">
            <div className="panel p-4 max-w-[320px] text-center">
              <div className="text-lg font-bold">Coming next</div>
              <div className="text-sm text-white/60 mt-1">
                This room shell + economy is ready. Implement the next game plugin under /packages/shared and render it here.
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomActionBar />
    </div>
  );
}

function Lobby() {
  const { room, userId, youSeatIndex } = useApp();
  const socket = getSocket();
  const mySeat =
    (youSeatIndex != null ? room?.seats.find(s => s.seatIndex === youSeatIndex) : undefined) ??
    (userId ? room?.seats.find(s => s.userId === userId) : undefined);
  const isReady = mySeat?.ready ?? false;
  const isHoldemLobby = room?.gameKey === "holdem";
  const canStartHoldem =
    !!room &&
    isHoldemLobby &&
    room.seats.some((s) => !!s.userId && !s.isBot) &&
    room.seats.filter((s) => !!s.userId && !s.isBot).every((s) => s.ready);
  const seatsOrdered = useMemo(() => {
    const list = room?.seats.slice() ?? [];
    return list.sort((a, b) => {
      if (a.userId === userId) return -1;
      if (b.userId === userId) return 1;
      return a.seatIndex - b.seatIndex;
    });
  }, [room?.seats, userId]);

  return (
    <div className="h-full flex flex-col">
      <div className="panel-title px-2 py-1">Seats</div>
      <div
        className="lobby-seats-row px-2 pb-2"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, seatsOrdered.length)}, minmax(0, 1fr))` }}
      >
        {seatsOrdered.map((s) => (
          <div
            key={s.seatIndex}
            className={`lobby-seat-pill ${s.userId === userId ? "is-you" : ""} ${s.ready ? "is-ready" : ""}`}
          >
            <div className="lobby-seat-name">
              {s.displayName} {s.isBot ? "🤖" : ""}
            </div>
            <div className="panel-subtle">
              Seat {s.seatIndex + 1}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto px-2 pb-2 flex items-center justify-between gap-2">
        <div className="panel-subtle">
          {isHoldemLobby ? "Press Play when everyone is ready." : "Auto-start when all players are ready."}
        </div>
        <div className="flex items-center gap-2">
          {mySeat && !mySeat.isBot && (
            <button
              className={`start-btn game-ready-btn ${isReady ? "start-btn-join" : "start-btn-create"}`}
              onClick={() => socket?.emit("evt", { type: "room:ready", ready: !isReady })}
            >
              {isReady ? "Unready" : "Ready"}
            </button>
          )}
          {isHoldemLobby && (
            <button
              className="start-btn start-btn-auto game-ready-btn"
              onClick={() => socket?.emit("evt", { type: "room:next" })}
              disabled={!canStartHoldem}
            >
              Play
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BottomActionBar() {
  const { room } = useApp();
  const socket = getSocket();

  const isBJ = room?.gameKey === "blackjack";
  const isHoldem = room?.gameKey === "holdem";
  const { publicState } = useApp();
  const [raiseAmt, setRaiseAmt] = React.useState(100);
  const minRaise = publicState?.minRaise ?? 100;
  const maxRaise = Math.max(minRaise * 10, minRaise + 1000);

  React.useEffect(() => {
    if (raiseAmt < minRaise) setRaiseAmt(minRaise);
  }, [minRaise, raiseAmt]);

  return (
    <div className="action-bar">
      <button className="btn-ghost" onClick={() => alert("Rules modal TODO: show /docs/rules/" + room?.gameKey)}>
        Rules
      </button>

      {isBJ && publicState?.phase === "playerTurn" ? (
        <div className="flex gap-2">
          <button className="btn-blue" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "bj:hit" } })}>
            Hit
          </button>
          <button className="btn-green" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "bj:stand" } })}>
            Stand
          </button>
        </div>
      ) : isHoldem && publicState ? (
        <div className="flex items-center gap-2">
          <button
            className="btn-red"
            onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "he:fold" } })}
          >
            Fold
          </button>
          {publicState?.legalActions?.some((a: any) => a.type === "he:check") && (
            <button
              className="btn-blue"
              onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "he:check" } })}
            >
              Check
            </button>
          )}
          {publicState?.legalActions?.some((a: any) => a.type === "he:call") && (
            <button
              className="btn-gold"
              onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "he:call" } })}
            >
              Call {publicState?.callAmount ?? ""}
            </button>
          )}
          {publicState?.legalActions?.some((a: any) => a.type === "he:raise") && (
            <div className="holdem-raise-wrap">
              <div className="holdem-raise-value">Raise {raiseAmt}</div>
              <input
                className="holdem-raise-slider"
                type="range"
                min={minRaise}
                max={maxRaise}
                step={minRaise}
                value={Math.min(maxRaise, Math.max(minRaise, raiseAmt))}
                onChange={(e) => setRaiseAmt(Number(e.target.value))}
              />
              <button
                className="btn-green"
                onClick={() =>
                  socket?.emit("evt", {
                    type: "game:action",
                    action: { type: "he:raise", amount: Math.min(maxRaise, Math.max(minRaise, raiseAmt)) }
                  })
                }
              >
                Raise
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="panel-subtle px-2">Actions appear here</div>
      )}

      <button className="btn-ghost" onClick={() => alert("Players drawer TODO")}>Players</button>
    </div>
  );
}
