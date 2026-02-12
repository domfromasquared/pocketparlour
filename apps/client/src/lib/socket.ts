// apps/client/src/lib/socket.ts
import { io, type Socket } from "socket.io-client";
import { supabase } from "./supabase";
import { useApp } from "../state/store";
import type { ServerToClientEvent } from "@versus/shared";

let socket: Socket | null = null;

export async function connectSocket(): Promise<Socket> {
  if (socket) return socket;

  const state = useApp.getState();

  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not logged in");

  socket = io(state.serverUrl, {
    transports: ["websocket"],
    auth: {
      accessToken: session.access_token,
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

export function resetSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
