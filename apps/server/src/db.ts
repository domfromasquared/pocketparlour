// apps/server/src/db.ts
import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({
  connectionString: env.SUPABASE_DB_URL,
  max: 10
});
