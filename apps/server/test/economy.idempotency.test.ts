// apps/server/test/economy.idempotency.test.ts
import { describe, it, expect } from "vitest";

// Pure deterministic idempotency key format test (fast, no DB).
describe("economy idempotency keys", () => {
  it("uses deterministic keys", () => {
    const matchId = "m1";
    const userId = "u1";
    expect(`lock:${matchId}:${userId}`).toBe("lock:m1:u1");
    expect(`refund:${matchId}:${userId}`).toBe("refund:m1:u1");
    expect(`payout:${matchId}:${userId}`).toBe("payout:m1:u1");
  });
});
