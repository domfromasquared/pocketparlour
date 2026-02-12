// apps/client/src/ui/Home.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store";
import { connectSocket, getSocket } from "../lib/socket";
import { supabase } from "../lib/supabase";

const games = [
  { key: "blackjack", name: "Blackjack", icon: "🂡" },
  { key: "spades", name: "Spades", icon: "♠️" },
  { key: "holdem", name: "Hold ’Em", icon: "🃏" },
  { key: "solitaire", name: "Solitaire", icon: "🂫" },
  { key: "scrabble", name: "Scrabble", icon: "🔤" },
  { key: "dominoes", name: "Dominoes", icon: "🁫" },
  { key: "chess", name: "Chess", icon: "♟️" },
  { key: "checkers", name: "Checkers", icon: "⚫" },
  { key: "liars_dice", name: "Liar’s Dice", icon: "🎲" }
] as const;

export function Home() {
  const {
    selectedGame,
    setSelectedGame,
    displayName,
    setDisplayName,
    stakeAmount,
    setStakeAmount,
    authed,
    userEmail,
    serverUrl,
    setBalance
  } = useApp();
  const [roomCode, setRoomCode] = useState("");
  const [email, setEmail] = useState(userEmail ?? "");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [spinAvailable, setSpinAvailable] = useState(false);
  const [nextSpinAt, setNextSpinAt] = useState<string | null>(null);
  const [spinLoading, setSpinLoading] = useState(false);
  const [spinPrize, setSpinPrize] = useState<number | null>(null);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [spinPrizes, setSpinPrizes] = useState<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wheelAngle, setWheelAngle] = useState(0);
  const spinAnimRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [showGameModal, setShowGameModal] = useState(false);

  const join = async () => {
    await connectSocket();
    getSocket()!.emit("evt", { type: "room:join", roomCode });
  };

  const create = async () => {
    await connectSocket();
    getSocket()!.emit("evt", { type: "room:create", gameKey: selectedGame, stakeAmount });
  };

  const auto = async () => {
    await connectSocket();
    getSocket()!.emit("evt", { type: "room:autoJoin", gameKey: selectedGame, stakeAmount });
  };

  const fetchSpinStatus = async () => {
    if (!authed) return;
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) return;
    const res = await fetch(`${serverUrl}/daily-spin`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    setSpinAvailable(!!data.available);
    setNextSpinAt(data.nextAvailableAt ?? null);
    if (Array.isArray(data.prizes)) setSpinPrizes(data.prizes);
  };

  useEffect(() => {
    fetchSpinStatus();
  }, [authed]);

  useEffect(() => {
    if (!nextSpinAt) return;
    const id = setInterval(() => {
      setNowTick(Date.now());
      const ms = Math.max(0, new Date(nextSpinAt).getTime() - Date.now());
      if (ms <= 0) setSpinAvailable(true);
    }, 1000);
    return () => clearInterval(id);
  }, [nextSpinAt]);

  const remaining = useMemo(() => {
    if (!nextSpinAt) return "00:00:00";
    const ms = Math.max(0, new Date(nextSpinAt).getTime() - nowTick);
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [nextSpinAt, nowTick, spinAvailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const size = Math.min(parent.clientWidth, parent.clientHeight);
      canvas.width = size * devicePixelRatio;
      canvas.height = size * devicePixelRatio;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      drawWheel(wheelAngle);
    };
    const drawWheel = (angle: number) => {
      const size = canvas.width;
      const r = size / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(r, r);
      ctx.rotate(angle);
      const segments = spinPrizes.length || 24;
      const colors = [
        "#ff5b5b",
        "#ffb347",
        "#ffe66d",
        "#5bff8a",
        "#4cc9ff",
        "#7b5bff",
        "#ff5bd6"
      ];
      const labels =
        spinPrizes.length > 0
          ? spinPrizes.map((p) => `${p}`)
          : Array.from({ length: 24 }, (_, i) => `${(i + 1) * 100}`);
      for (let i = 0; i < segments; i++) {
        const start = (i * 2 * Math.PI) / segments;
        const end = ((i + 1) * 2 * Math.PI) / segments;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r * 0.96, start, end);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = r * 0.02;
        ctx.stroke();

        const mid = (start + end) / 2;
        ctx.save();
        ctx.rotate(mid);
        ctx.translate(r * 0.62, 0);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = "#1b0f30";
        ctx.font = `${Math.max(10, r * 0.09)}px Baloo 2, Rubik, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labels[i % labels.length], 0, 0);
        ctx.restore();
      }
      ctx.restore();

      // center hub
      ctx.beginPath();
      ctx.arc(r, r, r * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd36a";
      ctx.fill();
      ctx.strokeStyle = "#8a5a14";
      ctx.lineWidth = r * 0.02;
      ctx.stroke();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => ro.disconnect();
  }, [spinPrizes, wheelAngle]);

  const spinToPrize = (prize: number) => {
    const segments = spinPrizes.length || 24;
    const index = Math.max(0, spinPrizes.indexOf(prize));
    const segmentAngle = (2 * Math.PI) / segments;
    const target = (segments - index) * segmentAngle + Math.PI / 2;
    const extra = 6 * Math.PI;
    const start = wheelAngle;
    const end = target + extra;
    const duration = 2400;
    const startTime = performance.now();
    if (spinAnimRef.current) cancelAnimationFrame(spinAnimRef.current);
    const tick = (t: number) => {
      const p = Math.min(1, (t - startTime) / duration);
      const ease = 1 - Math.pow(1 - p, 3);
      const angle = start + (end - start) * ease;
      setWheelAngle(angle);
      if (p < 1) spinAnimRef.current = requestAnimationFrame(tick);
    };
    spinAnimRef.current = requestAnimationFrame(tick);
  };

  return (
    <div className="screen">
      {authed && (
        <div className="panel px-3 py-2 spin-panel">
          <div className="panel-title">Daily Spin</div>
          <div className="wheel-wrap">
            <canvas ref={canvasRef} />
            <div className="wheel-pointer" />
          </div>
          <div className="panel-subtle mt-2">
            {spinAvailable ? "Free spin ready" : `Next free spin in ${remaining}`}
          </div>
        </div>
      )}

      {!authed && (
        <div className="panel px-3 py-2 flex flex-col gap-2">
          <div className="panel-title">Sign In</div>
          <input
            className="input-field"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
          />
          <input
            className="input-field"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {authError && <div className="panel-subtle">{authError}</div>}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn-green"
              onClick={async () => {
                setAuthError(null);
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) setAuthError(error.message);
              }}
            >
              Sign In
            </button>
            <button
              className="btn-blue"
              onClick={async () => {
                setAuthError(null);
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) setAuthError(error.message);
              }}
            >
              Sign Up
            </button>
          </div>
          <button
            className="btn-google"
            onClick={async () => {
              setAuthError(null);
              const redirectTo = `${window.location.origin}${window.location.pathname}`;
              const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo }
              });
              if (error) setAuthError(error.message);
            }}
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt=""
              aria-hidden="true"
            />
            Continue with Google
          </button>
        </div>
      )}

      <div className="panel px-3 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="panel-title">Player</div>
          <div className="text-lg font-black tracking-wide truncate text-shadow">{displayName}</div>
          <div className="panel-subtle">Edit name (shown in rooms)</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input-field w-32 focus:glow-ring"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 16))}
            aria-label="Display name"
          />
        </div>
      </div>

      <div className={`panel flex-1 min-h-0 p-2 flex flex-col gap-2 ${!authed ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="panel-title">Choose Your Game</div>
          <div className="panel-subtle">CPU fills missing seats</div>
        </div>

        <div className="game-grid flex-1 min-h-0">
          {games.map((g) => (
            <button
              key={g.key}
              onClick={() => {
                setSelectedGame(g.key as any);
                setShowGameModal(true);
              }}
              className={`tile-btn ${selectedGame === g.key ? "is-selected" : ""}`}
            >
              <div className="tile-icon">{g.icon}</div>
              <div className="tile-label">{g.name}</div>
            </button>
          ))}
        </div>

        {/* Start flow is handled by the modal after selecting a game */}
      </div>

      {showGameModal && authed && (
        <div className="modal-backdrop" onClick={() => setShowGameModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="panel-title">Start Game</div>
                <div className="text-lg font-black tracking-wide">{selectedGame.replace("_", " ")}</div>
              </div>
              <button className="btn-ghost" onClick={() => setShowGameModal(false)}>✕</button>
            </div>

            <div className="panel-subtle mt-2">Join by code (optional)</div>
            <input
              className="input-field uppercase w-full mt-1"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 8))}
              placeholder="ABCDE"
            />

            <div className="grid grid-cols-3 gap-2 mt-3">
              <button
                className="btn-blue"
                onClick={async () => {
                  await auto();
                  setShowGameModal(false);
                }}
              >
                Auto
              </button>
              <button
                className="btn-green"
                onClick={async () => {
                  await create();
                  setShowGameModal(false);
                }}
              >
                Create
              </button>
              <button
                className="btn-gold"
                onClick={async () => {
                  await join();
                  setShowGameModal(false);
                }}
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
