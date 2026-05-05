// apps/server/src/rooms/rooms.ts
import crypto from "crypto";
import type { GameKey, RoomSummary, Seat, ServerToClientEvent, SpadesPublicState, SpadesState, HEPublicState } from "@versus/shared";
import { blackjackPlugin, spadesPlugin, holdemPlugin, liarsDicePlugin, dominoesPlugin, checkersPlugin, chessPlugin, solitairePlugin, scrabblePlugin } from "@versus/shared";
import { mulberry32 } from "@versus/shared";
import { ensureWalletRow, getBalance, lockStake, refundStake, settleMatchSplitPot } from "../economy/economy.js";
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
  if (gameKey === "blackjack") return 5;
  if (gameKey === "spades") return 4;
  if (gameKey === "holdem") return 6;
  if (gameKey === "liars_dice") return 4;
  if (gameKey === "dominoes") return 4;
  if (gameKey === "checkers") return 2;
  if (gameKey === "chess") return 2;
  if (gameKey === "solitaire") return 1;
  if (gameKey === "scrabble") return 4;
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

// Generic simple game end handler (winner-take-all or refund)
async function endSimpleGame(
  room: Room,
  winners: { winners: string[]; outcomeByPlayer: Record<string, "win" | "lose" | "push"> },
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
) {
  if (!room.matchId) return;
  const humanIds = room.seats.filter(s => !s.isBot && !!s.userId).map(s => s.userId!) as string[];
  const humanWinnerIds = winners.winners.filter(pid => humanIds.includes(pid));

  if (room.stakeAmount > 0n && humanIds.length > 0) {
    if (humanWinnerIds.length === 0) {
      await refundStake({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, roomId: room.roomId });
    } else {
      await settleMatchSplitPot({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, winnerUserIds: humanWinnerIds, roomId: room.roomId });
    }
  }

  const pot = room.stakeAmount * BigInt(humanIds.length);
  const wCount = BigInt(Math.max(1, humanWinnerIds.length));
  const baseShare = humanWinnerIds.length > 0 ? pot / wCount : 0n;
  let remainder = humanWinnerIds.length > 0 ? pot % wCount : 0n;

  for (const uid of humanIds) {
    const outcome = winners.outcomeByPlayer[uid] ?? "lose";
    let delta = 0n;
    if (room.stakeAmount > 0n) {
      if (humanWinnerIds.length === 0) {
        delta = 0n;
      } else if (humanWinnerIds.includes(uid)) {
        let share = baseShare;
        if (remainder > 0n) { share += 1n; remainder -= 1n; }
        delta = share - room.stakeAmount;
      } else {
        delta = -room.stakeAmount;
      }
    }
    const newBal = await getBalance(uid);
    const conn = room.conns.get(uid);
    if (conn) {
      ioEmitSocket(conn.socketId, { type: "game:ended", result: { delta: delta.toString(), newBalance: newBal.toString(), outcome } });
    }
  }

  await pool.query(
    `update matches set status='finished', winner_user_id=$1, finished_at=now() where match_id=$2`,
    [humanWinnerIds[0] ?? null, room.matchId]
  );

  room.status = "ended";
  ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
}

