import express, { type Express, Request } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { insertRecipeSchema, insertMealEntrySchema, insertIngredientSchema } from "@shared/schema";
import { calculateScaledAmount } from "@shared/scaling";
import multer from "multer";
import path from "path";
import fs from "fs";


const stepThresholdSchema = z.object({
  minServings: z.number().min(0),
  maxServings: z.number().min(0).nullable().optional(),
  amount: z.number().min(0),
});

const recipeIngredientInputSchema = z.object({
  ingredientId: z.number(),
  amount: z.number().min(0),
  baseAmount: z.number().min(0).optional(),
  unit: z.string().min(1).optional(),
  alternativeAmount: z.number().min(0).optional(),
  alternativeUnit: z.string().min(1).optional(),
  scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]).default("LINEAR"),
  scalingFormula: z.string().optional(),
  stepThresholds: z.array(stepThresholdSchema).optional(),
});

const instructionSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("ingredient"),
    text: z.string(),
    ingredientId: z.number(),
    ingredientIds: z.array(z.number()).optional(),
    ingredientSource: z.enum(["ingredient", "frequentAddon"]).optional(),
    multiplier: z.number().positive().optional(),
  }),
]);

const instructionStepSchema = z.object({
  segments: z.array(instructionSegmentSchema),
});

const suggestedRecipeInputSchema = z.object({
  recipeId: z.number(),
  servings: z.number().min(0.1),
});


function resolveIngredientForScaling(entry: any, ingredientRow: any, occurrenceTracker?: Map<number, number>) {
  const ingredientId = Number(ingredientRow?.ingredientId);
  const recipeIngredients = (entry?.recipe?.ingredients || []).filter(
    (ri: any) => Number(ri.ingredientId) === ingredientId,
  );
  const recipeFrequentAddons = (entry?.recipe?.frequentAddons || []).filter(
    (addon: any) => Number(addon.ingredientId) === ingredientId,
  );

  const candidates = [...recipeIngredients, ...recipeFrequentAddons];
  const currentOccurrence = occurrenceTracker
    ? (occurrenceTracker.get(ingredientId) || 0) + 1
    : 1;
  if (occurrenceTracker) occurrenceTracker.set(ingredientId, currentOccurrence);
  const source = candidates[currentOccurrence - 1] || candidates[0] || {};

  return {
    ...source,
    ...ingredientRow,
    baseAmount: Number(
      ingredientRow?.baseAmount
      ?? ingredientRow?.amount
      ?? source?.baseAmount
      ?? source?.amount
      ?? 0,
    ),
    scalingType: ingredientRow?.scalingType ?? source?.scalingType ?? "LINEAR",
    scalingFormula: ingredientRow?.scalingFormula ?? source?.scalingFormula,
    stepThresholds: ingredientRow?.stepThresholds ?? source?.stepThresholds,
  };
}



// Extend Request type for multer
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

