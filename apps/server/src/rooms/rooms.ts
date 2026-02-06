// apps/server/src/rooms/rooms.ts
import crypto from "crypto";
import type { GameKey, RoomSummary, Seat, ServerToClientEvent } from "@versus/shared";
import { blackjackPlugin } from "@versus/shared";
import { mulberry32 } from "@versus/shared";
import { ensureWalletRow, getBalance, lockStake, refundStake, settleMatchWinnerTakeAll } from "../economy/economy.js";
import { pool } from "../db.js";
import type { Room, SocketWithUser } from "./roomTypes.js";

const rooms = new Map<string, Room>();
const codeToRoomId = new Map<string, string>();

function genCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function genRoomId(): string {
  return crypto.randomUUID();
}

function makeSeats(gameKey: GameKey): Seat[] {
  // V1: Blackjack is 1 seat (vs house). Other games can expand later.
  const seatsCount = gameKey === "blackjack" ? 1 : 2;
  return Array.from({ length: seatsCount }, (_, i) => ({
    seatIndex: i,
    isBot: false,
    displayName: "Empty"
  }));
}

export function toSummary(r: Room): RoomSummary {
  return {
    roomId: r.roomId,
    roomCode: r.roomCode,
    gameKey: r.gameKey,
    status: r.status,
    createdAt: r.createdAt,
    stakeAmount: r.stakeAmount,
    turnMs: r.turnMs,
    seats: r.seats
  };
}

export function findBestRoom(gameKey: GameKey, stakeAmount: bigint): Room | null {
  for (const r of rooms.values()) {
    if (r.gameKey !== gameKey) continue;
    if (r.status !== "lobby") continue;
    if (r.stakeAmount !== stakeAmount) continue;
    const hasEmpty = r.seats.some(s => !s.userId);
    if (hasEmpty) return r;
  }
  return null;
}

export function createRoom(gameKey: GameKey, stakeAmount: bigint): Room {
  let roomCode = genCode();
  while (codeToRoomId.has(roomCode)) roomCode = genCode();

  const roomId = genRoomId();
  const rngSeed = Math.floor(Math.random() * 1_000_000_000);

  const r: Room = {
    roomId,
    roomCode,
    gameKey,
    status: "lobby",
    createdAt: Date.now(),
    stakeAmount,
    turnMs: 20_000,
    seats: makeSeats(gameKey),
    conns: new Map(),
    matchId: null,
    rngSeed
  };

  rooms.set(roomId, r);
  codeToRoomId.set(roomCode, roomId);
  return r;
}

export function getRoomByCode(code: string): Room | null {
  const id = codeToRoomId.get(code.toUpperCase());
  if (!id) return null;
  return rooms.get(id) ?? null;
}

export function joinRoom(room: Room, sock: SocketWithUser): { seatIndex: number } {
  // Reconnect path
  room.conns.set(sock.data.userId, {
    userId: sock.data.userId,
    displayName: sock.data.displayName,
    socketId: sock.id,
    lastSeen: Date.now(),
    ready: false
  });

  // If already seated, keep seat
  const existing = room.seats.find(s => s.userId === sock.data.userId);
  if (existing) {
    existing.displayName = sock.data.displayName;
    existing.isBot = false;
    return { seatIndex: existing.seatIndex };
  }

  const empty = room.seats.find(s => !s.userId);
  if (!empty) throw new Error("Room full");
  empty.userId = sock.data.userId;
  empty.displayName = sock.data.displayName;
  empty.isBot = false;
  return { seatIndex: empty.seatIndex };
}

export function leaveRoom(room: Room, userId: string) {
  room.conns.delete(userId);
  const seat = room.seats.find(s => s.userId === userId);
  if (seat) {
    seat.userId = undefined;
    seat.displayName = "Empty";
    seat.isBot = false;
    seat.botDifficulty = undefined;
  }

  // If lobby empty, cleanup
  const anyHumans = room.seats.some(s => s.userId);
  if (!anyHumans && room.status !== "active") {
    rooms.delete(room.roomId);
    codeToRoomId.delete(room.roomCode);
  }
}

export async function emitWallet(sock: SocketWithUser) {
  await ensureWalletRow(sock.data.userId);
  const bal = await getBalance(sock.data.userId);
  sock.emit("evt", { type: "wallet:balance", balance: bal.toString() } satisfies ServerToClientEvent);
}