export async function endHoldemGame(
  room: Room,
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
) {
  if (!room.matchId || !room.heState) return;

  const winners = holdemPlugin.getWinners(room.heState);
  const humanIds = room.seats.filter(s => s.userId && !s.isBot).map(s => s.userId!) as string[];
  const humanWinnerIds = winners.winners.filter(pid => humanIds.includes(pid));

  if (room.stakeAmount > 0n && humanIds.length > 0) {
    if (humanWinnerIds.length === 0) {
      await refundStake({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, roomId: room.roomId });
    } else {
      await settleMatchSplitPot({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, winnerUserIds: humanWinnerIds, roomId: room.roomId });
    }
  }

  const pot = room.stakeAmount * BigInt(humanIds.length);
  const wCount = BigInt(Math.max(1, humanWinnerIds.length));
  const baseShare = humanWinnerIds.length > 0 ? pot / wCount : 0n;
  let remainder = humanWinnerIds.length > 0 ? pot % wCount : 0n;

  for (const uid of humanIds) {
    let delta = 0n;
    const outcome = winners.outcomeByPlayer[uid] ?? "lose";
    if (room.stakeAmount > 0n) {
      if (humanWinnerIds.length === 0) {
        delta = 0n;
      } else if (humanWinnerIds.includes(uid)) {
        let share = baseShare;
        if (remainder > 0n) { share += 1n; remainder -= 1n; }
        delta = share - room.stakeAmount;
      } else {
        delta = -room.stakeAmount;
      }
    }
    const newBal = await getBalance(uid);
    const conn = room.conns.get(uid);
    if (conn) {
      ioEmitSocket(conn.socketId, { type: "game:ended", result: { delta: delta.toString(), newBalance: newBal.toString(), outcome } });
    }
  }

  await pool.query(
    `update matches set status='finished', winner_user_id=$1, finished_at=now() where match_id=$2`,
    [humanWinnerIds[0] ?? null, room.matchId]
  );

  room.status = "ended";
  ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
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
    seats: r.seats,
    waitingCount: r.waitingQueue?.length ?? 0
  };
}

