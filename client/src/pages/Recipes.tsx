import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { useRecipes, useCreateRecipe, useUpdateRecipe, useDeleteRecipe } from "@/hooks/use-recipes";
import { useIngredients } from "@/hooks/use-ingredients";
import { useAddMealEntry, useDayPlan } from "@/hooks/use-meal-plan";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Clock, Trash2, ChefHat, X, Eye, Edit2, CalendarPlus, Check, ChevronsUpDown, Heart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ScalingType } from "@shared/scaling";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { pl } from "date-fns/locale";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Form schema matching the backend expectation
const createRecipeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  tags: z.array(z.string()).optional().default([]),
  description: z.string().optional(),
  instructions: z.string().optional(),
  prepTime: z.coerce.number().min(0),
  servings: z.coerce.number().min(0.1).default(1),
  imageUrl: z.string().optional().or(z.literal("")),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number(),
    amount: z.coerce.number().min(0),
    baseAmount: z.coerce.number().min(0).optional(),
    unit: z.string().min(1).default("g"),
    scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]).default("LINEAR"),
    scalingFormula: z.string().optional(),
    stepThresholds: z.array(z.object({
      minServings: z.coerce.number().min(0),
      maxServings: z.coerce.number().min(0).nullable().optional(),
      amount: z.coerce.number().min(0),
    })).optional().default([]),
  })).min(1, "Add at least one ingredient"),
  frequentAddons: z.array(z.object({
    ingredientId: z.coerce.number(),
    amount: z.coerce.number().min(1),
  })).optional().default([]),
});

type RecipeFormData = z.infer<typeof createRecipeSchema>;

import { RecipeView } from "@/components/RecipeView";

