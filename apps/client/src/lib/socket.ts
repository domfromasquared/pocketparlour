// apps/client/src/lib/socket.ts
import { io, type Socket } from "socket.io-client";
import { supabase } from "./supabase";
import { useApp } from "../state/store";
import type { ServerToClientEvent } from "@versus/shared";

let socket: Socket | null = null;

export async function connectSocket(): Promise<Socket> {
  if (socket) return socket;

  const state = useApp.getState();

  // Anonymous auth (guest) but still a Supabase user identity (wallet persists)
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) {
    await supabase.auth.signInAnonymously();
  }
  const session2 = (await supabase.auth.getSession()).data.session;
  if (!session2) throw new Error("Failed to auth");

  socket = io(state.serverUrl, {
    transports: ["websocket"],
    auth: {
      accessToken: session2.access_token,
      displayName: state.displayName
    }
  });

  socket.on("evt", (evt: ServerToClientEvent) => {
    useApp.getState().applyServerEvt(evt);
  });

  socket.on("connect_error", (err) => {
    console.warn("connect_error", err.message);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}
