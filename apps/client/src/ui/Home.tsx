// apps/client/src/ui/Home.tsx
import React, { useState } from "react";
import { useApp } from "../state/store";
import { connectSocket, getSocket } from "../lib/socket";

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
  const { selectedGame, setSelectedGame, displayName, setDisplayName, stakeAmount, setStakeAmount } = useApp();
  const [roomCode, setRoomCode] = useState("");

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

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="panel p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-white/70">Welcome</div>
            <div className="text-xl font-black tracking-wide truncate">{displayName}</div>
          </div>
          <input
            className="h-11 w-32 rounded-xl bg-black/30 border border-white/10 px-3 text-sm outline-none focus:glow-ring"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value.slice(0, 16))}
            aria-label="Display name"
          />
        </div>
      </div>

      <div className="panel p-3 flex-1 min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-white/70">Pick a game</div>
          <div className="text-xs text-white/50">CPU fills missing seats</div>
        </div>

        <div className="grid grid-cols-3 gap-2 h-[58%] min-h-0">
          {games.map((g) => (
            <button
              key={g.key}
              onClick={() => setSelectedGame(g.key as any)}
              className={[
                "panel px-2 py-2 flex flex-col items-center justify-center gap-1 border-white/10",
                selectedGame === g.key ? "glow-ring" : ""
              ].join(" ")}
              style={{ minHeight: 56 }}
            >
              <div className="text-2xl">{g.icon}</div>
              <div className="text-[11px] font-semibold leading-tight text-center">{g.name}</div>
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="panel p-2">
            <div className="text-[10px] text-white/60">Stake (chips)</div>
            <input
              className="h-11 w-full rounded-xl bg-black/30 border border-white/10 px-3 text-sm outline-none"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="panel p-2">
            <div className="text-[10px] text-white/60">Join by code</div>
            <input
              className="h-11 w-full rounded-xl bg-black/30 border border-white/10 px-3 text-sm uppercase outline-none"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 8))}
              placeholder="ABCDE"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button className="btn-gold" onClick={auto}>Auto</button>
          <button className="btn-primary" onClick={create}>Create</button>
          <button className="btn-ghost" onClick={join}>Join</button>
        </div>
      </div>

      <div className="text-[11px] text-white/45 px-1">
        Portrait-only. Touch targets ≥44px. No scroll/pinch.
      </div>
    </div>
  );
}
