// apps/server/src/rooms/roomTypes.ts
import type { GameKey, RoomSummary, Seat } from "@versus/shared";
import type { BJState } from "@versus/shared";
import type { Socket } from "socket.io";

export type PlayerConn = {
  userId: string;
  displayName: string;
  socketId: string;
  lastSeen: number;
  ready: boolean;
};

export type Room = {
  roomId: string;
  roomCode: string;
  gameKey: GameKey;
  status: "lobby" | "active" | "ended";
  createdAt: number;
  stakeAmount: bigint;
  turnMs: number;
  seats: Seat[];
  conns: Map<string, PlayerConn>; // userId -> conn
  matchId: string | null;
  rngSeed: number;
  // Game state (v1: Blackjack only)
  bjState?: BJState;
  turnDeadline?: number;
};

export type SocketWithUser = Socket & { data: { userId: string; displayName: string } };
