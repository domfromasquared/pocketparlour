// apps/server/test/rooms.basic.test.ts
import { describe, it, expect } from "vitest";
import { createRoom, toSummary } from "../src/rooms/rooms.js";

describe("rooms", () => {
  it("creates a room with code and seats", () => {
    const r = createRoom("blackjack", 0n);
    const s = toSummary(r);
    expect(s.roomCode.length).toBeGreaterThanOrEqual(3);
    expect(s.seats.length).toBe(1);
  });
});
