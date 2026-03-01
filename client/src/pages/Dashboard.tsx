import { useDayPlan, useUpdateMealEntry, useToggleEaten } from "@/hooks/use-meal-plan";
import { useIngredients } from "@/hooks/use-ingredients";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, subDays } from "date-fns";
import { pl } from "date-fns/locale";
import { NutritionRing } from "@/components/NutritionRing";
import { Layout } from "@/components/Layout";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Flame, CheckCircle2, Circle, CalendarDays, ChevronLeft, ChevronRight, Settings2, Wallet, Eye, Clock, ChefHat, Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { api } from "@shared/routes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { RecipeView } from "@/components/RecipeView";

export default function Dashboard() {
  const [date, setDate] = useState(new Date());
  const dateStr = format(date, "yyyy-MM-dd");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: dayPlan, isLoading: isLoadingPlan } = useDayPlan(dateStr);
  const { mutate: toggleEaten } = useToggleEaten();
  const [viewingRecipe, setViewingRecipe] = useState<any>(null);
  const [viewingMeal, setViewingMeal] = useState<any>(null);
  const [viewingPlannedServings, setViewingPlannedServings] = useState<number | undefined>(undefined);

  const [isEditingIngredients, setIsEditingIngredients] = useState(false);
  const [editingMealIngredients, setEditingMealIngredients] = useState<any[]>([]);
  const { data: allAvailableIngredients } = useIngredients();
  const { toast } = useToast();

  const { mutate: updateMealEntry, isPending: isSaving } = useUpdateMealEntry();

  const startEditing = () => {
    const currentIngredients = (viewingMeal?.ingredients && viewingMeal.ingredients.length > 0)
      ? viewingMeal.ingredients
      : viewingRecipe.ingredients;
    
    const entryServings = viewingMeal ? (Number(viewingMeal.servings) || 1) : 1;
    const recipeServings = Number(viewingRecipe.servings) || 1;
    const factor = entryServings / recipeServings;

    setEditingMealIngredients(currentIngredients.map((ri: any) => ({
      ingredientId: ri.ingredientId,
      amount: Math.round(ri.amount * factor), // Scale to current servings
      ingredient: ri.ingredient
    })));
    setIsEditingIngredients(true);
  };

  const addIngredientToEdit = () => {
    setEditingMealIngredients([...editingMealIngredients, { ingredientId: 0, amount: 100, ingredient: null }]);
  };

  const updateIngredientInEdit = (index: number, updates: any) => {
    const newIngredients = [...editingMealIngredients];
    newIngredients[index] = { ...newIngredients[index], ...updates };
    if (updates.ingredientId && allAvailableIngredients) {
      newIngredients[index].ingredient = allAvailableIngredients.find((i: any) => i.id === updates.ingredientId);
    }
    setEditingMealIngredients(newIngredients);
  };

  const removeIngredientFromEdit = (index: number) => {
    setEditingMealIngredients(editingMealIngredients.filter((_, i) => i !== index));
  };

  const saveIngredients = () => {
    if (!viewingMeal || !viewingRecipe) return;
    
    const entryServings = Number(viewingMeal.servings) || 1;
    const recipeServings = Number(viewingRecipe.servings) || 1;
    const factor = entryServings / recipeServings;

    const ingredientsData = editingMealIngredients
      .filter(i => i.ingredientId > 0)
      .map(i => ({ 
        ingredientId: Number(i.ingredientId), 
        amount: Math.round(Number(i.amount) / factor)
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

  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: any) => {
      const res = await apiRequest("PATCH", "/api/user-settings", newSettings);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
    },
  });

  if (isLoadingPlan || isLoadingSettings) return <Layout><LoadingSpinner /></Layout>;

  const targets = settings || { targetCalories: 2000, targetProtein: 150, targetCarbs: 200, targetFat: 65 };
  const isToday = dateStr === todayStr;
  const allEntries = dayPlan?.entries || [];
  const personName: Record<string, string> = { A: "Tysia", B: "Mati" };

  const calculateConsumed = (entries: any[]) => {
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
      const entryServings = Number(entry.servings) || 1;
      const recipeServings = Number(recipe?.servings || 1);
      const factor = entryServings / recipeServings;

      const stats = entryIngredients.reduce((sum: any, ri: any) => {
        if (!ri.ingredient) return sum;
        return {
          calories: sum.calories + (ri.ingredient.calories * ri.amount / 100),
          protein: sum.protein + (ri.ingredient.protein * ri.amount / 100),
          carbs: sum.carbs + (ri.ingredient.carbs * ri.amount / 100),
          fat: sum.fat + (ri.ingredient.fat * ri.amount / 100),
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      return {
        calories: acc.calories + stats.calories * factor,
        protein: acc.protein + stats.protein * factor,
        carbs: acc.carbs + stats.carbs * factor,
        fat: acc.fat + stats.fat * factor,
      };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  };

  const consumed = calculateConsumed(allEntries);

  const totalDayCost = (dayPlan?.entries || []).reduce((acc: number, entry: any) => {
    const recipe = entry.recipe;
    const entryIngredients = entry.ingredients.length > 0 ? entry.ingredients : (recipe?.ingredients || []);
    const entryServings = Number(entry.servings) || 1;
    const recipeServings = Number(recipe?.servings || 1);
    const factor = entryServings / recipeServings;

    return acc + entryIngredients.reduce((sum: number, ri: any) =>
      sum + ((ri.ingredient?.price || 0) * ri.amount / 100) * factor, 0
    );
  }, 0) || 0;

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
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-xl">
                <Settings2 className="w-5 h-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ustawienia celów</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Kalorie (kcal)</label>
                    <Input 
                      type="number" 
                      defaultValue={targets.targetCalories}
                      onBlur={(e) => updateSettingsMutation.mutate({ targetCalories: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Białko (g)</label>
                    <Input 
                      type="number" 
                      defaultValue={targets.targetProtein}
                      onBlur={(e) => updateSettingsMutation.mutate({ targetProtein: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Węglowodany (g)</label>
                    <Input 
                      type="number" 
                      defaultValue={targets.targetCarbs}
                      onBlur={(e) => updateSettingsMutation.mutate({ targetCarbs: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tłuszcze (g)</label>
                    <Input 
                      type="number" 
                      defaultValue={targets.targetFat}
                      onBlur={(e) => updateSettingsMutation.mutate({ targetFat: Number(e.target.value) })}
                    />
                  </div>
                </div>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <NutritionRing current={consumed.calories} target={targets.targetCalories} label="Kalorie" color="hsl(var(--primary))" unit="kcal" />
        <NutritionRing current={consumed.protein} target={targets.targetProtein} label="Białko" color="#3b82f6" unit="g" />
        <NutritionRing current={consumed.carbs} target={targets.targetCarbs} label="Węgle" color="#f59e0b" unit="g" />
        <NutritionRing current={consumed.fat} target={targets.targetFat} label="Tłuszcze" color="#ef4444" unit="g" />
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
        onEditIngredients={startEditing}
        showFooter={false}
        onAddToPlan={() => {}} 
      />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Menu na {isToday ? "dziś" : format(date, "eeee", { locale: pl })}</h2>
          <Link href="/meal-plan">
            <span className="text-primary text-sm font-semibold hover:underline cursor-pointer">Edytuj Plan</span>
          </Link>
        </div>

        {allEntries.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-border">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <CalendarDays className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Brak zaplanowanych posiłków na ten dzień</h3>
            <p className="text-muted-foreground mb-4">Zacznij dodawać zdrowe przepisy do swojego harmonogramu!</p>
            <Link href="/meal-plan">
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
                            <div className="flex items-center gap-2 mt-0.5">
                              {meal.recipe ? (
                                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                  {personName[meal.person || "A"]}: {(Number(meal.servings) || 1)}/{(Number(meal.recipe?.servings) || 1)} porcji
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
                                  {personName[meal.person || "A"]}: x{Number(meal.servings) || 1}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Flame className="w-3 h-3" />
                                {meal.recipe ? (() => {
                                  const entryServings = Number(meal.servings) || 1;
                                  const recipeServings = Number(meal.recipe?.servings) || 1;
                                  const factor = entryServings / recipeServings;
                                  const total = (meal.ingredients && meal.ingredients.length > 0 ? meal.ingredients : (meal.recipe?.ingredients || [])).reduce((sum: number, ri: any) =>
                                    sum + (ri.ingredient ? (ri.ingredient.calories * ri.amount / 100) : 0), 0
                                  );
                                  return Math.round(total * factor);
                                })() : ((meal.customCalories || 0) * (Number(meal.servings) || 1))} kcal
                              </p>
                              {meal.recipe && (
                                <p className="text-xs text-primary/70 font-semibold flex items-center gap-1">
                                  <Wallet className="w-3 h-3" />
                                  {(() => {
                                    const entryServings = Number(meal.servings) || 1;
                                    const recipeServings = Number(meal.recipe?.servings) || 1;
                                    const factor = entryServings / recipeServings;
                                    const total = (meal.ingredients && meal.ingredients.length > 0 ? meal.ingredients : (meal.recipe?.ingredients || [])).reduce((sum: number, ri: any) =>
                                      sum + (ri.ingredient ? (ri.ingredient.price * ri.amount / 100) : 0), 0
                                    );
                                    return Math.round(total * factor);
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
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {editingMealIngredients.map((item, idx) => (
              <div key={idx} className="flex gap-2 items-start bg-secondary/20 p-3 rounded-xl">
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
