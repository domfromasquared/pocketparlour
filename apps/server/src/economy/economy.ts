// apps/server/src/economy/economy.ts
import { pool } from "../db.js";

export type LedgerType = "reward" | "stake_lock" | "payout" | "refund" | "fee";

export async function getBalance(userId: string): Promise<bigint> {
  const r = await pool.query("select balance from wallets where user_id = $1", [userId]);
  if (r.rowCount === 0) return 0n;
  return BigInt(r.rows[0].balance);
}

async function applyLedgerTx(params: {
  userId: string;
  amount: bigint;
  type: LedgerType;
  matchId: string | null;
  gameKey: string;
  idempotencyKey: string;
  metadata: any;
}, client: any) {
  // Insert ledger row idempotently; if already exists, do nothing.
  const insert = await client.query(
    `insert into ledger_transactions (user_id, amount, type, match_id, game_key, idempotency_key, metadata)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (idempotency_key) do nothing
     returning amount`,
    [
      params.userId,
      params.amount.toString(),
      params.type,
      params.matchId,
      params.gameKey,
      params.idempotencyKey,
      JSON.stringify(params.metadata ?? {})
    ]
  );

  if (insert.rowCount === 0) {
    // already applied
    return { applied: false };
  }

  // Update wallet balance
  await client.query(
    `update wallets set balance = balance + $1, updated_at = now() where user_id = $2`,
    [params.amount.toString(), params.userId]
  );

  return { applied: true };
}

export async function grantReward(params: {
  userId: string;
  amount: bigint;
  gameKey: string;
  idempotencyKey: string;
  metadata?: any;
}): Promise<bigint> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await ensureWalletRow(params.userId);
    await applyLedgerTx(
      {
        userId: params.userId,
        amount: params.amount,
        type: "reward",
        matchId: null,
        gameKey: params.gameKey,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata ?? {}
      },
      client
    );
    const balRes = await client.query("select balance from wallets where user_id=$1", [params.userId]);
    await client.query("commit");
    return BigInt(balRes.rows[0].balance);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function ensureWalletRow(userId: string) {
  await pool.query(
    `insert into wallets (user_id, balance) values ($1, 0)
     on conflict (user_id) do nothing`,
    [userId]
  );
}

export async function lockStake(params: {
  matchId: string;
  gameKey: string;
  stakeAmount: bigint;
  userIds: string[];
  roomId: string;
}) {
  if (params.stakeAmount <= 0n) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Ensure wallets exist
    for (const uid of params.userIds) {
      await client.query(`insert into wallets (user_id, balance) values ($1, 0) on conflict do nothing`, [uid]);
    }

    // Check funds and lock
    for (const uid of params.userIds) {
      const balRes = await client.query(`select balance from wallets where user_id=$1 for update`, [uid]);
      const balance = BigInt(balRes.rows[0].balance);
      if (balance - params.stakeAmount < 0n) {
        throw new Error("Insufficient balance");
      }
    }

    for (const uid of params.userIds) {
      await applyLedgerTx(
        {
          userId: uid,
          amount: -params.stakeAmount,
          type: "stake_lock",
          matchId: params.matchId,
          gameKey: params.gameKey,
          idempotencyKey: `lock:${params.matchId}:${uid}`,
          metadata: { roomId: params.roomId }
        },
        client
      );
    }

    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function refundStake(params: {
  matchId: string;
  gameKey: string;
  stakeAmount: bigint;
  userIds: string[];
  roomId: string;
}) {
  if (params.stakeAmount <= 0n) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const uid of params.userIds) {
      await applyLedgerTx(
        {
          userId: uid,
          amount: params.stakeAmount,
          type: "refund",
          matchId: params.matchId,
          gameKey: params.gameKey,
          idempotencyKey: `refund:${params.matchId}:${uid}`,
          metadata: { roomId: params.roomId }
        },
        client
      );
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function settleMatchWinnerTakeAll(params: {
  matchId: string;
  gameKey: string;
  stakeAmount: bigint;
  userIds: string[];
  winnerUserId: string | null;
  outcomeByUser: Record<string, "win" | "lose" | "push">;
  roomId: string;
}) {
  const stake = params.stakeAmount;
  const client = await pool.connect();
  try {
    await client.query("begin");

    // Pushes: refund; Win: payout = pot; Lose: no action (stake already locked)
    const pot = stake * BigInt(params.userIds.length);

    for (const uid of params.userIds) {
      const outcome = params.outcomeByUser[uid];
      if (stake <= 0n) continue;

      if (outcome === "push") {
        await applyLedgerTx(
          {
            userId: uid,
            amount: stake,
            type: "refund",
            matchId: params.matchId,
            gameKey: params.gameKey,
            idempotencyKey: `refund:${params.matchId}:${uid}`,
            metadata: { roomId: params.roomId, reason: "push" }
          },
          client
        );
      }
    }

    if (params.winnerUserId) {
      // In single-player Blackjack: pot = stake*1; winner payout should be +2*stake (refund stake + winnings).
      // But because stake was already locked as negative, payout should be +2*stake for a net +stake.
      // For N players winner-take-all: winner gets pot*2? No. Winner already paid stake; to receive full pot + their stake back,
      // payout should be pot + stake (their own stake) BUT stake already included in pot. So payout should be pot * 2? No.
      // Correct: pot currently equals sum of all locked stakes. To give winner the pot (including their own stake back), payout = pot.
      // Net result: winner -stake + pot = + (pot - stake). For single player: -stake + stake = 0; not right. So for 1-player blackjack,
      // treat as vs house: payout = 2*stake on win, refund=stake on push, nothing on lose.
      const payout =
        params.userIds.length === 1 ? stake * 2n : pot;

      await applyLedgerTx(
        {
          userId: params.winnerUserId,
          amount: payout,
          type: "payout",
          matchId: params.matchId,
          gameKey: params.gameKey,
          idempotencyKey: `payout:${params.matchId}:${params.winnerUserId}`,
          metadata: { roomId: params.roomId, model: "winner_take_all" }
        },
        client
      );
    }

    await client.query(
      `update matches set status='finished', winner_user_id=$1, finished_at=now() where match_id=$2`,
      [params.winnerUserId, params.matchId]
    );

    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function settleMatchSplitPot(params: {
  matchId: string;
  gameKey: string;
  stakeAmount: bigint;
  userIds: string[];
  winnerUserIds: string[];
  roomId: string;
}) {
  const stake = params.stakeAmount;
  const client = await pool.connect();
  try {
    await client.query("begin");

    const pot = stake * BigInt(params.userIds.length);
    const winners = params.winnerUserIds;
    if (stake > 0n && winners.length > 0) {
      const base = pot / BigInt(winners.length);
      let remainder = pot % BigInt(winners.length);
      for (const uid of winners) {
        let amount = base;
        if (remainder > 0n) {
          amount += 1n;
          remainder -= 1n;
        }
        await applyLedgerTx(
          {
            userId: uid,
            amount,
            type: "payout",
            matchId: params.matchId,
            gameKey: params.gameKey,
            idempotencyKey: `payout:${params.matchId}:${uid}`,
            metadata: { roomId: params.roomId, model: "split_pot" }
          },
          client
        );
      }
    }

    await client.query(
      `update matches set status='finished', winner_user_id=$1, finished_at=now() where match_id=$2`,
      [winners[0] ?? null, params.matchId]
    );

    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
