
import { pgTable, text, serial, integer, boolean, timestamp, real, date, jsonb, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type InstructionSegment =
  | { type: "text"; text: string }
  | { type: "ingredient"; text: string; ingredientId: number; ingredientIds?: number[]; ingredientSource?: "ingredient" | "frequentAddon"; multiplier?: number };

export type InstructionStep = {
  segments: InstructionSegment[];
};

export type SuggestedRecipe = {
  recipeId: number;
  servings: number;
};

// === TABLE DEFINITIONS ===

export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"), // e.g. "mięso", "nabiał", "owoce"
  calories: integer("calories").notNull(), // per 100g/ml
  protein: real("protein").notNull(),
  carbs: real("carbs").notNull(),
  fat: real("fat").notNull(),
  unit: text("unit").notNull().default("g"), // Always "g" for base calc, but we'll show unitDescription
  unitWeight: real("unit_weight"), // Weight of one "sztuka" in grams
  unitDescription: text("unit_description"), // e.g. "1 sztuka to ok. 150g"
  price: real("price").default(0), // Price per 100g
  imageUrl: text("image_url"),
  alwaysAtHome: boolean("always_at_home").notNull().default(false),
});

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  person: text("person").notNull().default("A"),
  targetCalories: integer("target_calories").notNull().default(2000),
  targetProtein: integer("target_protein").notNull().default(150),
  targetCarbs: integer("target_carbs").notNull().default(200),
  targetFat: integer("target_fat").notNull().default(65),
  sharedBatchesManualOnly: boolean("shared_batches_manual_only").notNull().default(true),
});

export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isFavorite: boolean("is_favorite").notNull().default(false),
  suggestedRecipeIds: integer("suggested_recipe_ids").array().notNull().default(sql`'{}'::integer[]`),
  suggestedRecipes: jsonb("suggested_recipes").$type<SuggestedRecipe[]>().notNull().default(sql`'[]'::jsonb`),
  tags: text("tags").array(), // e.g. ["szybkie", "śniadanie"]
  description: text("description"),
  instructions: text("instructions"),
  instructionSteps: jsonb("instruction_steps").$type<InstructionStep[]>(),
  prepTime: integer("prep_time"), // minutes
  imageUrl: text("image_url"),
  servings: real("servings").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ingredientScalingTypeEnum = pgEnum("ingredient_scaling_type", ["LINEAR", "FIXED", "STEP", "FORMULA"]);

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  amount: integer("amount").notNull(), // Legacy amount (kept for backward compatibility)
  baseAmount: real("base_amount").notNull(),
  alternativeAmount: real("alternative_amount"),
  alternativeUnit: text("alternative_unit"),
  unit: text("unit").notNull().default("g"),
  scalingType: ingredientScalingTypeEnum("scaling_type").notNull().default("LINEAR"),
  scalingFormula: text("scaling_formula"),
  stepThresholds: jsonb("step_thresholds").$type<{ minServings: number; maxServings?: number | null; amount: number }[]>(),
});

export const recipeFrequentAddons = pgTable("recipe_frequent_addons", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  amount: integer("amount").notNull(), // Legacy amount (kept for backward compatibility)
  baseAmount: real("base_amount").notNull(),
  alternativeAmount: real("alternative_amount"),
  alternativeUnit: text("alternative_unit"),
  unit: text("unit").notNull().default("g"),
  scalingType: ingredientScalingTypeEnum("scaling_type").notNull().default("LINEAR"),
  scalingFormula: text("scaling_formula"),
  stepThresholds: jsonb("step_thresholds").$type<{ minServings: number; maxServings?: number | null; amount: number }[]>(),
});

