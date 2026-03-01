
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

export const api = {
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
        servings: z.number().min(0.1).default(1),
        ingredients: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
        })),
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
        servings: z.number().min(0.1).optional(),
        ingredients: z.array(z.object({
          ingredientId: z.number(),
          amount: z.number(),
        })),
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
