// apps/server/src/rooms/roomTypes.ts
import type { GameKey, RoomSummary, Seat } from "@versus/shared";
import type { BJState, SpadesState, HEState } from "@versus/shared";
import type { LDState } from "@versus/shared";
import type { DomState } from "@versus/shared";
import type { CkState } from "@versus/shared";
import type { ChessState } from "@versus/shared";
import type { SolState } from "@versus/shared";
import type { ScrState } from "@versus/shared";
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
  conns: Map<string, PlayerConn>;
  waitingQueue?: { userId: string; displayName: string }[];
  matchId: string | null;
  rngSeed: number;
  bjState?: BJState;
  spadesState?: SpadesState;
  heState?: HEState;
  ldState?: LDState;
  domState?: DomState;
  ckState?: CkState;
  chessState?: ChessState;
  solState?: SolState;
  scrState?: ScrState;
  turnDeadline?: number;
};

export type SocketWithUser = Socket & { data: { userId: string; displayName: string } };
