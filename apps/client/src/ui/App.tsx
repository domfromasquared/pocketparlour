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
  const { balance, room, displayName, setDisplayName, authed, userEmail, userId } = useApp();
  const roomCode = room?.roomCode ?? "—";
  const [open, setOpen] = useState(false);
  const initials = (displayName || "P").trim().slice(0, 2).toUpperCase();
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
        <div className="panel settings-panel mt-2">
          <div className="panel-title">Settings</div>
          {authed ? (
            <>
              <div className="profile-card mt-2">
                <div className="profile-avatar">{initials}</div>
                <div className="profile-main">
                  <div className="profile-name">{displayName || "Player"}</div>
                  <div className="profile-email">{userEmail ?? "No email"}</div>
                  <input
                    className="input-field settings-name-input mt-2"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value.slice(0, 16))}
                    aria-label="Display name"
                    placeholder="Player name"
                  />
                </div>
                <div className="profile-chip-pill">🪙 {balance}</div>
              </div>
              <div className="profile-stats mt-2">
                <div className="profile-stat">
                  <div className="profile-stat-label">User ID</div>
                  <div className="profile-stat-value">{(userId ?? "—").slice(0, 8)}</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-label">Room</div>
                  <div className="profile-stat-value">{roomCode}</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-label">Status</div>
                  <div className="profile-stat-value">{room ? "In Match" : "Lobby"}</div>
                </div>
              </div>
              <button className="settings-logout-btn mt-2" onClick={() => supabase.auth.signOut()}>
                Log Out
              </button>
            </>
          ) : (
            <div className="panel-subtle mt-2">Sign in to access settings.</div>
          )}
        </div>
      )}
    </div>
  );
}
