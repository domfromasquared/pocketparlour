// apps/server/src/rooms/runtime.ts
import type { Room } from "./roomTypes.js";
import { cancelMatchIfActive, leaveRoom, toSummary } from "./rooms.js";
import type { ServerToClientEvent } from "@versus/shared";

// This module owns the in-memory room registry accessors.
// Kept separate so index.ts can cleanup without exposing Maps directly.
const state = globalThis as any;
state.__rooms = state.__rooms ?? new Map<string, Room>();
state.__codeToRoomId = state.__codeToRoomId ?? new Map<string, string>();

export function _bindRoomStores(rooms: Map<string, Room>, codeToRoomId: Map<string, string>) {
  state.__rooms = rooms;
  state.__codeToRoomId = codeToRoomId;
}

// The rooms.ts in this v1 keeps internal Maps; for brevity we mirror them here.
// TODO: refactor to single source of truth (one module exports the maps + typed getters).
export function getRoomById(roomId: string): Room | null {
  return (state.__rooms as Map<string, Room>).get(roomId) ?? null;
}

export function listRooms(): Room[] {
  return Array.from((state.__rooms as Map<string, Room>).values());
}

export async function internalCleanupLeave(room: Room, userId: string, emitToRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  // If active match and the only human leaves, cancel and refund (simple v1 policy).
  const stillSeated = room.seats.some(s => s.userId === userId);
  if (stillSeated && room.status === "active" && room.gameKey === "blackjack") {
    await cancelMatchIfActive(room, emitToRoom);
  }

  if (room.status === "active" && room.gameKey === "spades") {
    room.conns.delete(userId);
    const seat = room.seats.find(s => s.userId === userId);
    if (seat) {
      seat.isBot = true;
      seat.ready = true;
      seat.botDifficulty = seat.botDifficulty ?? 2;
      if (!seat.displayName.startsWith("CPU")) seat.displayName = `CPU ${seat.seatIndex + 1}`;
    }
    emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    return;
  }

  leaveRoom(room, userId);
  emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
}
