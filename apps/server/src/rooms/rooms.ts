// apps/server/src/rooms/rooms.ts
import crypto from "crypto";
import type { GameKey, RoomSummary, Seat, ServerToClientEvent, SpadesPublicState, SpadesState, HEPublicState, HEState } from "@versus/shared";
import { blackjackPlugin, spadesPlugin, holdemPlugin } from "@versus/shared";
import { mulberry32 } from "@versus/shared";
import { ensureWalletRow, getBalance, lockStake, refundStake, settleMatchWinnerTakeAll, settleMatchSplitPot } from "../economy/economy.js";
import { pool } from "../db.js";
import type { Room, SocketWithUser } from "./roomTypes.js";
import { _bindRoomStores } from "./runtime.js";

const rooms = new Map<string, Room>();
const codeToRoomId = new Map<string, string>();
_bindRoomStores(rooms, codeToRoomId);

function genCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function genRoomId(): string {
  return crypto.randomUUID();
}

function getSeatsCount(gameKey: GameKey): number {
  if (gameKey === "blackjack") return 1;
  if (gameKey === "spades") return 4;
  if (gameKey === "holdem") return 6;
  return 2;
}

function makeSeats(gameKey: GameKey): Seat[] {
  const seatsCount = getSeatsCount(gameKey);
  return Array.from({ length: seatsCount }, (_, i) => ({
    seatIndex: i,
    isBot: false,
    ready: false,
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
    stakeAmount: r.stakeAmount.toString(),
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
    waitingQueue: [],
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
    existing.ready = room.conns.get(sock.data.userId)?.ready ?? false;
    return { seatIndex: existing.seatIndex };
  }

  if (room.gameKey === "holdem" && room.status === "active") {
    room.waitingQueue ??= [];
    if (!room.waitingQueue.some(q => q.userId === sock.data.userId)) {
      room.waitingQueue.push({ userId: sock.data.userId, displayName: sock.data.displayName });
    }
    return { seatIndex: -1 };
  }

  const empty = room.seats.find(s => !s.userId);
  if (!empty) throw new Error("Room full");
  empty.userId = sock.data.userId;
  empty.displayName = sock.data.displayName;
  empty.isBot = false;
  empty.ready = room.gameKey === "holdem" ? true : room.conns.get(sock.data.userId)?.ready ?? false;
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
    seat.ready = false;
  }

  // If lobby empty, cleanup
  const anyHumans = room.seats.some(s => s.userId);
  if (!anyHumans && room.status !== "active") {
    rooms.delete(room.roomId);
    codeToRoomId.delete(room.roomCode);
  }
}

function allHumansReady(room: Room): boolean {
  const humanSeats = room.seats.filter(s => s.userId && !s.isBot);
  if (humanSeats.length === 0) return false;
  return humanSeats.every(s => s.ready);
}

export function prepareNextHand(room: Room) {
  if (room.gameKey !== "blackjack") return;
  room.status = "lobby";
  room.matchId = null;
  room.bjState = undefined;
  room.turnDeadline = undefined;
  room.rngSeed = Math.floor(Math.random() * 1_000_000_000);
  for (const seat of room.seats) {
    if (seat.userId && !seat.isBot) seat.ready = true;
  }
}

function fillBots(room: Room) {
  const rng = mulberry32(room.rngSeed);
  let botIndex = 1;
  for (const seat of room.seats) {
    if (seat.userId || seat.isBot) continue;
    seat.isBot = true;
    seat.ready = true;
    seat.botDifficulty = 1 + Math.floor(rng() * 3);
    seat.displayName = `CPU ${botIndex++}`;
    seat.userId = `bot:${room.roomId}:${seat.seatIndex}`;
  }
}

function fillHoldemBots(room: Room) {
  const rng = mulberry32(room.rngSeed);
  const humans = room.seats.filter(s => s.userId && !s.isBot);
  if (humans.length === 0) return;
  for (const seat of room.seats) {
    if (seat.userId) continue;
    seat.isBot = true;
    seat.ready = true;
    seat.botDifficulty = 1 + Math.floor(rng() * 3);
    seat.displayName = `CPU ${seat.seatIndex + 1}`;
    seat.userId = `bot:${room.roomId}:${seat.seatIndex}`;
  }
}

export function setReady(room: Room, userId: string, ready: boolean) {
  const conn = room.conns.get(userId);
  if (conn) conn.ready = ready;
  const seat = room.seats.find(s => s.userId === userId);
  if (seat) seat.ready = ready;
}

export async function emitWallet(sock: SocketWithUser) {
  await ensureWalletRow(sock.data.userId);
  const bal = await getBalance(sock.data.userId);
  sock.emit("evt", { type: "wallet:balance", balance: bal.toString() } satisfies ServerToClientEvent);
}

export async function maybeStartGame(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (room.status !== "lobby") return;
  if (!allHumansReady(room)) return;

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

  if (room.gameKey === "spades") {
    fillBots(room);
    const playerIds = room.seats.map(s => s.userId!).filter(Boolean);
    if (playerIds.length !== 4) return;

    const matchId = crypto.randomUUID();
    room.matchId = matchId;

    await pool.query(
      `insert into matches (match_id, room_id, game_key, stake_amount, status) values ($1,$2,$3,$4,'active')`,
      [matchId, room.roomId, room.gameKey, room.stakeAmount.toString()]
    );
    for (const seat of room.seats) {
      await pool.query(
        `insert into match_players (match_id, user_id, is_bot, seat_index)
         values ($1,$2,$3,$4)`,
        [matchId, seat.isBot ? null : seat.userId, seat.isBot, seat.seatIndex]
      );
    }

    const humanIds = room.seats.filter(s => !s.isBot && s.userId).map(s => s.userId!) as string[];
    await lockStake({
      matchId,
      gameKey: room.gameKey,
      stakeAmount: room.stakeAmount,
      userIds: humanIds,
      roomId: room.roomId
    });

    const base = spadesPlugin.createInitialState({ seats: 4, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed });
    const remap: Record<string, string> = {};
    base.playerIds.forEach((pid, i) => (remap[pid] = playerIds[i]));
    const hands: SpadesState["hands"] = {};
    for (const [pid, hand] of Object.entries(base.hands)) {
      hands[remap[pid]] = hand;
    }
    const tricksWon: SpadesState["tricksWon"] = {};
    for (const pid of playerIds) tricksWon[pid] = 0;

    room.spadesState = {
      ...base,
      playerIds,
      hands,
      bids: {},
      tricksWon
    };
    room.status = "active";
    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
  }

  if (room.gameKey === "holdem") {
    room.waitingQueue ??= [];
    fillHoldemBots(room);
    const playerIds = room.seats.map(s => s.userId!).filter(Boolean);
    if (playerIds.length < 2) return;

    const matchId = crypto.randomUUID();
    room.matchId = matchId;

    await pool.query(
      `insert into matches (match_id, room_id, game_key, stake_amount, status) values ($1,$2,$3,$4,'active')`,
      [matchId, room.roomId, room.gameKey, room.stakeAmount.toString()]
    );
    for (const seat of room.seats) {
      if (!seat.userId) continue;
      await pool.query(
        `insert into match_players (match_id, user_id, is_bot, seat_index) values ($1,$2,$3,$4)`,
        [matchId, seat.userId, seat.isBot, seat.seatIndex]
      );
    }

    room.status = "active";
    const base = holdemPlugin.createInitialState({ seats: playerIds.length, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed });
    // map P1.. to actual userIds by seat order
    const order = playerIds;
    const mappedHole: Record<string, any> = {};
    const mappedFolded: Record<string, boolean> = {};
    const mappedBet: Record<string, number> = {};
    for (let i = 0; i < base.players.length; i++) {
      const from = base.players[i];
      const to = order[i];
      mappedHole[to] = base.hole[from];
      mappedFolded[to] = base.folded[from];
      mappedBet[to] = base.bet[from];
    }
    room.heState = {
      ...base,
      players: order,
      hole: mappedHole,
      folded: mappedFolded,
      bet: mappedBet
    };
    room.turnDeadline = Date.now() + room.turnMs;

    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
  }
}

export function seatQueuedPlayers(room: Room) {
  if (room.gameKey !== "holdem") return;
  // Clear bots so humans can take seats next hand
  for (const seat of room.seats) {
    if (seat.isBot) {
      seat.userId = undefined;
      seat.displayName = "Empty";
      seat.isBot = false;
      seat.botDifficulty = undefined;
      seat.ready = false;
    }
  }
  const queue = room.waitingQueue ?? [];
  if (queue.length === 0) return;
  for (const seat of room.seats) {
    if (!seat.userId && queue.length > 0) {
      const next = queue.shift()!;
      seat.userId = next.userId;
      seat.displayName = next.displayName;
      seat.isBot = false;
      seat.ready = true;
    }
  }
  room.waitingQueue = queue;
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

export function buildSpadesPublicState(room: Room, forPlayerId: string): SpadesPublicState | null {
  if (!room.spadesState) return null;
  return spadesPlugin.getPublicState(room.spadesState, forPlayerId);
}

export function buildHoldemPublicState(room: Room, forPlayerId: string): HEPublicState | null {
  if (!room.heState) return null;
  return holdemPlugin.getPublicState(room.heState, forPlayerId);
}

export async function applySpadesAction(room: Room, userId: string, action: any) {
  if (room.status !== "active" || room.gameKey !== "spades" || !room.spadesState) throw new Error("Not in game");
  const current = spadesPlugin.getCurrentTurnPlayerId(room.spadesState);
  if (current !== userId) throw new Error("Not your turn");

  const legal = spadesPlugin.getLegalActions(room.spadesState, userId);
  const ok = legal.some(a => a.type === action?.type && (a as any).card === action?.card && (a as any).bid === action?.bid);
  if (!ok) throw new Error("Illegal action");

  const { state } = spadesPlugin.applyAction(room.spadesState, action, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.spadesState = state;

  if (spadesPlugin.isGameOver(room.spadesState)) {
    await endSpadesGame(room);
  }
}

export async function applyHoldemAction(room: Room, userId: string, action: any) {
  if (room.status !== "active" || room.gameKey !== "holdem" || !room.heState) throw new Error("Not in game");
  const current = holdemPlugin.getCurrentTurnPlayerId(room.heState);
  if (current !== userId) throw new Error("Not your turn");
  const legal = holdemPlugin.getLegalActions(room.heState, userId);
  if (!legal.some(a => a.type === action?.type)) throw new Error("Illegal action");
  const { state } = holdemPlugin.applyAction(room.heState, action, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.heState = state;
  room.turnDeadline = Date.now() + room.turnMs;
}

export async function handleSpadesBotTick(room: Room): Promise<boolean> {
  if (room.status !== "active" || room.gameKey !== "spades" || !room.spadesState) return false;
  const current = spadesPlugin.getCurrentTurnPlayerId(room.spadesState);
  if (!current) return false;
  const seat = room.seats.find(s => s.userId === current);
  if (!seat?.isBot) return false;

  const rng = mulberry32(room.rngSeed + Date.now());
  const action = spadesPlugin.botChooseAction(room.spadesState, current, seat.botDifficulty ?? 1, rng);
  const { state } = spadesPlugin.applyAction(room.spadesState, action as any, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.spadesState = state;
  if (spadesPlugin.isGameOver(room.spadesState)) {
    await endSpadesGame(room);
  }
  return true;
}

export async function handleHoldemBotTick(room: Room): Promise<boolean> {
  if (room.status !== "active" || room.gameKey !== "holdem" || !room.heState) return false;
  const current = holdemPlugin.getCurrentTurnPlayerId(room.heState);
  if (!current) return false;
  const seat = room.seats.find(s => s.userId === current);
  if (!seat || !seat.isBot) return false;
  const rng = mulberry32(room.rngSeed + Date.now());
  const action = holdemPlugin.botChooseAction(room.heState, current, seat.botDifficulty ?? 1, rng);
  const { state } = holdemPlugin.applyAction(room.heState, action as any, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.heState = state;
  room.turnDeadline = Date.now() + room.turnMs;
  return true;
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

async function endSpadesGame(room: Room) {
  if (!room.matchId || !room.spadesState) return;
  const winners = spadesPlugin.getWinners(room.spadesState);
  const humanIds = room.seats.filter(s => !s.isBot && s.userId).map(s => s.userId!) as string[];
  const winnerHumans = winners.winners.filter(pid => humanIds.includes(pid));

  if (humanIds.length > 0) {
    if (winnerHumans.length === 0) {
      await refundStake({
        matchId: room.matchId,
        gameKey: room.gameKey,
        stakeAmount: room.stakeAmount,
        userIds: humanIds,
        roomId: room.roomId
      });
    } else {
      await settleMatchSplitPot({
        matchId: room.matchId,
        gameKey: room.gameKey,
        stakeAmount: room.stakeAmount,
        userIds: humanIds,
        winnerUserIds: winnerHumans,
        roomId: room.roomId
      });
    }
  }

  room.status = "ended";
}

export async function cancelMatchIfActive(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (!room.matchId || room.status !== "active") return;
  const userIds = room.seats.filter(s => !!s.userId).map(s => s.userId!) as string[];
  await refundStake({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds, roomId: room.roomId });
  await pool.query(`update matches set status='cancelled', finished_at=now() where match_id=$1`, [room.matchId]);
  ioEmitRoom(room.roomId, { type: "game:ended", result: { delta: "0", newBalance: "0", outcome: "cancelled" } });
  room.status = "ended";
}
