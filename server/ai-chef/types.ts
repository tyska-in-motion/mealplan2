import type { Ingredient, InstructionStep } from "@shared/schema";

export type AiChefInput = {
  mainIngredient: string;
  servings: number;
  targetCaloriesPerServing: number;
  answers?: {
    diet: string;
    difficulty: string;
    maxPrepTimeMinutes: number;
    allergies?: string;
  };
};

export type AiChefQuestionsResponse = {
  phase: "questions";
  followUpQuestion: string;
  questions: {
    diet: string[];
    difficulty: string[];
    maxPrepTimeMinutes: number[];
  };
};

export type AiChefRecipeResponse = {
  phase: "recipe";
  recipe: {
    name: string;
    description: string;
    servings: number;
    estimatedCaloriesPerServing: number;
    ingredients: {
      ingredientId: number | null;
      name: string;
      amount: number;
      unit: string;
      fromUserStock: boolean;
      toBuy: boolean;
    }[];
    steps: string[];
    instructionSteps: InstructionStep[];
  };
  recipeDraft: {
    name: string;
    description: string;
    instructions: string;
    instructionSteps: InstructionStep[];
    prepTime: number;
    servings: number;
    tags: string[];
    ingredients: {
      ingredientId: number;
      amount: number;
      baseAmount: number;
      unit: string;
      scalingType: "LINEAR";
    }[];
  };
  missingIngredients: {
    ingredientId: number;
    name: string;
    reason: string;
  }[];
  usedUserIngredientsFirst: boolean;
};

export type AiChefResponse = AiChefQuestionsResponse | AiChefRecipeResponse;

export interface AiChefIngredientDataSource {
  getUserIngredients(): Promise<Ingredient[]>;
  getAllIngredients(): Promise<Ingredient[]>;
}
