
import { db } from "./db";
import {
  ingredients,
  recipes,
  recipeIngredients,
  recipeFrequentAddons,
  mealEntries,
  userSettings,
  shoppingListChecks,
  mealEntryIngredients,
  type Ingredient,
  type Recipe,
  type MealEntry,
  type CreateIngredientRequest,
  type CreateRecipeRequest,
  type CreateMealEntryRequest,
  type RecipeWithIngredients,
  type MealEntryWithRecipe,
  type DaySummary,
  type UserSettings,
} from "@shared/schema";
import { eq, sql, and, gte, lte, inArray } from "drizzle-orm";

export interface IStorage {
  // Ingredients
  getIngredients(search?: string): Promise<Ingredient[]>;
  getIngredient(id: number): Promise<Ingredient | undefined>;
  createIngredient(ingredient: CreateIngredientRequest): Promise<Ingredient>;
  deleteIngredient(id: number): Promise<void>;

  // Recipes
  getRecipes(search?: string, ingredientId?: number): Promise<RecipeWithIngredients[]>;
  getRecipe(id: number): Promise<RecipeWithIngredients | undefined>;
  createRecipe(recipe: CreateRecipeRequest & { ingredients: { ingredientId: number; amount: number }[]; frequentAddons?: { ingredientId: number; amount: number }[] }): Promise<RecipeWithIngredients>;
  updateRecipe(id: number, recipe: CreateRecipeRequest & { ingredients: { ingredientId: number; amount: number }[]; frequentAddons?: { ingredientId: number; amount: number }[] }): Promise<RecipeWithIngredients>;
  deleteRecipe(id: number): Promise<void>;

  // Meal Plan
  getDayEntries(date: string): Promise<MealEntryWithRecipe[]>;
  getMealEntryById(id: number): Promise<MealEntryWithRecipe | undefined>;
  createMealEntry(entry: CreateMealEntryRequest): Promise<MealEntry>;
  updateMealEntry(id: number, updates: Partial<MealEntry> & { servings?: number }): Promise<MealEntry>;
  deleteMealEntry(id: number): Promise<void>;
  getMealEntriesRange(startDate: string, endDate: string): Promise<MealEntryWithRecipe[]>;
  updateMealEntryIngredients(mealEntryId: number, ingredients: { ingredientId: number; amount: number }[]): Promise<void>;
  copyDayEntries(sourceDate: string, targetDate: string, replaceTarget?: boolean): Promise<number>;

  // Shopping List Checks
  getShoppingListChecks(): Promise<Record<number, boolean>>;
  toggleShoppingListCheck(ingredientId: number, isChecked: boolean): Promise<void>;

  // User Settings
  getUserSettings(): Promise<UserSettings>;
  updateUserSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
}

export class DatabaseStorage implements IStorage {
  async getUserSettings(): Promise<UserSettings> {
    const [settings] = await db.select().from(userSettings);
    if (!settings) {
      const [newSettings] = await db.insert(userSettings).values({}).returning();
      return newSettings;
    }
    return settings;
  }