export default function Recipes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: recipes, isLoading } = useRecipes();
  const { mutate: deleteRecipe } = useDeleteRecipe();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [favoriteFilter, setFavoriteFilter] = useState<"all" | "favorites">("all");
  const [sortBy, setSortBy] = useState<string>("frequency");
  const [cookingSteps, setCookingSteps] = useState<Array<{ text: string; timerMinutes?: number }>>([]);

  const parseInstructionsToSteps = (instructions?: string) => {
    if (!instructions) return [];
    return instructions
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const stripped = line.replace(/^\d+[.)]\s*/, "");
        const timerMatch = stripped.match(/\[timer\s*:\s*(\d+)\]/i);
        return {
          text: stripped.replace(/\[timer\s*:\s*\d+\]/gi, "").trim(),
          timerMinutes: timerMatch ? Number(timerMatch[1]) : undefined,
        };
      });
  };

  const allTags = Array.from(new Set(recipes?.flatMap(r => r.tags || []) || [])) as string[];

  function getIngredientAmount(ri: any) {
    return Number(ri?.baseAmount ?? ri?.amount ?? 0);
  }

  const sortedAndFilteredRecipes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return (recipes || [])
      .filter((recipe) => {
        const matchesTag = selectedTag === "all" || recipe.tags?.includes(selectedTag);
        if (!matchesTag) return false;

        const matchesFavorite = favoriteFilter === "all" || !!recipe.isFavorite;
        if (!matchesFavorite) return false;

        if (!normalizedSearch) return true;

        const matchesName = recipe.name?.toLowerCase().includes(normalizedSearch);
        const matchesTags = (recipe.tags || []).some((tag: string) => tag.toLowerCase().includes(normalizedSearch));
        const matchesIngredients = (recipe.ingredients || []).some((ri: any) =>
          ri.ingredient?.name?.toLowerCase().includes(normalizedSearch)
        );
        const matchesAddons = (recipe.frequentAddons || []).some((ri: any) =>
          ri.ingredient?.name?.toLowerCase().includes(normalizedSearch)
        );

        return matchesName || matchesTags || matchesIngredients || matchesAddons;
      })
      .sort((a, b) => {
    switch (sortBy) {
      case "frequency":
        return (b.stats?.eatCount || 0) - (a.stats?.eatCount || 0);
      case "alphabetical":
        return a.name.localeCompare(b.name);
      case "calories":
        return (b.stats?.calories || 0) - (a.stats?.calories || 0);
      case "value": {
        const getPrice = (r: any) => (r.ingredients || []).reduce((sum: number, ri: any) => 
          sum + (ri.ingredient ? (ri.ingredient.price * getIngredientAmount(ri) / 100) : 0), 0) / (r.servings || 1);
        const valA = (a.stats?.calories || 0) / (getPrice(a) || 1);
        const valB = (b.stats?.calories || 0) / (getPrice(b) || 1);
        return valB - valA;
      }
      case "time":
        return (a.prepTime || 0) - (b.prepTime || 0);
      case "protein":
        return (b.stats?.protein || 0) - (a.stats?.protein || 0);
      case "carbs":
        return (b.stats?.carbs || 0) - (a.stats?.carbs || 0);
      case "fat":
        return (b.stats?.fat || 0) - (a.stats?.fat || 0);
      default:
        return 0;
    }
  });
  }, [recipes, search, selectedTag, favoriteFilter, sortBy]);

  // New state for "Add to Meal Plan"
  const [isAddToPlanOpen, setIsAddToPlanOpen] = useState(false);
  const [recipeToPlan, setRecipeToPlan] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedMealType, setSelectedMealType] = useState("lunch");
  const [selectedFrequentAddons, setSelectedFrequentAddons] = useState<number[]>([]);

  const { data: dayPlan } = useDayPlan(selectedDate);
  const { mutate: addEntry, isPending: isAddingToPlan } = useAddMealEntry();

  const handleAddToPlan = () => {
    if (!recipeToPlan) return;

    const isOccupiedA = dayPlan?.entries.some((e: any) => e.mealType === selectedMealType && (e.person || "A") === "A");
    const isOccupiedB = dayPlan?.entries.some((e: any) => e.mealType === selectedMealType && (e.person || "A") === "B");
    if (isOccupiedA || isOccupiedB) {
      toast({
        variant: "destructive",
        title: "Błąd",
        description: "Ten posiłek jest już zajęty dla jednej z osób w wybranym dniu.",
      });
      return;
    }

    const selectedAddons = (recipeToPlan?.frequentAddons || []).filter((addon: any) =>
      selectedFrequentAddons.includes(addon.ingredientId)
    );

    const addForPerson = (person: "A" | "B") =>
      new Promise<void>((resolve, reject) => {
        addEntry({
          date: selectedDate,
          mealType: selectedMealType,
          recipeId: recipeToPlan.id,
          person,
          isEaten: false,
          servings: 1
        }, {
          onSuccess: async (createdEntry: any) => {
            try {
              if (selectedAddons.length > 0) {
                const baseIngredients = (recipeToPlan.ingredients || []).map((ri: any) => ({
                  ingredientId: ri.ingredientId,
                  amount: Number(ri.amount) || 0,
                }));

                const mergedIngredients = [...baseIngredients];
                selectedAddons.forEach((addon: any) => {
                  const existing = mergedIngredients.find((i) => i.ingredientId === addon.ingredientId);
                  if (existing) {
                    existing.amount += Number(addon.amount) || 0;
                  } else {
                    mergedIngredients.push({
                      ingredientId: addon.ingredientId,
                      amount: Number(addon.amount) || 0,
                    });
                  }
                });

                await updateMealEntry.mutateAsync({
                  id: createdEntry.id,
                  data: {
                    ingredients: mergedIngredients,
                    servings: 1,
                  },
                });
              }

              resolve();
            } catch (err) {
              reject(err);
            }
          },
          onError: (err: any) => reject(err),
        });
      });

    Promise.all([addForPerson("A"), addForPerson("B")])
      .then(() => {
        setIsAddToPlanOpen(false);
        setRecipeToPlan(null);
        setSelectedFrequentAddons([]);
        toast({ title: "Sukces", description: "Przepis dodany do planu dla Tysi i Matiego." });
      })
      .catch((err: any) => {
        toast({ variant: "destructive", title: "Błąd", description: err?.message || "Nie udało się dodać przepisu." });
      });
  };

  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), i);
    return {
      value: format(d, "yyyy-MM-dd"),
      label: format(d, "EEEE, d MMM", { locale: pl })
    };
  });

  // Form setup
  const { data: availableIngredients } = useIngredients();

  const form = useForm<RecipeFormData>({
    resolver: zodResolver(createRecipeSchema),
    defaultValues: {
      name: "",
      tags: [] as string[],
      description: "",
      instructions: "",
      prepTime: 15,
      servings: 1,
      imageUrl: "",
      ingredients: [{ ingredientId: 0, amount: 100, baseAmount: 100, unit: "g", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] }],
      frequentAddons: [] as { ingredientId: number; amount: number }[],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  const {
    fields: frequentAddonFields,
    append: appendFrequentAddon,
    remove: removeFrequentAddon,
  } = useFieldArray({
    control: form.control,
    name: "frequentAddons" as const,
  });

  const [editingRecipe, setEditingRecipe] = useState<any>(null);
  const [viewingRecipe, setViewingRecipe] = useState<any>(null);


  const getRecipeCaloriesPerServing = (recipe: any) => {
    const servings = Number(recipe?.servings) || 1;
    const baseTotal = (recipe?.ingredients || []).reduce((sum: number, ri: any) =>
      sum + (ri.ingredient ? (ri.ingredient.calories * getIngredientAmount(ri) / 100) : 0), 0
    );

    const addonsTotal = (recipe?.frequentAddons || []).reduce((sum: number, addon: any) =>
      sum + (addon.ingredient ? (addon.ingredient.calories * addon.amount / 100) : 0), 0
    );

    return {
      base: Math.round(baseTotal / servings),
      withAddons: Math.round((baseTotal + addonsTotal) / servings),
    };
  };

  const [isEditingIngredients, setIsEditingIngredients] = useState(false);
  const [editingMealIngredients, setEditingMealIngredients] = useState<any[]>([]);
  const updateMealEntry = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/meal-plan/entry/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/meal-plan/${selectedDate}`] });
      setIsEditingIngredients(false);
      toast({ title: "Sukces", description: "Składniki posiłku zostały zaktualizowane." });
    }
  });

  const openEdit = (recipe: any) => {
    setEditingRecipe(recipe);
    form.reset({
      name: recipe.name,
      tags: recipe.tags || [],
      description: recipe.description || "",
      instructions: recipe.instructions || "",
      prepTime: recipe.prepTime,
      servings: recipe.servings || 1,
      imageUrl: recipe.imageUrl || "",
      ingredients: recipe.ingredients.map((ri: any) => ({
        ingredientId: ri.ingredientId,
        amount: Number(ri.baseAmount ?? ri.amount ?? 0),
        baseAmount: Number(ri.baseAmount ?? ri.amount ?? 0),
        unit: ri.unit || ri.ingredient?.unit || "g",
        scalingType: ri.scalingType || "LINEAR",
        scalingFormula: ri.scalingFormula || "",
        stepThresholds: ri.stepThresholds || [],
      })),
      frequentAddons: (recipe.frequentAddons || []).map((addon: any) => ({
        ingredientId: addon.ingredientId,
        amount: Number(addon.baseAmount ?? addon.amount ?? 0),
      })),
    });
    setCookingSteps(parseInstructionsToSteps(recipe.instructions));
    setIsOpen(true);
  };

  const closeDialog = () => {
    setIsOpen(false);
    setEditingRecipe(null);
    form.reset({
      name: "",
      tags: [],
      description: "",
      instructions: "",
      prepTime: 15,
      servings: 1,
      imageUrl: "",
      ingredients: [{ ingredientId: 0, amount: 100, baseAmount: 100, unit: "g", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] }],
      frequentAddons: [],
    });
    setCookingSteps([]);
  };

  const { mutate: createRecipeMutation, isPending: isCreating } = useCreateRecipe();
  const { mutate: updateRecipeMutation, isPending: isUpdating } = useUpdateRecipe();

  const toggleRecipeFavorite = (recipe: any) => {
    const payload = {
      name: recipe.name,
      tags: recipe.tags || [],
      description: recipe.description || "",
      instructions: recipe.instructions || "",
      prepTime: recipe.prepTime || 0,
      imageUrl: recipe.imageUrl || "",
      servings: Number(recipe.servings) || 1,
      isFavorite: !recipe.isFavorite,
      ingredients: (recipe.ingredients || []).map((ri: any) => ({
        ingredientId: ri.ingredientId,
        amount: Number(ri.baseAmount ?? ri.amount ?? 0),
        baseAmount: Number(ri.baseAmount ?? ri.amount ?? 0),
        unit: ri.unit || ri.ingredient?.unit || "g",
        scalingType: (ri.scalingType || "LINEAR") as ScalingType,
        scalingFormula: ri.scalingType === "FORMULA" ? ri.scalingFormula : undefined,
        stepThresholds: ri.scalingType === "STEP" ? (ri.stepThresholds || []) : undefined,
      })),
      frequentAddons: (recipe.frequentAddons || []).map((addon: any) => ({
        ingredientId: addon.ingredientId,
        amount: Number(addon.amount) || 0,
      })),
    };

    updateRecipeMutation({ id: recipe.id, data: payload }, {
      onSuccess: () => {
        toast({ title: "Zapisano", description: payload.isFavorite ? "Dodano do ulubionych" : "Usunięto z ulubionych" });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Błąd", description: err.message });
      },
    });
  };

  const onSubmit = (data: any) => {
    const normalizedInstructions = cookingSteps.length > 0
      ? cookingSteps
          .filter((step) => step.text.trim() !== "")
          .map((step, index) => `${index + 1}. ${step.text.trim()}${step.timerMinutes && step.timerMinutes > 0 ? ` [timer:${step.timerMinutes}]` : ""}`)
          .join("\n")
      : data.instructions;

    const normalizedData = {
      ...data,
      instructions: normalizedInstructions,
      ingredients: (data.ingredients || []).map((ingredient: any) => ({
        ...ingredient,
        baseAmount: Number(ingredient.baseAmount ?? ingredient.amount ?? 0),
        amount: Number(ingredient.baseAmount ?? ingredient.amount ?? 0),
        unit: ingredient.unit || "g",
        scalingType: (ingredient.scalingType || "LINEAR") as ScalingType,
        scalingFormula: ingredient.scalingType === "FORMULA" ? ingredient.scalingFormula : undefined,
        stepThresholds: ingredient.scalingType === "STEP" ? (ingredient.stepThresholds || []) : undefined,
      })),
    };

    if (editingRecipe) {
      updateRecipeMutation({ id: editingRecipe.id, data: normalizedData }, {
        onSuccess: () => {
          closeDialog();
          toast({ title: "Sukces", description: "Przepis został zaktualizowany" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Błąd", description: err.message });
        },
      });
    } else {
      createRecipeMutation(normalizedData, {
        onSuccess: () => {
          closeDialog();
          toast({ title: "Success", description: "Recipe created successfully" });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err.message });
        },
      });
    }
  };

  if (isLoading) return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Przepisy</h1>
          <p className="text-muted-foreground">Znajdź lub stwórz swój kolejny ulubiony posiłek.</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-recipe" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 rounded-xl h-12 px-6 shadow-lg shadow-primary/20" onClick={() => setIsOpen(true)}>
              <Plus className="w-5 h-5" /> Stwórz przepis
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto px-2 py-3 sm:max-h-[90vh] sm:px-6 sm:py-6 max-sm:h-[92dvh] max-sm:w-[95vw] max-sm:max-w-[95vw]">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-2xl font-display">{editingRecipe ? "Edytuj przepis" : "Nowy przepis"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 sm:space-y-6 mt-2 sm:mt-4 text-xs sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">Nazwa przepisu</label>
                  <Input {...form.register("name")} placeholder="np. Tosty z awokado" />
                  {form.formState.errors.name && <p className="text-red-500 text-xs mt-1">{form.formState.errors.name.message}</p>}
                </div>

                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">Tagi (oddzielone przecinkami)</label>
                  <Input 
                    placeholder="np. szybkie, śniadanie, obiad" 
                    onChange={(e) => {
                      const tags = e.target.value.split(",").map(t => t.trim()).filter(t => t !== "");
                      form.setValue("tags", tags);
                    }}
                    defaultValue={form.getValues("tags")?.join(", ")}
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-1 block">Czas przygotowania (min)</label>
                  <Input type="number" {...form.register("prepTime")} />
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-1 block">Liczba porcji</label>
                  <Input type="number" step="0.1" {...form.register("servings")} min="0.1" />
                </div>
                
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1 block">Zdjęcie przepisu</label>
                  <div className="flex gap-2 items-center">
                    <Input {...form.register("imageUrl")} placeholder="URL obrazka (opcjonalnie)" className="flex-1" />
                    <div className="relative">
                      <Input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        id="recipe-image-upload"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const formData = new FormData();
                            formData.append("image", file);
                            try {
                              const res = await fetch("/api/upload", {
                                method: "POST",
                                body: formData,
                              });
                              if (res.ok) {
                                const data = await res.json();
                                form.setValue("imageUrl", data.imageUrl);
                                toast({ title: "Sukces", description: "Zdjęcie zostało przesłane." });
                              }
                            } catch (err) {
                              toast({ variant: "destructive", title: "Błąd", description: "Nie udało się przesłać zdjęcia." });
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => document.getElementById("recipe-image-upload")?.click()}
                      >
                        Wgraj plik
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Składniki</label>
                </div>
                <div className="space-y-3 mb-3">
                  {fields.map((field, index) => {
                    const selectedId = Number(form.watch(`ingredients.${index}.ingredientId`));
                    return (
                      <div key={field.id} className="bg-secondary/20 p-2 rounded-xl border border-border/50">
                        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                          <div className="flex-1">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between h-9 rounded-lg bg-background font-normal",
                                    !selectedId && "text-muted-foreground"
                                  )}
                                >
                                  {selectedId
                                    ? (availableIngredients || []).find((i: any) => i.id === selectedId)?.name
                                    : "Wybierz składnik"}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[300px] p-0 bg-white border border-border shadow-md" align="start">
                                <Command>
                                  <CommandInput placeholder="Szukaj składnika..." onKeyDown={(event) => event.stopPropagation()} />
                                  <CommandList>
                                    <CommandEmpty>Nie znaleziono składnika.</CommandEmpty>
                                    <CommandGroup>
                                      {(availableIngredients || []).map((i: any) => (
                                        <CommandItem
                                          key={i.id}
                                          value={i.name}
                                          onSelect={() => {
                                            form.setValue(`ingredients.${index}.ingredientId`, i.id);
                                            if (!form.getValues(`ingredients.${index}.unit` as const)) {
                                              form.setValue(`ingredients.${index}.unit` as const, i.unit || "g");
                                            }
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              selectedId === i.id ? "opacity-100" : "opacity-0"
                                            )}
                                          />
                                          <div className="flex flex-col">
                                            <span>{i.name}</span>
                                            <span className="text-[10px] text-muted-foreground">
                                              {i.calories} kcal {i.category ? `[${i.category}]` : ""}
                                            </span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="w-full sm:w-24">
                            <Input type="number" placeholder="Bazowa" className="h-9 rounded-lg" {...form.register(`ingredients.${index}.baseAmount` as const)} />
                          </div>
                          <div className="w-full sm:w-24">
                            <Input placeholder="Jedn." className="h-9 rounded-lg" {...form.register(`ingredients.${index}.unit` as const)} />
                          </div>
                          <div className="w-full sm:w-36">
                            <Select
                              value={form.watch(`ingredients.${index}.scalingType`) || "LINEAR"}
                              onValueChange={(value) => form.setValue(`ingredients.${index}.scalingType`, value as any)}
                            >
                              <SelectTrigger className="h-9 rounded-lg"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="LINEAR">LINEAR</SelectItem>
                                <SelectItem value="FIXED">FIXED</SelectItem>
                                <SelectItem value="STEP">STEP</SelectItem>
                                <SelectItem value="FORMULA">FORMULA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg hover:bg-red-50 hover:text-red-500 self-end" onClick={() => remove(index)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {form.watch(`ingredients.${index}.scalingType`) === "FORMULA" && (
                          <div className="mt-2">
                            <Input placeholder="np. 100 + (scaleFactor - 1) * 50" className="h-9 rounded-lg" {...form.register(`ingredients.${index}.scalingFormula` as const)} />
                          </div>
                        )}
                        {form.watch(`ingredients.${index}.scalingType`) === "STEP" && (
                          <div className="mt-2 space-y-2">
                            {(form.watch(`ingredients.${index}.stepThresholds`) || []).map((_: any, thresholdIndex: number) => (
                              <div key={thresholdIndex} className="grid grid-cols-4 gap-2 items-center">
                                <Input type="number" placeholder="Od porcji" {...form.register(`ingredients.${index}.stepThresholds.${thresholdIndex}.minServings` as const)} />
                                <Input type="number" placeholder="Do porcji" {...form.register(`ingredients.${index}.stepThresholds.${thresholdIndex}.maxServings` as const)} />
                                <Input type="number" placeholder="Ilość" {...form.register(`ingredients.${index}.stepThresholds.${thresholdIndex}.amount` as const)} />
                                <Button type="button" variant="ghost" onClick={() => {
                                  const current = form.getValues(`ingredients.${index}.stepThresholds`) || [];
                                  form.setValue(`ingredients.${index}.stepThresholds`, current.filter((_: any, i: number) => i !== thresholdIndex));
                                }}>Usuń</Button>
                              </div>
                            ))}
                            <Button type="button" variant="outline" onClick={() => {
                              const current = form.getValues(`ingredients.${index}.stepThresholds`) || [];
                              form.setValue(`ingredients.${index}.stepThresholds`, [...current, { minServings: 1, maxServings: null, amount: Number(form.getValues(`ingredients.${index}.baseAmount`) || 0) }]);
                            }}>+ Próg</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="rounded-lg border-dashed w-full py-3 sm:py-5 border-2 hover:bg-primary/5 hover:border-primary/50 transition-all text-xs sm:text-sm" onClick={() => append({ ingredientId: 0, amount: 100, baseAmount: 100, unit: "g", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] })}>
                  + Dodaj kolejny składnik
                </Button>
                {form.formState.errors.ingredients && <p className="text-red-500 text-xs mt-1">{form.formState.errors.ingredients.message}</p>}
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Najczęste dodatki (opcjonalnie)</label>
                </div>
                <div className="space-y-3 mb-3">
                                    {frequentAddonFields.map((field, index) => {
                    const selectedId = Number(form.watch(`frequentAddons.${index}.ingredientId`));
                    return (
                      <div key={field.id} className="flex flex-col sm:flex-row gap-2 sm:items-end bg-emerald-50/60 p-2 rounded-xl border border-emerald-100">
                        <div className="flex-1">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between h-9 rounded-lg bg-background font-normal",
                                  !selectedId && "text-muted-foreground"
                                )}
                              >
                                {selectedId
                                  ? (availableIngredients || []).find((i: any) => i.id === selectedId)?.name
                                  : "Wybierz dodatek"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0 bg-white border border-border shadow-md" align="start">
                              <Command>
                                <CommandInput placeholder="Szukaj składnika..." onKeyDown={(event) => event.stopPropagation()} />
                                <CommandList>
                                  <CommandEmpty>Nie znaleziono składnika.</CommandEmpty>
                                  <CommandGroup>
                                    {(availableIngredients || []).map((i: any) => (
                                      <CommandItem
                                        key={i.id}
                                        value={i.name}
                                        onSelect={() => {
                                          form.setValue(`frequentAddons.${index}.ingredientId`, i.id);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            selectedId === i.id ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                        <div className="flex flex-col">
                                          <span>{i.name}</span>
                                          <span className="text-[10px] text-muted-foreground">{i.calories} kcal</span>
                                        </div>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="w-full sm:w-24">
                          <Input type="number" placeholder="g" className="h-9 rounded-lg" {...form.register(`frequentAddons.${index}.amount` as const)} />
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg hover:bg-red-50 hover:text-red-500 self-end" onClick={() => removeFrequentAddon(index)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="rounded-lg border-dashed w-full py-3 sm:py-5 border-2 hover:bg-emerald-50 hover:border-emerald-300 transition-all text-xs sm:text-sm" onClick={() => appendFrequentAddon({ ingredientId: 0, amount: 50 })}>
                  + Dodaj najczęsty dodatek
                </Button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Kroki gotowania (cooking mode)</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCookingSteps((prev) => [...prev, { text: "", timerMinutes: undefined }])}
                  >
                    + Dodaj krok
                  </Button>
                </div>
                <div className="space-y-2">
                  {cookingSteps.map((step, index) => (
                    <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2">
                      <Input
                        placeholder={`Krok ${index + 1}`}
                        value={step.text}
                        onChange={(e) => setCookingSteps((prev) => prev.map((s, i) => i === index ? { ...s, text: e.target.value } : s))}
                      />
                      <Input
                        type="number"
                        min="0"
                        placeholder="Timer (min)"
                        value={step.timerMinutes ?? ""}
                        onChange={(e) => setCookingSteps((prev) => prev.map((s, i) => i === index ? { ...s, timerMinutes: e.target.value ? Number(e.target.value) : undefined } : s))}
                      />
                      <Button type="button" variant="ghost" onClick={() => setCookingSteps((prev) => prev.filter((_, i) => i !== index))}>
                        Usuń
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Instrukcje</label>
                <textarea 
                  {...form.register("instructions")} 
                  className="w-full min-h-[100px] p-3 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" 
                  placeholder="Krok 1..." 
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3 sm:pt-4">
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Anuluj</Button>
                <Button type="submit" disabled={isCreating || isUpdating}>
                  {isCreating || isUpdating ? "Zapisywanie..." : "Zapisz przepis"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-8 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
          <input 
            type="text" 
            placeholder="Search recipes or ingredients..." 
            className="w-full pl-12 pr-4 py-3 rounded-2xl border border-border bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Select value={selectedTag} onValueChange={setSelectedTag}>
            <SelectTrigger className="w-full sm:w-[160px] h-[52px] rounded-2xl bg-white shadow-sm border-border">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie tagi</SelectItem>
              {allTags.map(tag => (
                <SelectItem key={tag} value={tag}>{tag}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={favoriteFilter} onValueChange={(value: "all" | "favorites") => setFavoriteFilter(value)}>
            <SelectTrigger className="w-full sm:w-[180px] h-[52px] rounded-2xl bg-white shadow-sm border-border">
              <SelectValue placeholder="Ulubione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="favorites">Tylko ulubione</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full sm:w-[180px] h-[52px] rounded-2xl bg-white shadow-sm border-border">
              <SelectValue placeholder="Sortuj według" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="frequency">Najczęściej jedzone</SelectItem>
              <SelectItem value="alphabetical">Alfabetycznie</SelectItem>
              <SelectItem value="calories">Kalorie (max)</SelectItem>
              <SelectItem value="value">Kalorie / Cena (max)</SelectItem>
              <SelectItem value="time">Czas gotowania (min)</SelectItem>
              <SelectItem value="protein">Białko (max)</SelectItem>
              <SelectItem value="carbs">Węglowodany (max)</SelectItem>
              <SelectItem value="fat">Tłuszcze (max)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedAndFilteredRecipes?.map((recipe: any) => (
          <div key={recipe.id} className="group bg-white rounded-3xl p-4 shadow-sm hover:shadow-xl transition-all duration-300 border border-border/50 flex flex-col h-full">
            <div 
              className="h-48 rounded-2xl bg-cover bg-center mb-4 relative overflow-hidden"
              style={{ backgroundImage: `url(${recipe.imageUrl || 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800'})` }} 
            >
              <div className="absolute top-2 right-2 bg-white/90 backdrop-blur px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm">
                Zjedzone: {recipe.stats?.eatCount || 0}x
              </div>
              {/* Healthy green salad */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4 gap-2">
                 <button 
                 onClick={(e) => { 
                    e.preventDefault(); 
                    setRecipeToPlan(recipe);
                    setSelectedFrequentAddons([]);
                    setIsAddToPlanOpen(true);
                  }}
                  className="bg-white/80 p-2 rounded-full text-primary hover:bg-white transition-colors"
                  title="Dodaj do planu"
                 >
                   <CalendarPlus className="w-4 h-4" />
                 </button>
                 <button 
                  onClick={(e) => { e.preventDefault(); setViewingRecipe(recipe); }}
                  className="bg-white/80 p-2 rounded-full text-primary hover:bg-white transition-colors"
                 >
                   <Eye className="w-4 h-4" />
                 </button>
                 <button 
                  onClick={(e) => { e.preventDefault(); openEdit(recipe); }}
                  className="bg-white/80 p-2 rounded-full text-primary hover:bg-white transition-colors"
                 >
                   <Edit2 className="w-4 h-4" />
                 </button>
                 <AlertDialog>
                   <AlertDialogTrigger asChild>
                     <button 
                      onClick={(e) => e.stopPropagation()}
                      className="bg-red-500/80 p-2 rounded-full text-white hover:bg-red-600 transition-colors ml-auto"
                     >
                       <Trash2 className="w-4 h-4" />
                     </button>
                   </AlertDialogTrigger>
                   <AlertDialogContent>
                     <AlertDialogHeader>
                       <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                       <AlertDialogDescription>
                         This will permanently delete "{recipe.name}".
                       </AlertDialogDescription>
                     </AlertDialogHeader>
                     <AlertDialogFooter>
                       <AlertDialogCancel>Cancel</AlertDialogCancel>
                       <AlertDialogAction 
                         onClick={() => deleteRecipe(recipe.id)}
                         className="bg-red-500 hover:bg-red-600"
                       >
                         Delete
                       </AlertDialogAction>
                     </AlertDialogFooter>
                   </AlertDialogContent>
                 </AlertDialog>
              </div>
            </div>
            
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl font-bold font-display leading-tight">{recipe.name}</h3>
                  <div className="flex flex-wrap gap-1">
                    {recipe.tags?.map((tag: string, i: number) => (
                      <span key={i} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-md font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                            <button
                              type="button"
                              className={cn("rounded-full p-1 transition-colors", recipe.isFavorite ? "text-rose-500 bg-rose-50" : "text-muted-foreground hover:text-rose-500 hover:bg-rose-50")}
                              onClick={() => toggleRecipeFavorite(recipe)}
                              title={recipe.isFavorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
                            >
                              <Heart className={cn("w-4 h-4", recipe.isFavorite && "fill-current")} />
                            </button>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full mb-1">
                              <Clock className="w-3 h-3" />
                              {recipe.prepTime}m
                            </div>
                            <div className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                              {Math.round(((recipe.ingredients || []).reduce((sum: number, ri: any) => 
                                sum + (ri.ingredient ? (ri.ingredient.price * getIngredientAmount(ri) / 100) : 0), 0)) / (recipe.servings || 1)
                              )} PLN / porcja
                            </div>
                          </div>
              </div>
              
              <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">
                {recipe.description || recipe.instructions || "No description provided."}
              </p>
              
              <div className="mt-auto pt-4 border-t border-dashed border-border">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs text-muted-foreground font-medium">
                    <span className="flex items-center gap-1"><ChefHat className="w-3 h-3" /> {recipe.ingredients.length} składników ({recipe.servings || 1} porcji)</span>
                    <span>
                      {(() => {
                        const calories = getRecipeCaloriesPerServing(recipe);
                        return calories.withAddons > calories.base
                          ? `${calories.base}-${calories.withAddons} kcal / porcja`
                          : `${calories.base} kcal / porcja`;
                      })()}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] text-center text-muted-foreground">
                    <div className="bg-secondary/50 rounded-sm py-0.5">
                      B: {recipe.stats?.protein || 0}g
                    </div>
                    <div className="bg-secondary/50 rounded-sm py-0.5">
                      W: {recipe.stats?.carbs || 0}g
                    </div>
                    <div className="bg-secondary/50 rounded-sm py-0.5">
                      T: {recipe.stats?.fat || 0}g
                    </div>
                    <div className="bg-primary/10 text-primary font-bold rounded-sm py-0.5">
                      {recipe.stats?.calories || 0} kcal
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {recipes?.length === 0 && (
          <div className="col-span-full py-20 text-center">
            <p className="text-muted-foreground">No recipes found. Try searching for something else or create a new one!</p>
          </div>
        )}
      </div>
      <RecipeView 
        recipe={viewingRecipe}
        isOpen={!!viewingRecipe}
        onClose={() => setViewingRecipe(null)}
        onAddToPlan={(recipe) => {
          setRecipeToPlan(recipe);
          setViewingRecipe(null);
          setIsAddToPlanOpen(true);
        }}
      />

      <Dialog
        open={isAddToPlanOpen}
        onOpenChange={(open) => {
          setIsAddToPlanOpen(open);
          if (!open) {
            setSelectedFrequentAddons([]);
          }
        }}
      >
        <DialogContent className="max-sm:h-[100dvh] max-sm:max-h-none px-3 py-4 sm:px-6 sm:py-6">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Dodaj do planu: {recipeToPlan?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Wybierz dzień</label>
              <Select value={selectedDate} onValueChange={setSelectedDate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {next7Days.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Wybierz posiłek</label>
              <Select value={selectedMealType} onValueChange={setSelectedMealType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="breakfast">Śniadanie</SelectItem>
                  <SelectItem value="lunch">Obiad</SelectItem>
                  <SelectItem value="dinner">Kolacja</SelectItem>
                  <SelectItem value="snack">Przekąska</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(recipeToPlan?.frequentAddons || []).length > 0 && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Sugerowane dodatki</label>
                <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
                  {(recipeToPlan.frequentAddons || []).map((addon: any) => (
                    <label key={addon.ingredientId} className="flex items-center justify-between gap-3 text-sm">
                      <span>{addon.ingredient?.name || "Składnik"}</span>
                      <span className="text-muted-foreground mr-auto">+{addon.amount} g</span>
                      <input
                        type="checkbox"
                        checked={selectedFrequentAddons.includes(addon.ingredientId)}
                        onChange={(e) => {
                          setSelectedFrequentAddons((prev) =>
                            e.target.checked
                              ? [...prev, addon.ingredientId]
                              : prev.filter((id) => id !== addon.ingredientId)
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsAddToPlanOpen(false)}>Anuluj</Button>
            <Button onClick={handleAddToPlan} disabled={isAddingToPlan}>
              {isAddingToPlan ? "Dodawanie..." : "Dodaj do planu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