export const sharedMealBatches = pgTable("shared_meal_batches", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  totalServings: real("total_servings").notNull().default(1),
  note: text("note"),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const sharedMealBatchLogs = pgTable("shared_meal_batch_logs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mealEntries = pgTable("meal_entries", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(), // YYYY-MM-DD
  recipeId: integer("recipe_id"), // Optional for custom meals
  customName: text("custom_name"),
  customCalories: integer("custom_calories"),
  customProtein: real("custom_protein"),
  customCarbs: real("custom_carbs"),
  customFat: real("custom_fat"),
  mealType: text("meal_type").notNull(), // breakfast, lunch, dinner, snack
  person: text("person").notNull().default("A"), // A or B
  servings: real("servings").notNull().default(1),
  cookedBatchId: integer("cooked_batch_id"),

  isEaten: boolean("is_eaten").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mealEntryIngredients = pgTable("meal_entry_ingredients", {
  id: serial("id").primaryKey(),
  mealEntryId: integer("meal_entry_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  amount: integer("amount").notNull(),
  scalingType: ingredientScalingTypeEnum("scaling_type").notNull().default("LINEAR"),
});

// === RELATIONS ===

export const recipesRelations = relations(recipes, ({ many }) => ({
  ingredients: many(recipeIngredients),
  frequentAddons: many(recipeFrequentAddons),
  mealEntries: many(mealEntries),
  sharedBatches: many(sharedMealBatches),
}));

export const ingredientsRelations = relations(ingredients, ({ many }) => ({
  inRecipes: many(recipeIngredients),
  inRecipeFrequentAddons: many(recipeFrequentAddons),
  inMealEntries: many(mealEntryIngredients),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeIngredients.recipeId],
    references: [recipes.id],
  }),
  ingredient: one(ingredients, {
    fields: [recipeIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const recipeFrequentAddonsRelations = relations(recipeFrequentAddons, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeFrequentAddons.recipeId],
    references: [recipes.id],
  }),
  ingredient: one(ingredients, {
    fields: [recipeFrequentAddons.ingredientId],
    references: [ingredients.id],
  }),
}));


export const sharedMealBatchesRelations = relations(sharedMealBatches, ({ one, many }) => ({
  recipe: one(recipes, {
    fields: [sharedMealBatches.recipeId],
    references: [recipes.id],
  }),
  mealEntries: many(mealEntries),
  logs: many(sharedMealBatchLogs),
}));

export const sharedMealBatchLogsRelations = relations(sharedMealBatchLogs, ({ one }) => ({
  batch: one(sharedMealBatches, {
    fields: [sharedMealBatchLogs.batchId],
    references: [sharedMealBatches.id],
  }),
}));
export const mealEntriesRelations = relations(mealEntries, ({ one, many }) => ({
  recipe: one(recipes, {
    fields: [mealEntries.recipeId],
    references: [recipes.id],
  }),
  cookedBatch: one(sharedMealBatches, {
    fields: [mealEntries.cookedBatchId],
    references: [sharedMealBatches.id],
  }),
  ingredients: many(mealEntryIngredients),
}));

export const mealEntryIngredientsRelations = relations(mealEntryIngredients, ({ one }) => ({
  mealEntry: one(mealEntries, {
    fields: [mealEntryIngredients.mealEntryId],
    references: [mealEntries.id],
  }),
  ingredient: one(ingredients, {
    fields: [mealEntryIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const shoppingListChecks = pgTable("shopping_list_checks", {
  ingredientId: integer("ingredient_id").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ingredientId, table.periodStart, table.periodEnd] }),
}));

export const shoppingListExtras = pgTable("shopping_list_extras", {
  id: serial("id").primaryKey(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  name: text("name").notNull(),
  amount: real("amount").notNull().default(1),
  unit: text("unit").notNull().default("szt"),
  category: text("category").notNull().default("Dodatkowe"),
  isChecked: boolean("is_checked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shoppingListExcludedItems = pgTable("shopping_list_excluded_items", {
  ingredientId: integer("ingredient_id").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ingredientId, table.periodStart, table.periodEnd] }),
}));

export const shoppingListSnapshots = pgTable("shopping_list_snapshots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shoppingListSnapshotItems = pgTable("shopping_list_snapshot_items", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id").notNull().references(() => shoppingListSnapshots.id, { onDelete: "cascade" }),
  ingredientId: integer("ingredient_id"),
  name: text("name").notNull(),
  totalAmount: real("total_amount").notNull().default(0),
  unit: text("unit").notNull().default("g"),
  category: text("category").notNull().default("Inne"),
  status: text("status").notNull().default("NOT_BOUGHT"),
  price: real("price").notNull().default(0),
  isExtra: boolean("is_extra").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SCHEMAS & TYPES ===

export const insertIngredientSchema = createInsertSchema(ingredients).omit({ id: true });
export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, createdAt: true });
export const insertRecipeIngredientSchema = createInsertSchema(recipeIngredients).omit({ id: true });
export const insertRecipeFrequentAddonSchema = createInsertSchema(recipeFrequentAddons).omit({ id: true });
export const insertMealEntrySchema = createInsertSchema(mealEntries).omit({ id: true, createdAt: true });
export const insertSharedMealBatchSchema = createInsertSchema(sharedMealBatches).omit({ id: true, createdAt: true });
export const insertSharedMealBatchLogSchema = createInsertSchema(sharedMealBatchLogs).omit({ id: true, createdAt: true });
export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ id: true });

export type Ingredient = typeof ingredients.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type RecipeFrequentAddon = typeof recipeFrequentAddons.$inferSelect;
export type MealEntry = typeof mealEntries.$inferSelect;
export type SharedMealBatch = typeof sharedMealBatches.$inferSelect;
export type SharedMealBatchLog = typeof sharedMealBatchLogs.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;

export type CreateIngredientRequest = z.infer<typeof insertIngredientSchema>;
export type CreateRecipeRequest = z.infer<typeof insertRecipeSchema>;
export type CreateMealEntryRequest = z.infer<typeof insertMealEntrySchema>;
export type CreateSharedMealBatchRequest = z.infer<typeof insertSharedMealBatchSchema>;

// Extended types for frontend
export type RecipeWithIngredients = Recipe & {
  ingredients: (RecipeIngredient & { ingredient: Ingredient })[];
  frequentAddons: (RecipeFrequentAddon & { ingredient: Ingredient })[];
};

export type MealEntryWithRecipe = MealEntry & {
  recipe?: RecipeWithIngredients;
  ingredients: (typeof mealEntryIngredients.$inferSelect & { ingredient: Ingredient })[];
};

export type ShoppingListItem = {
  ingredientId: number;
  name: string;
  totalAmount: number;
  unit: string;
  isChecked: boolean;
};

export type DaySummary = {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalPrice: number;
  entries: MealEntryWithRecipe[];
};
