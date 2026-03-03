import type { InstructionStep } from "@shared/schema";
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

function buildInstructionSteps(steps: string[]): InstructionStep[] {
  return steps.map((step) => ({ segments: [{ type: "text", text: step }] }));
}

const KITCHEN_BASE = [
  { name: "oliwa z oliwek", unit: "g", amountPerServing: 8, kcalPerUnit: 8.84 },
  { name: "sól", unit: "g", amountPerServing: 1, kcalPerUnit: 0 },
  { name: "pieprz czarny", unit: "g", amountPerServing: 0.5, kcalPerUnit: 2.5 },
  { name: "czosnek", unit: "g", amountPerServing: 6, kcalPerUnit: 1.49 },
  { name: "cebula", unit: "g", amountPerServing: 40, kcalPerUnit: 0.4 },
  { name: "pomidory krojone", unit: "g", amountPerServing: 90, kcalPerUnit: 0.18 },
  { name: "jogurt naturalny", unit: "g", amountPerServing: 40, kcalPerUnit: 0.61 },
  { name: "ryż basmati", unit: "g", amountPerServing: 55, kcalPerUnit: 3.6 },
  { name: "kasza bulgur", unit: "g", amountPerServing: 55, kcalPerUnit: 3.4 },
  { name: "ziemniaki", unit: "g", amountPerServing: 180, kcalPerUnit: 0.77 },
  { name: "papryka czerwona", unit: "g", amountPerServing: 70, kcalPerUnit: 0.31 },
  { name: "cukinia", unit: "g", amountPerServing: 100, kcalPerUnit: 0.17 },
  { name: "szpinak", unit: "g", amountPerServing: 60, kcalPerUnit: 0.23 },
  { name: "sok z cytryny", unit: "g", amountPerServing: 8, kcalPerUnit: 0.22 },
  { name: "natka pietruszki", unit: "g", amountPerServing: 4, kcalPerUnit: 0.36 },
];

function getMainIngredientKcal(mainIngredient: string): number {
  const main = normalize(mainIngredient);
  if (main.includes("łoso") || main.includes("makrela")) return 2.0;
  if (main.includes("tuńczyk") || main.includes("dorsz")) return 1.2;
  if (main.includes("tofu")) return 1.4;
  if (main.includes("ciecierzy") || main.includes("fasol")) return 1.6;
  if (main.includes("wołow")) return 2.4;
  if (main.includes("wieprz")) return 2.7;
  if (main.includes("indyk") || main.includes("kurcz")) return 1.65;
  return 1.8;
}

function getBaseIngredients(mainIngredient: string, diet: string) {
  const main = normalize(mainIngredient);
  const normalizedDiet = normalize(diet);
  const proteinAmount = normalizedDiet.includes("high-protein") ? 190 : 160;

  const ingredients = [
    { name: mainIngredient, amount: proteinAmount, unit: "g", kcalPerUnit: getMainIngredientKcal(main) },
    KITCHEN_BASE.find((item) => item.name === "oliwa z oliwek")!,
    KITCHEN_BASE.find((item) => item.name === "czosnek")!,
    KITCHEN_BASE.find((item) => item.name === "cebula")!,
    KITCHEN_BASE.find((item) => item.name === "papryka czerwona")!,
    KITCHEN_BASE.find((item) => item.name === "cukinia")!,
    KITCHEN_BASE.find((item) => item.name === "sok z cytryny")!,
    KITCHEN_BASE.find((item) => item.name === "natka pietruszki")!,
    KITCHEN_BASE.find((item) => item.name === "sól")!,
    KITCHEN_BASE.find((item) => item.name === "pieprz czarny")!,
  ].map((item) => ({
    name: item.name,
    amount: "amount" in item ? item.amount : item.amountPerServing,
    unit: item.unit,
    kcalPerUnit: item.kcalPerUnit,
  }));

  if (normalizedDiet.includes("low-carb")) {
    ingredients.push({ name: "szpinak", amount: 80, unit: "g", kcalPerUnit: 0.23 });
  } else {
    ingredients.push({ name: "ryż basmati", amount: 65, unit: "g", kcalPerUnit: 3.6 });
  }

  if (normalizedDiet.includes("wegańska")) {
    return ingredients.filter((item) => !normalize(item.name).includes("jogurt"));
  }

  ingredients.push({ name: "jogurt naturalny", amount: 35, unit: "g", kcalPerUnit: 0.61 });
  return ingredients;
}

export async function generateAiChefRecipe(input: AiChefInput, _datasource: AiChefIngredientDataSource): Promise<AiChefResponse> {
  if (!input.answers) {
    return {
      phase: "questions",
      followUpQuestion: "Doprecyzuj proszę preferencje, żebym dobrał najlepszy przepis.",
      questions: QUESTION_BANK,
    };
  }

  const targetTotalCalories = input.targetCaloriesPerServing * input.servings;
  const baseIngredients = getBaseIngredients(input.mainIngredient, input.answers.diet);
  const baseCalories = baseIngredients.reduce((acc, item) => acc + item.amount * item.kcalPerUnit, 0);
  const scalingFactor = baseCalories > 0 ? targetTotalCalories / (baseCalories * input.servings) : 1;

  const ingredients = baseIngredients.map((item) => ({
    ingredientId: null,
    name: item.name,
    amount: Math.max(1, round(item.amount * scalingFactor * input.servings)),
    unit: item.unit,
    fromUserStock: false,
    toBuy: true,
  }));

  const estimatedTotalCalories = ingredients.reduce((acc, item) => {
    const source = baseIngredients.find((base) => base.name === item.name);
    if (!source) return acc;
    return acc + item.amount * source.kcalPerUnit;
  }, 0);

  const missingIngredients = ingredients.map((item) => ({
    ingredientId: null,
    name: item.name,
    reason: "do dopasowania i ewentualnego dokupienia",
  }));

  const prepTime = input.answers.maxPrepTimeMinutes;
  const steps = [
    `Przygotuj wszystkie składniki i odmierz porcje dla ${input.servings} porcji.`,
    `Obrób główny składnik (${input.mainIngredient}) zgodnie z poziomem trudności: ${input.answers.difficulty}.`,
    "Podsmaż warzywa na oliwie, dodaj główny składnik i kontroluj stopień wysmażenia/upieczenia.",
    "Dodaj składnik skrobiowy lub warzywa liściaste zgodnie z wybraną dietą, dopraw i zredukuj płyn.",
    `Podawaj od razu. Szacunkowo ${round(estimatedTotalCalories / input.servings)} kcal / porcję.`,
  ];

  const instructionSteps = buildInstructionSteps(steps);
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
      ingredients: [],
    },
    missingIngredients,
    usedUserIngredientsFirst: false,
  };
}