// Configure multer for file uploads
const storage_multer = multer.diskStorage({
  destination: function (_req: any, _file: any, cb: any) {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (_req: any, file: any, cb: any) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage_multer });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // File Upload Route
  app.post("/api/upload", upload.single("image"), (req: MulterRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ imageUrl });
  });

  // Serve uploads directory statically
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Ingredients
  app.get(api.ingredients.list.path, async (req, res) => {
    const search = req.query.search as string | undefined;
    const items = await storage.getIngredients(search);
    res.json(items);
  });

  app.post(api.ingredients.create.path, async (req, res) => {
    try {
      const input = insertIngredientSchema.parse(req.body);
      const item = await storage.createIngredient(input);
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  app.patch(api.ingredients.update.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = insertIngredientSchema.partial().parse(req.body);
      const item = await storage.updateIngredient(id, input);
      res.json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  app.delete(api.ingredients.delete.path, async (req, res) => {
    try {
      await storage.deleteIngredient(Number(req.params.id));
      res.status(204).end();
    } catch (err) {
      console.error("Error deleting ingredient:", err);
      res.status(500).json({ message: "Błąd serwera przy usuwaniu składnika" });
    }
  });



  // Recipes
  app.get(api.recipes.list.path, async (req, res) => {
    const search = req.query.search as string | undefined;
    const ingredientId = req.query.ingredientId ? Number(req.query.ingredientId) : undefined;
    let items = await storage.getRecipes(search, ingredientId);
    
    // Get all meal entries to calculate frequencies (shared batches count as single cooking event)
    const allEntries = await storage.getMealEntriesRange("2000-01-01", "2100-01-01");
    const frequencyMap = new Map<number, number>();
    const recipeEventsMap = new Map<number, Set<string>>();
    allEntries.forEach((entry: any) => {
      if (!entry.recipeId || !entry.date) return;
      const recipeId = Number(entry.recipeId);
      const events = recipeEventsMap.get(recipeId) || new Set<string>();
      const batchId = Number(entry.cookedBatchId || 0);
      if (batchId > 0) {
        events.add(`batch:${batchId}`);
      } else {
        events.add(`day:${entry.date}`);
      }
      recipeEventsMap.set(recipeId, events);
    });
    recipeEventsMap.forEach((events, recipeId) => {
      frequencyMap.set(recipeId, events.size);
    });

    const itemsWithStats = items.map(r => {
      const stats = {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        eatCount: frequencyMap.get(r.id) || 0
      };

      r.ingredients.forEach(ri => {
        if (!ri.ingredient) return;
        const scaledAmount = calculateScaledAmount(ri as any, Number(r.servings) || 1, Number(r.servings) || 1);
        const multiplier = scaledAmount / 100;
        stats.calories += ri.ingredient.calories * multiplier;
        stats.protein += ri.ingredient.protein * multiplier;
        stats.carbs += ri.ingredient.carbs * multiplier;
        stats.fat += ri.ingredient.fat * multiplier;
      });

      return {
        ...r,
        ingredients: r.ingredients.map((ri) => ({
          ...ri,
          calculatedAmount: calculateScaledAmount(ri as any, Number(r.servings) || 1, Number(r.servings) || 1),
        })),
        stats: {
          calories: Math.round(stats.calories),
          protein: Math.round(stats.protein),
          carbs: Math.round(stats.carbs),
          fat: Math.round(stats.fat),
          eatCount: stats.eatCount
        }
      };
    });
    
    let filtered = itemsWithStats;
    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(r => 
        (r.name && r.name.toLowerCase().includes(lowerSearch)) || 
        r.ingredients.some(ri => ri.ingredient && ri.ingredient.name.toLowerCase().includes(lowerSearch))
      );
    }
    
    res.json(filtered);
  });

  app.get(api.recipes.get.path, async (req, res) => {
    const item = await storage.getRecipe(Number(req.params.id));
    if (!item) return res.status(404).json({ message: "Not found" });
    const baseServings = Number(item.servings) || 1;
    const recipeWithCalculated = {
      ...item,
      ingredients: item.ingredients.map((ri) => ({
        ...ri,
        calculatedAmount: calculateScaledAmount(ri as any, baseServings, baseServings),
      })),
    };
    res.json(recipeWithCalculated);
  });

  app.post(api.recipes.create.path, async (req, res) => {
    try {
      // Manual schema composition for validation
      const input = z.object({
        name: z.string().min(1),
        tags: z.array(z.string()).optional().default([]),
        description: z.string().optional(),
        instructions: z.string().optional(),
        instructionSteps: z.array(instructionStepSchema).optional(),
        prepTime: z.number().optional(),
        imageUrl: z.string().optional(),
        isFavorite: z.boolean().optional().default(false),
        servings: z.number().min(0.1).default(1),
        suggestedRecipeIds: z.array(z.number()).optional().default([]),
        suggestedRecipes: z.array(suggestedRecipeInputSchema).optional().default([]),
        ingredients: z.array(recipeIngredientInputSchema),
        frequentAddons: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
          baseAmount: z.number().min(0).optional(),
          unit: z.string().min(1).optional(),
          alternativeAmount: z.number().min(0).optional(),
          alternativeUnit: z.string().min(1).optional(),
          scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]).default("LINEAR"),
          scalingFormula: z.string().optional(),
          stepThresholds: z.array(stepThresholdSchema).optional(),
        })).optional().default([]),
      }).parse(req.body);
      
      const item = await storage.createRecipe(input);
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  app.patch(api.recipes.update.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = z.object({
        name: z.string().min(1),
        tags: z.array(z.string()).optional().default([]),
        description: z.string().optional(),
        instructions: z.string().optional(),
        instructionSteps: z.array(instructionStepSchema).optional(),
        prepTime: z.number().optional(),
        imageUrl: z.string().optional(),
        isFavorite: z.boolean().optional(),
        servings: z.number().min(0.1).optional(),
        suggestedRecipeIds: z.array(z.number()).optional().default([]),
        suggestedRecipes: z.array(suggestedRecipeInputSchema).optional().default([]),
        ingredients: z.array(recipeIngredientInputSchema),
        frequentAddons: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
          baseAmount: z.number().min(0).optional(),
          unit: z.string().min(1).optional(),
          alternativeAmount: z.number().min(0).optional(),
          alternativeUnit: z.string().min(1).optional(),
          scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]).default("LINEAR"),
          scalingFormula: z.string().optional(),
          stepThresholds: z.array(stepThresholdSchema).optional(),
        })).optional().default([]),
      }).parse(req.body);
      
      const item = await storage.updateRecipe(id, input);
      res.json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  app.delete(api.recipes.delete.path, async (req, res) => {
    await storage.deleteRecipe(Number(req.params.id));
    res.status(204).end();
  });

  // Meal Plan
  app.get(api.mealPlan.getDay.path, async (req, res) => {
    const date = req.params.date;
    const entries = await storage.getDayEntries(date);
    
    // Calculate summaries
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalPrice = 0;

    entries.forEach(entry => {
      // Use entry-specific ingredients if they exist, inaczej fallback do domyślnych przepisu
      const ingredientsToUse = entry.ingredients && entry.ingredients.length > 0 
        ? entry.ingredients 
        : (entry.recipe?.ingredients || []);

      const entryServings = Number(entry.servings) || 1;
      const recipeServings = Number(entry.recipe?.servings || 1);

      if (ingredientsToUse.length > 0) {
        const occurrenceTracker = new Map<number, number>();
        ingredientsToUse.forEach(ri => {
          if (!ri.ingredient) return;
          const scaledAmount = calculateScaledAmount(resolveIngredientForScaling(entry, ri, occurrenceTracker), entryServings, recipeServings);
          const multiplier = scaledAmount / 100;
          totalCalories += (ri.ingredient.calories * multiplier);
          totalProtein += (ri.ingredient.protein * multiplier);
          totalCarbs += (ri.ingredient.carbs * multiplier);
          totalFat += (ri.ingredient.fat * multiplier);
          totalPrice += (ri.ingredient.price || 0) * multiplier;
        });
      } else if (entry.customCalories !== null) {
        totalCalories += (entry.customCalories || 0) * entryServings;
        totalProtein += (entry.customProtein || 0) * entryServings;
        totalCarbs += (entry.customCarbs || 0) * entryServings;
        totalFat += (entry.customFat || 0) * entryServings;
      }
    });

    const entriesWithCalculated = entries.map((entry) => {
      const entryServings = Number(entry.servings) || 1;
      const recipeServings = Number(entry.recipe?.servings || 1);
      return {
        ...entry,
        ingredients: (() => {
          const occurrenceTracker = new Map<number, number>();
          return (entry.ingredients || []).map((ri: any) => ({
            ...ri,
            calculatedAmount: calculateScaledAmount(resolveIngredientForScaling(entry, ri, occurrenceTracker), entryServings, recipeServings),
          }));
        })(),
        recipe: entry.recipe
          ? {
              ...entry.recipe,
              ingredients: (() => {
                const occurrenceTracker = new Map<number, number>();
                return (entry.recipe.ingredients || []).map((ri: any) => ({
                  ...ri,
                  calculatedAmount: calculateScaledAmount(resolveIngredientForScaling(entry, ri, occurrenceTracker), entryServings, recipeServings),
                }));
              })(),
            }
          : entry.recipe,
      };
    });

    res.json({
      date,
      totalCalories: Math.round(totalCalories),
      totalProtein: Math.round(totalProtein),
      totalCarbs: Math.round(totalCarbs),
      totalFat: Math.round(totalFat),
      totalPrice: Math.round(totalPrice * 100) / 100,
      entries: entriesWithCalculated
    });
  });

  app.post(api.mealPlan.addEntry.path, async (req, res) => {
    try {
      const input = insertMealEntrySchema.parse(req.body);
      const entry = await storage.createMealEntry(input);
      res.status(201).json(entry);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  app.post(api.mealPlan.copyDay.path, async (req, res) => {
    try {
      const { sourceDate, targetDate, replaceTarget } = api.mealPlan.copyDay.input.parse(req.body);

      if (!sourceDate || !targetDate) {
        return res.status(400).json({ message: "Wymagane daty źródłowa i docelowa" });
      }

      const copiedEntries = await storage.copyDayEntries(sourceDate, targetDate, replaceTarget);
      res.json({ copiedEntries });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }

      if (err instanceof Error) {
        return res.status(400).json({ message: err.message });
      }

      res.status(500).json({ message: "Błąd serwera" });
    }
  });

  app.get(api.sharedMeals.list.path, async (_req, res) => {
    const batches = await storage.getSharedMealBatches();
    res.json(batches);
  });

  app.post(api.sharedMeals.createBatch.path, async (req, res) => {
    try {
      const input = api.sharedMeals.createBatch.input.parse(req.body);
      const batch = await storage.createSharedMealBatch(input as any);
      res.status(201).json(batch);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  app.patch(api.sharedMeals.archiveBatch.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { isArchived } = api.sharedMeals.archiveBatch.input.parse(req.body || {});
      const batch = await storage.archiveSharedMealBatch(id, isArchived);
      res.json(batch);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      if (err instanceof Error && err.message.includes("not found")) {
        return res.status(404).json({ message: "Nie znaleziono partii" });
      }
      throw err;
    }
  });

  app.patch("/api/meal-plan/entry/:id", async (req, res) => {

    try {
      const id = Number(req.params.id);
      const { ingredients: ingredientsList, ...updates } = req.body;
      
      // Ensure we only pass fields that exist in the schema to storage.updateMealEntry
      const finalUpdates: any = {};
      const allowedFields = ['servings', 'isEaten', 'person', 'customName', 'customCalories', 'customProtein', 'customCarbs', 'customFat', 'date', 'mealType', 'cookedBatchId'];
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          finalUpdates[field] = updates[field];
        }
      }

      const hasEntryUpdates = Object.keys(finalUpdates).length > 0;
      const hasIngredientUpdates = ingredientsList !== undefined;

      if (!hasEntryUpdates && !hasIngredientUpdates) {
        return res.status(400).json({ message: "Brak danych do aktualizacji" });
      }

      // Update meal entry fields only when there is anything to set.
      let entry = await storage.getMealEntryById(id);
      if (!entry) {
        return res.status(404).json({ message: "Nie znaleziono wpisu posiłku" });
      }

      if (hasEntryUpdates) {
        await storage.updateMealEntry(id, finalUpdates);
      }

      // Then update ingredients if provided
      if (hasIngredientUpdates) {
        await storage.updateMealEntryIngredients(id, ingredientsList);
      }

      // Force database to clear any relation caches by re-fetching everything
      entry = await storage.getMealEntryById(id);
      if (!entry) {
        return res.status(404).json({ message: "Nie znaleziono wpisu posiłku" });
      }

      console.log("Updated entry sent to client:", JSON.stringify(entry));
      res.json(entry);
    } catch (err) {
      console.error("Error updating meal entry:", err);
      res.status(500).json({ message: "Błąd serwera: " + (err instanceof Error ? err.message : String(err)) });
    }
  });

  app.delete(api.mealPlan.deleteEntry.path, async (req, res) => {
    await storage.deleteMealEntry(Number(req.params.id));
    res.status(204).end();
  });

  app.get(api.mealPlan.getShoppingList.path, async (req, res) => {
    const rangeParse = z.object({
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }).safeParse(req.query);

    if (!rangeParse.success) {
      return res.status(400).json({ message: "Brak wymaganego zakresu dat" });
    }

    const safeScaledAmount = (entry: any, ri: any, occurrenceTracker: Map<number, number>) => {
      try {
        const entryServings = Number(entry?.servings) > 0 ? Number(entry.servings) : 1;
        const recipeServings = Number(entry?.recipe?.servings) > 0 ? Number(entry.recipe.servings) : 1;
        const amount = calculateScaledAmount(
          resolveIngredientForScaling(entry, ri, occurrenceTracker),
          entryServings,
          recipeServings,
        );
        return Number.isFinite(amount) && amount >= 0 ? amount : 0;
      } catch (error) {
        console.warn("Skipping invalid shopping-list ingredient scaling", {
          ingredientId: ri?.ingredientId,
          entryId: entry?.id,
          error,
        });
        return Number(ri?.amount) > 0 ? Number(ri.amount) : 0;
      }
    };

    const { startDate, endDate } = rangeParse.data;
    const entries = await storage.getMealEntriesRange(startDate, endDate);
    const excludedItems = new Set(await storage.getShoppingListExcludedItems(startDate, endDate));

    const shoppingMap = new Map<number, { name: string, amount: number, unit: string, category: string, unitWeight: number | null }>();

    for (const entry of entries.filter((item) => item.isEaten !== true)) {
      const entryIngredients = (entry.ingredients || []).filter((ri: any) => !!ri?.ingredient);
      const recipeIngredientsFromRange = [
        ...(entry.recipe?.ingredients || []),
        ...(entry.recipe?.frequentAddons || []),
      ].filter((ri: any) => !!ri?.ingredient);

      let ingredientsToUse = entryIngredients.length > 0 ? entryIngredients : recipeIngredientsFromRange;

      if (ingredientsToUse.length === 0 && entry.recipeId) {
        const recipeFallback = await storage.getRecipe(Number(entry.recipeId));
        ingredientsToUse = [
          ...(recipeFallback?.ingredients || []),
          ...(recipeFallback?.frequentAddons || []),
        ].filter((ri: any) => !!ri?.ingredient);
      }

      if (ingredientsToUse.length === 0) {
        console.warn("Meal entry skipped in shopping list due to missing ingredients", {
          entryId: entry.id,
          recipeId: entry.recipeId,
        });
      }

      const occurrenceTracker = new Map<number, number>();
      for (const ri of ingredientsToUse) {
        const ingredientId = Number(ri?.ingredientId);
        if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
          continue;
        }

        const existing = shoppingMap.get(ingredientId);
        const amount = safeScaledAmount(entry, ri, occurrenceTracker);
        if (existing) {
          existing.amount += amount;
        } else {
          shoppingMap.set(ingredientId, {
            name: (ri.ingredient as any).name,
            amount,
            unit: "g",
            category: (ri.ingredient as any).category || "Inne",
            unitWeight: (ri.ingredient as any).unitWeight
          });
        }
      }
    }

    const list = Array.from(shoppingMap.entries()).map(([id, val]) => ({
      ingredientId: id,
      name: val.name,
      totalAmount: Number.isFinite(val.amount) && val.amount > 0 ? val.amount : 0,
      unit: val.unit,
      category: val.category,
      unitWeight: val.unitWeight,
      isChecked: false,
      isExcluded: excludedItems.has(id),
    }));

    const extras = await storage.getShoppingListExtras(startDate, endDate);
    const normalizedExtras = extras.map((extra) => ({
      ingredientId: -extra.id,
      extraId: extra.id,
      name: extra.name,
      totalAmount: Number(extra.amount || 1),
      unit: extra.unit || "szt",
      category: extra.category || "Dodatkowe",
      unitWeight: null,
      isChecked: !!extra.isChecked,
      isExtra: true,
    }));

    res.json([...list, ...normalizedExtras]);
  });

  app.get("/api/shopping-list/checks", async (req, res) => {
    const input = z.object({
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }).safeParse(req.query);

    if (!input.success) {
      return res.json({});
    }
    const checks = await storage.getShoppingListChecks(input.data.startDate, input.data.endDate);
    res.json(checks);
  });

  app.post("/api/shopping-list/checks", async (req, res) => {
    const input = z.object({
      ingredientId: z.number(),
      isChecked: z.boolean(),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }).safeParse(req.body);

    if (!input.success) {
      return res.status(400).json({ message: "Niepoprawne dane" });
    }
    await storage.toggleShoppingListCheck(input.data.ingredientId, input.data.startDate, input.data.endDate, input.data.isChecked);
    res.json({ success: true });
  });

  app.post("/api/shopping-list/extras", async (req, res) => {
    const input = z.object({
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      name: z.string().min(1),
      amount: z.number().positive().optional(),
      unit: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
    }).safeParse(req.body);

    if (!input.success) {
      return res.status(400).json({ message: "Niepoprawne dane" });
    }
    const extra = await storage.addShoppingListExtra(input.data.startDate, input.data.endDate, {
      name: input.data.name,
      amount: input.data.amount,
      unit: input.data.unit,
      category: input.data.category,
    });
    res.status(201).json(extra);
  });

  app.patch("/api/shopping-list/extras/:id", async (req, res) => {
    const id = Number(req.params.id);
    const input = z.object({ isChecked: z.boolean() }).parse(req.body);
    await storage.toggleShoppingListExtraCheck(id, input.isChecked);
    res.json({ success: true });
  });

  app.delete("/api/shopping-list/extras/:id", async (req, res) => {
    await storage.deleteShoppingListExtra(Number(req.params.id));
    res.status(204).end();
  });

  app.get("/api/shopping-list/exclusions", async (req, res) => {
    const input = z.object({
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }).safeParse(req.query);

    if (!input.success) {
      return res.json([]);
    }

    const excluded = await storage.getShoppingListExcludedItems(input.data.startDate, input.data.endDate);
    res.json(excluded);
  });

  app.post("/api/shopping-list/exclusions", async (req, res) => {
    const input = z.object({
      ingredientId: z.number(),
      excluded: z.boolean(),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
    }).safeParse(req.body);

    if (!input.success) {
      return res.status(400).json({ message: "Niepoprawne dane" });
    }
    await storage.setShoppingListExcludedItem(input.data.ingredientId, input.data.startDate, input.data.endDate, input.data.excluded);
    res.json({ success: true });
  });

  // User Settings
  app.get("/api/user-settings", async (req, res) => {
    const settings = await storage.getUserSettings();
    res.json(settings);
  });

  app.patch("/api/user-settings", async (req, res) => {
    try {
      const input = z.object({
        person: z.enum(["A", "B"]),
        targetCalories: z.number().optional(),
        targetProtein: z.number().optional(),
        targetCarbs: z.number().optional(),
        targetFat: z.number().optional(),
      }).parse(req.body);

      const { person, ...updates } = input;
      const settings = await storage.updateUserSettings(person, updates);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }
  });

  // Seeding
  const existingIngredients = await storage.getIngredients();
  if (existingIngredients.length === 0) {
    console.log("Seeding database...");
    
    // Ingredients
    const chicken = await storage.createIngredient({ name: "Pierś z kurczaka", calories: 165, protein: 31, carbs: 0, fat: 3.6, unit: "g", imageUrl: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500&auto=format&fit=crop&q=60" });
    const rice = await storage.createIngredient({ name: "Ryż basmati", calories: 350, protein: 7, carbs: 77, fat: 1, unit: "g", imageUrl: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500&auto=format&fit=crop&q=60" });
    const broccoli = await storage.createIngredient({ name: "Brokuły", calories: 34, protein: 2.8, carbs: 7, fat: 0.4, unit: "g", imageUrl: "https://images.unsplash.com/photo-1459411621453-7b03977f4bef?w=500&auto=format&fit=crop&q=60" });
    const oliveOil = await storage.createIngredient({ name: "Oliwa z oliwek", calories: 884, protein: 0, carbs: 0, fat: 100, unit: "ml", imageUrl: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500&auto=format&fit=crop&q=60" });
    const oatmeal = await storage.createIngredient({ name: "Płatki owsiane", calories: 389, protein: 16.9, carbs: 66.3, fat: 6.9, unit: "g", imageUrl: "https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=500&auto=format&fit=crop&q=60" });
    const milk = await storage.createIngredient({ name: "Mleko 2%", calories: 50, protein: 3.4, carbs: 4.8, fat: 2, unit: "ml", imageUrl: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=500&auto=format&fit=crop&q=60" });
    const apple = await storage.createIngredient({ name: "Jabłko", calories: 52, protein: 0.3, carbs: 14, fat: 0.2, unit: "szt", imageUrl: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=500&auto=format&fit=crop&q=60" });

  

  // Recipes
    const chickenRecipe = await storage.createRecipe({
      name: "Kurczak z ryżem i warzywami",
      description: "Klasyczne danie kulturysty. Proste, szybkie i zdrowe.",
      instructions: "1. Ugotuj ryż. 2. Kurczaka pokrój w kostkę i usmaż na oliwie. 3. Dodaj brokuły i duś pod przykryciem.",
      prepTime: 25,
      imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=60",
      ingredients: [
        { ingredientId: chicken.id, amount: 200 },
        { ingredientId: rice.id, amount: 100 },
        { ingredientId: broccoli.id, amount: 150 },
        { ingredientId: oliveOil.id, amount: 10 }
      ]
    });

    const porridge = await storage.createRecipe({
      name: "Owsianka z jabłkiem",
      description: "Idealne śniadanie na start dnia. Pełne błonnika.",
      instructions: "1. Zagotuj mleko. 2. Dodaj płatki i gotuj na wolnym ogniu. 3. Dodaj pokrojone jabłko na koniec.",
      prepTime: 10,
      imageUrl: "https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=500&auto=format&fit=crop&q=60",
      ingredients: [
        { ingredientId: oatmeal.id, amount: 60 },
        { ingredientId: milk.id, amount: 200 },
        { ingredientId: apple.id, amount: 1 }
      ]
    });
    
    // Sample Meal Plan for today
    const today = new Date().toISOString().split('T')[0];
    await storage.createMealEntry({
      date: today,
      recipeId: porridge.id,
      mealType: "breakfast",
      isEaten: false
    });
    
    console.log("Database seeded successfully!");
  }

  return httpServer;
}
