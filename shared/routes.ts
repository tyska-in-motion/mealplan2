
import { z } from 'zod';
import { 
  insertIngredientSchema, 
  insertRecipeSchema, 
  insertMealEntrySchema, 
  insertRecipeIngredientSchema,
  ingredients, 
  recipes, 
  mealEntries 
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

const stepThresholdSchema = z.object({
  minServings: z.number().min(0),
  maxServings: z.number().min(0).nullable().optional(),
  amount: z.number().min(0),
});

const recipeIngredientInputSchema = z.object({
  ingredientId: z.number(),
  amount: z.number(),
  baseAmount: z.number().optional(),
  unit: z.string().optional(),
  scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]).optional().default("LINEAR"),
  scalingFormula: z.string().optional(),
  stepThresholds: z.array(stepThresholdSchema).optional(),
});

const instructionSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("ingredient"), text: z.string(), ingredientId: z.number(), multiplier: z.number().positive().optional() }),
]);

const instructionStepSchema = z.object({
  segments: z.array(instructionSegmentSchema),
});

export const api = {
  ai: {
    generateRecipe: {
      method: 'POST' as const,
      path: '/api/ai/recipe',
      input: z.object({
        mainIngredient: z.string().min(1),
        servings: z.number().int().min(1).max(12),
        targetCaloriesPerServing: z.number().min(100).max(2000),
        answers: z.object({
          diet: z.string().min(1),
          difficulty: z.string().min(1),
          maxPrepTimeMinutes: z.number().int().min(5).max(240),
          allergies: z.string().optional(),
        }).optional(),
      }),
      responses: {
        200: z.discriminatedUnion("phase", [
          z.object({
            phase: z.literal("questions"),
            followUpQuestion: z.string(),
            questions: z.object({
              diet: z.array(z.string()).min(1),
              difficulty: z.array(z.string()).min(1),
              maxPrepTimeMinutes: z.array(z.number()).min(1),
            }),
          }),
          z.object({
            phase: z.literal("recipe"),
            recipe: z.object({
              name: z.string(),
              description: z.string(),
              servings: z.number(),
              estimatedCaloriesPerServing: z.number(),
              ingredients: z.array(z.object({
                ingredientId: z.number().nullable(),
                name: z.string(),
                amount: z.number(),
                unit: z.string(),
                fromUserStock: z.boolean(),
                toBuy: z.boolean(),
              })),
              steps: z.array(z.string()),
              instructionSteps: z.array(instructionStepSchema),
            }),
            recipeDraft: z.object({
              name: z.string(),
              description: z.string(),
              instructions: z.string(),
              instructionSteps: z.array(instructionStepSchema),
              prepTime: z.number(),
              servings: z.number(),
              tags: z.array(z.string()),
              ingredients: z.array(z.object({
                ingredientId: z.number(),
                amount: z.number(),
                baseAmount: z.number(),
                unit: z.string(),
                scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]),
              })),
            }),
            missingIngredients: z.array(z.object({
              ingredientId: z.number(),
              name: z.string(),
              reason: z.string(),
            })),
            usedUserIngredientsFirst: z.boolean(),
          }),
        ]),
        400: errorSchemas.validation,
      },
    },
  },
  ingredients: {
    list: {
      method: 'GET' as const,
      path: '/api/ingredients',
      input: z.object({
        search: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof ingredients.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/ingredients',
      input: insertIngredientSchema,
      responses: {
        201: z.custom<typeof ingredients.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/ingredients/:id',
      responses: {
        200: z.custom<typeof ingredients.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/ingredients/:id',
      input: insertIngredientSchema.partial(),
      responses: {
        200: z.custom<typeof ingredients.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/ingredients/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    }
  },
  recipes: {
    list: {
      method: 'GET' as const,
      path: '/api/recipes',
      input: z.object({
        search: z.string().optional(),
        ingredientId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<any>()), // Returns RecipeWithIngredients
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/recipes',
      input: insertRecipeSchema.extend({
        instructionSteps: z.array(instructionStepSchema).optional(),
        servings: z.number().min(0.1).default(1),
        ingredients: z.array(recipeIngredientInputSchema),
        frequentAddons: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
        })).optional().default([]),
      }),
      responses: {
        201: z.custom<any>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/recipes/:id',
      responses: {
        200: z.custom<any>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/recipes/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/recipes/:id',
      input: insertRecipeSchema.extend({
        instructionSteps: z.array(instructionStepSchema).optional(),
        servings: z.number().min(0.1).optional(),
        ingredients: z.array(recipeIngredientInputSchema),
        frequentAddons: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
        })).optional().default([]),
      }),
      responses: {
        200: z.custom<any>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    }
  },
  mealPlan: {
    getDay: {
      method: 'GET' as const,
      path: '/api/meal-plan/:date',
      responses: {
        200: z.custom<any>(), // DaySummary
      },
    },
    addEntry: {
      method: 'POST' as const,
      path: '/api/meal-plan',
      input: insertMealEntrySchema,
      responses: {
        201: z.custom<typeof mealEntries.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    copyDay: {
      method: 'POST' as const,
      path: '/api/meal-plan/copy-day',
      input: z.object({
        sourceDate: z.string(),
        targetDate: z.string(),
        replaceTarget: z.boolean().optional().default(true),
      }),
      responses: {
        200: z.object({ copiedEntries: z.number() }),
        400: errorSchemas.validation,
      },
    },
    toggleEaten: {
      method: 'PATCH' as const,
      path: '/api/meal-plan/:id/toggle',
      input: z.object({ isEaten: z.boolean() }),
      responses: {
        200: z.custom<typeof mealEntries.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    deleteEntry: {
      method: 'DELETE' as const,
      path: '/api/meal-plan/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    updateEntry: {
      method: 'PATCH' as const,
      path: '/api/meal-plan/entry/:id',
      input: z.object({
        servings: z.number().optional(),
        isEaten: z.boolean().optional(),
        person: z.enum(["A", "B"]).optional(),
        ingredients: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
        })).optional(),
      }).passthrough(),
      responses: {
        200: z.custom<any>(),
        404: errorSchemas.notFound,
      },
    },
    getShoppingList: {
      method: 'GET' as const,
      path: '/api/shopping-list',
      input: z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
      responses: {
        200: z.array(z.custom<any>()), // ShoppingListItem[]
      },
    },
  },
  userSettings: {
    get: {
      path: "/api/user-settings",
      method: "GET"
    },
    update: {
      path: "/api/user-settings",
      method: "PATCH"
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
