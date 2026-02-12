// apps/server/src/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Server } from "socket.io";
import { env } from "./env.js";
import { verifySupabaseJwt } from "./supabase.js";
import { ClientToServerEventSchema, type ServerToClientEvent, holdemPlugin } from "@versus/shared";
import {
  applyBlackjackAction,
  applyHoldemAction,
  applySpadesAction,
  buildSpadesPublicState,
  buildHoldemPublicState,
  createRoom,
  emitWallet,
  findBestRoom,
  getRoomByCode,
  joinRoom,
  prepareNextHand,
  maybeStartGame,
  handleSpadesBotTick,
  handleHoldemBotTick,
  seatQueuedPlayers,
  setReady,
  toSummary,
  handleTimeoutTick
} from "./rooms/rooms.js";
import { getRoomById, internalCleanupLeave } from "./rooms/runtime.js";
import type { SocketWithUser } from "./rooms/roomTypes.js";
import { grantReward } from "./economy/economy.js";
import { pool } from "./db.js";
import { getBalance } from "./economy/economy.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [env.PUBLIC_ORIGIN],
  credentials: true
});

await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

app.get("/health", async () => ({ ok: true }));

const DAILY_SPIN_PRIZES: number[] = Array.from({ length: 24 }, () =>
  100 * (1 + Math.floor(Math.random() * 100))
);

function msUntilNextSpin(lastSpinAt: Date | null, now = new Date()): number {
  if (!lastSpinAt) return 0;
  const next = new Date(lastSpinAt.getTime() + 24 * 60 * 60 * 1000);
  return Math.max(0, next.getTime() - now.getTime());
}

async function getLastSpinAt(userId: string): Promise<Date | null> {
  const res = await pool.query(
    `select created_at from ledger_transactions
     where user_id = $1 and metadata->>'source' = 'daily_spin'
     order by created_at desc limit 1`,
    [userId]
  );
  if (res.rowCount === 0) return null;
  return new Date(res.rows[0].created_at);
}

app.get("/daily-spin", async (req, reply) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const verified = await verifySupabaseJwt(token);
  if (!verified) return reply.status(401).send({ error: "Unauthorized" });
  const lastSpinAt = await getLastSpinAt(verified.userId);
  const msLeft = msUntilNextSpin(lastSpinAt);
  const nextAvailableAt = msLeft > 0 ? new Date(Date.now() + msLeft).toISOString() : new Date().toISOString();
  return { available: msLeft === 0, nextAvailableAt, prizes: DAILY_SPIN_PRIZES };
});

app.post("/daily-spin", async (req, reply) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const verified = await verifySupabaseJwt(token);
  if (!verified) return reply.status(401).send({ error: "Unauthorized" });

  // serialize per user to avoid double spins
  await pool.query("select pg_advisory_xact_lock(hashtext($1))", [verified.userId]);
  const lastSpinAt = await getLastSpinAt(verified.userId);
  const msLeft = msUntilNextSpin(lastSpinAt);
  if (msLeft > 0) {
    const nextAvailableAt = new Date(Date.now() + msLeft).toISOString();
    return reply.status(429).send({ error: "Not ready", nextAvailableAt });
  }

  const prize = DAILY_SPIN_PRIZES[Math.floor(Math.random() * DAILY_SPIN_PRIZES.length)];
  const newBalance = await grantReward({
    userId: verified.userId,
    amount: BigInt(prize),
    gameKey: "blackjack",
    idempotencyKey: `daily_spin:${verified.userId}:${Date.now()}`,
    metadata: { source: "daily_spin", prize }
  });

  return {
    prize,
    newBalance: newBalance.toString(),
    nextAvailableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
});

const httpServer = app.server;

const io = new Server(httpServer, {
  cors: { origin: [env.PUBLIC_ORIGIN], credentials: true },
  transports: ["websocket"]
});

