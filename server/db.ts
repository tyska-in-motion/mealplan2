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
  // Backward-compatible self-healing for ingredients migration
  await pool.query(`ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS always_at_home boolean DEFAULT false`);
  await pool.query(`UPDATE ingredients SET always_at_home = false WHERE always_at_home IS NULL`);
  await pool.query(`ALTER TABLE ingredients ALTER COLUMN always_at_home SET NOT NULL`);
  await pool.query(`ALTER TABLE ingredients ALTER COLUMN always_at_home SET DEFAULT false`);

  await pool.query(`ALTER TABLE meal_entries ADD COLUMN IF NOT EXISTS person text DEFAULT 'A'`);
  await pool.query(`UPDATE meal_entries SET person = 'A' WHERE person IS NULL`);
  await pool.query(`ALTER TABLE meal_entries ALTER COLUMN person SET NOT NULL`);

  await pool.query(`CREATE TABLE IF NOT EXISTS user_settings (
    id serial PRIMARY KEY,
    target_calories integer NOT NULL DEFAULT 2000,
    target_protein integer NOT NULL DEFAULT 150,
    target_carbs integer NOT NULL DEFAULT 200,
    target_fat integer NOT NULL DEFAULT 65
  )`);

  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS target_calories integer DEFAULT 2000`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS target_protein integer DEFAULT 150`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS target_carbs integer DEFAULT 200`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS target_fat integer DEFAULT 65`);
  await pool.query(`UPDATE user_settings SET target_calories = 2000 WHERE target_calories IS NULL`);
  await pool.query(`UPDATE user_settings SET target_protein = 150 WHERE target_protein IS NULL`);
  await pool.query(`UPDATE user_settings SET target_carbs = 200 WHERE target_carbs IS NULL`);
  await pool.query(`UPDATE user_settings SET target_fat = 65 WHERE target_fat IS NULL`);
  await pool.query(`ALTER TABLE user_settings ALTER COLUMN target_calories SET NOT NULL`);
  await pool.query(`ALTER TABLE user_settings ALTER COLUMN target_protein SET NOT NULL`);
  await pool.query(`ALTER TABLE user_settings ALTER COLUMN target_carbs SET NOT NULL`);
  await pool.query(`ALTER TABLE user_settings ALTER COLUMN target_fat SET NOT NULL`);

  // Backward compatibility for environments that already query per-person settings.
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS person text DEFAULT 'A'`);


  // Backward-compatible self-healing for ingredient scaling migration
  await pool.query(`DO $$ BEGIN
    CREATE TYPE ingredient_scaling_type AS ENUM ('LINEAR', 'FIXED', 'STEP', 'FORMULA');
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;`);

  await pool.query(`ALTER TABLE recipe_ingredients
    ADD COLUMN IF NOT EXISTS base_amount real,
    ADD COLUMN IF NOT EXISTS alternative_amount real,
    ADD COLUMN IF NOT EXISTS alternative_unit text,
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

  // Backward-compatible self-healing for frequent addons scaling migration
  await pool.query(`ALTER TABLE recipe_frequent_addons
    ADD COLUMN IF NOT EXISTS base_amount real,
    ADD COLUMN IF NOT EXISTS alternative_amount real,
    ADD COLUMN IF NOT EXISTS alternative_unit text,
    ADD COLUMN IF NOT EXISTS unit text,
    ADD COLUMN IF NOT EXISTS scaling_type ingredient_scaling_type,
    ADD COLUMN IF NOT EXISTS scaling_formula text,
    ADD COLUMN IF NOT EXISTS step_thresholds jsonb`);

  await pool.query(`UPDATE recipe_frequent_addons SET base_amount = amount WHERE base_amount IS NULL`);
  await pool.query(`UPDATE recipe_frequent_addons SET unit = 'g' WHERE unit IS NULL`);
  await pool.query(`UPDATE recipe_frequent_addons SET scaling_type = 'LINEAR' WHERE scaling_type IS NULL`);

  await pool.query(`ALTER TABLE recipe_frequent_addons ALTER COLUMN base_amount SET NOT NULL`);
  await pool.query(`ALTER TABLE recipe_frequent_addons ALTER COLUMN unit SET NOT NULL`);
  await pool.query(`ALTER TABLE recipe_frequent_addons ALTER COLUMN scaling_type SET NOT NULL`);
  await pool.query(`ALTER TABLE recipe_frequent_addons ALTER COLUMN scaling_type SET DEFAULT 'LINEAR'`);

  // Backward-compatible self-healing for recipe favorites migration
  await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false`);
  await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS instruction_steps jsonb`);
  await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS suggested_recipe_ids integer[] DEFAULT '{}'::integer[]`);
  await pool.query(`UPDATE recipes SET suggested_recipe_ids = '{}'::integer[] WHERE suggested_recipe_ids IS NULL`);
  await pool.query(`ALTER TABLE recipes ALTER COLUMN suggested_recipe_ids SET NOT NULL`);
  await pool.query(`ALTER TABLE recipes ALTER COLUMN suggested_recipe_ids SET DEFAULT '{}'::integer[]`);
  await pool.query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS suggested_recipes jsonb DEFAULT '[]'::jsonb`);
  await pool.query(`UPDATE recipes SET suggested_recipes = '[]'::jsonb WHERE suggested_recipes IS NULL`);
  await pool.query(`UPDATE recipes SET suggested_recipes = COALESCE((
    SELECT jsonb_agg(jsonb_build_object('recipeId', rid, 'servings', 1))
    FROM unnest(suggested_recipe_ids) AS rid
  ), '[]'::jsonb)
  WHERE (suggested_recipes = '[]'::jsonb OR suggested_recipes IS NULL) AND array_length(suggested_recipe_ids, 1) > 0`);
  await pool.query(`ALTER TABLE recipes ALTER COLUMN suggested_recipes SET NOT NULL`);
  await pool.query(`ALTER TABLE recipes ALTER COLUMN suggested_recipes SET DEFAULT '[]'::jsonb`);
  await pool.query(`UPDATE recipes SET is_favorite = false WHERE is_favorite IS NULL`);
  await pool.query(`ALTER TABLE recipes ALTER COLUMN is_favorite SET NOT NULL`);
  await pool.query(`ALTER TABLE recipes ALTER COLUMN is_favorite SET DEFAULT false`);

  await pool.query(`CREATE TABLE IF NOT EXISTS shopping_list_checks (
    ingredient_id integer NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    is_checked boolean NOT NULL DEFAULT false,
    updated_at timestamp DEFAULT now(),
    PRIMARY KEY (ingredient_id, period_start, period_end)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS shopping_list_extras (
    id serial PRIMARY KEY,
    period_start date NOT NULL,
    period_end date NOT NULL,
    name text NOT NULL,
    amount real NOT NULL DEFAULT 1,
    unit text NOT NULL DEFAULT 'szt',
    category text NOT NULL DEFAULT 'Dodatkowe',
    is_checked boolean NOT NULL DEFAULT false,
    created_at timestamp DEFAULT now()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS shopping_list_excluded_items (
    ingredient_id integer NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    updated_at timestamp DEFAULT now(),
    PRIMARY KEY (ingredient_id, period_start, period_end)
  )`);

  await pool.query(`ALTER TABLE shopping_list_checks ADD COLUMN IF NOT EXISTS period_start date`);
  await pool.query(`ALTER TABLE shopping_list_checks ADD COLUMN IF NOT EXISTS period_end date`);
  await pool.query(`UPDATE shopping_list_checks SET period_start = CURRENT_DATE, period_end = CURRENT_DATE WHERE period_start IS NULL OR period_end IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_checks ALTER COLUMN period_start SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_checks ALTER COLUMN period_end SET NOT NULL`);
  await pool.query(`DELETE FROM shopping_list_checks a USING shopping_list_checks b WHERE a.ctid < b.ctid AND a.ingredient_id = b.ingredient_id AND a.period_start = b.period_start AND a.period_end = b.period_end`);
  await pool.query(`ALTER TABLE shopping_list_checks DROP CONSTRAINT IF EXISTS shopping_list_checks_pkey`);
  await pool.query(`ALTER TABLE shopping_list_checks ADD CONSTRAINT shopping_list_checks_pkey PRIMARY KEY (ingredient_id, period_start, period_end)`);

  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS period_start date`);
  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS period_end date`);
  await pool.query(`UPDATE shopping_list_extras SET period_start = CURRENT_DATE, period_end = CURRENT_DATE WHERE period_start IS NULL OR period_end IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN period_start SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN period_end SET NOT NULL`);

  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS amount real DEFAULT 1`);
  await pool.query(`UPDATE shopping_list_extras SET amount = 1 WHERE amount IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN amount SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN amount SET DEFAULT 1`);

  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS unit text DEFAULT 'szt'`);
  await pool.query(`UPDATE shopping_list_extras SET unit = 'szt' WHERE unit IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN unit SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN unit SET DEFAULT 'szt'`);

  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS category text DEFAULT 'Dodatkowe'`);
  await pool.query(`UPDATE shopping_list_extras SET category = 'Dodatkowe' WHERE category IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN category SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN category SET DEFAULT 'Dodatkowe'`);

  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS is_checked boolean DEFAULT false`);
  await pool.query(`UPDATE shopping_list_extras SET is_checked = false WHERE is_checked IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN is_checked SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_extras ALTER COLUMN is_checked SET DEFAULT false`);

  await pool.query(`ALTER TABLE shopping_list_extras ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now()`);

  await pool.query(`ALTER TABLE shopping_list_excluded_items ADD COLUMN IF NOT EXISTS period_start date`);
  await pool.query(`ALTER TABLE shopping_list_excluded_items ADD COLUMN IF NOT EXISTS period_end date`);
  await pool.query(`UPDATE shopping_list_excluded_items SET period_start = CURRENT_DATE, period_end = CURRENT_DATE WHERE period_start IS NULL OR period_end IS NULL`);
  await pool.query(`ALTER TABLE shopping_list_excluded_items ALTER COLUMN period_start SET NOT NULL`);
  await pool.query(`ALTER TABLE shopping_list_excluded_items ALTER COLUMN period_end SET NOT NULL`);
  await pool.query(`DELETE FROM shopping_list_excluded_items a USING shopping_list_excluded_items b WHERE a.ctid < b.ctid AND a.ingredient_id = b.ingredient_id AND a.period_start = b.period_start AND a.period_end = b.period_end`);
  await pool.query(`ALTER TABLE shopping_list_excluded_items DROP CONSTRAINT IF EXISTS shopping_list_excluded_items_pkey`);
  await pool.query(`ALTER TABLE shopping_list_excluded_items ADD CONSTRAINT shopping_list_excluded_items_pkey PRIMARY KEY (ingredient_id, period_start, period_end)`);

}
