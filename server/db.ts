import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });


export async function ensureDbCompat() {
  await pool.query(`ALTER TABLE meal_entries ADD COLUMN IF NOT EXISTS person text DEFAULT 'A'`);
  await pool.query(`UPDATE meal_entries SET person = 'A' WHERE person IS NULL`);
  await pool.query(`ALTER TABLE meal_entries ALTER COLUMN person SET NOT NULL`);
}
