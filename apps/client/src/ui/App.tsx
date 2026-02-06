// apps/client/src/ui/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { connectSocket, getSocket } from "../lib/socket";
import { useApp } from "../state/store";
import { Home } from "./Home";
import { LobbyOrGame } from "./LobbyOrGame";

export function App() {
  const { room } = useApp();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    connectSocket().finally(() => setReady(true));
  }, []);

  // Prevent landscape use: simple overlay
  const [isPortrait, setIsPortrait] = useState(true);
  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="safe h-full w-full overflow-hidden">
      {!isPortrait && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/80 text-white">
          <div className="panel p-6 text-center max-w-[320px]">
            <div className="text-xl font-bold">Portrait only</div>
            <div className="text-white/70 mt-2">Rotate your phone back to portrait.</div>
          </div>
        </div>
      )}

      <div className="h-full w-full flex flex-col">
        <TopHud />
        <div className="flex-1 min-h-0 px-3 pb-3">
          {!ready ? <Loading /> : room ? <LobbyOrGame /> : <Home />}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="h-full grid place-items-center">
      <div className="panel px-6 py-4">
        <div className="text-lg font-semibold">Connecting…</div>
        <div className="text-white/60 text-sm">No scrolling. Neon only. 🎰</div>
      </div>
    </div>
  );
}

function TopHud() {
  const { balance, room } = useApp();
  const roomCode = room?.roomCode ?? "—";
  return (
    <div className="px-3 pt-3">
      <div className="panel h-14 flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 grid place-items-center">♠</div>
          <div className="leading-tight">
            <div className="text-xs text-white/60">Room</div>
            <div className="font-bold tracking-widest">{roomCode}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="panel px-3 py-2 border-white/10 bg-black/20">
            <div className="text-[10px] text-white/60">Chips</div>
            <div className="font-bold">🪙 {balance}</div>
          </div>
          <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 grid place-items-center">⚙️</div>
        </div>
      </div>
    </div>
  );
}
