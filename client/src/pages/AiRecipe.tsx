import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { api } from "@shared/routes";
import { useCreateRecipe } from "@/hooks/use-recipes";
import { useIngredients } from "@/hooks/use-ingredients";

type AiRecipeResponse = {
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
  };
  recipeDraft: any;
  missingIngredients: { ingredientId: number | null; name: string; reason: string }[];
  usedUserIngredientsFirst: boolean;
};

type AiRecipeQuestionsResponse = {
  phase: "questions";
  followUpQuestion: string;
  questions: {
    diet: string[];
    difficulty: string[];
    maxPrepTimeMinutes: number[];
  };
};

export default function AiRecipe() {
  const [mainIngredient, setMainIngredient] = useState("");
  const [servings, setServings] = useState("2");
  const [targetCaloriesPerServing, setTargetCaloriesPerServing] = useState("700");
  const [diet, setDiet] = useState("bez ograniczeń");
  const [difficulty, setDifficulty] = useState("łatwy");
  const [maxPrepTimeMinutes, setMaxPrepTimeMinutes] = useState("25");
  const [allergies, setAllergies] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AiRecipeResponse | null>(null);
  const [questionStep, setQuestionStep] = useState<AiRecipeQuestionsResponse | null>(null);
  const { toast } = useToast();
  const createRecipe = useCreateRecipe();
  const { data: ingredients } = useIngredients();

  const generate = async (withAnswers = false) => {
    setIsLoading(true);
    if (!withAnswers) {
      setResult(null);
      setQuestionStep(null);
    }

    try {
      const payload = {
        mainIngredient,
        servings: Number(servings),
        targetCaloriesPerServing: Number(targetCaloriesPerServing),
        answers: withAnswers
          ? {
              diet,
              difficulty,
              maxPrepTimeMinutes: Number(maxPrepTimeMinutes),
              allergies: allergies || undefined,
            }
          : undefined,
      };

      const parsed = api.ai.generateRecipe.input.parse(payload);

      const res = await fetch(api.ai.generateRecipe.path, {
        method: api.ai.generateRecipe.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.message || "Nie udało się wygenerować przepisu");
      }

      const data = api.ai.generateRecipe.responses[200].parse(body);
      if (data.phase === "questions") {
        setQuestionStep(data);
        setDiet(data.questions.diet[0]);
        setDifficulty(data.questions.difficulty[0]);
        setMaxPrepTimeMinutes(String(data.questions.maxPrepTimeMinutes[0]));
        return;
      }

      setQuestionStep(null);
      setResult(data);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Błąd",
        description: err.message || "Nie udało się wygenerować przepisu",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">AI Chef</h1>
          <p className="text-muted-foreground">Wpisz główny składnik, kalorie i porcje. AI Chef wygeneruje realistyczny przepis i zwróci składniki jako czyste nazwy w JSON (bez dopasowania do bazy na tym etapie).</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Generowanie przepisu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mainIngredient">Główny składnik</Label>
              <Input id="mainIngredient" value={mainIngredient} onChange={(e) => setMainIngredient(e.target.value)} placeholder="np. kurczak" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="servings">Liczba porcji</Label>
                <Input id="servings" type="number" min={1} max={12} value={servings} onChange={(e) => setServings(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kcal">Maks. kcal na porcję</Label>
                <Input id="kcal" type="number" min={100} value={targetCaloriesPerServing} onChange={(e) => setTargetCaloriesPerServing(e.target.value)} />
              </div>
            </div>

            <Button onClick={() => generate(false)} disabled={isLoading} className="rounded-xl">
              {isLoading ? <><LoadingSpinner /> Generowanie...</> : "Dalej"}
            </Button>
          </CardContent>
        </Card>

        {questionStep && !result && (
          <Card>
            <CardHeader>
              <CardTitle>Pytania doprecyzowujące</CardTitle>
              <p className="text-sm text-muted-foreground">{questionStep.followUpQuestion}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Dieta</Label>
                  <select className="w-full border rounded-md px-3 py-2" value={diet} onChange={(e) => setDiet(e.target.value)}>
                    {questionStep.questions.diet.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Poziom trudności</Label>
                  <select className="w-full border rounded-md px-3 py-2" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                    {questionStep.questions.difficulty.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Maksymalny czas (min)</Label>
                  <select className="w-full border rounded-md px-3 py-2" value={maxPrepTimeMinutes} onChange={(e) => setMaxPrepTimeMinutes(e.target.value)}>
                    {questionStep.questions.maxPrepTimeMinutes.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Alergie (opcjonalnie)</Label>
                <Input value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="np. orzechy, laktoza" />
              </div>
              <Button onClick={() => generate(true)} disabled={isLoading} className="rounded-xl">
                {isLoading ? <><LoadingSpinner /> Generowanie przepisu...</> : "Wygeneruj przepis"}
              </Button>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>{result.recipe.name}</CardTitle>
              <p className="text-sm text-muted-foreground">{result.recipe.description}</p>
              <p className="text-sm">Kalorie: ~{result.recipe.estimatedCaloriesPerServing} kcal / porcję ({result.recipe.servings} porcji)</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Składniki</h3>
                <div className="space-y-2">
                  {result.recipe.ingredients.map((item, idx) => (
                    <div key={`${item.name}-${idx}`} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{item.name} — {item.amount} {item.unit}</p>
                      <p className="text-muted-foreground">{item.toBuy ? "do dokupienia" : "z bazy użytkownika"}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Kroki przygotowania</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm">
                  {result.recipe.steps.map((step, idx) => <li key={idx}>{step}</li>)}
                </ol>
              </div>

              {result.missingIngredients.length > 0 && (
                <div className="rounded-xl bg-muted p-4 text-sm">
                  <p className="font-semibold mb-1">Brakujące składniki</p>
                  <ul className="list-disc pl-5">
                    {result.missingIngredients.map((item, idx) => <li key={`${item.name}-${idx}`}>{item.name} — {item.reason}</li>)}
                  </ul>
                </div>
              )}

              <Button
                className="rounded-xl"
                onClick={async () => {
                  try {
                    await createRecipe.mutateAsync(result.recipeDraft);
                    toast({ title: "Zapisano", description: "Przepis został zapisany do Recipe." });
                  } catch (err: any) {
                    toast({ variant: "destructive", title: "Błąd zapisu", description: err.message || "Nie udało się zapisać przepisu" });
                  }
                }}
                disabled={createRecipe.isPending}
              >
                {createRecipe.isPending ? <><LoadingSpinner /> Zapisywanie...</> : "Zapisz jako Recipe"}
              </Button>

              <p className="text-xs text-muted-foreground">Składniki domowe (alwaysAtHome) wykryte w bazie: {(ingredients || []).filter((item: any) => item.alwaysAtHome).length}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
