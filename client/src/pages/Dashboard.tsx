import { useDayPlan, useUpdateMealEntry, useToggleEaten, useAddMealEntry } from "@/hooks/use-meal-plan";
import { useIngredients } from "@/hooks/use-ingredients";
import { useRecipes } from "@/hooks/use-recipes";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, subDays, startOfWeek, endOfWeek } from "date-fns";
import { pl } from "date-fns/locale";
import { Layout } from "@/components/Layout";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Flame, CheckCircle2, Circle, CalendarDays, ChevronLeft, ChevronRight, Settings2, Wallet, Eye, Check, ChevronsUpDown, X, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { api } from "@shared/routes";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { RecipeView } from "@/components/RecipeView";
import { calculateScaledAmount } from "@shared/scaling";

export default function Dashboard() {
  type PersonTargets = { calories: number; protein: number; carbs: number; fat: number };
  type MacroStats = { calories: number; protein: number; carbs: number; fat: number };
  const [date, setDate] = useState(new Date());
  const dateStr = format(date, "yyyy-MM-dd");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: dayPlan, isLoading: isLoadingPlan } = useDayPlan(dateStr);
  const { mutate: toggleEaten } = useToggleEaten();
  const [viewingRecipe, setViewingRecipe] = useState<any>(null);
  const [viewingMeal, setViewingMeal] = useState<any>(null);
  const [viewingPlannedServings, setViewingPlannedServings] = useState<number | undefined>(undefined);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddMode, setQuickAddMode] = useState<"recipe" | "custom">("recipe");
  const [quickMealType, setQuickMealType] = useState("lunch");
  const [quickPerson, setQuickPerson] = useState<"A" | "B">("A");
  const [quickRecipeId, setQuickRecipeId] = useState<number | null>(null);
  const [quickCustomName, setQuickCustomName] = useState("");
  const [quickCustomCalories, setQuickCustomCalories] = useState<number>(450);
  const [quickCustomProtein, setQuickCustomProtein] = useState<number>(25);
  const [quickCustomCarbs, setQuickCustomCarbs] = useState<number>(45);
  const [quickCustomFat, setQuickCustomFat] = useState<number>(15);
  const [servingInputs, setServingInputs] = useState<Record<string, string>>({});
  const [targetsByPerson, setTargetsByPerson] = useState<Record<"A" | "B", PersonTargets>>({
    A: { calories: 1850, protein: 120, carbs: 205, fat: 61 },
    B: { calories: 2700, protein: 170, carbs: 302, fat: 90 },
  });

  const [isEditingIngredients, setIsEditingIngredients] = useState(false);
  const [editingMealIngredients, setEditingMealIngredients] = useState<any[]>([]);
  const { data: allAvailableIngredients } = useIngredients();
  const { toast } = useToast();

  const { mutate: updateMealEntry, isPending: isSaving } = useUpdateMealEntry();
  const { mutate: addEntry, isPending: isQuickAdding } = useAddMealEntry();
  const { data: recipes } = useRecipes();
  const weekStart = format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { data: shoppingListExcludedIds = [] } = useQuery<number[]>({
    queryKey: ["/api/shopping-list/exclusions", weekStart, weekEnd],
    queryFn: async () => {
      const response = await fetch(`/api/shopping-list/exclusions?startDate=${weekStart}&endDate=${weekEnd}`);
      if (!response.ok) return [];
      return response.json();
    },
  });

  const frequentAddonIngredientIds = useMemo(() => new Set(
    (viewingRecipe?.frequentAddons || []).map((addon: any) => Number(addon.ingredientId))
  ), [viewingRecipe?.frequentAddons]);
  const frequentAddonDefinitions = viewingRecipe?.frequentAddons || [];
  const getAddonBaseAmount = (addon: any) => Number(addon?.baseAmount ?? addon?.amount) || 0;

  const availableIngredientIds = useMemo(() => {
    const alwaysAtHomeIds = (allAvailableIngredients || [])
      .filter((ingredient: any) => ingredient.alwaysAtHome)
      .map((ingredient: any) => Number(ingredient.id));

    const manualIds = (shoppingListExcludedIds || []).map((id) => Number(id));
    return Array.from(new Set([...alwaysAtHomeIds, ...manualIds]));
  }, [allAvailableIngredients, shoppingListExcludedIds]);

  const getIngredientServingFactor = (ingredientId: number, entryServings: number, recipeServings: number) => {
    if (frequentAddonIngredientIds.has(Number(ingredientId))) return 1;
    return entryServings / recipeServings;
  };

  const resolveRecipeIngredientSource = (ingredientId: number, occurrence: number) => {
    if (!viewingRecipe) return undefined;
    const recipeIngredients = (viewingRecipe.ingredients || []).filter((ri: any) => Number(ri?.ingredientId) === Number(ingredientId));
    const recipeFrequentAddons = (viewingRecipe.frequentAddons || []).filter((ri: any) => Number(ri?.ingredientId) === Number(ingredientId));
    const candidates = [...recipeIngredients, ...recipeFrequentAddons];
    return candidates[occurrence - 1] || candidates[0];
  };

  const convertDisplayedAmountToStoredAmount = (ingredient: any, entryServings: number, recipeServings: number) => {
    const displayAmount = Number(ingredient?.amount) || 0;
    const scalingType = ingredient?.scalingType || "LINEAR";

    if (scalingType === "LINEAR") {
      const factor = getIngredientServingFactor(Number(ingredient?.ingredientId), entryServings, recipeServings);
      return Math.round(displayAmount / (factor || 1));
    }

    return Math.round(displayAmount);
  };

  const getEntryIngredientServingFactor = (entry: any, ingredientId: number) => {
    const entryServings = Number(entry?.servings) || 1;
    const recipeServings = Number(entry?.recipe?.servings) || 1;
    const frequentAddonIds = new Set<number>(((entry?.recipe?.frequentAddons) || []).map((addon: any) => Number(addon.ingredientId)));
    if (frequentAddonIds.has(Number(ingredientId))) return 1;
    return entryServings / recipeServings;
  };

  const getEffectiveIngredientAmount = (entry: any, ri: any) => {
    if (typeof ri?.calculatedAmount === "number") return ri.calculatedAmount;
    const factor = getEntryIngredientServingFactor(entry, ri.ingredientId);
    return (Number(ri?.amount) || 0) * factor;
  };


  const startEditing = () => {
    if (!viewingRecipe || !viewingMeal) return;

    const currentIngredients = (viewingMeal?.ingredients && viewingMeal.ingredients.length > 0)
      ? viewingMeal.ingredients
      : viewingRecipe.ingredients;
    
    const entryServings = viewingMeal ? (Number(viewingMeal.servings) || 1) : 1;
    const recipeServings = Number(viewingRecipe.servings) || 1;
    const recipeIngredientCounts = (viewingRecipe.ingredients || []).reduce((acc: Map<number, number>, ingredient: any) => {
      const ingredientId = Number(ingredient?.ingredientId);
      if (!Number.isFinite(ingredientId)) return acc;
      acc.set(ingredientId, (acc.get(ingredientId) || 0) + 1);
      return acc;
    }, new Map<number, number>());
    const occurrenceMap = new Map<number, number>();

    const mappedIngredients = currentIngredients.map((ri: any) => {
      const ingredientId = Number(ri.ingredientId);
      const occurrence = (occurrenceMap.get(ingredientId) || 0) + 1;
      occurrenceMap.set(ingredientId, occurrence);
      const recipeCount = recipeIngredientCounts.get(ingredientId) || 0;
      const isFrequentAddon = frequentAddonIngredientIds.has(ingredientId) && occurrence > recipeCount;

      const source = resolveRecipeIngredientSource(ingredientId, occurrence);
      const ingredientForScaling = {
        ...source,
        ...ri,
        baseAmount: Number(ri?.baseAmount ?? ri?.amount ?? source?.baseAmount ?? source?.amount ?? 0) || 0,
        scalingType: ri?.scalingType ?? source?.scalingType ?? "LINEAR",
        scalingFormula: ri?.scalingFormula ?? source?.scalingFormula,
        stepThresholds: ri?.stepThresholds ?? source?.stepThresholds,
      };

      return {
        ingredientId: ri.ingredientId,
        amount: Math.round(calculateScaledAmount(ingredientForScaling as any, entryServings, recipeServings)),
        ingredient: ri.ingredient,
        isFrequentAddon,
        scalingType: ingredientForScaling.scalingType,
        scalingFormula: ingredientForScaling.scalingFormula,
        stepThresholds: ingredientForScaling.stepThresholds,
      };
    });

    setEditingMealIngredients([
      ...mappedIngredients.filter((item: any) => !item.isFrequentAddon),
      ...mappedIngredients.filter((item: any) => item.isFrequentAddon),
    ]);
    setIsEditingIngredients(true);
  };

  const addIngredientToEdit = () => {
    setEditingMealIngredients([...editingMealIngredients, { ingredientId: 0, amount: 100, ingredient: null }]);
  };

  const addFrequentAddonToEdit = (addon: any) => {
    const addonIngredientId = Number(addon.ingredientId);
    const addonStep = getAddonBaseAmount(addon);
    if (!addonIngredientId || addonStep <= 0) return;

    setEditingMealIngredients((prev) => {
      const existingIndex = prev.findIndex((item: any) => Number(item.ingredientId) === addonIngredientId && item.isFrequentAddon);
      if (existingIndex >= 0) {
        return prev.map((item: any, idx: number) =>
          idx === existingIndex
            ? { ...item, amount: Number(item.amount || 0) + addonStep, isFrequentAddon: true }
            : item
        );
      }

      return [...prev, {
        ingredientId: addonIngredientId,
        amount: addonStep,
        ingredient: addon.ingredient || null,
        isFrequentAddon: true,
      }];
    });
  };

  const updateIngredientInEdit = (index: number, updates: any) => {
    const newIngredients = [...editingMealIngredients];
    newIngredients[index] = { ...newIngredients[index], ...updates };
    if (updates.ingredientId && allAvailableIngredients) {
      newIngredients[index].ingredient = allAvailableIngredients.find((i: any) => i.id === updates.ingredientId);
      newIngredients[index].isFrequentAddon = frequentAddonIngredientIds.has(Number(updates.ingredientId));
    }
    setEditingMealIngredients(newIngredients);
  };

  const removeIngredientFromEdit = (index: number) => {
    setEditingMealIngredients(editingMealIngredients.filter((_, i) => i !== index));
  };

  const updateViewingMealServings = (nextServings: number) => {
    if (!viewingMeal) return;
    const safeServings = Math.max(0.5, Math.round(nextServings * 2) / 2);
    setViewingPlannedServings(safeServings);
    setViewingMeal((prev: any) => (prev ? { ...prev, servings: safeServings } : prev));
    updateMealEntry({
      id: viewingMeal.id,
      updates: {
        servings: safeServings,
        isEaten: !!viewingMeal.isEaten,
        date: viewingMeal.date,
        mealType: viewingMeal.mealType,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/meal-plan/${dateStr}`] });
      },
    });
  };

  const saveIngredients = () => {
    if (!viewingMeal || !viewingRecipe) return;
    
    const entryServings = Number(viewingMeal.servings) || 1;
    const recipeServings = Number(viewingRecipe.servings) || 1;
    const ingredientsData = editingMealIngredients
      .filter(i => i.ingredientId > 0)
      .map(i => ({ 
        ingredientId: Number(i.ingredientId), 
        amount: convertDisplayedAmountToStoredAmount(i, entryServings, recipeServings),
      }));

    if (ingredientsData.length === 0) {
      toast({ title: "Błąd", description: "Dodaj przynajmniej jeden składnik.", variant: "destructive" });
      return;
    }

    updateMealEntry({
      id: viewingMeal.id,
      updates: { 
        ingredients: ingredientsData, 
        servings: entryServings,
        isEaten: !!viewingMeal.isEaten,
        date: viewingMeal.date,
        mealType: viewingMeal.mealType
      }
    }, {
      onSuccess: () => {
        // Force immediate invalidation on success to be absolutely sure
        queryClient.invalidateQueries({ queryKey: [`/api/meal-plan/${dateStr}`] });
        setIsEditingIngredients(false);
        setViewingRecipe(null);
        setViewingMeal(null);
        toast({ title: "Sukces", description: "Składniki posiłku zostały zaktualizowane." });
      }
    });
  };

  const { data: settings, isLoading: isLoadingSettings } = useQuery<any>({
    queryKey: ["/api/user-settings"],
  });

  useEffect(() => {
    if (!settings) return;
    const baseTargets = {
      A: {
        calories: settings?.A?.targetCalories ?? 2000,
        protein: settings?.A?.targetProtein ?? 150,
        carbs: settings?.A?.targetCarbs ?? 200,
        fat: settings?.A?.targetFat ?? 65,
      },
      B: {
        calories: settings?.B?.targetCalories ?? settings?.A?.targetCalories ?? 2000,
        protein: settings?.B?.targetProtein ?? settings?.A?.targetProtein ?? 150,
        carbs: settings?.B?.targetCarbs ?? settings?.A?.targetCarbs ?? 200,
        fat: settings?.B?.targetFat ?? settings?.A?.targetFat ?? 65,
      },
    };

    let localOverrides: any = {};
    try {
      localOverrides = JSON.parse(localStorage.getItem("dashboard-person-targets") || "{}");
    } catch {
      localOverrides = {};
    }

    setTargetsByPerson({
      A: {
        calories: Number(localOverrides?.A?.calories ?? baseTargets.A.calories),
        protein: Number(localOverrides?.A?.protein ?? baseTargets.A.protein),
        carbs: Number(localOverrides?.A?.carbs ?? baseTargets.A.carbs),
        fat: Number(localOverrides?.A?.fat ?? baseTargets.A.fat),
      },
      B: {
        calories: Number(localOverrides?.B?.calories ?? baseTargets.B.calories),
        protein: Number(localOverrides?.B?.protein ?? baseTargets.B.protein),
        carbs: Number(localOverrides?.B?.carbs ?? baseTargets.B.carbs),
        fat: Number(localOverrides?.B?.fat ?? baseTargets.B.fat),
      },
    });
  }, [settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: any) => {
      const res = await apiRequest("PATCH", "/api/user-settings", newSettings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
    },
  });

  const isToday = dateStr === todayStr;
  const allEntries = dayPlan?.entries || [];
  const personName: Record<string, string> = { A: "Tysia", B: "Mati" };

  const calculateConsumed = (entries: any[]): MacroStats => {
    const eatenEntries = entries.filter((e: any) => e.isEaten) || [];

    return eatenEntries.reduce((acc: any, entry: any) => {
      if (entry.customCalories !== null) {
        const s = Number(entry.servings) || 1;
        return {
          ...acc,
          calories: acc.calories + (entry.customCalories || 0) * s,
          protein: acc.protein + (entry.customProtein || 0) * s,
          carbs: acc.carbs + (entry.customCarbs || 0) * s,
          fat: acc.fat + (entry.customFat || 0) * s,
        };
      }

      const recipe = entry.recipe;
      const entryIngredients = entry.ingredients.length > 0 ? entry.ingredients : (recipe?.ingredients || []);
      const stats = entryIngredients.reduce((sum: any, ri: any) => {
        if (!ri.ingredient) return sum;
        const effectiveAmount = getEffectiveIngredientAmount(entry, ri);
        return {
          calories: sum.calories + (ri.ingredient.calories * effectiveAmount / 100),
          protein: sum.protein + (ri.ingredient.protein * effectiveAmount / 100),
          carbs: sum.carbs + (ri.ingredient.carbs * effectiveAmount / 100),
          fat: sum.fat + (ri.ingredient.fat * effectiveAmount / 100),
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      return {
        calories: acc.calories + stats.calories,
        protein: acc.protein + stats.protein,
        carbs: acc.carbs + stats.carbs,
        fat: acc.fat + stats.fat,
      };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  };


  if (isLoadingPlan || isLoadingSettings) return <Layout><LoadingSpinner /></Layout>;

  const consumedA = calculateConsumed(allEntries.filter((e: any) => (e.person || "A") === "A"));
  const consumedB = calculateConsumed(allEntries.filter((e: any) => (e.person || "A") === "B"));

  const totalDayCost = (dayPlan?.entries || []).reduce((acc: number, entry: any) => {
    const recipe = entry.recipe;
    const entryIngredients = entry.ingredients.length > 0 ? entry.ingredients : (recipe?.ingredients || []);
    return acc + entryIngredients.reduce((sum: number, ri: any) => {
      const effectiveAmount = getEffectiveIngredientAmount(entry, ri);
      return sum + ((ri.ingredient?.price || 0) * effectiveAmount / 100);
    }, 0);
  }, 0) || 0;

  const resetQuickAdd = () => {
    setQuickAddMode("recipe");
    setQuickMealType("lunch");
    setQuickPerson("A");
    setQuickRecipeId(null);
    setQuickCustomName("");
    setQuickCustomCalories(450);
    setQuickCustomProtein(25);
    setQuickCustomCarbs(45);
    setQuickCustomFat(15);
  };

  const updatePersonTargets = (person: "A" | "B", key: keyof PersonTargets, value: number) => {
    const next = {
      ...targetsByPerson,
      [person]: {
        ...targetsByPerson[person],
        [key]: Number(value) || 0,
      },
    };
    setTargetsByPerson(next);
    localStorage.setItem("dashboard-person-targets", JSON.stringify(next));

    const mapKey: Record<keyof PersonTargets, string> = {
      calories: "targetCalories",
      protein: "targetProtein",
      carbs: "targetCarbs",
      fat: "targetFat",
    };
    updateSettingsMutation.mutate({ person, [mapKey[key]]: Number(value) || 0 });
  };

  const macrosConfig: { key: keyof MacroStats; label: string; unit: string; barClassName: string }[] = [
    { key: "calories", label: "Kcal", unit: "kcal", barClassName: "bg-primary" },
    { key: "protein", label: "Białko", unit: "g", barClassName: "bg-blue-500" },
    { key: "fat", label: "Tłuszcze", unit: "g", barClassName: "bg-rose-500" },
    { key: "carbs", label: "Węglowodany", unit: "g", barClassName: "bg-amber-500" },
  ];

  const getProgressValue = (current: number, target: number) => {
    if (target <= 0) return 0;
    return Math.min((current / target) * 100, 100);
  };

  const renderMacroTiles = (title: string, consumedPerson: MacroStats, targets: PersonTargets) => (
    <div className="rounded-2xl border border-border/50 bg-white p-4 md:p-5 shadow-sm">
      <p className="mb-4 text-sm font-semibold text-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {macrosConfig.map((macro) => (
          <div key={macro.key} className="rounded-xl border border-border/60 bg-card p-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">{macro.label}</p>
              <p className="text-xs text-muted-foreground">
                {Math.round(consumedPerson[macro.key])} / {Math.round(targets[macro.key])} {macro.unit}
              </p>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", macro.barClassName)}
                style={{ width: `${getProgressValue(consumedPerson[macro.key], targets[macro.key])}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {Math.round(getProgressValue(consumedPerson[macro.key], targets[macro.key]))}% celu
            </p>
          </div>
        ))}
      </div>
    </div>
  );


  const getServingInputKey = (entry: any) => `${entry.id}-${entry.person || "A"}`;

  const updateServingsQuick = (entry: any, nextServings: number) => {
    const parsed = Number(nextServings);
    if (!parsed || parsed <= 0) return;

    updateMealEntry({
      id: entry.id,
      updates: {
        servings: parsed,
        isEaten: !!entry.isEaten,
        person: entry.person || "A",
        date: entry.date,
        mealType: entry.mealType,
      },
    });
  };

  const applyServingInput = (entry: any) => {
    const inputKey = getServingInputKey(entry);
    const rawValue = servingInputs[inputKey];
    if (rawValue === undefined) return;
    const parsed = Number(rawValue.replace(",", "."));
    if (!parsed || parsed <= 0) {
      setServingInputs((prev) => {
        const next = { ...prev };
        delete next[inputKey];
        return next;
      });
      return;
    }

    const rounded = Math.round(parsed * 100) / 100;
    updateServingsQuick(entry, rounded);
    setServingInputs((prev) => {
      const next = { ...prev };
      delete next[inputKey];
      return next;
    });
  };

  const handleQuickAddMeal = () => {
    if (quickAddMode === "recipe") {
      if (!quickRecipeId) {
        toast({ title: "Błąd", description: "Wybierz przepis.", variant: "destructive" });
        return;
      }

      addEntry({
        date: dateStr,
        mealType: quickMealType,
        person: quickPerson,
        recipeId: quickRecipeId,
        servings: 1,
        isEaten: true,
      }, {
        onSuccess: () => {
          setIsQuickAddOpen(false);
          resetQuickAdd();
          toast({ title: "Dodano", description: "Posiłek został dodany do planu i oznaczony jako zjedzony." });
        },
      });
      return;
    }

    if (!quickCustomName.trim()) {
      toast({ title: "Błąd", description: "Podaj nazwę posiłku.", variant: "destructive" });
      return;
    }

    addEntry({
      date: dateStr,
      mealType: quickMealType,
      person: quickPerson,
      customName: quickCustomName.trim(),
      customCalories: Number(quickCustomCalories) || 0,
      customProtein: Number(quickCustomProtein) || 0,
      customCarbs: Number(quickCustomCarbs) || 0,
      customFat: Number(quickCustomFat) || 0,
      servings: 1,
      isEaten: true,
      recipeId: null as any,
    }, {
      onSuccess: () => {
        setIsQuickAddOpen(false);
        resetQuickAdd();
        toast({ title: "Dodano", description: "Posiłek został dodany do planu i oznaczony jako zjedzony." });
      },
    });
  };

  return (
    <Layout>
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Witaj! 🌱</h1>
          <div className="flex items-center gap-4">
            <p className="text-muted-foreground text-lg">
              {isToday ? "Podsumowanie na dziś," : "Podsumowanie na"} <span className="font-semibold text-foreground">{format(date, "EEEE, d MMMM", { locale: pl })}</span>
            </p>
            <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full text-primary font-bold text-sm">
              <Wallet className="w-4 h-4" />
              {Math.round(totalDayCost)} PLN
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isQuickAddOpen} onOpenChange={(open) => {
            setIsQuickAddOpen(open);
            if (!open) resetQuickAdd();
          }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl gap-2">
                <PlusCircle className="w-4 h-4" />
                Szybkie dodanie
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl bg-white">
              <DialogHeader>
                <DialogTitle>Szybko dodaj zjedzony posiłek</DialogTitle>
                <DialogDescription>Wybierz osobę i dodaj zjedzony posiłek z przepisu lub jako własny wpis.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Typ posiłku</label>
                    <Select value={quickMealType} onValueChange={setQuickMealType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="breakfast">Śniadanie</SelectItem>
                        <SelectItem value="lunch">Obiad</SelectItem>
                        <SelectItem value="dinner">Kolacja</SelectItem>
                        <SelectItem value="snack">Przekąska</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Osoba</label>
                    <Select value={quickPerson} onValueChange={(v: "A" | "B") => setQuickPerson(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A">Tysia</SelectItem>
                        <SelectItem value="B">Mati</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant={quickAddMode === "recipe" ? "default" : "outline"} onClick={() => setQuickAddMode("recipe")} className="flex-1">
                    Z przepisu
                  </Button>
                  <Button type="button" variant={quickAddMode === "custom" ? "default" : "outline"} onClick={() => setQuickAddMode("custom")} className="flex-1">
                    Własny posiłek
                  </Button>
                </div>

                {quickAddMode === "recipe" ? (
                  <div>
                    <label className="text-sm font-medium">Przepis</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className={cn("w-full justify-between", !quickRecipeId && "text-muted-foreground")}>
                          {quickRecipeId ? recipes?.find((r) => r.id === quickRecipeId)?.name : "Wybierz przepis..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[440px] p-0">
                        <Command>
                          <CommandInput placeholder="Szukaj przepisu..." />
                          <CommandList>
                            <CommandEmpty>Nie znaleziono przepisu.</CommandEmpty>
                            <CommandGroup>
                              {recipes?.map((recipe) => (
                                <CommandItem key={recipe.id} value={recipe.name} onSelect={() => setQuickRecipeId(recipe.id)}>
                                  <Check className={cn("mr-2 h-4 w-4", quickRecipeId === recipe.id ? "opacity-100" : "opacity-0")} />
                                  {recipe.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">Nazwa posiłku</label>
                      <Input value={quickCustomName} onChange={(e) => setQuickCustomName(e.target.value)} placeholder="np. Kanapka po treningu" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-sm font-medium">Kalorie</label><Input type="number" value={quickCustomCalories} onChange={(e) => setQuickCustomCalories(Number(e.target.value))} /></div>
                      <div><label className="text-sm font-medium">Białko (g)</label><Input type="number" value={quickCustomProtein} onChange={(e) => setQuickCustomProtein(Number(e.target.value))} /></div>
                      <div><label className="text-sm font-medium">Węglowodany (g)</label><Input type="number" value={quickCustomCarbs} onChange={(e) => setQuickCustomCarbs(Number(e.target.value))} /></div>
                      <div><label className="text-sm font-medium">Tłuszcz (g)</label><Input type="number" value={quickCustomFat} onChange={(e) => setQuickCustomFat(Number(e.target.value))} /></div>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsQuickAddOpen(false)}>Anuluj</Button>
                <Button onClick={handleQuickAddMeal} disabled={isQuickAdding}>{isQuickAdding ? "Dodawanie..." : "Dodaj i oznacz jako zjedzone"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl">
                <Settings2 className="w-5 h-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ustawienia celów (osobno dla każdej osoby)</DialogTitle>
                <DialogDescription>Ustaw dzienne cele kalorii i makroskładników niezależnie dla Tysi oraz Matiego.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {(["A", "B"] as const).map((person) => (
                  <div key={person} className="space-y-3 rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold">{personName[person]}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Kalorie (kcal)</label>
                        <Input
                          type="number"
                          value={targetsByPerson[person].calories}
                          onChange={(e) => updatePersonTargets(person, "calories", Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Białko (g)</label>
                        <Input
                          type="number"
                          value={targetsByPerson[person].protein}
                          onChange={(e) => updatePersonTargets(person, "protein", Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Węglowodany (g)</label>
                        <Input
                          type="number"
                          value={targetsByPerson[person].carbs}
                          onChange={(e) => updatePersonTargets(person, "carbs", Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Tłuszcze (g)</label>
                        <Input
                          type="number"
                          value={targetsByPerson[person].fat}
                          onChange={(e) => updatePersonTargets(person, "fat", Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-border shadow-sm">
            <button 
              onClick={() => setDate(d => subDays(d, 1))} 
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setDate(new Date())}
              className={cn(
                "px-3 py-1 text-sm font-medium rounded-lg transition-colors",
                isToday ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
              )}
            >
              Today
            </button>
            <button 
              onClick={() => setDate(d => addDays(d, 1))} 
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-4 mb-8">
        {renderMacroTiles("Tysia", consumedA, targetsByPerson.A)}
        {renderMacroTiles("Mati", consumedB, targetsByPerson.B)}
      </div>

      <RecipeView 
        recipe={viewingRecipe}
        isOpen={!!viewingRecipe}
        onClose={() => {
          setViewingRecipe(null);
          setViewingMeal(null);
          setViewingPlannedServings(undefined);
        }}
        plannedServings={viewingPlannedServings ?? (viewingMeal ? Number(viewingMeal.servings) : undefined)}
        mealEntryIngredients={viewingMeal?.ingredients}
        frequentAddonIds={viewingRecipe?.frequentAddons?.map((addon: any) => addon.ingredientId) || []}
        availableIngredientIds={availableIngredientIds}
        onEditIngredients={startEditing}
        onPlannedServingsChange={viewingMeal ? updateViewingMealServings : undefined}
        showFooter={false}
        onAddToPlan={() => {}} 
      />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Menu na {isToday ? "dziś" : format(date, "eeee", { locale: pl })}</h2>
          <div className="flex items-center gap-4">
            <Link href={`/meal-plan?date=${dateStr}#shared-meals`}>
              <span className="text-emerald-700 text-sm font-semibold hover:underline cursor-pointer">Wspólne posiłki</span>
            </Link>
            <Link href={`/meal-plan?date=${dateStr}`}>
              <span className="text-primary text-sm font-semibold hover:underline cursor-pointer">Edytuj Plan</span>
            </Link>
          </div>
        </div>

        {allEntries.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-border">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <CalendarDays className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Brak zaplanowanych posiłków na ten dzień</h3>
            <p className="text-muted-foreground mb-4">Zacznij dodawać zdrowe przepisy do swojego harmonogramu!</p>
            <Link href={`/meal-plan?date=${dateStr}`}>
              <button className="bg-primary text-primary-foreground px-6 py-2 rounded-xl font-medium hover:bg-primary/90 transition-colors">
                Zaplanuj posiłki
              </button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {["breakfast", "lunch", "dinner", "snack"].map((type) => {
              const meals = allEntries.filter((e: any) => e.mealType === type);
              if (!meals?.length) return null;

              return (
                <div key={type} className="bg-white rounded-2xl p-5 shadow-sm border border-border/50">
                  <h3 className="uppercase text-xs font-bold text-muted-foreground tracking-wider mb-4">{type}</h3>
                  <div className="space-y-3">
                    {meals.map((meal: any) => (
                      <div key={meal.id} className="flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => toggleEaten({ id: meal.id, isEaten: !meal.isEaten })}
                            className={cn(
                              "transition-all duration-300",
                              meal.isEaten ? "text-primary" : "text-muted-foreground hover:text-primary/70"
                            )}
                          >
                            {meal.isEaten ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                          </button>
                          <div className="flex flex-col flex-1">
                            <div className="flex items-center gap-2">
                              <p className={cn(
                                "font-medium text-lg transition-all",
                                meal.isEaten && "text-muted-foreground line-through decoration-primary/50"
                              )}>
                                {meal.recipe?.name || meal.customName}
                              </p>
                              {meal.recipe && (
                                <button 
                                  onClick={() => {
                                    setViewingRecipe(meal.recipe);
                                    setViewingMeal(meal);
                                  }}
                                  className="text-muted-foreground hover:text-primary p-1 rounded-full hover:bg-secondary transition-colors"
                                  title="Pokaż przepis"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              {meal.recipe ? (
                                <span className="text-[9px] sm:text-[10px] font-bold text-primary bg-primary/10 px-1.5 sm:px-2 py-0.5 rounded-full whitespace-nowrap">
                                  {personName[meal.person || "A"]}: {(Number(meal.servings) || 1)}/{(Number(meal.recipe?.servings) || 1)} porcji
                                </span>
                              ) : (
                                <span className="text-[9px] sm:text-[10px] font-bold text-muted-foreground bg-secondary/60 px-1.5 sm:px-2 py-0.5 rounded-full whitespace-nowrap">
                                  {personName[meal.person || "A"]}: x{Number(meal.servings) || 1}
                                </span>
                              )}
                              <div className="flex items-center gap-1 rounded-full border border-border bg-white px-1 py-0.5">
                                <button
                                  className="h-6 w-6 text-xs rounded-full hover:bg-secondary shrink-0"
                                  onClick={() => updateServingsQuick(meal, Math.max(0.5, (Number(meal.servings) || 1) - 0.5))}
                                  title="Zmniejsz porcję"
                                >
                                  -
                                </button>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0.5}
                                  step={0.5}
                                  className="h-6 w-12 sm:w-14 text-[11px] font-semibold px-1 py-0 text-center"
                                  value={servingInputs[getServingInputKey(meal)] ?? String(Number(meal.servings) || 1)}
                                  onChange={(e) => setServingInputs((prev) => ({ ...prev, [getServingInputKey(meal)]: e.target.value }))}
                                  onBlur={() => applyServingInput(meal)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.currentTarget.blur();
                                    }
                                  }}
                                  aria-label="Liczba porcji"
                                />
                                <button
                                  className="h-6 w-6 text-xs rounded-full hover:bg-secondary shrink-0"
                                  onClick={() => updateServingsQuick(meal, (Number(meal.servings) || 1) + 0.5)}
                                  title="Zwiększ porcję"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Flame className="w-3 h-3" />
                                {meal.recipe ? (() => {
                                  const total = (meal.ingredients && meal.ingredients.length > 0 ? meal.ingredients : (meal.recipe?.ingredients || [])).reduce((sum: number, ri: any) => {
                                    if (!ri.ingredient) return sum;
                                    const effectiveAmount = getEffectiveIngredientAmount(meal, ri);
                                    return sum + (ri.ingredient.calories * effectiveAmount / 100);
                                  }, 0);
                                  return Math.round(total);
                                })() : ((meal.customCalories || 0) * (Number(meal.servings) || 1))} kcal
                              </p>
                              {meal.recipe && (
                                <p className="text-xs text-primary/70 font-semibold flex items-center gap-1">
                                  <Wallet className="w-3 h-3" />
                                  {(() => {
                                    const total = (meal.ingredients && meal.ingredients.length > 0 ? meal.ingredients : (meal.recipe?.ingredients || [])).reduce((sum: number, ri: any) => {
                                      if (!ri.ingredient) return sum;
                                      const effectiveAmount = getEffectiveIngredientAmount(meal, ri);
                                      return sum + (ri.ingredient.price * effectiveAmount / 100);
                                    }, 0);
                                    return Math.round(total);
                                  })()} PLN
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div 
                          className="w-12 h-12 rounded-lg bg-cover bg-center border border-border/50" 
                          style={{ backgroundImage: `url(${meal.recipe?.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'})` }} 
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={isEditingIngredients} onOpenChange={setIsEditingIngredients}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col bg-white">
          <DialogHeader>
            <DialogTitle>Edytuj składniki posiłku</DialogTitle>
            <DialogDescription>Dostosuj składniki i ilości dla wybranego posiłku.</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {frequentAddonDefinitions.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Najczęstsze dodatki (opcjonalnie)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {frequentAddonDefinitions.map((addon: any) => {
                    const isAlreadyAdded = editingMealIngredients.some((item: any) => Number(item.ingredientId) === Number(addon.ingredientId) && item.isFrequentAddon);
                    return (
                      <Button
                        key={`edit-addon-${addon.ingredientId}`}
                        type="button"
                        size="sm"
                        variant={isAlreadyAdded ? "secondary" : "outline"}
                        className={cn("h-8", isAlreadyAdded && "border-emerald-300 bg-emerald-100 text-emerald-900")}
                        onClick={() => addFrequentAddonToEdit(addon)}
                      >
                        + {Math.round(getAddonBaseAmount(addon))}g {addon.ingredient?.name || "Składnik"}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {editingMealIngredients.map((item, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex gap-2 items-start bg-secondary/20 p-3 rounded-xl border border-transparent",
                  item.isFrequentAddon && "border-emerald-300 bg-emerald-50/50"
                )}
              >
                <div className="flex-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn("w-full justify-between bg-white", !item.ingredientId && "text-muted-foreground")}
                      >
                        {item.ingredientId > 0 
                          ? allAvailableIngredients?.find(i => i.id === item.ingredientId)?.name 
                          : "Wybierz składnik..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0">
                      <Command>
                        <CommandInput placeholder="Szukaj składnika..." />
                        <CommandList>
                          <CommandEmpty>Nie znaleziono składnika.</CommandEmpty>
                          <CommandGroup>
                            {allAvailableIngredients?.map((i) => (
                              <CommandItem
                                key={i.id}
                                value={i.name}
                                onSelect={() => updateIngredientInEdit(idx, { ingredientId: i.id })}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    item.ingredientId === i.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                {i.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {item.isFrequentAddon && (
                    <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      Najczęstszy dodatek
                    </span>
                  )}
                </div>
                
                <div className="w-32">
                  <div className="relative">
                    <Input
                      type="number"
                      value={item.amount}
                      onChange={(e) => updateIngredientInEdit(idx, { amount: e.target.value })}
                      className="bg-white pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-bold">
                      {item.ingredient?.unit || 'g'}
                    </span>
                  </div>
                </div>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => removeIngredientFromEdit(idx)}
                  className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            
            <Button variant="outline" className="w-full border-dashed" onClick={addIngredientToEdit}>
              + Dodaj składnik
            </Button>
          </div>

          <DialogFooter className="pt-4 border-t">
            <Button variant="outline" onClick={() => setIsEditingIngredients(false)} disabled={isSaving}>Anuluj</Button>
            <Button onClick={saveIngredients} disabled={isSaving} className="bg-primary hover:bg-primary/90">
              {isSaving ? <LoadingSpinner /> : "Zapisz zmiany"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
