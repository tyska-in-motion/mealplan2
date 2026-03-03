import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { api } from "@shared/routes";

type AiRecipeResponse = {
  title: string;
  summary: string;
  followUpQuestion: string;
  missingIngredients: string[];
  instructions: string[];
  ingredients: {
    ingredientId: number;
    name: string;
    amount: number;
    unit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    cost: number;
  }[];
  totals: {
    calories: number;
    caloriesPerServing: number;
    servings: number;
    protein: number;
    carbs: number;
    fat: number;
    cost: number;
  };
};

export default function AiRecipe() {
  const [pantry, setPantry] = useState("");
  const [servings, setServings] = useState("2");
  const [targetCaloriesPerServing, setTargetCaloriesPerServing] = useState("700");
  const [extraPantry, setExtraPantry] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AiRecipeResponse | null>(null);
  const { toast } = useToast();

  const onGenerate = async () => {
    setIsLoading(true);
    setResult(null);

    try {
      const payload = {
        pantry,
        servings: Number(servings),
        targetCaloriesPerServing: Number(targetCaloriesPerServing),
        extraPantry: extraPantry || undefined,
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
          <p className="text-muted-foreground">AI Chef tworzy przepis wyłącznie na bazie składników które masz, pyta o brakujące rzeczy i dopasowuje dokładnie porcje oraz kcal na porcję.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Generowanie przepisu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pantry">Co masz w domu?</Label>
              <Textarea
                id="pantry"
                placeholder="np. kurczak, ryż, brokuły, oliwa"
                value={pantry}
                onChange={(e) => setPantry(e.target.value)}
                rows={4}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="servings">Liczba porcji</Label>
                <Input
                  id="servings"
                  type="number"
                  min={1}
                  max={12}
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="kcal">Kcal na porcję</Label>
                <Input
                  id="kcal"
                  type="number"
                  min={100}
                  value={targetCaloriesPerServing}
                  onChange={(e) => setTargetCaloriesPerServing(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra">Co masz jeszcze? (opcjonalnie)</Label>
              <Textarea
                id="extra"
                placeholder="np. czosnek, cebula, passata, przyprawy"
                value={extraPantry}
                onChange={(e) => setExtraPantry(e.target.value)}
                rows={2}
              />
            </div>

            <Button onClick={onGenerate} disabled={isLoading} className="rounded-xl">
              {isLoading ? <><LoadingSpinner /> Generowanie...</> : "Wygeneruj przepis"}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>{result.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{result.summary}</p>
              <p className="text-sm">{result.followUpQuestion}</p>
              {result.missingIngredients.length > 0 && (
                <p className="text-xs text-muted-foreground">Brakujące / sugerowane dodatki: {result.missingIngredients.join(", ")}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Składniki i wyliczenia</h3>
                <div className="space-y-2">
                  {result.ingredients.map((item) => (
                    <div key={item.ingredientId} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{item.name} — {item.amount} {item.unit}</p>
                      <p className="text-muted-foreground">
                        {item.calories} kcal | B: {item.protein} g | W: {item.carbs} g | T: {item.fat} g | koszt: {item.cost.toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-muted p-4 text-sm">
                <p className="font-semibold mb-1">Suma</p>
                <p>
                  {result.totals.calories} kcal łącznie ({result.totals.caloriesPerServing} kcal / porcja, porcji: {result.totals.servings}) | B: {result.totals.protein} g | W: {result.totals.carbs} g | T: {result.totals.fat} g | koszt: {result.totals.cost.toFixed(2)}
                </p>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Instrukcje</h3>
                <ol className="list-decimal pl-5 space-y-1 text-sm">
                  {result.instructions.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
