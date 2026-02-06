// apps/client/src/ui/LobbyOrGame.tsx
import React, { useMemo } from "react";
import { useApp } from "../state/store";
import { getSocket } from "../lib/socket";
import { BlackjackTable } from "./games/BlackjackTable";

export function LobbyOrGame() {
  const { room } = useApp();
  if (!room) return null;

  const leave = () => {
    getSocket()?.emit("evt", { type: "room:leave" });
    // Simple local clear; server will also emit room:left on real implementation.
    // TODO: implement room:leave on server with roomId lookup and cleanup.
    window.location.reload();
  };

  const isActive = room.status === "active";
  const isEnded = room.status === "ended";

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="panel p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/60">Game</div>
            <div className="text-lg font-black capitalize">{room.gameKey.replace("_", " ")}</div>
            <div className="text-xs text-white/50">Stake: {room.stakeAmount.toString()}</div>
          </div>
          <button className="btn-ghost" onClick={leave}>Exit</button>
        </div>
      </div>

      <div className="panel flex-1 min-h-0 p-2">
        {!isActive && !isEnded && <Lobby />}
        {room.gameKey === "blackjack" && <BlackjackTable />}
        {room.gameKey !== "blackjack" && (
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
  const { room } = useApp();
  return (
    <div className="h-full flex flex-col">
      <div className="text-sm text-white/70 px-2 py-1">Seats</div>
      <div className="grid grid-cols-1 gap-2 px-2 pb-2 overflow-hidden">
        {room?.seats.map((s) => (
          <div key={s.seatIndex} className="panel p-3 flex items-center justify-between">
            <div className="font-semibold">
              {s.displayName} {s.isBot ? "🤖" : ""}
            </div>
            <div className="text-xs text-white/60">Seat {s.seatIndex + 1}</div>
          </div>
        ))}
      </div>

      <div className="mt-auto px-2 pb-2 text-xs text-white/50">
        Auto-start when required players are seated.
      </div>
    </div>
  );
}

function BottomActionBar() {
  const { room } = useApp();
  const socket = getSocket();

  const isBJ = room?.gameKey === "blackjack";
  const { publicState } = useApp();

  return (
    <div className="panel h-16 px-2 flex items-center justify-between">
      <button className="btn-ghost" onClick={() => alert("Rules modal TODO: show /docs/rules/" + room?.gameKey)}>
        📜 Rules
      </button>

      {isBJ && publicState?.phase === "playerTurn" ? (
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "bj:hit" } })}>
            Hit
          </button>
          <button className="btn-primary" onClick={() => socket?.emit("evt", { type: "game:action", action: { type: "bj:stand" } })}>
            Stand
          </button>
        </div>
      ) : (
        <div className="text-xs text-white/60 px-2">Actions appear here</div>
      )}

      <button className="btn-ghost" onClick={() => alert("Players drawer TODO")}>👥</button>
    </div>
  );
}