export async function maybeStartGame(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (room.status !== "lobby") return;
  const seatedUsers = room.seats.filter(s => !!s.userId).map(s => s.userId!) as string[];
  if (room.gameKey === "blackjack" && seatedUsers.length === 1) {
    const userId = seatedUsers[0];
    const matchId = crypto.randomUUID();
    room.matchId = matchId;

    // Create match rows
    await pool.query(
      `insert into matches (match_id, room_id, game_key, stake_amount, status) values ($1,$2,$3,$4,'active')`,
      [matchId, room.roomId, room.gameKey, room.stakeAmount.toString()]
    );
    await pool.query(
      `insert into match_players (match_id, user_id, is_bot, seat_index) values ($1,$2,false,0)`,
      [matchId, userId]
    );

    // Lock stake atomically (idempotent)
    await lockStake({
      matchId,
      gameKey: room.gameKey,
      stakeAmount: room.stakeAmount,
      userIds: [userId],
      roomId: room.roomId
    });

    // Start game
    room.status = "active";
    const state = blackjackPlugin.createInitialState({ seats: 1, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed });
    // Map plugin playerId "P1" -> actual user; store separately in room (v1: single seat)
    room.bjState = { ...state, playerId: userId };
    room.turnDeadline = Date.now() + room.turnMs;

    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    ioEmitRoom(room.roomId, { type: "game:state", publicState: blackjackPlugin.getPublicState(room.bjState, userId) });
  }
}

export async function handleTimeoutTick(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (room.status !== "active" || room.gameKey !== "blackjack" || !room.bjState) return;
  const now = Date.now();
  if (!room.turnDeadline || now < room.turnDeadline) return;

  const userId = room.bjState.playerId;
  // Auto-move policy: if total < 17 => hit else stand
  const pub = blackjackPlugin.getPublicState(room.bjState, userId);
  const action = pub.playerTotal < 17 ? ({ type: "bj:hit" } as const) : ({ type: "bj:stand" } as const);

  const { state } = blackjackPlugin.applyAction(room.bjState, action, { now, rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.bjState = state;
  room.turnDeadline = Date.now() + room.turnMs;

  ioEmitRoom(room.roomId, { type: "game:state", publicState: blackjackPlugin.getPublicState(room.bjState, userId) });

  if (blackjackPlugin.isGameOver(room.bjState)) {
    await endGame(room, ioEmitRoom);
  }
}

export async function applyBlackjackAction(room: Room, userId: string, action: any, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (room.status !== "active" || room.gameKey !== "blackjack" || !room.bjState) throw new Error("Not in game");
  if (room.bjState.playerId !== userId) throw new Error("Not your seat");

  const legal = blackjackPlugin.getLegalActions(room.bjState, userId);
  if (!legal.some(a => a.type === action?.type)) throw new Error("Illegal action");

  const { state } = blackjackPlugin.applyAction(room.bjState, action, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.bjState = state;
  room.turnDeadline = Date.now() + room.turnMs;

  // Append event
  if (room.matchId) {
    await pool.query(
      `insert into match_events (match_id, seq, user_id, event_type, payload)
       values ($1,
         coalesce((select max(seq) from match_events where match_id=$1), -1) + 1,
         $2, 'move', $3)`,
      [room.matchId, userId, JSON.stringify(action)]
    );
  }

  ioEmitRoom(room.roomId, { type: "game:state", publicState: blackjackPlugin.getPublicState(room.bjState, userId) });

  if (blackjackPlugin.isGameOver(room.bjState)) {
    await endGame(room, ioEmitRoom);
  }
}

async function endGame(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (!room.matchId || !room.bjState) return;
  const userId = room.bjState.playerId;

  const winners = blackjackPlugin.getWinners(room.bjState);
  const outcome = winners.outcomeByPlayer[userId];

  // Settle
  await settleMatchWinnerTakeAll({
    matchId: room.matchId,
    gameKey: room.gameKey,
    stakeAmount: room.stakeAmount,
    userIds: [userId],
    winnerUserId: outcome === "win" ? userId : null,
    outcomeByUser: { [userId]: outcome },
    roomId: room.roomId
  });

  const newBal = await getBalance(userId);

  // Compute delta for end modal
  let delta = 0n;
  if (room.stakeAmount > 0n) {
    if (outcome === "win") delta = room.stakeAmount; // net +stake vs house
    else if (outcome === "lose") delta = -room.stakeAmount;
    else delta = 0n;
  }

  ioEmitRoom(room.roomId, {
    type: "game:ended",
    result: { delta: delta.toString(), newBalance: newBal.toString(), outcome }
  });

  room.status = "ended";
  ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
}

export async function cancelMatchIfActive(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (!room.matchId || room.status !== "active") return;
  const userIds = room.seats.filter(s => !!s.userId).map(s => s.userId!) as string[];
  await refundStake({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds, roomId: room.roomId });
  await pool.query(`update matches set status='cancelled', finished_at=now() where match_id=$1`, [room.matchId]);
  ioEmitRoom(room.roomId, { type: "game:ended", result: { delta: "0", newBalance: "0", outcome: "cancelled" } });
  room.status = "ended";
}