  async updateUserSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getUserSettings();
    const [updated] = await db.update(userSettings)
      .set(updates)
      .where(eq(userSettings.id, current.id))
      .returning();
    return updated;
  }

  async getIngredients(search?: string): Promise<Ingredient[]> {
    if (search) {
      const lowerSearch = `%${search.toLowerCase()}%`;
      return await db.select().from(ingredients).where(
        sql`LOWER(${ingredients.name}) LIKE ${lowerSearch} OR LOWER(${ingredients.category}) LIKE ${lowerSearch}`
      );
    }
    return await db.select().from(ingredients);
  }

  async getIngredient(id: number): Promise<Ingredient | undefined> {
    const [ingredient] = await db.select().from(ingredients).where(eq(ingredients.id, id));
    return ingredient;
  }

  async createIngredient(ingredient: CreateIngredientRequest): Promise<Ingredient> {
    const [newIngredient] = await db.insert(ingredients).values(ingredient).returning();
    return newIngredient;
  }

  async updateIngredient(id: number, updates: Partial<Ingredient>): Promise<Ingredient> {
    const [updated] = await db.update(ingredients)
      .set(updates)
      .where(eq(ingredients.id, id))
      .returning();
    if (!updated) throw new Error("Ingredient not found");
    return updated;
  }

  async deleteIngredient(id: number): Promise<void> {
    await db.delete(ingredients).where(eq(ingredients.id, id));
  }

  async getRecipes(search?: string, ingredientId?: number): Promise<RecipeWithIngredients[]> {
    let query = db.query.recipes.findMany({
      with: {
        ingredients: {
          with: {
            ingredient: true
          }
        },
        frequentAddons: {
          with: {
            ingredient: true
          }
        }
      }
    });

    const allRecipes = await query;
    let filtered = allRecipes;

    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(r => 
        r.name.toLowerCase().includes(lowerSearch) || 
        (r.tags && r.tags.some(tag => tag.toLowerCase().includes(lowerSearch))) ||
        r.ingredients.some(ri => ri.ingredient.name.toLowerCase().includes(lowerSearch))
      );
    }

    if (ingredientId) {
      filtered = filtered.filter(r => r.ingredients.some(ri => ri.ingredientId === ingredientId));
    }

    return filtered as RecipeWithIngredients[];
  }

  async getRecipe(id: number): Promise<RecipeWithIngredients | undefined> {
    const recipe = await db.query.recipes.findFirst({
      where: eq(recipes.id, id),
      with: {
        ingredients: {
          with: {
            ingredient: true
          }
        },
        frequentAddons: {
          with: {
            ingredient: true
          }
        }
      }
    });
    return recipe as RecipeWithIngredients | undefined;
  }

  async createRecipe(req: CreateRecipeRequest & { ingredients: { ingredientId: number; amount: number }[]; frequentAddons?: { ingredientId: number; amount: number }[] }): Promise<RecipeWithIngredients> {
    const [recipe] = await db.insert(recipes).values({
      name: req.name,
      tags: req.tags,
      description: req.description,
      instructions: req.instructions,
      prepTime: req.prepTime,
      imageUrl: req.imageUrl,
      servings: req.servings || 1,
    }).returning();

    if (req.ingredients.length > 0) {
      await db.insert(recipeIngredients).values(
        req.ingredients.map(i => ({
          recipeId: recipe.id,
          ingredientId: i.ingredientId,
          amount: i.amount
        }))
      );
    }

    if (req.frequentAddons && req.frequentAddons.length > 0) {
      await db.insert(recipeFrequentAddons).values(
        req.frequentAddons.map((i) => ({
          recipeId: recipe.id,
          ingredientId: i.ingredientId,
          amount: i.amount,
        }))
      );
    }

    return this.getRecipe(recipe.id) as Promise<RecipeWithIngredients>;
  }

  async updateRecipe(id: number, req: CreateRecipeRequest & { ingredients: { ingredientId: number; amount: number }[]; frequentAddons?: { ingredientId: number; amount: number }[] }): Promise<RecipeWithIngredients> {
    await db.update(recipes)
      .set({
        name: req.name,
        tags: req.tags,
        description: req.description,
        instructions: req.instructions,
        prepTime: req.prepTime,
        imageUrl: req.imageUrl,
        servings: req.servings || 1,
      })
      .where(eq(recipes.id, id));

    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    await db.delete(recipeFrequentAddons).where(eq(recipeFrequentAddons.recipeId, id));

    if (req.ingredients.length > 0) {
      await db.insert(recipeIngredients).values(
        req.ingredients.map(i => ({
          recipeId: id,
          ingredientId: i.ingredientId,
          amount: i.amount
        }))
      );
    }

    if (req.frequentAddons && req.frequentAddons.length > 0) {
      await db.insert(recipeFrequentAddons).values(
        req.frequentAddons.map((i) => ({
          recipeId: id,
          ingredientId: i.ingredientId,
          amount: i.amount,
        }))
      );
    }

    return this.getRecipe(id) as Promise<RecipeWithIngredients>;
  }

  async deleteRecipe(id: number): Promise<void> {
    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    await db.delete(recipeFrequentAddons).where(eq(recipeFrequentAddons.recipeId, id));
    await db.delete(mealEntries).where(eq(mealEntries.recipeId, id));
    await db.delete(recipes).where(eq(recipes.id, id));
  }

  async getDayEntries(date: string): Promise<MealEntryWithRecipe[]> {
    const entries = await db.query.mealEntries.findMany({
      where: eq(mealEntries.date, date),
      with: {
        recipe: {
          with: {
            ingredients: {
              with: {
                ingredient: true
              }
            },
            frequentAddons: {
              with: {
                ingredient: true
              }
            }
          }
        },
        ingredients: {
          with: {
            ingredient: true
          }
        }
      }
    });
    return entries as MealEntryWithRecipe[];
  }

  async getMealEntryById(id: number): Promise<MealEntryWithRecipe | undefined> {
    const entry = await db.query.mealEntries.findFirst({
      where: eq(mealEntries.id, id),
      with: {
        recipe: {
          with: {
            ingredients: {
              with: {
                ingredient: true
              }
            },
            frequentAddons: {
              with: {
                ingredient: true
              }
            }
          }
        },
        ingredients: {
          with: {
            ingredient: true
          }
        }
      }
    });

    return entry as MealEntryWithRecipe | undefined;
  }

  async createMealEntry(entry: CreateMealEntryRequest): Promise<MealEntry> {
    const [newEntry] = await db.insert(mealEntries).values(entry).returning();
    
    // If it's a recipe, clone its ingredients to the entry for independent editing
    if (entry.recipeId) {
      const recipe = await this.getRecipe(entry.recipeId);
      if (recipe && recipe.ingredients.length > 0) {
        await db.insert(mealEntryIngredients).values(
          recipe.ingredients.map(ri => ({
            mealEntryId: newEntry.id,
            ingredientId: ri.ingredientId,
            amount: ri.amount // Note: this is for the whole recipe, we adjust by servings in calculation
          }))
        );
      }
    }
    
    return newEntry;
  }

  async updateMealEntry(id: number, updates: Partial<MealEntry>): Promise<MealEntry> {
    const [updated] = await db.update(mealEntries)
      .set(updates)
      .where(eq(mealEntries.id, id))
      .returning();
    if (!updated) throw new Error("Meal entry not found");
    
    // Clear relations from cache by refetching
    return updated;
  }

  async updateMealEntryIngredients(mealEntryId: number, ingredientsList: { ingredientId: number; amount: number }[]): Promise<void> {
    await db.transaction(async (tx) => {
      // Delete existing and insert new in one transaction
      await tx.delete(mealEntryIngredients).where(eq(mealEntryIngredients.mealEntryId, mealEntryId));
      if (ingredientsList.length > 0) {
        await tx.insert(mealEntryIngredients).values(
          ingredientsList.map(i => ({
            mealEntryId,
            ingredientId: i.ingredientId,
            amount: i.amount
          }))
        );
      }
    });
    // Optional: add a small delay or logging to verify
    console.log(`Ingredients updated for meal entry ${mealEntryId}`);
  }

  async copyDayEntries(sourceDate: string, targetDate: string, replaceTarget = true): Promise<number> {
    if (sourceDate === targetDate) {
      throw new Error("Dzień źródłowy i docelowy muszą się różnić");
    }

    const sourceEntries = await this.getDayEntries(sourceDate);

    await db.transaction(async (tx) => {
      if (replaceTarget) {
        const existingTargetEntries = await tx.select({ id: mealEntries.id })
          .from(mealEntries)
          .where(eq(mealEntries.date, targetDate));

        const targetEntryIds = existingTargetEntries.map((entry) => entry.id);
        if (targetEntryIds.length > 0) {
          await tx.delete(mealEntryIngredients).where(inArray(mealEntryIngredients.mealEntryId, targetEntryIds));
          await tx.delete(mealEntries).where(inArray(mealEntries.id, targetEntryIds));
        }
      }

      for (const sourceEntry of sourceEntries) {
        const [copiedEntry] = await tx.insert(mealEntries).values({
          date: targetDate,
          recipeId: sourceEntry.recipeId,
          customName: sourceEntry.customName,
          customCalories: sourceEntry.customCalories,
          customProtein: sourceEntry.customProtein,
          customCarbs: sourceEntry.customCarbs,
          customFat: sourceEntry.customFat,
          mealType: sourceEntry.mealType,
          person: sourceEntry.person,
          servings: sourceEntry.servings,
          isEaten: sourceEntry.isEaten,
        }).returning();

        const sourceIngredients = sourceEntry.ingredients || [];
        if (sourceIngredients.length > 0) {
          await tx.insert(mealEntryIngredients).values(sourceIngredients.map((ingredient) => ({
            mealEntryId: copiedEntry.id,
            ingredientId: ingredient.ingredientId,
            amount: ingredient.amount,
          })));
        }
      }
    });

    return sourceEntries.length;
  }

  async deleteMealEntry(id: number): Promise<void> {
    await db.delete(mealEntryIngredients).where(eq(mealEntryIngredients.mealEntryId, id));
    await db.delete(mealEntries).where(eq(mealEntries.id, id));
  }

  async getMealEntriesRange(startDate: string, endDate: string): Promise<MealEntryWithRecipe[]> {
    const entries = await db.query.mealEntries.findMany({
      where: and(gte(mealEntries.date, startDate), lte(mealEntries.date, endDate)),
      with: {
        recipe: {
          with: {
            ingredients: {
              with: {
                ingredient: true
              }
            },
            frequentAddons: {
              with: {
                ingredient: true
              }
            }
          }
        },
        ingredients: {
          with: {
            ingredient: true
          }
        }
      }
    });
    return entries as MealEntryWithRecipe[];
  }

  async getShoppingListChecks(): Promise<Record<number, boolean>> {
    const checks = await db.select().from(shoppingListChecks);
    return checks.reduce((acc, curr) => {
      acc[curr.ingredientId] = curr.isChecked;
      return acc;
    }, {} as Record<number, boolean>);
  }

  async toggleShoppingListCheck(ingredientId: number, isChecked: boolean): Promise<void> {
    await db.insert(shoppingListChecks)
      .values({ ingredientId, isChecked, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: shoppingListChecks.ingredientId,
        set: { isChecked, updatedAt: new Date() }
      });
  }
}

export const storage = new DatabaseStorage();
