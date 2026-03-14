
import { db } from "./db";
import {
  ingredients,
  recipes,
  recipeIngredients,
  recipeFrequentAddons,
  mealEntries,
  sharedMealBatches,
  sharedMealBatchLogs,
  userSettings,
  shoppingListChecks,
  shoppingListExtras,
  shoppingListExcludedItems,
  mealEntryIngredients,
  type Ingredient,
  type Recipe,
  type MealEntry,
  type SharedMealBatch,
  type SharedMealBatchLog,
  type CreateIngredientRequest,
  type CreateRecipeRequest,
  type CreateMealEntryRequest,
  type CreateSharedMealBatchRequest,
  type RecipeWithIngredients,
  type MealEntryWithRecipe,
  type DaySummary,
  type UserSettings,
  type InstructionStep,
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
  createRecipe(recipe: CreateRecipeRequest & { instructionSteps?: InstructionStep[]; ingredients: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[]; frequentAddons?: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[] }): Promise<RecipeWithIngredients>;
  updateRecipe(id: number, recipe: CreateRecipeRequest & { instructionSteps?: InstructionStep[]; ingredients: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[]; frequentAddons?: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[] }): Promise<RecipeWithIngredients>;
  deleteRecipe(id: number): Promise<void>;

  // Meal Plan
  getDayEntries(date: string): Promise<MealEntryWithRecipe[]>;
  getMealEntryById(id: number): Promise<MealEntryWithRecipe | undefined>;
  createMealEntry(entry: CreateMealEntryRequest): Promise<MealEntry>;
  updateMealEntry(id: number, updates: Partial<MealEntry> & { servings?: number }): Promise<MealEntry>;
  deleteMealEntry(id: number): Promise<void>;
  getMealEntriesRange(startDate: string, endDate: string): Promise<MealEntryWithRecipe[]>;
  updateMealEntryIngredients(mealEntryId: number, ingredients: { ingredientId: number; amount: number; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA" }[]): Promise<void>;
  copyDayEntries(sourceDate: string, targetDate: string, replaceTarget?: boolean): Promise<number>;

  // Shared meal batches
  getSharedMealBatches(): Promise<any[]>;
  getArchivedSharedMealBatches(): Promise<any[]>;
  getSharedMealBatchLogs(batchId: number): Promise<SharedMealBatchLog[]>;
  createSharedMealBatch(input: CreateSharedMealBatchRequest): Promise<SharedMealBatch>;
  updateSharedMealBatch(id: number, updates: Partial<Pick<SharedMealBatch, "totalServings" | "note">>): Promise<SharedMealBatch>;
  archiveSharedMealBatch(id: number, isArchived: boolean): Promise<SharedMealBatch>;
  deleteSharedMealBatch(id: number): Promise<void>;

  // Shopping List Checks
  getShoppingListChecks(periodStart: string, periodEnd: string): Promise<Record<number, boolean>>;
  toggleShoppingListCheck(ingredientId: number, periodStart: string, periodEnd: string, isChecked: boolean): Promise<void>;
  getShoppingListExtras(periodStart: string, periodEnd: string): Promise<any[]>;
  addShoppingListExtra(periodStart: string, periodEnd: string, input: { name: string; amount?: number; unit?: string; category?: string }): Promise<any>;
  deleteShoppingListExtra(id: number): Promise<void>;
  toggleShoppingListExtraCheck(id: number, isChecked: boolean): Promise<void>;
  getShoppingListExcludedItems(periodStart: string, periodEnd: string): Promise<number[]>;
  setShoppingListExcludedItem(ingredientId: number, periodStart: string, periodEnd: string, excluded: boolean): Promise<void>;

  // User Settings
  getUserSettings(): Promise<Record<"A" | "B", UserSettings>>;
  updateUserSettings(person: "A" | "B", settings: Partial<UserSettings>): Promise<UserSettings>;
}

export class DatabaseStorage implements IStorage {
  async getUserSettings(): Promise<Record<"A" | "B", UserSettings>> {
    const allSettings = await db.select().from(userSettings);

    const byPerson = new Map<string, UserSettings>();
    for (const setting of allSettings) {
      byPerson.set(setting.person || "A", setting);
    }

    for (const person of ["A", "B"] as const) {
      if (!byPerson.has(person)) {
        const seed = byPerson.get("A") || byPerson.get("B");
        const [created] = await db.insert(userSettings).values({
          person,
          targetCalories: seed?.targetCalories ?? 2000,
          targetProtein: seed?.targetProtein ?? 150,
          targetCarbs: seed?.targetCarbs ?? 200,
          targetFat: seed?.targetFat ?? 65,
          sharedBatchesManualOnly: seed?.sharedBatchesManualOnly ?? true,
        }).returning();
        byPerson.set(person, created);
      }
    }

    return {
      A: byPerson.get("A") as UserSettings,
      B: byPerson.get("B") as UserSettings,
    };
  }

  async updateUserSettings(person: "A" | "B", updates: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getUserSettings();
    const currentPerson = current[person];

    const [updated] = await db.update(userSettings)
      .set(updates)
      .where(eq(userSettings.id, currentPerson.id))
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

  async createRecipe(req: CreateRecipeRequest & { instructionSteps?: InstructionStep[]; ingredients: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[]; frequentAddons?: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[] }): Promise<RecipeWithIngredients> {
    const [recipe] = await db.insert(recipes).values({
      name: req.name,
      tags: req.tags,
      description: req.description,
      instructions: req.instructions,
      instructionSteps: req.instructionSteps,
      prepTime: req.prepTime,
      imageUrl: req.imageUrl,
      isFavorite: req.isFavorite ?? false,
      suggestedRecipeIds: req.suggestedRecipeIds || [],
      suggestedRecipes: (req as any).suggestedRecipes || ((req.suggestedRecipeIds || []).map((recipeId: number) => ({ recipeId, servings: 1 }))),
      servings: req.servings || 1,
    }).returning();

    if (req.ingredients.length > 0) {
      await db.insert(recipeIngredients).values(
        req.ingredients.map(i => ({
          recipeId: recipe.id,
          ingredientId: i.ingredientId,
          amount: Math.round(i.amount),
          baseAmount: i.baseAmount ?? i.amount,
          unit: i.unit || "g",
          alternativeAmount: i.alternativeAmount,
          alternativeUnit: i.alternativeUnit,
          scalingType: i.scalingType || "LINEAR",
          scalingFormula: i.scalingFormula,
          stepThresholds: i.stepThresholds,
        }))
      );
    }

    if (req.frequentAddons && req.frequentAddons.length > 0) {
      await db.insert(recipeFrequentAddons).values(
        req.frequentAddons.map((i) => ({
          recipeId: recipe.id,
          ingredientId: i.ingredientId,
          amount: Math.round(i.amount),
          baseAmount: i.baseAmount ?? i.amount,
          unit: i.unit || "g",
          alternativeAmount: i.alternativeAmount,
          alternativeUnit: i.alternativeUnit,
          scalingType: i.scalingType || "LINEAR",
          scalingFormula: i.scalingFormula,
          stepThresholds: i.stepThresholds,
        }))
      );
    }

    return this.getRecipe(recipe.id) as Promise<RecipeWithIngredients>;
  }

  async updateRecipe(id: number, req: CreateRecipeRequest & { instructionSteps?: InstructionStep[]; ingredients: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[]; frequentAddons?: { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA"; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[] }): Promise<RecipeWithIngredients> {
    await db.update(recipes)
      .set({
        name: req.name,
        tags: req.tags,
        description: req.description,
        instructions: req.instructions,
      instructionSteps: req.instructionSteps,
        prepTime: req.prepTime,
        imageUrl: req.imageUrl,
        isFavorite: req.isFavorite,
        suggestedRecipeIds: req.suggestedRecipeIds || [],
        suggestedRecipes: (req as any).suggestedRecipes || ((req.suggestedRecipeIds || []).map((recipeId: number) => ({ recipeId, servings: 1 }))),
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
          amount: Math.round(i.amount),
          baseAmount: i.baseAmount ?? i.amount,
          unit: i.unit || "g",
          alternativeAmount: i.alternativeAmount,
          alternativeUnit: i.alternativeUnit,
          scalingType: i.scalingType || "LINEAR",
          scalingFormula: i.scalingFormula,
          stepThresholds: i.stepThresholds,
        }))
      );
    }

    if (req.frequentAddons && req.frequentAddons.length > 0) {
      await db.insert(recipeFrequentAddons).values(
        req.frequentAddons.map((i) => ({
          recipeId: id,
          ingredientId: i.ingredientId,
          amount: Math.round(i.amount),
          baseAmount: i.baseAmount ?? i.amount,
          unit: i.unit || "g",
          alternativeAmount: i.alternativeAmount,
          alternativeUnit: i.alternativeUnit,
          scalingType: i.scalingType || "LINEAR",
          scalingFormula: i.scalingFormula,
          stepThresholds: i.stepThresholds,
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
        cookedBatch: true,
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
        cookedBatch: true,
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
    let cookedBatchId = entry.cookedBatchId;

    if (entry.recipeId && !cookedBatchId) {
      const recipe = await this.getRecipe(Number(entry.recipeId));
      const recipeServings = Number(recipe?.servings) || 1;
      const settings = await this.getUserSettings();
      const manualOnly = !!settings?.A?.sharedBatchesManualOnly;

      if (!manualOnly && recipe && recipeServings > 1) {
        const requestedServings = Number(entry.servings) || 1;
        const activeBatches = await this.getSharedMealBatches();
        const existingBatch = activeBatches.find((batch: any) => (
          Number(batch.recipeId) === Number(entry.recipeId)
          && Number(batch.remainingServings || 0) >= requestedServings
        ));

        if (existingBatch) {
          cookedBatchId = Number(existingBatch.id);
        } else {
          const totalServingsToCook = requestedServings > 0
            ? Math.min(requestedServings, recipeServings)
            : recipeServings;

          const [autoBatch] = await db.insert(sharedMealBatches).values({
            recipeId: Number(entry.recipeId),
            totalServings: totalServingsToCook,
            note: "Auto",
            isArchived: false,
          }).returning();
          cookedBatchId = autoBatch.id;
        }
      }
    }

    const [newEntry] = await db.insert(mealEntries).values({
      ...entry,
      cookedBatchId,
    }).returning();
    
    // If it's a recipe, clone its ingredients to the entry for independent editing
    if (entry.recipeId) {
      const recipe = await this.getRecipe(entry.recipeId);
      if (recipe && recipe.ingredients.length > 0) {
        await db.insert(mealEntryIngredients).values(
          recipe.ingredients.map(ri => ({
            mealEntryId: newEntry.id,
            ingredientId: ri.ingredientId,
            amount: Math.round(Number(ri.baseAmount ?? ri.amount) || 0), // immutable base snapshot
            scalingType: ri.scalingType || "LINEAR"
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

  async updateMealEntryIngredients(mealEntryId: number, ingredientsList: { ingredientId: number; amount: number; scalingType?: "LINEAR" | "FIXED" | "STEP" | "FORMULA" }[]): Promise<void> {
    await db.transaction(async (tx) => {
      // Delete existing and insert new in one transaction
      await tx.delete(mealEntryIngredients).where(eq(mealEntryIngredients.mealEntryId, mealEntryId));
      if (ingredientsList.length > 0) {
        await tx.insert(mealEntryIngredients).values(
          ingredientsList.map(i => ({
            mealEntryId,
            ingredientId: i.ingredientId,
            amount: i.amount,
            scalingType: i.scalingType || "FIXED"
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
            scalingType: ingredient.scalingType || "LINEAR",
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
    const normalizedStart = String(startDate).slice(0, 10);
    const normalizedEnd = String(endDate).slice(0, 10);

    const entries = await db.query.mealEntries.findMany({
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
        cookedBatch: true,
        ingredients: {
          with: {
            ingredient: true
          }
        }
      }
    });

    const rangedEntries = entries.filter((entry) => {
      const dateOnly = String(entry.date || "").slice(0, 10);
      return dateOnly >= normalizedStart && dateOnly <= normalizedEnd;
    });

    return rangedEntries as MealEntryWithRecipe[];
  }

  async getSharedMealBatches(): Promise<any[]> {
    return this.getSharedMealBatchesByArchived(false);
  }

  async getArchivedSharedMealBatches(): Promise<any[]> {
    return this.getSharedMealBatchesByArchived(true);
  }

  private async getSharedMealBatchesByArchived(isArchived: boolean): Promise<any[]> {
    const batches = await db.query.sharedMealBatches.findMany({
      where: eq(sharedMealBatches.isArchived, isArchived),
      with: {
        recipe: {
          with: {
            ingredients: { with: { ingredient: true } },
            frequentAddons: { with: { ingredient: true } },
          },
        },
        mealEntries: true,
        logs: true,
      },
      orderBy: (b, { desc }) => [desc(b.createdAt)],
    });

    return batches.map((batch: any) => {
      const allocatedServings = (batch.mealEntries || []).reduce((sum: number, entry: any) => sum + (Number(entry.servings) || 0), 0);
      return {
        ...batch,
        allocatedServings,
        remainingServings: Math.max(0, (Number(batch.totalServings) || 0) - allocatedServings),
        logs: (batch.logs || []).sort((a: any, b: any) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))),
      };
    });
  }

  async getSharedMealBatchLogs(batchId: number): Promise<SharedMealBatchLog[]> {
    return db.query.sharedMealBatchLogs.findMany({
      where: eq(sharedMealBatchLogs.batchId, batchId),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
    });
  }

  async createSharedMealBatch(input: CreateSharedMealBatchRequest): Promise<SharedMealBatch> {
    const [created] = await db.insert(sharedMealBatches).values({
      recipeId: input.recipeId,
      totalServings: input.totalServings,
      note: input.note,
      isArchived: input.isArchived ?? false,
    }).returning();
    await db.insert(sharedMealBatchLogs).values({
      batchId: created.id,
      action: "CREATED",
      payload: {
        recipeId: created.recipeId,
        totalServings: created.totalServings,
        note: created.note,
      },
    });
    return created;
  }

  async updateSharedMealBatch(id: number, updates: Partial<Pick<SharedMealBatch, "totalServings" | "note">>): Promise<SharedMealBatch> {
    const previous = await db.query.sharedMealBatches.findFirst({ where: eq(sharedMealBatches.id, id) });
    if (!previous) throw new Error("Shared meal batch not found");

    const payload: Partial<SharedMealBatch> = {};
    if (updates.totalServings !== undefined) payload.totalServings = updates.totalServings;
    if (updates.note !== undefined) payload.note = updates.note;

    const [updated] = await db.update(sharedMealBatches).set(payload).where(eq(sharedMealBatches.id, id)).returning();
    if (!updated) throw new Error("Shared meal batch not found");

    await db.insert(sharedMealBatchLogs).values({
      batchId: id,
      action: "UPDATED",
      payload: {
        before: { totalServings: previous.totalServings, note: previous.note },
        after: { totalServings: updated.totalServings, note: updated.note },
      },
    });

    return updated;
  }

  async archiveSharedMealBatch(id: number, isArchived: boolean): Promise<SharedMealBatch> {
    const [updated] = await db.update(sharedMealBatches).set({ isArchived }).where(eq(sharedMealBatches.id, id)).returning();
    if (!updated) throw new Error("Shared meal batch not found");
    await db.insert(sharedMealBatchLogs).values({
      batchId: id,
      action: isArchived ? "ARCHIVED" : "UNARCHIVED",
      payload: { isArchived },
    });
    return updated;
  }

  async deleteSharedMealBatch(id: number): Promise<void> {
    const existing = await db.query.sharedMealBatches.findFirst({ where: eq(sharedMealBatches.id, id) });
    if (!existing) throw new Error("Shared meal batch not found");

    await db.delete(mealEntries).where(eq(mealEntries.cookedBatchId, id));
    await db.delete(sharedMealBatchLogs).where(eq(sharedMealBatchLogs.batchId, id));
    await db.delete(sharedMealBatches).where(eq(sharedMealBatches.id, id));
  }

  async getShoppingListChecks(periodStart: string, periodEnd: string): Promise<Record<number, boolean>> {
    const checks = await db.select().from(shoppingListChecks).where(
      and(
        lte(shoppingListChecks.periodStart, periodStart),
        gte(shoppingListChecks.periodEnd, periodEnd),
      )
    );

    const getPeriodLength = (start: string, end: string) => {
      const startDate = new Date(`${start}T00:00:00Z`);
      const endDate = new Date(`${end}T00:00:00Z`);
      const diff = endDate.getTime() - startDate.getTime();
      return Number.isFinite(diff) && diff >= 0 ? diff : Number.POSITIVE_INFINITY;
    };

    const bestByIngredient = new Map<number, (typeof checks)[number] & { isExact: boolean; periodLength: number }>();

    for (const check of checks) {
      const isExact = check.periodStart === periodStart && check.periodEnd === periodEnd;
      const periodLength = getPeriodLength(check.periodStart, check.periodEnd);
      const existing = bestByIngredient.get(check.ingredientId);

      if (!existing) {
        bestByIngredient.set(check.ingredientId, { ...check, isExact, periodLength });
        continue;
      }

      const isBetterMatch =
        // Exact match for selected range should always win.
        (isExact && !existing.isExact)
        // For same exactness, prefer narrower period (closer to requested range).
        || (isExact === existing.isExact && periodLength < existing.periodLength)
        // For ties, prefer the most recently updated status.
        || (isExact === existing.isExact
          && periodLength === existing.periodLength
          && (check.updatedAt?.getTime() ?? 0) > (existing.updatedAt?.getTime() ?? 0));

      if (isBetterMatch) {
        bestByIngredient.set(check.ingredientId, { ...check, isExact, periodLength });
      }
    }

    return Array.from(bestByIngredient.values()).reduce((acc, curr) => {
      acc[curr.ingredientId] = curr.isChecked;
      return acc;
    }, {} as Record<number, boolean>);
  }

  async toggleShoppingListCheck(ingredientId: number, periodStart: string, periodEnd: string, isChecked: boolean): Promise<void> {
    await db.insert(shoppingListChecks)
      .values({ ingredientId, periodStart, periodEnd, isChecked, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [shoppingListChecks.ingredientId, shoppingListChecks.periodStart, shoppingListChecks.periodEnd],
        set: { isChecked, updatedAt: new Date() }
      });
  }

  async getShoppingListExtras(periodStart: string, periodEnd: string): Promise<any[]> {
    return await db.select().from(shoppingListExtras).where(
      and(
        eq(shoppingListExtras.periodStart, periodStart),
        eq(shoppingListExtras.periodEnd, periodEnd),
      )
    );
  }

  async addShoppingListExtra(periodStart: string, periodEnd: string, input: { name: string; amount?: number; unit?: string; category?: string }): Promise<any> {
    const [created] = await db.insert(shoppingListExtras).values({
      periodStart,
      periodEnd,
      name: input.name,
      amount: input.amount ?? 1,
      unit: input.unit || "szt",
      category: input.category || "Dodatkowe",
    }).returning();
    return created;
  }

  async deleteShoppingListExtra(id: number): Promise<void> {
    await db.delete(shoppingListExtras).where(eq(shoppingListExtras.id, id));
  }

  async toggleShoppingListExtraCheck(id: number, isChecked: boolean): Promise<void> {
    await db.update(shoppingListExtras)
      .set({ isChecked })
      .where(eq(shoppingListExtras.id, id));
  }

  async getShoppingListExcludedItems(periodStart: string, periodEnd: string): Promise<number[]> {
    const rows = await db.select().from(shoppingListExcludedItems).where(
      and(
        lte(shoppingListExcludedItems.periodStart, periodStart),
        gte(shoppingListExcludedItems.periodEnd, periodEnd),
      )
    );

    const bestByIngredient = new Map<number, (typeof rows)[number] & { isExact: boolean; periodLength: number }>();

    const getPeriodLength = (start: string, end: string) => {
      const startDate = new Date(`${start}T00:00:00Z`);
      const endDate = new Date(`${end}T00:00:00Z`);
      const diff = endDate.getTime() - startDate.getTime();
      return Number.isFinite(diff) && diff >= 0 ? diff : Number.POSITIVE_INFINITY;
    };

    for (const row of rows) {
      const isExact = row.periodStart === periodStart && row.periodEnd === periodEnd;
      const periodLength = getPeriodLength(row.periodStart, row.periodEnd);
      const existing = bestByIngredient.get(row.ingredientId);

      if (!existing) {
        bestByIngredient.set(row.ingredientId, { ...row, isExact, periodLength });
        continue;
      }

      const isBetterMatch =
        (isExact && !existing.isExact)
        || (isExact === existing.isExact && periodLength < existing.periodLength)
        || (isExact === existing.isExact
          && periodLength === existing.periodLength
          && (row.updatedAt?.getTime() ?? 0) > (existing.updatedAt?.getTime() ?? 0));

      if (isBetterMatch) {
        bestByIngredient.set(row.ingredientId, { ...row, isExact, periodLength });
      }
    }

    return Array.from(bestByIngredient.keys());
  }

  async setShoppingListExcludedItem(ingredientId: number, periodStart: string, periodEnd: string, excluded: boolean): Promise<void> {
    if (excluded) {
      await db.insert(shoppingListExcludedItems)
        .values({ ingredientId, periodStart, periodEnd, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [shoppingListExcludedItems.ingredientId, shoppingListExcludedItems.periodStart, shoppingListExcludedItems.periodEnd],
          set: { updatedAt: new Date() }
        });
      return;
    }

    await db.delete(shoppingListExcludedItems).where(
      and(
        eq(shoppingListExcludedItems.ingredientId, ingredientId),
        lte(shoppingListExcludedItems.periodStart, periodStart),
        gte(shoppingListExcludedItems.periodEnd, periodEnd),
      )
    );
  }
}

export const storage = new DatabaseStorage();
