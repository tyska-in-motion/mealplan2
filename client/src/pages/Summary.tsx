import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { api, buildUrl } from "@shared/routes";
import { format, subDays } from "date-fns";
import { pl } from "date-fns/locale";
import { CalendarDays, Coins, Flame, ChefHat, Carrot } from "lucide-react";
import { calculateScaledAmount } from "@shared/scaling";

type SummaryData = {
  date: string;
  totalCalories: number;
  totalPrice: number;
  entries: any[];
};

const RANGE_OPTIONS = [
  { label: "7 dni", days: 7 },
  { label: "14 dni", days: 14 },
  { label: "30 dni", days: 30 },
  { label: "90 dni", days: 90 },
];

export default function Summary() {
  const [rangeDays, setRangeDays] = useState(30);

  const dates = useMemo(() => {
    return Array.from({ length: rangeDays }, (_, i) =>
      format(subDays(new Date(), rangeDays - 1 - i), "yyyy-MM-dd")
    );
  }, [rangeDays]);

  const dayQueries = useQueries({
    queries: dates.map((date) => ({
      queryKey: [api.mealPlan.getDay.path, date],
      queryFn: async () => {
        const url = buildUrl(api.mealPlan.getDay.path, { date });
        const res = await fetch(url);
        if (!res.ok) throw new Error("Nie udało się pobrać danych dziennych");
        return api.mealPlan.getDay.responses[200].parse(await res.json()) as SummaryData;
      },
    })),
  });

  const isLoading = dayQueries.some((q) => q.isLoading);

  const analytics = useMemo(() => {
    const days = dayQueries
      .map((q) => q.data)
      .filter((day): day is SummaryData => !!day);

    const totalCost = days.reduce((sum, day) => sum + (Number(day.totalPrice) || 0), 0);
    const getEntryIngredientAmount = (entry: any, ri: any) => {
      if (typeof ri?.calculatedAmount === "number" && Number.isFinite(ri.calculatedAmount)) {
        return ri.calculatedAmount;
      }
      const entryServings = Number(entry?.servings) || 1;
      const recipeServings = Number(entry?.recipe?.servings) || 1;
      return calculateScaledAmount(ri, entryServings, recipeServings);
    };
    const calculateEntryNutrients = (entry: any) => {
      const result = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      const entryServings = Number(entry.servings) || 1;

      if (!entry.recipe) {
        return {
          calories: (Number(entry.customCalories) || 0) * entryServings,
          protein: (Number(entry.customProtein) || 0) * entryServings,
          carbs: (Number(entry.customCarbs) || 0) * entryServings,
          fat: (Number(entry.customFat) || 0) * entryServings,
        };
      }

      const ingredientsToUse = entry.ingredients?.length > 0 ? entry.ingredients : (entry.recipe?.ingredients || []);

      ingredientsToUse.forEach((ri: any) => {
        if (!ri.ingredient) return;
        const multiplier = getEntryIngredientAmount(entry, ri) / 100;
        result.calories += (Number(ri.ingredient.calories) || 0) * multiplier;
        result.protein += (Number(ri.ingredient.protein) || 0) * multiplier;
        result.carbs += (Number(ri.ingredient.carbs) || 0) * multiplier;
        result.fat += (Number(ri.ingredient.fat) || 0) * multiplier;
      });

      return result;
    };

    const ingredientMap = new Map<number, { name: string; totalAmount: number; usedInDays: Set<string> }>();
    const recipeMap = new Map<number, { name: string; count: number }>();

    days.forEach((day) => {
      (day.entries || []).forEach((entry: any) => {
        if (entry.recipe?.id) {
          const currentRecipe = recipeMap.get(entry.recipe.id) || { name: entry.recipe.name, count: 0 };
          currentRecipe.count += 1;
          recipeMap.set(entry.recipe.id, currentRecipe);
        }

        const ingredientsToUse = entry.ingredients?.length > 0 ? entry.ingredients : (entry.recipe?.ingredients || []);
        ingredientsToUse.forEach((ri: any) => {
          if (!ri.ingredient?.id) return;
          const currentIngredient = ingredientMap.get(ri.ingredient.id) || {
            name: ri.ingredient.name,
            totalAmount: 0,
            usedInDays: new Set<string>(),
          };

          currentIngredient.totalAmount += getEntryIngredientAmount(entry, ri);
          currentIngredient.usedInDays.add(day.date);
          ingredientMap.set(ri.ingredient.id, currentIngredient);
        });
      });
    });

    const mostUsedIngredients = Array.from(ingredientMap.values())
      .map((ingredient) => ({
        ...ingredient,
        totalAmount: Math.round(ingredient.totalAmount),
        usedDaysCount: ingredient.usedInDays.size,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 8);

    const mostCookedRecipes = Array.from(recipeMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const dailyHistory = [...days].sort((a, b) => b.date.localeCompare(a.date)).map((day) => {
      const entries = day.entries || [];
      const getPersonCalories = (person: "A" | "B") => {
        return Math.round(entries
          .filter((entry: any) => (entry.person || "A") === person)
          .reduce((sum: number, entry: any) => {
            if (!entry.recipe) {
              const servings = Number(entry.servings) || 1;
              return sum + (Number(entry.customCalories) || 0) * servings;
            }

            const ingredientsToUse = entry.ingredients?.length > 0 ? entry.ingredients : (entry.recipe?.ingredients || []);

            const kcal = ingredientsToUse.reduce((kcalSum: number, ri: any) => {
              if (!ri.ingredient) return kcalSum;
              return kcalSum + ((Number(ri.ingredient.calories) || 0) * getEntryIngredientAmount(entry, ri) / 100);
            }, 0);

            return sum + kcal;
          }, 0));
      };

      const getPersonPrice = (person: "A" | "B") => {
        return entries
          .filter((entry: any) => (entry.person || "A") === person)
          .reduce((sum: number, entry: any) => {
            if (!entry.recipe) {
              return sum + (Number(entry.customPrice) || 0) * (Number(entry.servings) || 1);
            }

            const ingredientsToUse = entry.ingredients?.length > 0 ? entry.ingredients : (entry.recipe?.ingredients || []);

            const price = ingredientsToUse.reduce((priceSum: number, ri: any) => {
              if (!ri.ingredient) return priceSum;
              return priceSum + ((Number(ri.ingredient.price) || 0) * getEntryIngredientAmount(entry, ri) / 100);
            }, 0);

            return sum + price;
          }, 0);
      };

      return {
        date: day.date,
        label: format(new Date(day.date), "d MMM", { locale: pl }),
        price: Number(day.totalPrice) || 0,
        calories: Number(day.totalCalories) || 0,
        perPerson: {
          A: {
            calories: getPersonCalories("A"),
            price: getPersonPrice("A"),
          },
          B: {
            calories: getPersonCalories("B"),
            price: getPersonPrice("B"),
          },
        },
      };
    });

    const eatenEntries = days.flatMap((day) => (day.entries || []).filter((entry: any) => entry.isEaten));

    const getEatenCaloriesForPerson = (person: "A" | "B") => eatenEntries.reduce((sum: number, entry: any) => {
      if ((entry.person || "A") !== person) return sum;

      return sum + calculateEntryNutrients(entry).calories;
    }, 0);

    const getEatenMacroForPerson = (person: "A" | "B", macro: "protein" | "carbs" | "fat") =>
      eatenEntries.reduce((sum: number, entry: any) => {
        if ((entry.person || "A") !== person) return sum;
        return sum + calculateEntryNutrients(entry)[macro];
      }, 0);

    const perPersonAvgEatenCalories = {
      A: eatenEntries.filter((entry: any) => (entry.person || "A") === "A").length
        ? Math.round(getEatenCaloriesForPerson("A") / eatenEntries.filter((entry: any) => (entry.person || "A") === "A").length)
        : 0,
      B: eatenEntries.filter((entry: any) => (entry.person || "A") === "B").length
        ? Math.round(getEatenCaloriesForPerson("B") / eatenEntries.filter((entry: any) => (entry.person || "A") === "B").length)
        : 0,
    };

    const perPersonEntryCount = {
      A: eatenEntries.filter((entry: any) => (entry.person || "A") === "A").length,
      B: eatenEntries.filter((entry: any) => (entry.person || "A") === "B").length,
    };

    const perPersonAvgEatenMacros = {
      A: {
        protein: perPersonEntryCount.A ? Math.round(getEatenMacroForPerson("A", "protein") / perPersonEntryCount.A) : 0,
        carbs: perPersonEntryCount.A ? Math.round(getEatenMacroForPerson("A", "carbs") / perPersonEntryCount.A) : 0,
        fat: perPersonEntryCount.A ? Math.round(getEatenMacroForPerson("A", "fat") / perPersonEntryCount.A) : 0,
      },
      B: {
        protein: perPersonEntryCount.B ? Math.round(getEatenMacroForPerson("B", "protein") / perPersonEntryCount.B) : 0,
        carbs: perPersonEntryCount.B ? Math.round(getEatenMacroForPerson("B", "carbs") / perPersonEntryCount.B) : 0,
        fat: perPersonEntryCount.B ? Math.round(getEatenMacroForPerson("B", "fat") / perPersonEntryCount.B) : 0,
      },
    };

    return {
      days,
      totalCost,
      mostUsedIngredients,
      mostCookedRecipes,
      dailyHistory,
      perPersonAvgEatenCalories,
      perPersonAvgEatenMacros,
    };
  }, [dayQueries]);

  return (
    <Layout>
      <div className="space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Summary</h1>
            <p className="text-muted-foreground">Analityka historyczna planu posiłków i gotowania</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.days}
                variant={rangeDays === option.days ? "default" : "outline"}
                onClick={() => setRangeDays(option.days)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </header>

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <Coins className="h-4 w-4" /> Koszt (okres)
                </div>
                <div className="text-2xl font-bold">{analytics.totalCost.toFixed(2)} PLN</div>
              </div>

              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" /> Dni z danymi
                </div>
                <div className="text-2xl font-bold">{analytics.days.length}</div>
              </div>


              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <Flame className="h-4 w-4" /> Śr. zjedzone kcal (Tysia)
                </div>
                <div className="text-2xl font-bold">{analytics.perPersonAvgEatenCalories.A} kcal</div>
                <div className="text-xs text-muted-foreground mt-1">
                  B: {analytics.perPersonAvgEatenMacros.A.protein}g • W: {analytics.perPersonAvgEatenMacros.A.carbs}g • T: {analytics.perPersonAvgEatenMacros.A.fat}g
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <Flame className="h-4 w-4" /> Śr. zjedzone kcal (Mati)
                </div>
                <div className="text-2xl font-bold">{analytics.perPersonAvgEatenCalories.B} kcal</div>
                <div className="text-xs text-muted-foreground mt-1">
                  B: {analytics.perPersonAvgEatenMacros.B.protein}g • W: {analytics.perPersonAvgEatenMacros.B.carbs}g • T: {analytics.perPersonAvgEatenMacros.B.fat}g
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Carrot className="h-5 w-5 text-emerald-600" /> Najczęściej używane składniki
                </h2>
                <div className="space-y-2">
                  {analytics.mostUsedIngredients.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Brak danych składników w wybranym okresie.</p>
                  ) : (
                    analytics.mostUsedIngredients.map((ingredient) => (
                      <div key={ingredient.name} className="flex items-center justify-between rounded-lg border px-3 py-2">
                        <div>
                          <div className="font-medium">{ingredient.name}</div>
                          <div className="text-xs text-muted-foreground">użyte dni: {ingredient.usedDaysCount}</div>
                        </div>
                        <div className="text-sm font-semibold">{ingredient.totalAmount} g</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <ChefHat className="h-5 w-5 text-primary" /> Najczęściej gotowane przepisy
                </h2>
                <div className="space-y-2">
                  {analytics.mostCookedRecipes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Brak gotowanych przepisów w wybranym okresie.</p>
                  ) : (
                    analytics.mostCookedRecipes.map((recipe) => (
                      <div key={recipe.name} className="flex items-center justify-between rounded-lg border px-3 py-2">
                        <div className="font-medium">{recipe.name}</div>
                        <div className="text-sm font-semibold">{recipe.count}x</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {[{ key: "A", name: "Tysia" }, { key: "B", name: "Mati" }].map((person) => (
                <div key={person.key} className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h2 className="mb-3 text-lg font-semibold">Historia dzienna — {person.name}</h2>
                  <div className="space-y-2">
                    {analytics.dailyHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Brak danych dla wybranego okresu.</p>
                    ) : (
                      analytics.dailyHistory.map((day) => {
                        const personData = day.perPerson[person.key as "A" | "B"];
                        return (
                          <div key={`${person.key}-${day.date}`} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2">
                            <span className="text-sm font-medium">{day.label}</span>
                            <div className="h-2 rounded-full bg-muted">
                              <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, personData.calories / 30)}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{personData.calories} kcal • {personData.price.toFixed(2)} PLN</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
