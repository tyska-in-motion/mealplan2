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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Meal Plan – kalendarz</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-44 text-center font-semibold">
              {format(currentMonth, "LLLL yyyy", { locale: pl })}
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