export function findBestRoom(gameKey: GameKey, stakeAmount: bigint): Room | null {
  for (const r of rooms.values()) {
    if (r.gameKey !== gameKey) continue;
    if (r.stakeAmount !== stakeAmount) continue;
    if (r.status !== "active") continue;
    return r;
  }
  for (const r of rooms.values()) {
    if (r.gameKey !== gameKey) continue;
    if (r.status !== "lobby") continue;
    if (r.stakeAmount !== stakeAmount) continue;
    const hasEmpty = r.seats.some(s => !s.userId);
    if (hasEmpty) return r;
  }
  for (const r of rooms.values()) {
    if (r.gameKey !== gameKey) continue;
    if (r.status !== "lobby") continue;
    if (r.stakeAmount !== stakeAmount) continue;
    return r;
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
  room.conns.set(sock.data.userId, {
    userId: sock.data.userId,
    displayName: sock.data.displayName,
    socketId: sock.id,
    lastSeen: Date.now(),
    ready: false
  });

  const existing = room.seats.find(s => s.userId === sock.data.userId);
  if (existing) {
    existing.displayName = sock.data.displayName;
    existing.isBot = false;
    existing.ready = room.conns.get(sock.data.userId)?.ready ?? false;
    return { seatIndex: existing.seatIndex };
  }

  if (room.status === "active") {
    enqueueWaitingPlayer(room, sock.data.userId, sock.data.displayName);
    return { seatIndex: -1 };
  }

  const empty = room.seats.find(s => !s.userId);
  if (!empty) {
    enqueueWaitingPlayer(room, sock.data.userId, sock.data.displayName);
    return { seatIndex: -1 };
  }
  empty.userId = sock.data.userId;
  empty.displayName = sock.data.displayName;
  empty.isBot = false;
  empty.ready = room.conns.get(sock.data.userId)?.ready ?? false;
  return { seatIndex: empty.seatIndex };
}

function enqueueWaitingPlayer(room: Room, userId: string, displayName: string) {
  room.waitingQueue ??= [];
  if (!room.waitingQueue.some(q => q.userId === userId)) {
    room.waitingQueue.push({ userId, displayName });
  }
}

export function leaveRoom(room: Room, userId: string) {
  room.conns.delete(userId);
  if (room.waitingQueue?.length) {
    room.waitingQueue = room.waitingQueue.filter(q => q.userId !== userId);
  }
  const seat = room.seats.find(s => s.userId === userId);
  if (seat) {
    seat.userId = undefined;
    seat.displayName = "Empty";
    seat.isBot = false;
    seat.botDifficulty = undefined;
    seat.ready = false;
  }
  const anyHumans = room.seats.some(s => s.userId && !s.isBot);
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
  room.status = "lobby";
  room.matchId = null;
  room.bjState = undefined;
  room.spadesState = undefined;
  room.ldState = undefined;
  room.domState = undefined;
  room.ckState = undefined;
  room.chessState = undefined;
  room.solState = undefined;
  room.scrState = undefined;
  room.turnDeadline = undefined;
  room.rngSeed = Math.floor(Math.random() * 1_000_000_000);
  seatQueuedPlayers(room);
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

async function createMatchRows(room: Room, matchId: string, humanIds: string[]) {
  await pool.query(
    `insert into matches (match_id, room_id, game_key, stake_amount, status) values ($1,$2,$3,$4,'active')`,
    [matchId, room.roomId, room.gameKey, room.stakeAmount.toString()]
  );
  for (const seat of room.seats) {
    if (!seat.userId) continue;
    await pool.query(
      `insert into match_players (match_id, user_id, is_bot, seat_index) values ($1,$2,$3,$4)`,
      [matchId, seat.isBot ? null : seat.userId, seat.isBot, seat.seatIndex]
    );
  }
  await lockStake({ matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, roomId: room.roomId });
}

export async function maybeStartGame(room: Room, ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void) {
  if (room.status !== "lobby") return;
  if (!allHumansReady(room)) return;

  if (room.gameKey === "blackjack") {
    fillBots(room);
    const playerIds = room.seats.filter(s => !!s.userId).map(s => s.userId!) as string[];
    const humanIds = room.seats.filter(s => !s.isBot && !!s.userId).map(s => s.userId!) as string[];
    if (playerIds.length === 0) return;
    const matchId = crypto.randomUUID();
    room.matchId = matchId;
    await createMatchRows(room, matchId, humanIds);
    room.status = "active";
    const base = blackjackPlugin.createInitialState({ seats: playerIds.length, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed });
    const remap: Record<string, string> = {};
    base.playerIds.forEach((pid, i) => (remap[pid] = playerIds[i]));
    const mappedPlayers: typeof base.players = {};
    for (const [pid, hand] of Object.entries(base.players)) {
      mappedPlayers[remap[pid]] = hand;
    }
    room.bjState = { ...base, playerIds, players: mappedPlayers, currentPlayerIndex: 0 };
    const current = blackjackPlugin.getCurrentTurnPlayerId(room.bjState);
    if (current) room.bjState.currentPlayerIndex = room.bjState.playerIds.indexOf(current);
    room.turnDeadline = Date.now() + room.turnMs;
    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    return;
  }

  if (room.gameKey === "spades") {
    fillBots(room);
    const playerIds = room.seats.map(s => s.userId!).filter(Boolean);
    if (playerIds.length !== 4) return;
    const matchId = crypto.randomUUID();
    room.matchId = matchId;
    const humanIds = room.seats.filter(s => !s.isBot && s.userId).map(s => s.userId!) as string[];
    await createMatchRows(room, matchId, humanIds);
    const base = spadesPlugin.createInitialState({ seats: 4, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed });
    const remap: Record<string, string> = {};
    base.playerIds.forEach((pid, i) => (remap[pid] = playerIds[i]));
    const hands: SpadesState["hands"] = {};
    for (const [pid, hand] of Object.entries(base.hands)) hands[remap[pid]] = hand;
    const tricksWon: SpadesState["tricksWon"] = {};
    for (const pid of playerIds) tricksWon[pid] = 0;
    room.spadesState = { ...base, playerIds, hands, bids: {}, tricksWon };
    room.status = "active";
    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    return;
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
    const mappedHole: Record<string, any> = {};
    const mappedFolded: Record<string, boolean> = {};
    const mappedBet: Record<string, number> = {};
    for (let i = 0; i < base.players.length; i++) {
      const from = base.players[i];
      const to = playerIds[i];
      mappedHole[to] = base.hole[from];
      mappedFolded[to] = base.folded[from];
      mappedBet[to] = base.bet[from];
    }
    room.heState = { ...base, players: playerIds, hole: mappedHole, folded: mappedFolded, bet: mappedBet };
    room.turnDeadline = Date.now() + room.turnMs;
    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    return;
  }

  // Generic 2-N player games: fill bots, create match, init plugin state
  const genericGames = ["liars_dice", "dominoes", "checkers", "chess", "scrabble"] as const;
  if ((genericGames as readonly string[]).includes(room.gameKey)) {
    const minPlayers: Record<string, number> = { liars_dice: 2, dominoes: 2, checkers: 2, chess: 2, scrabble: 2 };
    const min = minPlayers[room.gameKey] ?? 2;
    const humans = room.seats.filter(s => s.userId && !s.isBot);
    if (humans.length === 0) return;
    fillBots(room);
    const playerIds = room.seats.map(s => s.userId!).filter(Boolean);
    if (playerIds.length < min) return;
    const matchId = crypto.randomUUID();
    room.matchId = matchId;
    const humanIds = room.seats.filter(s => !s.isBot && s.userId).map(s => s.userId!) as string[];
    await createMatchRows(room, matchId, humanIds);
    room.status = "active";

    const initConfig = { seats: playerIds.length, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed };

    if (room.gameKey === "liars_dice") {
      const base = liarsDicePlugin.createInitialState(initConfig);
      const remap: Record<string, string> = {};
      base.playerIds.forEach((pid, i) => { remap[pid] = playerIds[i]; });
      const dice: Record<string, number[]> = {};
      for (const [pid, d] of Object.entries(base.dice)) dice[remap[pid]] = d;
      const elim = new Set<string>();
      for (const pid of Array.from(base.eliminated)) elim.add(remap[pid] ?? pid);
      room.ldState = { ...base, playerIds, dice, eliminated: elim };
    }

    if (room.gameKey === "dominoes") {
      const base = dominoesPlugin.createInitialState(initConfig);
      const remap: Record<string, string> = {};
      base.playerIds.forEach((pid, i) => { remap[pid] = playerIds[i]; });
      const hands: Record<string, [number, number][]> = {};
      for (const [pid, h] of Object.entries(base.hands)) hands[remap[pid]] = h;
      const scores: Record<string, number> = {};
      for (const pid of playerIds) scores[pid] = 0;
      room.domState = { ...base, playerIds, hands, scores };
    }

    if (room.gameKey === "checkers") {
      const base = checkersPlugin.createInitialState(initConfig);
      const remap: Record<string, string> = { [base.playerIds[0]]: playerIds[0], [base.playerIds[1]]: playerIds[1] };
      const winner = base.winner ? (remap[base.winner] ?? null) : null;
      room.ckState = { ...base, playerIds, winner };
    }

    if (room.gameKey === "chess") {
      const base = chessPlugin.createInitialState(initConfig);
      const remap: Record<string, string> = { [base.playerIds[0]]: playerIds[0], [base.playerIds[1]]: playerIds[1] };
      const winner = base.winner ? (remap[base.winner] ?? null) : null;
      room.chessState = { ...base, playerIds, winner };
    }

    if (room.gameKey === "scrabble") {
      const base = scrabblePlugin.createInitialState(initConfig);
      const remap: Record<string, string> = {};
      base.playerIds.forEach((pid, i) => { remap[pid] = playerIds[i]; });
      const racks: Record<string, string[]> = {};
      for (const [pid, rack] of Object.entries(base.racks)) racks[remap[pid]] = rack;
      const scores: Record<string, number> = {};
      for (const pid of playerIds) scores[pid] = 0;
      room.scrState = { ...base, playerIds, racks, scores };
    }

    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    return;
  }

  // Solitaire: single player, no bots, auto-start when human is seated and ready
  if (room.gameKey === "solitaire") {
    const human = room.seats.find(s => s.userId && !s.isBot);
    if (!human) return;
    const matchId = crypto.randomUUID();
    room.matchId = matchId;
    const humanIds = [human.userId!];
    await createMatchRows(room, matchId, humanIds);
    room.status = "active";
    room.solState = solitairePlugin.createInitialState({ seats: 1, stakeAmount: room.stakeAmount, rngSeed: room.rngSeed });
    room.solState.playerIds = [human.userId!];
    ioEmitRoom(room.roomId, { type: "room:update", room: toSummary(room) });
    return;
  }
}

export function seatQueuedPlayers(room: Room) {
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

export async function handleTimeoutTick(
  room: Room,
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
): Promise<boolean> {
  if (room.status !== "active" || room.gameKey !== "blackjack" || !room.bjState) return false;
  const now = Date.now();
  if (!room.turnDeadline || now < room.turnDeadline) return false;

  const userId = blackjackPlugin.getCurrentTurnPlayerId(room.bjState);
  if (!userId) return false;
  const pub = blackjackPlugin.getPublicState(room.bjState, userId);
  const total = pub.players.find(p => p.playerId === userId)?.total ?? 0;
  const action = total < 17 ? ({ type: "bj:hit" } as const) : ({ type: "bj:stand" } as const);

  const { state } = blackjackPlugin.applyAction(room.bjState, action, { now, rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.bjState = state;
  room.turnDeadline = Date.now() + room.turnMs;

  if (blackjackPlugin.isGameOver(room.bjState)) {
    await endGame(room, ioEmitRoom, ioEmitSocket);
  }
  return true;
}

export async function applyBlackjackAction(
  room: Room,
  userId: string,
  action: any,
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
) {
  if (room.status !== "active" || room.gameKey !== "blackjack" || !room.bjState) throw new Error("Not in game");
  const current = blackjackPlugin.getCurrentTurnPlayerId(room.bjState);
  if (current !== userId) throw new Error("Not your seat");
  const legal = blackjackPlugin.getLegalActions(room.bjState, userId);
  if (!legal.some(a => a.type === action?.type)) throw new Error("Illegal action");
  const { state } = blackjackPlugin.applyAction(room.bjState, action, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.bjState = state;
  room.turnDeadline = Date.now() + room.turnMs;
  if (room.matchId) {
    await pool.query(
      `insert into match_events (match_id, seq, user_id, event_type, payload) values ($1, coalesce((select max(seq) from match_events where match_id=$1), -1) + 1, $2, 'move', $3)`,
      [room.matchId, userId, JSON.stringify(action)]
    );
  }
  if (blackjackPlugin.isGameOver(room.bjState)) {
    await endGame(room, ioEmitRoom, ioEmitSocket);
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

// Generic apply for new games
export async function applyGenericAction(
  room: Room,
  userId: string,
  action: any,
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
): Promise<boolean> {
  const ctx = { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs };

  if (room.gameKey === "liars_dice" && room.ldState) {
    const current = liarsDicePlugin.getCurrentTurnPlayerId(room.ldState);
    if (current !== userId) throw new Error("Not your turn");
    const { state } = liarsDicePlugin.applyAction(room.ldState, action, ctx);
    room.ldState = state;
    if (liarsDicePlugin.isGameOver(room.ldState)) {
      await endSimpleGame(room, liarsDicePlugin.getWinners(room.ldState), ioEmitRoom, ioEmitSocket);
      return true;
    }
    return false;
  }

  if (room.gameKey === "dominoes" && room.domState) {
    const current = dominoesPlugin.getCurrentTurnPlayerId(room.domState);
    if (current !== userId) throw new Error("Not your turn");
    const { state } = dominoesPlugin.applyAction(room.domState, action, ctx);
    room.domState = state;
    if (dominoesPlugin.isGameOver(room.domState)) {
      await endSimpleGame(room, dominoesPlugin.getWinners(room.domState), ioEmitRoom, ioEmitSocket);
      return true;
    }
    return false;
  }

  if (room.gameKey === "checkers" && room.ckState) {
    const current = checkersPlugin.getCurrentTurnPlayerId(room.ckState);
    if (current !== userId) throw new Error("Not your turn");
    const { state } = checkersPlugin.applyAction(room.ckState, action, ctx);
    room.ckState = state;
    if (checkersPlugin.isGameOver(room.ckState)) {
      await endSimpleGame(room, checkersPlugin.getWinners(room.ckState), ioEmitRoom, ioEmitSocket);
      return true;
    }
    return false;
  }

  if (room.gameKey === "chess" && room.chessState) {
    const current = chessPlugin.getCurrentTurnPlayerId(room.chessState);
    if (current !== userId) throw new Error("Not your turn");
    const { state } = chessPlugin.applyAction(room.chessState, action, ctx);
    room.chessState = state;
    if (chessPlugin.isGameOver(room.chessState)) {
      await endSimpleGame(room, chessPlugin.getWinners(room.chessState), ioEmitRoom, ioEmitSocket);
      return true;
    }
    return false;
  }

  if (room.gameKey === "solitaire" && room.solState) {
    const current = solitairePlugin.getCurrentTurnPlayerId(room.solState);
    if (current !== userId) throw new Error("Not your turn");
    const { state } = solitairePlugin.applyAction(room.solState, action, ctx);
    room.solState = state;
    if (solitairePlugin.isGameOver(room.solState)) {
      await endSimpleGame(room, solitairePlugin.getWinners(room.solState), ioEmitRoom, ioEmitSocket);
      return true;
    }
    return false;
  }

  if (room.gameKey === "scrabble" && room.scrState) {
    const current = scrabblePlugin.getCurrentTurnPlayerId(room.scrState);
    if (current !== userId) throw new Error("Not your turn");
    const { state } = scrabblePlugin.applyAction(room.scrState, action, ctx);
    room.scrState = state;
    if (scrabblePlugin.isGameOver(room.scrState)) {
      await endSimpleGame(room, scrabblePlugin.getWinners(room.scrState), ioEmitRoom, ioEmitSocket);
      return true;
    }
    return false;
  }

  throw new Error("Game not implemented");
}

export function getGenericPublicState(room: Room, forPlayerId: string): any {
  if (room.gameKey === "liars_dice" && room.ldState) return liarsDicePlugin.getPublicState(room.ldState, forPlayerId);
  if (room.gameKey === "dominoes" && room.domState) return dominoesPlugin.getPublicState(room.domState, forPlayerId);
  if (room.gameKey === "checkers" && room.ckState) return checkersPlugin.getPublicState(room.ckState, forPlayerId);
  if (room.gameKey === "chess" && room.chessState) return chessPlugin.getPublicState(room.chessState, forPlayerId);
  if (room.gameKey === "solitaire" && room.solState) return solitairePlugin.getPublicState(room.solState, forPlayerId);
  if (room.gameKey === "scrabble" && room.scrState) return scrabblePlugin.getPublicState(room.scrState, forPlayerId);
  return null;
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
  if (!seat?.isBot) return false;
  const rng = mulberry32(room.rngSeed + Date.now());
  const action = holdemPlugin.botChooseAction(room.heState, current, seat.botDifficulty ?? 1, rng);
  const { state } = holdemPlugin.applyAction(room.heState, action as any, { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs });
  room.heState = state;
  room.turnDeadline = Date.now() + room.turnMs;
  return true;
}

export async function handleGenericBotTick(
  room: Room,
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
): Promise<boolean> {
  if (room.status !== "active") return false;
  const ctx = { now: Date.now(), rngSeed: room.rngSeed, turnMs: room.turnMs };
  const rng = mulberry32(room.rngSeed + Date.now());

  if (room.gameKey === "liars_dice" && room.ldState) {
    const current = liarsDicePlugin.getCurrentTurnPlayerId(room.ldState);
    if (!current) return false;
    const seat = room.seats.find(s => s.userId === current);
    if (!seat?.isBot) return false;
    const action = liarsDicePlugin.botChooseAction(room.ldState, current, seat.botDifficulty ?? 1, rng);
    const { state } = liarsDicePlugin.applyAction(room.ldState, action as any, ctx);
    room.ldState = state;
    if (liarsDicePlugin.isGameOver(room.ldState)) await endSimpleGame(room, liarsDicePlugin.getWinners(room.ldState), ioEmitRoom, ioEmitSocket);
    return true;
  }

  if (room.gameKey === "dominoes" && room.domState) {
    const current = dominoesPlugin.getCurrentTurnPlayerId(room.domState);
    if (!current) return false;
    const seat = room.seats.find(s => s.userId === current);
    if (!seat?.isBot) return false;
    const action = dominoesPlugin.botChooseAction(room.domState, current, seat.botDifficulty ?? 1, rng);
    const { state } = dominoesPlugin.applyAction(room.domState, action as any, ctx);
    room.domState = state;
    if (dominoesPlugin.isGameOver(room.domState)) await endSimpleGame(room, dominoesPlugin.getWinners(room.domState), ioEmitRoom, ioEmitSocket);
    return true;
  }

  if (room.gameKey === "checkers" && room.ckState) {
    const current = checkersPlugin.getCurrentTurnPlayerId(room.ckState);
    if (!current) return false;
    const seat = room.seats.find(s => s.userId === current);
    if (!seat?.isBot) return false;
    const action = checkersPlugin.botChooseAction(room.ckState, current, seat.botDifficulty ?? 1, rng);
    const { state } = checkersPlugin.applyAction(room.ckState, action as any, ctx);
    room.ckState = state;
    if (checkersPlugin.isGameOver(room.ckState)) await endSimpleGame(room, checkersPlugin.getWinners(room.ckState), ioEmitRoom, ioEmitSocket);
    return true;
  }

  if (room.gameKey === "chess" && room.chessState) {
    const current = chessPlugin.getCurrentTurnPlayerId(room.chessState);
    if (!current) return false;
    const seat = room.seats.find(s => s.userId === current);
    if (!seat?.isBot) return false;
    const action = chessPlugin.botChooseAction(room.chessState, current, seat.botDifficulty ?? 1, rng);
    const { state } = chessPlugin.applyAction(room.chessState, action as any, ctx);
    room.chessState = state;
    if (chessPlugin.isGameOver(room.chessState)) await endSimpleGame(room, chessPlugin.getWinners(room.chessState), ioEmitRoom, ioEmitSocket);
    return true;
  }

  if (room.gameKey === "scrabble" && room.scrState) {
    const current = scrabblePlugin.getCurrentTurnPlayerId(room.scrState);
    if (!current) return false;
    const seat = room.seats.find(s => s.userId === current);
    if (!seat?.isBot) return false;
    const action = scrabblePlugin.botChooseAction(room.scrState, current, seat.botDifficulty ?? 1, rng);
    const { state } = scrabblePlugin.applyAction(room.scrState, action as any, ctx);
    room.scrState = state;
    if (scrabblePlugin.isGameOver(room.scrState)) await endSimpleGame(room, scrabblePlugin.getWinners(room.scrState), ioEmitRoom, ioEmitSocket);
    return true;
  }

  return false;
}

async function endGame(
  room: Room,
  ioEmitRoom: (roomId: string, evt: ServerToClientEvent) => void,
  ioEmitSocket: (socketId: string, evt: ServerToClientEvent) => void
) {
  if (!room.matchId || !room.bjState) return;
  const winners = blackjackPlugin.getWinners(room.bjState);
  const humanIds = room.seats.filter(s => !s.isBot && !!s.userId).map(s => s.userId!) as string[];
  const winIds = humanIds.filter(uid => winners.outcomeByPlayer[uid] === "win");
  const pushIds = humanIds.filter(uid => winners.outcomeByPlayer[uid] === "push");

  if (room.stakeAmount > 0n) {
    if (winIds.length > 0) {
      await settleMatchSplitPot({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount * 2n, userIds: winIds, winnerUserIds: winIds, roomId: room.roomId });
    }
    if (pushIds.length > 0) {
      await refundStake({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: pushIds, roomId: room.roomId });
    }
  }

  for (const uid of humanIds) {
    const outcome = winners.outcomeByPlayer[uid] ?? "lose";
    let delta = 0n;
    if (room.stakeAmount > 0n) {
      if (outcome === "win") delta = room.stakeAmount;
      else if (outcome === "lose") delta = -room.stakeAmount;
    }
    const newBal = await getBalance(uid);
    const conn = room.conns.get(uid);
    if (conn) {
      ioEmitSocket(conn.socketId, { type: "game:ended", result: { delta: delta.toString(), newBalance: newBal.toString(), outcome } });
    }
  }
  await pool.query(
    `update matches set status='finished', winner_user_id=$1, finished_at=now() where match_id=$2`,
    [winIds[0] ?? null, room.matchId]
  );
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
      await refundStake({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, roomId: room.roomId });
    } else {
      await settleMatchSplitPot({ matchId: room.matchId, gameKey: room.gameKey, stakeAmount: room.stakeAmount, userIds: humanIds, winnerUserIds: winnerHumans, roomId: room.roomId });
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
