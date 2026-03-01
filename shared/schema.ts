
import { pgTable, text, serial, integer, boolean, timestamp, real, date } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
});

export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  targetCalories: integer("target_calories").notNull().default(2000),
  targetProtein: integer("target_protein").notNull().default(150),
  targetCarbs: integer("target_carbs").notNull().default(200),
  targetFat: integer("target_fat").notNull().default(65),
});

export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tags: text("tags").array(), // e.g. ["szybkie", "śniadanie"]
  description: text("description"),
  instructions: text("instructions"),
  prepTime: integer("prep_time"), // minutes
  imageUrl: text("image_url"),
  servings: real("servings").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  amount: integer("amount").notNull(), // Amount in default unit
});

export const recipeFrequentAddons = pgTable("recipe_frequent_addons", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  amount: integer("amount").notNull(), // Suggested add-on amount in grams
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
  isEaten: boolean("is_eaten").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mealEntryIngredients = pgTable("meal_entry_ingredients", {
  id: serial("id").primaryKey(),
  mealEntryId: integer("meal_entry_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  amount: integer("amount").notNull(),
});

// === RELATIONS ===

export const recipesRelations = relations(recipes, ({ many }) => ({
  ingredients: many(recipeIngredients),
  frequentAddons: many(recipeFrequentAddons),
  mealEntries: many(mealEntries),
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

export const mealEntriesRelations = relations(mealEntries, ({ one, many }) => ({
  recipe: one(recipes, {
    fields: [mealEntries.recipeId],
    references: [recipes.id],
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
  ingredientId: integer("ingredient_id").primaryKey(),
  isChecked: boolean("is_checked").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === SCHEMAS & TYPES ===

export const insertIngredientSchema = createInsertSchema(ingredients).omit({ id: true });
export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, createdAt: true });
export const insertRecipeIngredientSchema = createInsertSchema(recipeIngredients).omit({ id: true });
export const insertRecipeFrequentAddonSchema = createInsertSchema(recipeFrequentAddons).omit({ id: true });
export const insertMealEntrySchema = createInsertSchema(mealEntries).omit({ id: true, createdAt: true });
export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ id: true });

export type Ingredient = typeof ingredients.$inferSelect;
export type Recipe = typeof recipes.$inferSelect;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type RecipeFrequentAddon = typeof recipeFrequentAddons.$inferSelect;
export type MealEntry = typeof mealEntries.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;

export type CreateIngredientRequest = z.infer<typeof insertIngredientSchema>;
export type CreateRecipeRequest = z.infer<typeof insertRecipeSchema>;
export type CreateMealEntryRequest = z.infer<typeof insertMealEntrySchema>;

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
