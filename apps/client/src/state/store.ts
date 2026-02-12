// apps/client/src/state/store.ts
import { create } from "zustand";
import type { RoomSummary, ServerToClientEvent, GameKey } from "@versus/shared";

type AppState = {
  userId: string | null;
  displayName: string;
  balance: string; // bigint as string
  room: RoomSummary | null;
  youSeatIndex: number | null;
  publicState: any | null;
  lastResult: null | { delta: string; newBalance: string; outcome: "win" | "lose" | "push" | "cancelled" };
  authed: boolean;
  userEmail: string | null;
  serverUrl: string;

  setDisplayName: (n: string) => void;
  applyServerEvt: (e: ServerToClientEvent) => void;
  clearLastResult: () => void;
  setAuthed: (authed: boolean, email?: string | null) => void;
  setBalance: (balance: string) => void;

  selectedGame: GameKey;
  setSelectedGame: (g: GameKey) => void;

  stakeAmount: string;
  setStakeAmount: (s: string) => void;
};

export const useApp = create<AppState>((set, get) => ({
  userId: null,
  displayName: localStorage.getItem("vg_name") ?? "Guest",
  balance: "0",
  room: null,
  youSeatIndex: null,
  publicState: null,
  lastResult: null,
  authed: false,
  userEmail: null,
  serverUrl: import.meta.env.VITE_SERVER_URL ?? "http://localhost:8787",

  setDisplayName: (n) => {
    localStorage.setItem("vg_name", n);
    set({ displayName: n });
  },

  applyServerEvt: (e) => {
    if (e.type === "auth:ok") set({ userId: e.user.userId });
    if (e.type === "wallet:balance") set({ balance: e.balance });
    if (e.type === "room:joined") set({ room: e.room, youSeatIndex: e.youSeatIndex, lastResult: null });
    if (e.type === "room:left") set({ room: null, youSeatIndex: null, publicState: null, lastResult: null });
    if (e.type === "room:update") set({ room: e.room });
    if (e.type === "game:state") set({ publicState: e.publicState });
    if (e.type === "game:ended") {
      set({ balance: e.result.newBalance, lastResult: e.result });
    }
  },

  clearLastResult: () => set({ lastResult: null }),
  setAuthed: (authed, email = null) => set({ authed, userEmail: email }),
  setBalance: (balance) => set({ balance }),

  selectedGame: "blackjack",
  setSelectedGame: (g) => set({ selectedGame: g }),

  stakeAmount: "0",
  setStakeAmount: (s) => set({ stakeAmount: s.replace(/[^\d]/g, "") || "0" })
}));