// Socket auth middleware: client passes { auth: { accessToken, displayName } }
io.use(async (socket, next) => {
  const accessToken = (socket.handshake.auth?.accessToken ?? "") as string;
  const displayName = (socket.handshake.auth?.displayName ?? "Guest") as string;

  if (!accessToken) return next(new Error("Missing access token"));
  const verified = await verifySupabaseJwt(accessToken);
  if (!verified) return next(new Error("Invalid session"));

  (socket as SocketWithUser).data = { userId: verified.userId, displayName };
  next();
});

function emitToRoom(roomId: string, evt: ServerToClientEvent) {
  io.to(roomId).emit("evt", evt);
}

function emitSpadesState(room: any) {
  for (const conn of room.conns.values()) {
    const pub = buildSpadesPublicState(room, conn.userId);
    if (!pub) continue;
    io.to(conn.socketId).emit("evt", { type: "game:state", publicState: pub });
  }
}

function emitHoldemState(room: any) {
  for (const conn of room.conns.values()) {
    const sock = io.sockets.sockets.get(conn.socketId);
    if (!sock) continue;
    const pub = buildHoldemPublicState(room, conn.userId);
    if (!pub) continue;
    sock.emit("evt", { type: "game:state", publicState: pub });
  }
}

async function emitHoldemResults(room: any) {
  if (!room.heState) return;
  const winners = holdemPlugin.getWinners(room.heState);
  for (const conn of room.conns.values()) {
    const sock = io.sockets.sockets.get(conn.socketId);
    if (!sock) continue;
    const outcome = winners.outcomeByPlayer[conn.userId] ?? "lose";
    const bal = await getBalance(conn.userId);
    sock.emit("evt", {
      type: "game:ended",
      result: { delta: "0", newBalance: bal.toString(), outcome }
    });
  }
  room.status = "lobby";
  room.heState = undefined;
  room.matchId = null;
  room.turnDeadline = undefined;
  seatQueuedPlayers(room);
  emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
  await maybeStartGame(room, emitToRoom);
  if (room.gameKey === "holdem" && room.status === "active") emitHoldemState(room);
}

const socketRoom = new Map<string, string>(); // socket.id -> roomId

