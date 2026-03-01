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

  // Backward-compatible self-healing for ingredient scaling migration
  await pool.query(`DO $$ BEGIN
    CREATE TYPE ingredient_scaling_type AS ENUM ('LINEAR', 'FIXED', 'STEP', 'FORMULA');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;`);

  await pool.query(`ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS base_amount real,
    ADD COLUMN IF NOT EXISTS unit text,
    ADD COLUMN IF NOT EXISTS scaling_type ingredient_scaling_type,
    ADD COLUMN IF NOT EXISTS scaling_formula text,
    ADD COLUMN IF NOT EXISTS step_thresholds jsonb`);

  await pool.query(`UPDATE recipe_ingredients SET base_amount = amount WHERE base_amount IS NULL`);
  await pool.query(`UPDATE recipe_ingredients SET unit = 'g' WHERE unit IS NULL`);
  await pool.query(`UPDATE recipe_ingredients SET scaling_type = 'LINEAR' WHERE scaling_type IS NULL`);

  await pool.query(`ALTER TABLE recipe_ingredients ALTER COLUMN base_amount SET NOT NULL`);
  await pool.query(`ALTER TABLE recipe_ingredients ALTER COLUMN unit SET NOT NULL`);
  await pool.query(`ALTER TABLE recipe_ingredients ALTER COLUMN scaling_type SET NOT NULL`);
  await pool.query(`ALTER TABLE recipe_ingredients ALTER COLUMN scaling_type SET DEFAULT 'LINEAR'`);
}
