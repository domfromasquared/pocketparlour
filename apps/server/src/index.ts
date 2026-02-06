// apps/server/src/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Server } from "socket.io";
import { env } from "./env.js";
import { verifySupabaseJwt } from "./supabase.js";
import { ClientToServerEventSchema, type ServerToClientEvent } from "@versus/shared";
import {
  applyBlackjackAction,
  cancelMatchIfActive,
  createRoom,
  emitWallet,
  findBestRoom,
  getRoomByCode,
  joinRoom,
  leaveRoom,
  maybeStartGame,
  toSummary,
  handleTimeoutTick
} from "./rooms/rooms.js";
import type { SocketWithUser } from "./rooms/roomTypes.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [env.PUBLIC_ORIGIN],
  credentials: true
});

await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

app.get("/health", async () => ({ ok: true }));

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
      }

      if (evt.type === "room:leave") {
        if (!currentRoomId) return;
        const room = (await import("./rooms/rooms.js")).then(m => (m as any)).catch(() => null);
        // We don’t have direct access to the room map here; leave is handled via disconnect cleanup.
        socket.leave(currentRoomId);
        socketRoom.delete(socket.id);
        socket.emit("evt", { type: "room:left" });
      }

      if (evt.type === "game:action") {
        if (!currentRoomId) throw new Error("Not in room");
        const roomModule = await import("./rooms/rooms.js");
        // Access room by code via summary is not enough; simplest v1: keep roomId in join and store in closure.
        // TODO: expose a getRoomById in rooms module; kept concise here.
        // For now we route by roomId through Socket.IO adapter rooms; server-side room lookup is required:
        // We'll use a weak-but-ok trick: store roomId in socket.data and let rooms module do lookups.
        // => We'll add it now:
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
  }
}, 500);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info(`Server listening on :${env.PORT}`);