io.on("connection", async (socketRaw) => {
  const socket = socketRaw as SocketWithUser;

  socket.emit("evt", { type: "auth:ok", user: { userId: socket.data.userId, displayName: socket.data.displayName } });

  // Always push wallet balance on connect
  await emitWallet(socket);

  socket.on("evt", async (msg: unknown) => {
    // Basic per-socket rate limit
    // NOTE: Fastify rate-limit doesn't cover WS; this is a simple guard.
    const parsed = ClientToServerEventSchema.safeParse(msg);
    if (!parsed.success) {
      socket.emit("evt", { type: "error", message: "Bad payload" });
      return;
    }

    try {
      const evt = parsed.data;
      const currentRoomId = socketRoom.get(socket.id);

      if (evt.type === "room:create") {
        const stake = BigInt(evt.stakeAmount);
        const room = createRoom(evt.gameKey, stake);
        const { seatIndex } = joinRoom(room, socket);
        socket.join(room.roomId);
        socketRoom.set(socket.id, room.roomId);
        socket.emit("evt", { type: "room:joined", room: toSummary(room), youSeatIndex: seatIndex });
        emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
        await maybeStartGame(room, emitToRoom);
        if (room.gameKey === "spades" && room.status === "active") emitSpadesState(room);
        if (room.gameKey === "holdem" && room.status === "active") emitHoldemState(room);
      }

      if (evt.type === "room:autoJoin") {
        const stake = BigInt(evt.stakeAmount);
        const room = findBestRoom(evt.gameKey, stake) ?? createRoom(evt.gameKey, stake);
        const { seatIndex } = joinRoom(room, socket);
        socket.join(room.roomId);
        socketRoom.set(socket.id, room.roomId);
        socket.emit("evt", { type: "room:joined", room: toSummary(room), youSeatIndex: seatIndex });
        emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
        await maybeStartGame(room, emitToRoom);
        if (room.gameKey === "spades" && room.status === "active") emitSpadesState(room);
        if (room.gameKey === "holdem" && room.status === "active") emitHoldemState(room);
      }

      if (evt.type === "room:join") {
        const room = getRoomByCode(evt.roomCode);
        if (!room) throw new Error("Room not found");
        const { seatIndex } = joinRoom(room, socket);
        socket.join(room.roomId);
        socketRoom.set(socket.id, room.roomId);
        socket.emit("evt", { type: "room:joined", room: toSummary(room), youSeatIndex: seatIndex });
        emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
        await maybeStartGame(room, emitToRoom);
        if (room.gameKey === "spades" && room.status === "active") emitSpadesState(room);
        if (room.gameKey === "holdem" && room.status === "active") emitHoldemState(room);
      }

      if (evt.type === "room:leave") {
        if (!currentRoomId) return;
        const room = getRoomById(currentRoomId);
        if (room) {
          await internalCleanupLeave(room, socket.data.userId, emitToRoom);
        }
        socket.leave(currentRoomId);
        socketRoom.delete(socket.id);
        socket.emit("evt", { type: "room:left" });
      }

      if (evt.type === "room:ready") {
        if (!currentRoomId) return;
        const room = getRoomById(currentRoomId);
        if (!room) throw new Error("Room not found");
        setReady(room, socket.data.userId, evt.ready);
        emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
        await maybeStartGame(room, emitToRoom);
        if (room.gameKey === "spades" && room.status === "active") emitSpadesState(room);
        if (room.gameKey === "holdem" && room.status === "active") emitHoldemState(room);
      }

      if (evt.type === "room:next") {
        if (!currentRoomId) return;
        const room = getRoomById(currentRoomId);
        if (!room) throw new Error("Room not found");
        prepareNextHand(room);
        emitToRoom(room.roomId, { type: "room:update", room: toSummary(room) });
        await maybeStartGame(room, emitToRoom);
        if (room.gameKey === "holdem" && room.status === "active") emitHoldemState(room);
      }

      if (evt.type === "game:action") {
        if (!currentRoomId) throw new Error("Not in room");
        const room = getRoomById(currentRoomId);
        if (!room) throw new Error("Room not found");
        if (room.gameKey === "blackjack") {
          await applyBlackjackAction(room, socket.data.userId, evt.action, emitToRoom);
        } else if (room.gameKey === "spades") {
          await applySpadesAction(room, socket.data.userId, evt.action);
          emitSpadesState(room);
        } else if (room.gameKey === "holdem") {
          await applyHoldemAction(room, socket.data.userId, evt.action);
          emitHoldemState(room);
          if (room.heState && holdemPlugin.isGameOver(room.heState) && room.status === "active") {
            await emitHoldemResults(room);
          }
        } else {
          throw new Error("Game not implemented");
        }
      }
    } catch (e: any) {
      socket.emit("evt", { type: "error", message: e?.message ?? "Error" });
    }
  });

  socket.on("disconnect", async () => {
    const roomId = socketRoom.get(socket.id);
    if (!roomId) return;
    socketRoom.delete(socket.id);

    // We need room lookup by id. Keep it minimal: import the rooms map via a dedicated getter.
    const { getRoomById, internalCleanupLeave } = await import("./rooms/runtime.js");
    const room = getRoomById(roomId);
    if (!room) return;

    internalCleanupLeave(room, socket.data.userId, emitToRoom);
  });
});

// Tick loop: timeouts + bot turns (v1: blackjack timeout only)
setInterval(async () => {
  const { listRooms } = await import("./rooms/runtime.js");
  const all = listRooms();
  for (const r of all) {
    await handleTimeoutTick(r, emitToRoom);
    const advanced = await handleSpadesBotTick(r);
    if (advanced && r.gameKey === "spades") emitSpadesState(r);
    const advancedHoldem = await handleHoldemBotTick(r);
    if (advancedHoldem && r.gameKey === "holdem") {
      emitHoldemState(r);
      if (r.heState && holdemPlugin.isGameOver(r.heState) && r.status === "active") {
        await emitHoldemResults(r);
      }
    }
  }
}, 500);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info(`Server listening on :${env.PORT}`);
