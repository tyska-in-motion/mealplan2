import type { Ingredient, InstructionStep } from "@shared/schema";
import type { AiChefInput, AiChefResponse, AiChefIngredientDataSource } from "./types";

const QUESTION_BANK = {
  diet: ["bez ograniczeń", "wegetariańska", "wegańska", "high-protein", "low-carb"],
  difficulty: ["łatwy", "średni", "zaawansowany"],
  maxPrepTimeMinutes: [15, 25, 40, 60],
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function getAmount(unit: string, baseMultiplier: number): number {
  if (unit === "szt") return Math.max(1, Math.round(baseMultiplier));
  return Math.max(20, Math.round(baseMultiplier * 100));
}

function ingredientScore(item: Ingredient, mainIngredient: string): number {
  const name = normalize(item.name);
  let score = (Number(item.protein) || 0) + (Number(item.carbs) || 0) * 0.2 - (Number(item.fat) || 0) * 0.1;
  if (name.includes(mainIngredient)) score += 1000;
  if (item.alwaysAtHome) score += 100;
  return score;
}

function buildInstructionSteps(steps: string[], selected: Ingredient[]): InstructionStep[] {
  const main = selected[0];
  return steps.map((step, idx) => {
    if (idx === 0 && main) {
      return {
        segments: [
          { type: "text", text: "Przygotuj " },
          { type: "ingredient", text: main.name, ingredientId: main.id, multiplier: 1 },
          { type: "text", text: " i odmierz resztę składników." },
        ],
      };
    }
    return { segments: [{ type: "text", text: step }] };
  });
}

export async function generateAiChefRecipe(input: AiChefInput, datasource: AiChefIngredientDataSource): Promise<AiChefResponse> {
  if (!input.answers) {
    return {
      phase: "questions",
      followUpQuestion: "Doprecyzuj proszę preferencje, żebym dobrał najlepszy przepis.",
      questions: QUESTION_BANK,
    };
  }

  const allIngredients = await datasource.getAllIngredients();
  const userIngredients = await datasource.getUserIngredients();
  const mainIngredient = normalize(input.mainIngredient);

  const sorted = [...allIngredients].sort((a, b) => ingredientScore(b, mainIngredient) - ingredientScore(a, mainIngredient));
  const selected = sorted.slice(0, 8);

  if (!selected.some((item) => normalize(item.name).includes(mainIngredient))) {
    const matched = allIngredients.find((item) => normalize(item.name).includes(mainIngredient));
    if (matched) {
      selected.pop();
      selected.unshift(matched);
    }
  }

  const targetTotalCalories = input.targetCaloriesPerServing * input.servings;
  const caloriesPer100Total = selected.reduce((acc, item) => acc + (Number(item.calories) || 0), 0) || 1;
  const multiplier = targetTotalCalories / caloriesPer100Total;

  const userIngredientIds = new Set(userIngredients.map((item) => item.id));

  const ingredients = selected.map((item) => {
    const amount = getAmount(item.unit || "g", multiplier);
    return {
      ingredientId: item.id,
      name: item.name,
      amount,
      unit: item.unit || "g",
      fromUserStock: userIngredientIds.has(item.id),
      toBuy: !userIngredientIds.has(item.id),
    };
  });

  const estimatedTotalCalories = ingredients.reduce((acc, item) => {
    const source = selected.find((s) => s.id === item.ingredientId);
    if (!source) return acc;
    const localMultiplier = item.unit === "szt" ? item.amount : item.amount / 100;
    return acc + (Number(source.calories) || 0) * localMultiplier;
  }, 0);

  const missingIngredients = ingredients
    .filter((item) => item.toBuy)
    .map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      reason: "do dokupienia",
    }));

  const prepTime = input.answers.maxPrepTimeMinutes;
  const steps = [
    `Przygotuj wszystkie składniki i odmierz porcje dla ${input.servings} porcji.`,
    `Obrób główny składnik (${input.mainIngredient}) zgodnie z poziomem trudności: ${input.answers.difficulty}.`,
    "Dodawaj kolejne składniki partiami, zaczynając od tych z bazy użytkownika.",
    "Dopraw do wybranej diety i preferencji smakowych.",
    `Podawaj od razu. Szacunkowo ${round(estimatedTotalCalories / input.servings)} kcal / porcję.`,
  ];

  const instructionSteps = buildInstructionSteps(steps, selected);
  const recipeName = `AI Chef: ${input.mainIngredient} (${input.answers.diet})`;

  return {
    phase: "recipe",
    recipe: {
      name: recipeName,
      description: `Przepis wygenerowany pod ${input.answers.diet}, trudność: ${input.answers.difficulty}, max ${prepTime} min.`,
      servings: input.servings,
      estimatedCaloriesPerServing: round(estimatedTotalCalories / input.servings),
      ingredients,
      steps,
      instructionSteps,
    },
    recipeDraft: {
      name: recipeName,
      description: `Wygenerowane przez AI Chef. Alergie: ${input.answers.allergies || "brak"}.`,
      instructions: steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      instructionSteps,
      prepTime,
      servings: input.servings,
      tags: ["ai-chef", input.answers.diet, input.answers.difficulty],
      ingredients: ingredients.map((item) => ({
        ingredientId: item.ingredientId!,
        amount: item.amount,
        baseAmount: item.amount,
        unit: item.unit,
        scalingType: "LINEAR",
      })),
    },
    missingIngredients,
    usedUserIngredientsFirst: true,
  };
}
