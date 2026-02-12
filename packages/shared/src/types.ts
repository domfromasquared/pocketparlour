import { z } from "zod";

export const GameKeySchema = z.enum([
  "blackjack",
  "spades",
  "holdem",
  "solitaire",
  "scrabble",
  "dominoes",
  "chess",
  "checkers",
  "liars_dice"
]);
export type GameKey = z.infer<typeof GameKeySchema>;

export type RoomStatus = "lobby" | "active" | "ended";

export type Seat = {
  seatIndex: number;
  userId?: string; // undefined => empty
  isBot: boolean;
  botDifficulty?: number; // 1..3
  ready?: boolean;
  displayName: string;
};

export type RoomSummary = {
  roomId: string;
  roomCode: string;
  gameKey: GameKey;
  status: RoomStatus;
  createdAt: number;
  stakeAmount: string; // bigint as string
  turnMs: number; // default 20000
  seats: Seat[];
};

export type AuthedUser = {
  userId: string;
  displayName: string;
};

export const ClientToServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room:autoJoin"), gameKey: GameKeySchema, stakeAmount: z.string().regex(/^\d+$/).default("0") }),
  z.object({ type: z.literal("room:create"), gameKey: GameKeySchema, stakeAmount: z.string().regex(/^\d+$/).default("0") }),
  z.object({ type: z.literal("room:join"), roomCode: z.string().min(3).max(8) }),
  z.object({ type: z.literal("room:leave") }),
  z.object({ type: z.literal("room:next") }),
  z.object({ type: z.literal("room:ready"), ready: z.boolean() }),
  // Game actions are game-specific; server validates.
  z.object({ type: z.literal("game:action"), action: z.any() })
]);
export type ClientToServerEvent = z.infer<typeof ClientToServerEventSchema>;

export type ServerToClientEvent =
  | { type: "auth:ok"; user: AuthedUser }
  | { type: "wallet:balance"; balance: string } // bigint as string
  | { type: "room:joined"; room: RoomSummary; youSeatIndex: number }
  | { type: "room:left" }
  | { type: "room:update"; room: RoomSummary }
  | { type: "game:state"; publicState: any }
  | { type: "game:ended"; result: { delta: string; newBalance: string; outcome: "win" | "lose" | "push" | "cancelled" } }
  | { type: "error"; message: string };
