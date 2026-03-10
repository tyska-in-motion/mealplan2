import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAddMealEntry, useDayPlan, useDeleteMealEntry } from "@/hooks/use-meal-plan";
import { useRecipes } from "@/hooks/use-recipes";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { pl } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { fetchWithTimeout } from "@/lib/queryClient";

const MEAL_TYPES = [
  { value: "breakfast", label: "Śniadanie" },
  { value: "lunch", label: "Obiad" },
  { value: "dinner", label: "Kolacja" },
  { value: "snack", label: "Przekąska" },
];

export default function MealPlan() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isDayDialogOpen, setIsDayDialogOpen] = useState(false);
  const [recipeId, setRecipeId] = useState<number | "">("");
  const [mealType, setMealType] = useState("lunch");
  const [person, setPerson] = useState<"A" | "B">("A");

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays = useMemo(() => {
    const days: Date[] = [];
    let day = calendarStart;
    while (day <= calendarEnd) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [calendarStart, calendarEnd]);

  const monthQueries = useQueries({
    queries: calendarDays.map((day) => {
      const date = format(day, "yyyy-MM-dd");
      return {
        queryKey: [api.mealPlan.getDay.path, date],
        queryFn: async () => {
          const url = buildUrl(api.mealPlan.getDay.path, { date });
          const res = await fetchWithTimeout(url);
          if (!res.ok) return { date, entries: [] };
          return res.json();
        },
      };
    }),
  });

  const daySummaries = useMemo(() => {
    return calendarDays.reduce<Record<string, any>>((acc, day, idx) => {
      acc[format(day, "yyyy-MM-dd")] = monthQueries[idx]?.data;
      return acc;
    }, {});
  }, [calendarDays, monthQueries]);

  const { data: selectedDayData } = useDayPlan(selectedDate);
  const { data: recipes = [] } = useRecipes();
  const { mutate: addEntry, isPending: isAdding } = useAddMealEntry();
  const { mutate: deleteEntry } = useDeleteMealEntry();

  const openDay = (day: Date) => {
    setSelectedDate(format(day, "yyyy-MM-dd"));
    setIsDayDialogOpen(true);
  };

  const handleAddRecipe = () => {
    if (!recipeId) return;
    addEntry({
      date: selectedDate,
      recipeId: Number(recipeId),
      mealType,
      person,
      servings: 1,
    });
  };

  return (
    <Layout>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold">Plan Tygodniowy (widok okienek)</h1>
        <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-white p-2 shadow-sm sm:w-auto sm:justify-start sm:gap-4">
          <button onClick={() => setBaseDate(d => subDays(d, 7))} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="min-w-0 flex-1 text-center text-sm font-semibold tabular-nums sm:w-48 sm:flex-none sm:text-base">
            {format(weekDays[0], "d MMM", { locale: pl })} - {format(weekDays[6], "d MMM, yyyy", { locale: pl })}
          </span>
          <button onClick={() => setBaseDate(d => addDays(d, 7))} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="mb-4 inline-flex rounded-xl border bg-white p-1 shadow-sm">
        <Button variant={activeView === "plan" ? "default" : "ghost"} size="sm" onClick={() => setActiveView("plan")}>Plan tygodniowy</Button>
        <Button variant={activeView === "shared" ? "default" : "ghost"} size="sm" onClick={() => setActiveView("shared")}><Soup className="mr-1 h-4 w-4" />Wspólne posiłki</Button>
      </div>

      {activeView === "plan" && (
      <>
      <section className="mb-6 rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 flex-1">
            <div className="space-y-1">
              <label className="text-sm font-medium">Kopiuj z dnia</label>
              <Input
                type="date"
                value={copySourceDate}
                onChange={(e) => setCopySourceDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Wklej do dnia</label>
              <Input
                type="date"
                value={copyTargetDate}
                onChange={(e) => setCopyTargetDate(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 text-center text-sm font-medium text-muted-foreground">
          {["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"].map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const summary = daySummaries[dateKey];
            const entries = summary?.entries ?? [];

            return (
              <button
                key={dateKey}
                onClick={() => openDay(day)}
                className={`min-h-32 rounded-lg border p-2 text-left transition hover:border-primary ${
                  isSameMonth(day, currentMonth) ? "bg-card" : "bg-muted/40"
                }`}
              >
                <div className="mb-1 text-sm font-semibold">{format(day, "d")}</div>
                <div className="space-y-1">
                  {entries.slice(0, 3).map((entry: any) => (
                    <div key={entry.id} className="truncate rounded bg-primary/10 px-2 py-1 text-xs">
                      {entry.recipe?.name || entry.customName}
                    </div>
                  ))}
                  {entries.length > 3 && (
                    <div className="text-xs text-muted-foreground">+ {entries.length - 3} więcej</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={isDayDialogOpen} onOpenChange={setIsDayDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Dzień: {selectedDate}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={recipeId}
                onChange={(e) => setRecipeId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Wybierz przepis</option>
                {recipes.map((recipe: any) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </select>

              <select className="h-10 rounded-md border bg-background px-3" value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {MEAL_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              <select
                className="h-10 rounded-md border bg-background px-3"
                value={person}
                onChange={(e) => setPerson(e.target.value as "A" | "B")}
              >
                <option value="A">Osoba A</option>
                <option value="B">Osoba B</option>
              </select>

              <Button onClick={handleAddRecipe} disabled={!recipeId || isAdding}>
                <Plus className="mr-2 h-4 w-4" /> Dodaj
              </Button>
            </div>

            <div className="space-y-2">
              {(selectedDayData?.entries || []).map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="font-medium">{entry.recipe?.name || entry.customName}</p>
                    <p className="text-sm text-muted-foreground">
                      {MEAL_TYPES.find((m) => m.value === entry.mealType)?.label || entry.mealType} • {entry.person}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteEntry({ id: entry.id, date: selectedDate })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}

              {(selectedDayData?.entries || []).length === 0 && (
                <p className="text-sm text-muted-foreground">Brak przepisów w tym dniu.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function DaySection({ day, sectionId, recipes, onAddMeal, onAddCustom, onAddIngredient, onDeleteMeal, onToggleEaten, onUpdateEntry, onViewRecipe, onViewPlannedRecipe }: any) {
  const [servingInputs, setServingInputs] = useState<Record<number, string>>({});
  const [selectedEntries, setSelectedEntries] = useState<Record<number, boolean>>({});
  const dateStr = format(day, "yyyy-MM-dd");
  const { data: dayPlan, isLoading } = useDayPlan(dateStr);
  const isToday = dateStr === format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    setSelectedEntries({});
  }, [dateStr]);

  const getEffectiveIngredientAmount = (ri: any, entry: any) => {
    if (typeof ri?.calculatedAmount === "number") return ri.calculatedAmount;
    const entryServings = Number(entry?.servings) || 1;
    const recipeServings = Number(entry?.recipe?.servings) || 1;
    return calculateScaledAmount(ri, entryServings, recipeServings);
  };

  const calculateSummary = (entries: any[]) => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    let price = 0;

    entries.forEach((entry: any) => {
      const entryServings = Number(entry.servings) || 1;
      const ingredientsToUse = entry.ingredients?.length > 0 ? entry.ingredients : (entry.recipe?.ingredients || []);

      if (ingredientsToUse.length > 0) {
        const entryServings = Number(entry?.servings) || 1;
        const recipeServings = Number(entry?.recipe?.servings) || 1;
        const frequentAddonIds = new Set<number>(((entry?.recipe?.frequentAddons) || []).map((addon: any) => Number(addon.ingredientId)));
        const recipeIngredientCounts = (entry?.recipe?.ingredients || []).reduce((acc: Map<number, number>, ingredient: any) => {
          const id = Number(ingredient?.ingredientId);
          if (!Number.isFinite(id)) return acc;
          acc.set(id, (acc.get(id) || 0) + 1);
          return acc;
        }, new Map<number, number>());
        const occurrenceMap = new Map<number, number>();

        ingredientsToUse.forEach((ri: any) => {
          if (!ri.ingredient) return;
          const ingredientId = Number(ri.ingredientId);
          const occurrence = (occurrenceMap.get(ingredientId) || 0) + 1;
          occurrenceMap.set(ingredientId, occurrence);
          const recipeCount = recipeIngredientCounts.get(ingredientId) || 0;
          const isFrequentAddon = frequentAddonIds.has(ingredientId) && occurrence > recipeCount;
          const effectiveAmount = getEffectiveIngredientAmount(ri, entry);
          const multiplier = effectiveAmount / 100;
          calories += (ri.ingredient.calories || 0) * multiplier;
          protein += (ri.ingredient.protein || 0) * multiplier;
          carbs += (ri.ingredient.carbs || 0) * multiplier;
          fat += (ri.ingredient.fat || 0) * multiplier;
          price += (ri.ingredient.price || 0) * multiplier;
        });
      } else {
        calories += (entry.customCalories || 0) * entryServings;
        protein += (entry.customProtein || 0) * entryServings;
        carbs += (entry.customCarbs || 0) * entryServings;
        fat += (entry.customFat || 0) * entryServings;
        price += (entry.customPrice || 0) * entryServings;
      }
    });

    return {
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
      price: Math.round(price * 100) / 100,
    };
  };

  const people = ["A", "B"] as const;
  const personName: Record<"A" | "B", string> = { A: "Tysia", B: "Mati" };
  const personEntries = useMemo(() => ({
    A: dayPlan?.entries.filter((e: any) => (e.person || "A") === "A") || [],
    B: dayPlan?.entries.filter((e: any) => (e.person || "A") === "B") || [],
  }), [dayPlan]);

  const personSummary = useMemo(() => ({
    A: calculateSummary(personEntries.A),
    B: calculateSummary(personEntries.B),
  }), [personEntries]);

  const sharedEntries = useMemo(() => {
    const collectFrequentAddonAmounts = (entry: any) => {
      const addonTotals = new Map<number, { amount: number; ingredient: any }>();
      const ingredientsToUse = entry?.ingredients?.length > 0 ? entry.ingredients : [];
      if (ingredientsToUse.length === 0) return addonTotals;

      const frequentAddonIds = new Set<number>(((entry?.recipe?.frequentAddons) || []).map((addon: any) => Number(addon.ingredientId)));
      const recipeIngredientCounts = (entry?.recipe?.ingredients || []).reduce((acc: Map<number, number>, ingredient: any) => {
        const id = Number(ingredient?.ingredientId);
        if (!Number.isFinite(id)) return acc;
        acc.set(id, (acc.get(id) || 0) + 1);
        return acc;
      }, new Map<number, number>());
      const occurrenceMap = new Map<number, number>();

      ingredientsToUse.forEach((ri: any) => {
        const ingredientId = Number(ri?.ingredientId);
        if (!Number.isFinite(ingredientId)) return;

        const occurrence = (occurrenceMap.get(ingredientId) || 0) + 1;
        occurrenceMap.set(ingredientId, occurrence);

        const recipeCount = recipeIngredientCounts.get(ingredientId) || 0;
        const isFrequentAddon = frequentAddonIds.has(ingredientId) && occurrence > recipeCount;
        if (!isFrequentAddon) return;

        const effectiveAmount = getEffectiveIngredientAmount(ri, entry);
        if (effectiveAmount <= 0) return;

        const current = addonTotals.get(ingredientId);
        addonTotals.set(ingredientId, {
          amount: (current?.amount || 0) + effectiveAmount,
          ingredient: ri?.ingredient || current?.ingredient || null,
        });
      });

      return addonTotals;
    };

    const collectFixedRecipeIngredientAmounts = (entry: any) => {
      const totals = new Map<number, { amount: number; ingredient: any }>();
      const ingredientsToUse = entry?.ingredients?.length > 0 ? entry.ingredients : [];
      if (ingredientsToUse.length === 0) return totals;

      const recipeIngredientCounts = (entry?.recipe?.ingredients || []).reduce((acc: Map<number, number>, ingredient: any) => {
        const id = Number(ingredient?.ingredientId);
        if (!Number.isFinite(id)) return acc;
        acc.set(id, (acc.get(id) || 0) + 1);
        return acc;
      }, new Map<number, number>());
      const occurrenceMap = new Map<number, number>();

      ingredientsToUse.forEach((ri: any) => {
        const ingredientId = Number(ri?.ingredientId);
        if (!Number.isFinite(ingredientId)) return;

        const occurrence = (occurrenceMap.get(ingredientId) || 0) + 1;
        occurrenceMap.set(ingredientId, occurrence);

        const recipeCount = recipeIngredientCounts.get(ingredientId) || 0;
        if (occurrence > recipeCount) return;

        const sourceIngredients = (entry?.recipe?.ingredients || []).filter((source: any) => Number(source?.ingredientId) === ingredientId);
        const source = sourceIngredients[occurrence - 1] || sourceIngredients[0];
        if ((source?.scalingType || "LINEAR") !== "FIXED") return;

        const effectiveAmount = getEffectiveIngredientAmount(ri, entry);
        if (effectiveAmount <= 0) return;

        const current = totals.get(ingredientId);
        totals.set(ingredientId, {
          amount: (current?.amount || 0) + effectiveAmount,
          ingredient: ri?.ingredient || current?.ingredient || null,
        });
      });

      return totals;
    };

    const sharedMap = new Map<string, { A: any; B: any }>();

    personEntries.A.forEach((entry: any) => {
      if (!entry.recipeId) return;
      const key = `${entry.mealType}__${entry.recipeId}`;
      sharedMap.set(key, { A: entry, B: null as any });
    });

    personEntries.B.forEach((entry: any) => {
      if (!entry.recipeId) return;
      const key = `${entry.mealType}__${entry.recipeId}`;
      const current = sharedMap.get(key);
      if (current?.A) {
        current.B = entry;
        sharedMap.set(key, current);
      }
    });

    return Array.from(sharedMap.values())
      .filter((pair) => pair.A && pair.B)
      .map((pair) => {
        const recipeServings = Number(pair.A?.recipe?.servings) || 1;
        const totalServings = (Number(pair.A?.servings) || 1) + (Number(pair.B?.servings) || 1);
        const sourceIngredients = pair.A?.recipe?.ingredients || [];

        const scaledIngredients = sourceIngredients.map((ri: any) => {
          const scaledAmount = calculateScaledAmount(ri, totalServings, recipeServings);
          return {
            ...ri,
            amount: scaledAmount,
            calculatedAmount: scaledAmount,
          };
        });

        if (Math.abs(recipeServings - 1) < 0.000001) {
          const fixedTotals = collectFixedRecipeIngredientAmounts(pair.A);
          collectFixedRecipeIngredientAmounts(pair.B).forEach((fixed, ingredientId) => {
            const existing = fixedTotals.get(ingredientId);
            fixedTotals.set(ingredientId, {
              amount: (existing?.amount || 0) + fixed.amount,
              ingredient: existing?.ingredient || fixed.ingredient || null,
            });
          });

          scaledIngredients.forEach((ri: any) => {
            if ((ri?.scalingType || "LINEAR") !== "FIXED") return;
            const fixed = fixedTotals.get(Number(ri.ingredientId));
            if (!fixed) return;
            ri.amount = fixed.amount;
            ri.calculatedAmount = fixed.amount;
            if (!ri.ingredient && fixed.ingredient) {
              ri.ingredient = fixed.ingredient;
            }
          });
        }

        const addonsA = collectFrequentAddonAmounts(pair.A);
        const addonsB = collectFrequentAddonAmounts(pair.B);
        const addonTotals = new Map<number, { amount: number; ingredient: any; byPerson: { A: number; B: number } }>();

        addonsA.forEach((addon, ingredientId) => {
          addonTotals.set(ingredientId, {
            amount: addon.amount,
            ingredient: addon.ingredient || null,
            byPerson: { A: addon.amount, B: 0 },
          });
        });

        addonsB.forEach((addon, ingredientId) => {
          const existing = addonTotals.get(ingredientId);
          addonTotals.set(ingredientId, {
            amount: (existing?.amount || 0) + addon.amount,
            ingredient: existing?.ingredient || addon.ingredient || null,
            byPerson: {
              A: existing?.byPerson?.A || 0,
              B: (existing?.byPerson?.B || 0) + addon.amount,
            },
          });
        });

        addonTotals.forEach((addon, ingredientId) => {
          const existingIngredient = scaledIngredients.find((ri: any) => Number(ri.ingredientId) === ingredientId);
          if (existingIngredient) {
            const nextAmount = (Number(existingIngredient.amount) || 0) + addon.amount;
            existingIngredient.amount = nextAmount;
            existingIngredient.calculatedAmount = nextAmount;
            existingIngredient.sharedAddonAmounts = addon.byPerson;
            if (!existingIngredient.ingredient && addon.ingredient) {
              existingIngredient.ingredient = addon.ingredient;
            }
            return;
          }

          scaledIngredients.push({
            ingredientId,
            amount: addon.amount,
            calculatedAmount: addon.amount,
            ingredient: addon.ingredient,
            scalingType: "FIXED",
            baseAmount: addon.amount,
            sharedAddonAmounts: addon.byPerson,
          });
        });

        return {
          mealType: pair.A.mealType,
          recipe: pair.A.recipe,
          servings: totalServings,
          ingredients: scaledIngredients,
          entryA: pair.A,
          entryB: pair.B,
        };
      });
  }, [personEntries]);

  const applyServingInput = (entry: any) => {
    const rawValue = servingInputs[entry.id];
    if (rawValue === undefined) return;

    const parsed = Number(rawValue.replace(",", "."));
    if (!parsed || parsed <= 0) {
      setServingInputs((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      return;
    }

    const rounded = Math.round(parsed * 100) / 100;
    onUpdateEntry(entry.id, { servings: rounded });
    setServingInputs((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
  };

  const dayEntries = dayPlan?.entries || [];
  const selectedEntryIds = Object.entries(selectedEntries)
    .filter(([, checked]) => checked)
    .map(([id]) => Number(id))
    .filter((id) => Number.isFinite(id));

  const deleteEntries = (entryIds: number[]) => {
    entryIds.forEach((id) => onDeleteMeal({ id, date: dateStr }));
    setSelectedEntries((prev) => {
      const next = { ...prev };
      entryIds.forEach((id) => {
        delete next[id];
      });
      return next;
    });
  };

  const clearPersonDay = (person: "A" | "B") => {
    const ids = dayEntries
      .filter((entry: any) => (entry.person || "A") === person)
      .map((entry: any) => Number(entry.id))
      .filter((id: number) => Number.isFinite(id));
    deleteEntries(ids);
  };

  const clearWholeDay = () => {
    const ids = dayEntries
      .map((entry: any) => Number(entry.id))
      .filter((id: number) => Number.isFinite(id));
    deleteEntries(ids);
  };

  return (
    <div id={sectionId} className={cn("space-y-6", isToday && "bg-primary/5 -mx-4 px-4 py-8 rounded-3xl border border-primary/10")}>
      <div className="flex flex-col md:flex-row md:items-baseline gap-4 mb-4">
        <div className="flex flex-wrap items-baseline gap-2 sm:gap-4">
          <h2 className="text-2xl font-bold font-display">{format(day, "EEEE", { locale: pl })}</h2>
          <span className="text-muted-foreground">{format(day, "d MMMM", { locale: pl })}</span>
          {isToday && <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded-full">Dzisiaj</span>}
        </div>

        {dayEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={selectedEntryIds.length === 0}
              onClick={() => deleteEntries(selectedEntryIds)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Usuń zaznaczone ({selectedEntryIds.length})
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => clearPersonDay("A")}>Wyczyść dzień Tysi</Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => clearPersonDay("B")}>Wyczyść dzień Matiego</Button>
            <Button variant="destructive" size="sm" className="h-8" onClick={clearWholeDay}>Wyczyść cały dzień</Button>
          </div>
        )}

        {dayPlan && (
          <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-4">
            {people.map((person) => (
              <div key={person} className="rounded-2xl border border-border/60 bg-white/60 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">{personName[person]}</span>
                  <span className="text-[11px] text-muted-foreground">Koszt dnia: {personSummary[person].price.toFixed(2)} PLN</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <div className="flex flex-col items-center bg-white px-3 py-1 rounded-xl border border-border shadow-sm min-w-[70px]">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">kcal</span>
                    <span className="text-sm font-bold text-primary">{personSummary[person].calories}</span>
                  </div>
                  <div className="flex flex-col items-center bg-white px-3 py-1 rounded-xl border border-border shadow-sm min-w-[60px]">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">P</span>
                    <span className="text-sm font-bold text-blue-600">{personSummary[person].protein}g</span>
                  </div>
                  <div className="flex flex-col items-center bg-white px-3 py-1 rounded-xl border border-border shadow-sm min-w-[60px]">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">C</span>
                    <span className="text-sm font-bold text-amber-600">{personSummary[person].carbs}g</span>
                  </div>
                  <div className="flex flex-col items-center bg-white px-3 py-1 rounded-xl border border-border shadow-sm min-w-[60px]">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">F</span>
                    <span className="text-sm font-bold text-rose-600">{personSummary[person].fat}g</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stabilized render tree for dual-person meal plan layout */}
      {isLoading ? <LoadingSpinner /> : (
        <div className="space-y-5">
          {sharedEntries.length > 0 && (
            <div id="shared-meals" className="space-y-2 rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-3">
              <div className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Wspólne posiłki (Tysia + Mati)</div>
              <div className="space-y-1.5">
                {sharedEntries.map((shared: any, idx: number) => (
                  <div key={`shared-${shared.mealType}-${shared.recipe?.id}-${idx}`} className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{shared.recipe?.name}</p>
                      <button
                        onClick={() => onViewPlannedRecipe(shared.recipe, { ...shared.entryA, servings: shared.servings, ingredients: shared.ingredients }, { shared: true })}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Podgląd wspólny"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {people.map((person) => (
            <div key={person} className="space-y-2">
              <div className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{personName[person]}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {["breakfast", "lunch", "dinner", "snack"].map((mealType) => {
                  const entries = dayPlan?.entries.filter((e: any) => e.mealType === mealType && (e.person || "A") === person) || [];

                  return (
                    <div key={`${person}-${mealType}`} className="bg-white rounded-xl p-3 shadow-sm border border-border/50 flex flex-col min-h-[150px]">
                      <div className="flex items-center justify-between mb-2 border-b border-border/50 pb-1.5">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          {mealType === "breakfast" ? "Śniadanie" : mealType === "lunch" ? "Obiad" : mealType === "dinner" ? "Kolacja" : "Przekąska"}
                        </h3>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => onAddIngredient(mealType, dateStr, person)} title="Dodaj składnik">
                            <Carrot className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => onAddCustom(mealType, dateStr, person)} title="Add Custom">
                            <Plus className="w-3 h-3 border rounded-full p-0.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => onAddMeal(mealType, dateStr, person)} title="Add Recipe">
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2 flex-1">
                        {entries.map((entry: any) => (
                          <div key={entry.id} className="group relative flex items-center gap-3 bg-background p-2 rounded-xl border border-border">
                            <input
                              type="checkbox"
                              checked={!!selectedEntries[entry.id]}
                              onChange={(e) => setSelectedEntries((prev) => ({ ...prev, [entry.id]: e.target.checked }))}
                              aria-label={`Zaznacz posiłek ${entry.recipe?.name || entry.customName}`}
                              className="h-4 w-4"
                            />
                            {entry.recipe ? (
                              <div className="w-10 h-10 rounded-lg bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${entry.recipe.imageUrl})` }} />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                <Plus className="w-5 h-5 text-muted-foreground/30" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className={cn("text-sm font-semibold truncate", entry.isEaten && "line-through text-muted-foreground")}>
                                  {entry.recipe?.name || entry.customName}
                                </p>
                                {entry.recipe && (
                                  <button onClick={() => onViewPlannedRecipe(entry.recipe, entry)} className="text-muted-foreground hover:text-primary transition-colors">
                                    <Eye className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {!entry.recipe && (
                                <p className="text-[10px] text-muted-foreground">
                                  {entry.ingredients?.length ? `${entry.ingredients[0]?.amount || 0} g` : "Custom Item"}
                                </p>
                              )}
                              <div className="flex items-center gap-1 mt-1">
                                {!entry.recipe && entry.ingredients?.length ? (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => {
                                      const currentAmount = Number(entry.ingredients[0]?.amount) || 0;
                                      const nextAmount = Math.max(1, currentAmount - 10);
                                      onUpdateEntry(entry.id, { ingredients: [{ ingredientId: entry.ingredients[0].ingredientId, amount: nextAmount }] });
                                    }}>
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <span className="text-[10px] font-medium text-center min-w-[42px]">{entry.ingredients[0]?.amount || 0} g</span>
                                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => {
                                      const currentAmount = Number(entry.ingredients[0]?.amount) || 0;
                                      onUpdateEntry(entry.id, { ingredients: [{ ingredientId: entry.ingredients[0].ingredientId, amount: currentAmount + 10 }] });
                                    }}>
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0 rounded-full" onClick={() => onUpdateEntry(entry.id, { servings: Math.max(0.5, (Number(entry.servings) || 1) - 0.5) })}>
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <div className="flex items-center gap-1 min-w-0">
                                      <Input
                                        type="number"
                                        inputMode="decimal"
                                        min={0.5}
                                        step={0.5}
                                        className="h-5 w-10 sm:w-12 text-[10px] font-medium px-1 py-0 text-center"
                                        value={servingInputs[entry.id] ?? String(Number(entry.servings) || 1)}
                                        onChange={(e) => setServingInputs((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                                        onBlur={() => applyServingInput(entry)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.currentTarget.blur();
                                          }
                                        }}
                                        aria-label="Liczba porcji"
                                      />
                                      {entry.recipe && (
                                        <span className="text-[8px] sm:text-[9px] font-medium text-muted-foreground whitespace-nowrap">/ {Number(entry.recipe.servings) || 1}</span>
                                      )}
                                    </div>
                                    <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0 rounded-full" onClick={() => onUpdateEntry(entry.id, { servings: (Number(entry.servings) || 1) + 0.5 })}>
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center">
                              <button onClick={() => onToggleEaten({ id: entry.id, isEaten: !entry.isEaten })} className={cn("p-1 rounded-md transition-colors", entry.isEaten ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-muted")}>
                                {entry.isEaten ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                              </button>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1">
                                    <X className="w-4 h-4" />
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove from plan?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Remove "{entry.recipe?.name || entry.customName}" from {format(day, "EEEE", { locale: pl })}'s plan?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDeleteMeal({ id: entry.id, date: dateStr })} className="bg-red-500 hover:bg-red-600">
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        ))}

                        {entries.length === 0 && (
                          <div className="flex items-center justify-center h-full text-muted-foreground/30 italic text-xs py-4">
                            Empty
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        )}
      {/* End of DaySection content */}
    </div>
  );
}
