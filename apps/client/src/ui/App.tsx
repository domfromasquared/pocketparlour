// apps/client/src/ui/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { connectSocket, resetSocket } from "../lib/socket";
import { useApp } from "../state/store";
import { Home } from "./Home";
import { LobbyOrGame } from "./LobbyOrGame";
import { supabase } from "../lib/supabase";
import { AppFrame } from "./layout/AppFrame";

export function App() {
  const { room, authed, setAuthed } = useApp();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const session = data.session;
      setAuthed(!!session, session?.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setAuthed(!!session, session?.user?.email ?? null);
      if (!session) {
        resetSocket();
        useApp.setState({
          userId: null,
          room: null,
          youSeatIndex: null,
          publicState: null,
          balance: "0",
          lastResult: null
        });
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authed) return;
    connectSocket().catch(() => {});
  }, [authed]);

  // Prevent landscape use: simple overlay
  const [isPortrait, setIsPortrait] = useState(true);
  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden">
      {!isPortrait && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/80 text-white">
          <div className="panel p-6 text-center max-w-[320px]">
            <div className="text-xl font-bold">Portrait Only</div>
            <div className="text-white/70 mt-2">Rotate your phone back to portrait.</div>
          </div>
        </div>
      )}

      <AppFrame header={<div className="hud-wrap"><TopHud /></div>}>
        {!ready ? <Loading /> : room ? <LobbyOrGame /> : <Home />}
      </AppFrame>
    </div>
  );
}

function Loading() {
  return (
    <div className="h-full grid place-items-center">
      <div className="panel px-6 py-4 text-center">
        <div className="text-lg font-semibold">Connecting…</div>
        <div className="panel-subtle mt-1">Initializing your table</div>
      </div>
    </div>
  );
}

function TopHud() {
  const { balance, room, displayName, authed, userEmail } = useApp();
  const roomCode = room?.roomCode ?? "—";
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="hud-bar">
        <div className="hud-left">
          <div className="icon-btn">♠</div>
        </div>
        <div className="hud-center">
          <div className="hud-pill hud-pill--center">Chips {balance}</div>
        </div>
        <div className="hud-right">
          <div className="room-pill">{roomCode}</div>
          <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Settings">
            ☰
          </button>
        </div>
      </div>
      {open && (
        <div className="panel px-3 py-2 mt-2">
          <div className="panel-title">Settings</div>
          {authed ? (
            <button className="btn-ghost mt-2 w-full" onClick={() => supabase.auth.signOut()}>
              Log Out
            </button>
          ) : (
            <div className="panel-subtle mt-2">Sign in to access settings.</div>
          )}
        </div>
      )}
    </div>
  );
}
