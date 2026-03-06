import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { useRecipes, useCreateRecipe, useUpdateRecipe, useDeleteRecipe } from "@/hooks/use-recipes";
import { useIngredients } from "@/hooks/use-ingredients";
import { useAddMealEntry, useDayPlan, useUpdateMealEntry } from "@/hooks/use-meal-plan";
import { useQueryClient } from "@tanstack/react-query";
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
import { buildInstructionSteps, parseInstructionLines, type InstructionLink } from "@/lib/instruction-steps";
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
  instructionSteps: z.array(z.any()).optional(),
  prepTime: z.coerce.number().min(0),
  servings: z.coerce.number().min(0.1).default(1),
  imageUrl: z.string().optional().or(z.literal("")),
  suggestedRecipes: z.array(z.object({ recipeId: z.coerce.number(), servings: z.coerce.number().min(0.1) })).optional().default([]),
  ingredients: z.array(z.object({
    ingredientId: z.coerce.number(),
    amount: z.coerce.number().min(0).optional().default(0),
    baseAmount: z.coerce.number().min(0).optional(),
    unit: z.string().min(1).default("g"),
    alternativeAmount: z.coerce.number().min(0).optional(),
    alternativeUnit: z.string().optional(),
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
    amount: z.coerce.number().min(0),
    baseAmount: z.coerce.number().min(0).optional(),
    unit: z.string().min(1).default("g"),
    alternativeAmount: z.coerce.number().min(0).optional(),
    alternativeUnit: z.string().optional(),
    scalingType: z.enum(["LINEAR", "FIXED", "STEP", "FORMULA"]).default("LINEAR"),
    scalingFormula: z.string().optional(),
    stepThresholds: z.array(z.object({
      minServings: z.coerce.number().min(0),
      maxServings: z.coerce.number().min(0).nullable().optional(),
      amount: z.coerce.number().min(0),
    })).optional().default([]),
  })).optional().default([]),
});

type RecipeFormData = z.infer<typeof createRecipeSchema>;

import { RecipeView } from "@/components/RecipeView";

export default function Recipes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: recipes, isLoading } = useRecipes();
  const { data: availableIngredients } = useIngredients();
  const { mutate: deleteRecipe } = useDeleteRecipe();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("frequency");
  const [manualAvailableIngredientIds, setManualAvailableIngredientIds] = useState<number[]>([]);
  const [excludedDefaultIngredientIds, setExcludedDefaultIngredientIds] = useState<number[]>([]);
  const [instructionLinks, setInstructionLinks] = useState<InstructionLink[]>([]);
  const [newInstructionLink, setNewInstructionLink] = useState<InstructionLink>({ stepIndex: 0, text: "", ingredientId: 0, ingredientSource: "ingredient", multiplier: 1 });
  const [newInstructionLinkMultiplierInput, setNewInstructionLinkMultiplierInput] = useState("1");

  const parsePositiveMultiplier = (value: string) => {
    const normalized = value.replace(",", ".").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const allTags = Array.from(new Set(recipes?.flatMap(r => r.tags || []) || [])) as string[];

  function getIngredientAmount(ri: any) {
    return Number(ri?.baseAmount ?? ri?.amount ?? 0);
  }

  const formatLocalizedNumber = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  };


  const alwaysAtHomeIngredientIds = useMemo(() =>
    (availableIngredients || [])
      .filter((ingredient: any) => ingredient.alwaysAtHome)
      .map((ingredient: any) => ingredient.id),
    [availableIngredients]
  );

  const effectiveAvailableIngredientIds = useMemo(() => {
    const defaults = alwaysAtHomeIngredientIds.filter((id) => !excludedDefaultIngredientIds.includes(id));
    return Array.from(new Set([...defaults, ...manualAvailableIngredientIds]));
  }, [alwaysAtHomeIngredientIds, excludedDefaultIngredientIds, manualAvailableIngredientIds]);

  const toggleIngredientAvailability = (ingredientId: number, checked: boolean, isAlwaysAtHome: boolean) => {
    if (isAlwaysAtHome) {
      setExcludedDefaultIngredientIds((prev) =>
        checked ? prev.filter((id) => id !== ingredientId) : Array.from(new Set([...prev, ingredientId]))
      );
      return;
    }

    setManualAvailableIngredientIds((prev) =>
      checked ? Array.from(new Set([...prev, ingredientId])) : prev.filter((id) => id !== ingredientId)
    );
  };

  const resetIngredientSelection = () => {
    setManualAvailableIngredientIds([]);
    setExcludedDefaultIngredientIds([]);
  };

  const sortedAndFilteredRecipes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return (recipes || [])
      .filter((recipe) => {
        const matchesTag = selectedTag === "all" || recipe.tags?.includes(selectedTag);
        if (!matchesTag) return false;

        const matchesFavorite = sortBy !== "favorites" || !!recipe.isFavorite;
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
      case "match": {
        const computeMatchScore = (recipe: any) => {
          const ingredients = recipe.ingredients || [];
          if (ingredients.length === 0) return 0;
          const matchingIngredients = ingredients.filter((ri: any) =>
            effectiveAvailableIngredientIds.includes(Number(ri.ingredientId))
          ).length;
          return matchingIngredients / ingredients.length;
        };
        return computeMatchScore(b) - computeMatchScore(a);
      }
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
  }, [recipes, search, selectedTag, sortBy, effectiveAvailableIngredientIds]);

  // New state for "Add to Meal Plan"
  const [isAddToPlanOpen, setIsAddToPlanOpen] = useState(false);
  const [recipeToPlan, setRecipeToPlan] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedMealType, setSelectedMealType] = useState("lunch");
  const [selectedPerson, setSelectedPerson] = useState<"A" | "B">("A");
  const [addForBothPeople, setAddForBothPeople] = useState(true);
  const [selectedFrequentAddons, setSelectedFrequentAddons] = useState<Record<"A" | "B", Record<string, number>>>({ A: {}, B: {} });
  const [selectedRecipeServings, setSelectedRecipeServings] = useState(1);
  const [selectedSuggestedRecipes, setSelectedSuggestedRecipes] = useState<Record<string, number>>({});
  const personName: Record<"A" | "B", string> = { A: "Tysia", B: "Mati" };

  const getAddonSelectionKey = (addon: any, index: number) => String(addon?.id ?? `${addon?.ingredientId}-${index}`);

  const setAddonAmount = (person: "A" | "B", addonKey: string, amount: number) => {
    const safeAmount = Math.max(0, Math.round(amount));
    setSelectedFrequentAddons((prev) => ({
      ...prev,
      [person]: {
        ...prev[person],
        [addonKey]: safeAmount,
      },
    }));
  };

  const adjustAddonAmount = (person: "A" | "B", addonKey: string, delta: number) => {
    const current = Number(selectedFrequentAddons?.[person]?.[addonKey] || 0);
    setAddonAmount(person, addonKey, current + delta);
  };

  const { data: dayPlan } = useDayPlan(selectedDate);
  const { mutateAsync: addEntry, isPending: isAddingToPlan } = useAddMealEntry();

  const suggestedRecipeOptionsForPlan = useMemo(() => {
    if (!recipeToPlan) return [] as { recipe: any; servings: number }[];

    const structured = (recipeToPlan?.suggestedRecipes || [])
      .map((item: any) => ({ recipeId: Number(item?.recipeId), servings: Number(item?.servings) || 1 }))
      .filter((item: any) => Number.isFinite(item.recipeId) && item.recipeId > 0);

    const legacy = (recipeToPlan?.suggestedRecipeIds || [])
      .map((id: any) => ({ recipeId: Number(id), servings: 1 }))
      .filter((item: any) => Number.isFinite(item.recipeId) && item.recipeId > 0);

    const entries = structured.length > 0 ? structured : legacy;

    return entries
      .map((entry: any) => ({
        recipe: (recipes || []).find((candidate: any) => Number(candidate?.id) === Number(entry.recipeId)),
        servings: entry.servings,
      }))
      .filter((entry: any) => !!entry.recipe);
  }, [recipeToPlan, recipes]);

  const handleAddToPlan = async () => {
    if (!recipeToPlan) return;

    const isOccupiedA = dayPlan?.entries.some((e: any) => e.mealType === selectedMealType && (e.person || "A") === "A");
    const isOccupiedB = dayPlan?.entries.some((e: any) => e.mealType === selectedMealType && (e.person || "A") === "B");
    const targetPeople = addForBothPeople ? (["A", "B"] as const) : ([selectedPerson] as const);
    const hasCollision = targetPeople.some((person) => person === "A" ? isOccupiedA : isOccupiedB);
    if (hasCollision) {
      toast({
        variant: "destructive",
        title: "Błąd",
        description: "Ten posiłek jest już zajęty dla wybranej osoby w wybranym dniu.",
      });
      return;
    }

    const getAddonAmountForPerson = (person: "A" | "B", addon: any, index: number) => {
      const addonKey = getAddonSelectionKey(addon, index);
      const directAmount = selectedFrequentAddons?.[person]?.[addonKey];
      if (directAmount !== undefined) return Number(directAmount) || 0;

      if (addForBothPeople) {
        const fallbackAmount = selectedFrequentAddons?.[selectedPerson]?.[addonKey];
        if (fallbackAmount !== undefined) return Number(fallbackAmount) || 0;
      }

      return 0;
    };

    const getSelectedAddonsForPerson = (person: "A" | "B") => (recipeToPlan?.frequentAddons || [])
      .map((addon: any, index: number) => ({
        ...addon,
        amount: getAddonAmountForPerson(person, addon, index),
      }))
      .filter((addon: any) => addon.amount > 0);

    try {
      for (const person of targetPeople) {
        const createdEntry: any = await addEntry({
          date: selectedDate,
          mealType: selectedMealType,
          recipeId: recipeToPlan.id,
          person,
          isEaten: false,
          servings: selectedRecipeServings,
        });

        const selectedAddons = getSelectedAddonsForPerson(person);
        if (selectedAddons.length > 0) {
          const baseIngredients = (recipeToPlan.ingredients || []).map((ri: any) => ({
            ingredientId: ri.ingredientId,
            amount: Number(ri.amount) || 0,
          }));

          const mergedIngredients = [
            ...baseIngredients,
            ...selectedAddons.map((addon: any) => ({
              ingredientId: addon.ingredientId,
              amount: Number(addon.amount) || 0,
            })),
          ];

          await updateMealEntry.mutateAsync({
            id: createdEntry.id,
            updates: {
              ingredients: mergedIngredients,
              servings: selectedRecipeServings,
            },
          });
        }

        const selectedSuggestions = suggestedRecipeOptionsForPlan
          .filter((entry: any) => Number(selectedSuggestedRecipes[String(entry.recipe.id)] || 0) > 0)
          .map((entry: any) => ({
            recipeId: Number(entry.recipe.id),
            servings: Number(selectedSuggestedRecipes[String(entry.recipe.id)] || 0),
          }));

        for (const suggestion of selectedSuggestions) {
          await addEntry({
            date: selectedDate,
            mealType: selectedMealType,
            recipeId: suggestion.recipeId,
            person,
            isEaten: false,
            servings: suggestion.servings,
          });
        }
      }

      setIsAddToPlanOpen(false);
      setRecipeToPlan(null);
      setSelectedFrequentAddons({ A: {}, B: {} });
      setAddForBothPeople(true);
      setSelectedRecipeServings(1);
      setSelectedSuggestedRecipes({});
      toast({ title: "Sukces", description: addForBothPeople ? "Przepis dodany do planu dla Tysi i Matiego." : `Przepis dodany do planu dla ${personName[selectedPerson]}.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Błąd", description: err?.message || "Nie udało się dodać przepisu." });
    }
  };

  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), i);
    return {
      value: format(d, "yyyy-MM-dd"),
      label: format(d, "EEEE, d MMM", { locale: pl })
    };
  });

  // Form setup
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
      suggestedRecipes: [],
      ingredients: [{ ingredientId: 0, amount: 100, baseAmount: 100, unit: "g", alternativeAmount: undefined, alternativeUnit: "", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] }],
      frequentAddons: [] as { ingredientId: number; amount: number; baseAmount?: number; unit?: string; alternativeAmount?: number; alternativeUnit?: string; scalingType?: ScalingType; scalingFormula?: string; stepThresholds?: { minServings: number; maxServings?: number | null; amount: number }[] }[],
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
  const watchedInstructions = form.watch("instructions");
  const watchedRecipeIngredients = form.watch("ingredients");
  const watchedFrequentAddons = form.watch("frequentAddons");
  const instructionLines = useMemo(() => parseInstructionLines(watchedInstructions), [watchedInstructions]);
  const mappableIngredients = useMemo(() => {
    const ingredientDictionary = new Map((availableIngredients || []).map((ingredient: any) => [Number(ingredient.id), ingredient]));

    const recipeIngredientOptions = (watchedRecipeIngredients || [])
      .map((recipeIngredient: any) => {
        const ingredientId = Number(recipeIngredient?.ingredientId);
        const ingredient = ingredientDictionary.get(ingredientId);
        if (!ingredient) return null;

        const amount = Number(recipeIngredient?.baseAmount ?? recipeIngredient?.amount ?? 0);
        const unit = recipeIngredient?.unit || ingredient.unit || "g";

        return {
          id: ingredientId,
          source: "ingredient" as const,
          key: `ingredient-${ingredientId}`,
          label: `${ingredient.name}-${amount}${unit}`,
          name: ingredient.name,
        };
      })
      .filter(Boolean);

    const frequentAddonOptions = (watchedFrequentAddons || [])
      .map((addon: any) => {
        const ingredientId = Number(addon?.ingredientId);
        const ingredient = ingredientDictionary.get(ingredientId);
        if (!ingredient) return null;

        const amount = Number(addon?.baseAmount ?? addon?.amount ?? 0);
        const unit = addon?.unit || ingredient.unit || "g";

        return {
          id: ingredientId,
          source: "frequentAddon" as const,
          key: `frequentAddon-${ingredientId}`,
          label: `[Dodatek] ${ingredient.name}-${amount}${unit}`,
          name: ingredient.name,
        };
      })
      .filter(Boolean);

    return [...recipeIngredientOptions, ...frequentAddonOptions] as { id: number; source: "ingredient" | "frequentAddon"; key: string; label: string; name: string }[];
  }, [availableIngredients, watchedRecipeIngredients, watchedFrequentAddons]);



  const groupedInstructionLinks = useMemo(() => {
    const grouped = new Map<string, InstructionLink[]>();
    instructionLinks.forEach((link) => {
      const multiplier = typeof link.multiplier === "number" ? link.multiplier : 1;
      const key = `${link.stepIndex}__${link.text.trim().toLowerCase()}__${multiplier}__${link.ingredientSource || "ingredient"}`;
      const existing = grouped.get(key) || [];
      grouped.set(key, [...existing, link]);
    });
    return Array.from(grouped.values());
  }, [instructionLinks]);

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
  const updateMealEntry = useUpdateMealEntry();

  const openEdit = (recipe: any) => {
    setEditingRecipe(recipe);
    form.reset({
      name: recipe.name,
      tags: recipe.tags || [],
      description: recipe.description || "",
      instructions: recipe.instructions || "",
      instructionSteps: recipe.instructionSteps || [],
      prepTime: recipe.prepTime,
      servings: recipe.servings || 1,
      imageUrl: recipe.imageUrl || "",
      suggestedRecipes: ((recipe.suggestedRecipes || []).length > 0 ? recipe.suggestedRecipes : (recipe.suggestedRecipeIds || []).map((id: any) => ({ recipeId: Number(id), servings: 1 })))
        .map((item: any) => ({ recipeId: Number(item.recipeId), servings: Number(item.servings) || 1 }))
        .filter((item: any) => Number.isFinite(item.recipeId) && item.recipeId > 0),
      ingredients: recipe.ingredients.map((ri: any) => ({
        ingredientId: ri.ingredientId,
        amount: Number(ri.baseAmount ?? ri.amount ?? 0),
        baseAmount: Number(ri.baseAmount ?? ri.amount ?? 0),
        unit: ri.unit || ri.ingredient?.unit || "g",
        alternativeAmount: Number(ri.alternativeAmount) || undefined,
        alternativeUnit: ri.alternativeUnit || "",
        scalingType: ri.scalingType || "LINEAR",
        scalingFormula: ri.scalingFormula || "",
        stepThresholds: ri.stepThresholds || [],
      })),
      frequentAddons: (recipe.frequentAddons || []).map((addon: any) => ({
        ingredientId: addon.ingredientId,
        amount: Number(addon.baseAmount ?? addon.amount ?? 0),
        baseAmount: Number(addon.baseAmount ?? addon.amount ?? 0),
        unit: addon.unit || addon.ingredient?.unit || "g",
        alternativeAmount: Number(addon.alternativeAmount) || undefined,
        alternativeUnit: addon.alternativeUnit || "",
        scalingType: addon.scalingType || "LINEAR",
        scalingFormula: addon.scalingFormula || "",
        stepThresholds: addon.stepThresholds || [],
      })),
    });
    const initialLinks: InstructionLink[] = (recipe.instructionSteps || []).flatMap((step: any, stepIndex: number) =>
      (step?.segments || [])
        .filter((segment: any) => segment.type === "ingredient")
        .flatMap((segment: any) => {
          const ingredientIds = Array.isArray(segment.ingredientIds) && segment.ingredientIds.length > 0
            ? segment.ingredientIds
            : [segment.ingredientId];

          return ingredientIds.map((ingredientId: number) => ({
            stepIndex,
            text: segment.text,
            ingredientId: Number(ingredientId),
            ingredientSource: segment.ingredientSource === "frequentAddon" ? "frequentAddon" : "ingredient",
            multiplier: typeof segment.multiplier === "number" ? segment.multiplier : 1,
          }));
        })
    );
    setInstructionLinks(initialLinks);
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
      instructionSteps: [],
      prepTime: 15,
      servings: 1,
      imageUrl: "",
      suggestedRecipes: [],
      ingredients: [{ ingredientId: 0, amount: 100, baseAmount: 100, unit: "g", alternativeAmount: undefined, alternativeUnit: "", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] }],
      frequentAddons: [],
    });
    setInstructionLinks([]);
    setNewInstructionLink({ stepIndex: 0, text: "", ingredientId: 0, ingredientSource: "ingredient", multiplier: 1 });
  };

  const { mutate: createRecipeMutation, isPending: isCreating } = useCreateRecipe();
  const { mutate: updateRecipeMutation, isPending: isUpdating } = useUpdateRecipe();

  const toggleRecipeFavorite = (recipe: any) => {
    const payload = {
      name: recipe.name,
      tags: recipe.tags || [],
      description: recipe.description || "",
      instructions: recipe.instructions || "",
      instructionSteps: recipe.instructionSteps || [],
      prepTime: recipe.prepTime || 0,
      imageUrl: recipe.imageUrl || "",
      servings: Number(recipe.servings) || 1,
      suggestedRecipes: ((recipe.suggestedRecipes || []).length > 0 ? recipe.suggestedRecipes : (recipe.suggestedRecipeIds || []).map((id: any) => ({ recipeId: Number(id), servings: 1 })))
        .map((item: any) => ({ recipeId: Number(item.recipeId), servings: Number(item.servings) || 1 }))
        .filter((item: any) => Number.isFinite(item.recipeId) && item.recipeId > 0),
      isFavorite: !recipe.isFavorite,
      ingredients: (recipe.ingredients || []).map((ri: any) => ({
        ingredientId: ri.ingredientId,
        amount: Number(ri.baseAmount ?? ri.amount ?? 0),
        baseAmount: Number(ri.baseAmount ?? ri.amount ?? 0),
        unit: ri.unit || ri.ingredient?.unit || "g",
        alternativeAmount: Number(ri.alternativeAmount) || undefined,
        alternativeUnit: ri.alternativeUnit || undefined,
        scalingType: (ri.scalingType || "LINEAR") as ScalingType,
        scalingFormula: ri.scalingType === "FORMULA" ? ri.scalingFormula : undefined,
        stepThresholds: ri.scalingType === "STEP" ? (ri.stepThresholds || []) : undefined,
      })),
      frequentAddons: (recipe.frequentAddons || []).map((addon: any) => ({
        ingredientId: addon.ingredientId,
        amount: Number(addon.baseAmount ?? addon.amount) || 0,
        baseAmount: Number(addon.baseAmount ?? addon.amount) || 0,
        unit: addon.unit || addon.ingredient?.unit || "g",
        alternativeAmount: Number(addon.alternativeAmount) || undefined,
        alternativeUnit: addon.alternativeUnit || undefined,
        scalingType: (addon.scalingType || "LINEAR") as ScalingType,
        scalingFormula: addon.scalingType === "FORMULA" ? addon.scalingFormula : undefined,
        stepThresholds: addon.scalingType === "STEP" ? (addon.stepThresholds || []) : undefined,
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
    const instructionSteps = buildInstructionSteps(data.instructions, instructionLinks);
    const normalizedData = {
      ...data,
      instructionSteps,
      suggestedRecipes: (data.suggestedRecipes || [])
        .map((item: any) => ({ recipeId: Number(item.recipeId), servings: Number(item.servings) }))
        .filter((item: any) => Number.isFinite(item.recipeId) && item.recipeId > 0 && Number.isFinite(item.servings) && item.servings > 0),
      suggestedRecipeIds: (data.suggestedRecipes || []).map((item: any) => Number(item.recipeId)).filter((id: number) => Number.isFinite(id) && id > 0),
      ingredients: (data.ingredients || []).map((ingredient: any) => ({
        ...ingredient,
        baseAmount: Number(ingredient.baseAmount ?? ingredient.amount ?? 0),
        amount: Number(ingredient.baseAmount ?? ingredient.amount ?? 0),
        unit: ingredient.unit || "g",
        alternativeAmount: Number(ingredient.alternativeAmount) > 0 ? Number(ingredient.alternativeAmount) : undefined,
        alternativeUnit: ingredient.alternativeUnit?.trim() ? ingredient.alternativeUnit.trim() : undefined,
        scalingType: (ingredient.scalingType || "LINEAR") as ScalingType,
        scalingFormula: ingredient.scalingType === "FORMULA" ? ingredient.scalingFormula : undefined,
        stepThresholds: ingredient.scalingType === "STEP" ? (ingredient.stepThresholds || []) : undefined,
      })),
      frequentAddons: (data.frequentAddons || []).map((addon: any) => ({
        ...addon,
        baseAmount: Number(addon.baseAmount ?? addon.amount ?? 0),
        amount: Number(addon.baseAmount ?? addon.amount ?? 0),
        unit: addon.unit || "g",
        alternativeAmount: Number(addon.alternativeAmount) > 0 ? Number(addon.alternativeAmount) : undefined,
        alternativeUnit: addon.alternativeUnit?.trim() ? addon.alternativeUnit.trim() : undefined,
        scalingType: (addon.scalingType || "LINEAR") as ScalingType,
        scalingFormula: addon.scalingType === "FORMULA" ? addon.scalingFormula : undefined,
        stepThresholds: addon.scalingType === "STEP" ? (addon.stepThresholds || []) : undefined,
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
          <p className="text-sm text-muted-foreground mt-1">Dodane przepisy: {recipes?.length || 0}</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setIsOpen(true); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-recipe" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 rounded-xl h-12 px-6 shadow-lg shadow-primary/20" onClick={() => { if (!editingRecipe) closeDialog(); setIsOpen(true); }}>
              <Plus className="w-5 h-5" /> Stwórz przepis
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden px-2 py-3 sm:max-h-[90vh] sm:px-6 sm:py-6 max-sm:h-[92dvh] max-sm:w-[95vw] max-sm:max-w-[95vw]">
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
                  <label className="text-sm font-medium mb-1 block">Sugerowane dodatki (inne przepisy + porcje)</label>
                  <div className="max-h-52 overflow-y-auto rounded-md border p-2 space-y-2">
                    {(recipes || [])
                      .filter((candidate: any) => Number(candidate.id) !== Number(editingRecipe?.id || 0))
                      .map((candidate: any) => {
                        const current = form.watch("suggestedRecipes") || [];
                        const selectedItem = current.find((item: any) => Number(item.recipeId) === Number(candidate.id));
                        const selected = !!selectedItem;
                        return (
                          <div key={candidate.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                const existing = (form.getValues("suggestedRecipes") || []).map((item: any) => ({ recipeId: Number(item.recipeId), servings: Number(item.servings) || 1 }));
                                const next = e.target.checked
                                  ? [...existing.filter((item: any) => Number(item.recipeId) !== Number(candidate.id)), { recipeId: Number(candidate.id), servings: 1 }]
                                  : existing.filter((item: any) => Number(item.recipeId) !== Number(candidate.id));
                                form.setValue("suggestedRecipes", next, { shouldDirty: true });
                              }}
                            />
                            <span className="flex-1">{candidate.name}</span>
                            <Input
                              type="number"
                              step="0.25"
                              min="0.1"
                              className="w-24 h-8"
                              disabled={!selected}
                              value={selectedItem?.servings ?? 1}
                              onChange={(e) => {
                                const nextServings = Math.max(0.1, Number(e.target.value) || 1);
                                const existing = (form.getValues("suggestedRecipes") || []).map((item: any) => ({ recipeId: Number(item.recipeId), servings: Number(item.servings) || 1 }));
                                const next = existing.map((item: any) => Number(item.recipeId) === Number(candidate.id) ? { ...item, servings: nextServings } : item);
                                form.setValue("suggestedRecipes", next, { shouldDirty: true });
                              }}
                            />
                          </div>
                        );
                      })}
                    {(recipes || []).filter((candidate: any) => Number(candidate.id) !== Number(editingRecipe?.id || 0)).length === 0 && (
                      <p className="text-xs text-muted-foreground">Brak innych przepisów do powiązania.</p>
                    )}
                  </div>
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
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
                          <div className="flex-1">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between h-8 rounded-lg bg-background font-normal text-xs sm:h-9 sm:text-sm",
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
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:flex lg:flex-1 lg:gap-2">
                            <div className="col-span-1 lg:w-24">
                              <Input type="number" placeholder="Bazowa" className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`ingredients.${index}.baseAmount` as const)} />
                            </div>
                            <div className="col-span-1 lg:w-24">
                              <Input placeholder="Jedn." className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`ingredients.${index}.unit` as const)} />
                            </div>
                            <div className="col-span-1 lg:w-24">
                              <Input type="number" step="0.01" placeholder="np. 1" className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`ingredients.${index}.alternativeAmount` as const)} />
                            </div>
                            <div className="col-span-1 lg:w-32">
                              <Input placeholder="np. sztuka" className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`ingredients.${index}.alternativeUnit` as const)} />
                            </div>
                          </div>
                          <div className="w-full lg:w-36">
                            <Select
                              value={form.watch(`ingredients.${index}.scalingType`) || "LINEAR"}
                              onValueChange={(value) => form.setValue(`ingredients.${index}.scalingType`, value as any)}
                            >
                              <SelectTrigger className="h-8 rounded-lg text-xs sm:h-9 sm:text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="LINEAR">LINEAR</SelectItem>
                                <SelectItem value="FIXED">FIXED</SelectItem>
                                <SelectItem value="STEP">STEP</SelectItem>
                                <SelectItem value="FORMULA">FORMULA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg hover:bg-red-50 hover:text-red-500 self-end sm:self-auto" onClick={() => remove(index)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {(() => {
                          const selectedIngredient = (availableIngredients || []).find((i: any) => i.id === selectedId);
                          const baseAmount = Number(form.watch(`ingredients.${index}.baseAmount`)) || 0;
                          const alternativeAmount = Number(form.watch(`ingredients.${index}.alternativeAmount`)) || 0;
                          const alternativeUnit = form.watch(`ingredients.${index}.alternativeUnit`) || "";
                          if (alternativeAmount <= 0 || !alternativeUnit.trim()) return null;
                          return (
                            <p className="mt-2 text-[10px] text-muted-foreground sm:text-xs">
                              Podgląd: {formatLocalizedNumber(baseAmount)}g = {formatLocalizedNumber(alternativeAmount)} {alternativeUnit}
                              {selectedIngredient?.unitWeight ? ` · baza składnika: 1 szt ≈ ${formatLocalizedNumber(Number(selectedIngredient.unitWeight))}g` : ""}
                            </p>
                          );
                        })()}
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
                <Button type="button" variant="outline" size="sm" className="rounded-lg border-dashed w-full py-3 sm:py-5 border-2 hover:bg-primary/5 hover:border-primary/50 transition-all text-xs sm:text-sm" onClick={() => append({ ingredientId: 0, amount: 100, baseAmount: 100, unit: "g", alternativeAmount: undefined, alternativeUnit: "", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] })}>
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
                      <div key={field.id} className="bg-emerald-50/60 p-2 rounded-xl border border-emerald-100">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
                          <div className="flex-1">
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between h-8 rounded-lg bg-background font-normal text-xs sm:h-9 sm:text-sm",
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
                                            if (!form.getValues(`frequentAddons.${index}.unit` as const)) {
                                              form.setValue(`frequentAddons.${index}.unit` as const, i.unit || "g");
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
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:flex lg:flex-1 lg:gap-2">
                            <div className="col-span-1 lg:w-24">
                              <Input type="number" placeholder="Bazowa" className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`frequentAddons.${index}.baseAmount` as const)} />
                            </div>
                            <div className="col-span-1 lg:w-24">
                              <Input placeholder="Jedn." className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`frequentAddons.${index}.unit` as const)} />
                            </div>
                            <div className="col-span-1 lg:w-24">
                              <Input type="number" step="0.01" placeholder="np. 1" className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`frequentAddons.${index}.alternativeAmount` as const)} />
                            </div>
                            <div className="col-span-1 lg:w-32">
                              <Input placeholder="np. sztuka" className="h-8 rounded-lg px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" {...form.register(`frequentAddons.${index}.alternativeUnit` as const)} />
                            </div>
                          </div>
                          <div className="w-full lg:w-36">
                            <Select
                              value={form.watch(`frequentAddons.${index}.scalingType`) || "LINEAR"}
                              onValueChange={(value) => form.setValue(`frequentAddons.${index}.scalingType`, value as any)}
                            >
                              <SelectTrigger className="h-8 rounded-lg text-xs sm:h-9 sm:text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="LINEAR">LINEAR</SelectItem>
                                <SelectItem value="FIXED">FIXED</SelectItem>
                                <SelectItem value="STEP">STEP</SelectItem>
                                <SelectItem value="FORMULA">FORMULA</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg hover:bg-red-50 hover:text-red-500 self-end sm:self-auto" onClick={() => removeFrequentAddon(index)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {(() => {
                          const baseAmount = Number(form.watch(`frequentAddons.${index}.baseAmount`)) || 0;
                          const alternativeAmount = Number(form.watch(`frequentAddons.${index}.alternativeAmount`)) || 0;
                          const alternativeUnit = form.watch(`frequentAddons.${index}.alternativeUnit`) || "";
                          if (alternativeAmount <= 0 || !alternativeUnit.trim()) return null;
                          return (
                            <p className="mt-2 text-[10px] text-muted-foreground sm:text-xs">
                              Podgląd: {formatLocalizedNumber(baseAmount)}g = {formatLocalizedNumber(alternativeAmount)} {alternativeUnit}
                            </p>
                          );
                        })()}
                        {form.watch(`frequentAddons.${index}.scalingType`) === "FORMULA" && (
                          <div className="mt-2">
                            <Input placeholder="np. 100 + (scaleFactor - 1) * 50" className="h-9 rounded-lg" {...form.register(`frequentAddons.${index}.scalingFormula` as const)} />
                          </div>
                        )}
                        {form.watch(`frequentAddons.${index}.scalingType`) === "STEP" && (
                          <div className="mt-2 space-y-2">
                            {(form.watch(`frequentAddons.${index}.stepThresholds`) || []).map((_: any, thresholdIndex: number) => (
                              <div key={thresholdIndex} className="grid grid-cols-4 gap-2 items-center">
                                <Input type="number" placeholder="Od porcji" {...form.register(`frequentAddons.${index}.stepThresholds.${thresholdIndex}.minServings` as const)} />
                                <Input type="number" placeholder="Do porcji" {...form.register(`frequentAddons.${index}.stepThresholds.${thresholdIndex}.maxServings` as const)} />
                                <Input type="number" placeholder="Ilość" {...form.register(`frequentAddons.${index}.stepThresholds.${thresholdIndex}.amount` as const)} />
                                <Button type="button" variant="ghost" onClick={() => {
                                  const current = form.getValues(`frequentAddons.${index}.stepThresholds`) || [];
                                  form.setValue(`frequentAddons.${index}.stepThresholds`, current.filter((_: any, i: number) => i !== thresholdIndex));
                                }}>Usuń</Button>
                              </div>
                            ))}
                            <Button type="button" variant="outline" onClick={() => {
                              const current = form.getValues(`frequentAddons.${index}.stepThresholds`) || [];
                              form.setValue(`frequentAddons.${index}.stepThresholds`, [...current, { minServings: 1, maxServings: null, amount: Number(form.getValues(`frequentAddons.${index}.baseAmount`) || 0) }]);
                            }}>+ Próg</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button type="button" variant="outline" size="sm" className="rounded-lg border-dashed w-full py-3 sm:py-5 border-2 hover:bg-emerald-50 hover:border-emerald-300 transition-all text-xs sm:text-sm" onClick={() => appendFrequentAddon({ ingredientId: 0, amount: 50, baseAmount: 50, unit: "g", alternativeAmount: undefined, alternativeUnit: "", scalingType: "LINEAR", scalingFormula: "", stepThresholds: [] })}>
                  + Dodaj najczęsty dodatek
                </Button>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Kroki wykonania (1 krok w linii)</label>
                <textarea 
                  {...form.register("instructions")} 
                  className="w-full min-h-[140px] p-3 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" 
                  placeholder={"1. Pokrój warzywa\n2. Smaż 8 minut [timer:8]\n3. Dopraw i podaj"}
                />
                <p className="text-xs text-muted-foreground mt-1">To samo pole zasila widok instrukcji i cooking mode. Opcjonalny timer dodasz jako [timer:liczba].</p>

                <div className="mt-3 rounded-xl border p-3 space-y-2 bg-secondary/20">
                  <p className="text-xs font-semibold">Mapowanie fragmentów na składniki (Cooking Mode)</p>
                  <div className="grid sm:grid-cols-4 gap-2">
                    <Select value={String(newInstructionLink.stepIndex)} onValueChange={(v) => setNewInstructionLink((prev) => ({ ...prev, stepIndex: Number(v) }))}>
                      <SelectTrigger><SelectValue placeholder="Krok" /></SelectTrigger>
                      <SelectContent>
                        {instructionLines.map((line, idx) => (<SelectItem key={idx} value={String(idx)}>Krok {idx + 1}: {line.slice(0, 24)}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Fragment tekstu" value={newInstructionLink.text} onChange={(e) => setNewInstructionLink((prev) => ({ ...prev, text: e.target.value }))} />
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]+"
                      placeholder="Mnożnik"
                      value={newInstructionLinkMultiplierInput}
                      onChange={(e) => {
                        const rawValue = e.target.value;
                        setNewInstructionLinkMultiplierInput(rawValue);
                        setNewInstructionLink((prev) => ({
                          ...prev,
                          multiplier: parsePositiveMultiplier(rawValue),
                        }));
                      }}
                      onBlur={() => {
                        const parsedMultiplier = parsePositiveMultiplier(newInstructionLinkMultiplierInput);
                        setNewInstructionLink((prev) => ({ ...prev, multiplier: parsedMultiplier }));
                        setNewInstructionLinkMultiplierInput(String(parsedMultiplier));
                      }}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select
                        value={newInstructionLink.ingredientId ? `${newInstructionLink.ingredientSource || "ingredient"}:${newInstructionLink.ingredientId}` : "0"}
                        onValueChange={(v) => {
                          if (v === "0") {
                            setNewInstructionLink((prev) => ({ ...prev, ingredientId: 0, ingredientSource: "ingredient" }));
                            return;
                          }
                          const [source, id] = v.split(":");
                          setNewInstructionLink((prev) => ({
                            ...prev,
                            ingredientId: Number(id),
                            ingredientSource: source === "frequentAddon" ? "frequentAddon" : "ingredient",
                          }));
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Składnik / dodatek" /></SelectTrigger>
                        <SelectContent>
                          {mappableIngredients.map((ingredient) => (
                            <SelectItem key={ingredient.key} value={`${ingredient.source}:${ingredient.id}`}>{ingredient.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (!newInstructionLink.text.trim() || !newInstructionLink.ingredientId) return;
                          const multiplier = parsePositiveMultiplier(newInstructionLinkMultiplierInput);
                          setInstructionLinks((prev) => [...prev, { ...newInstructionLink, multiplier }]);
                          setNewInstructionLink((prev) => ({ ...prev, multiplier }));
                        }}
                      >Dodaj</Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {groupedInstructionLinks.map((group, idx) => {
                      const first = group[0];
                      const ingredientNames = group
                        .map((link) => {
                          const ingredientName = (availableIngredients || []).find((ing: any) => ing.id === link.ingredientId)?.name || `#${link.ingredientId}`;
                          return link.ingredientSource === "frequentAddon" ? `[Dodatek] ${ingredientName}` : ingredientName;
                        })
                        .join(", ");
                      return (
                        <div key={`${first.stepIndex}-${first.text}-${idx}`} className="flex items-center justify-between text-xs bg-white rounded-md px-2 py-1 border">
                          <span>Krok {first.stepIndex + 1}: <b>{first.text}</b> → {ingredientNames} ×{first.multiplier ?? 1}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setInstructionLinks((prev) =>
                                prev.filter((link) => {
                                  const sameMultiplier = (link.multiplier ?? 1) === (first.multiplier ?? 1);
                                  return !(link.stepIndex === first.stepIndex && link.text === first.text && sameMultiplier && (link.ingredientSource || "ingredient") === (first.ingredientSource || "ingredient"));
                                })
                              )
                            }
                          >
                            Usuń
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3 sm:pt-4">
                <Button type="button" variant="ghost" onClick={closeDialog}>Anuluj</Button>
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full sm:w-[240px] h-[52px] rounded-2xl bg-white shadow-sm border-border justify-between">
                <span className="truncate">
                  {effectiveAvailableIngredientIds.length > 0
                    ? `Mam w domu: ${effectiveAvailableIngredientIds.length}`
                    : "Zaznacz co masz w domu"}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Szukaj składnika..." />
                <CommandList>
                  <CommandEmpty>Brak składników.</CommandEmpty>
                  <CommandGroup>
                    {(availableIngredients || []).map((ingredient: any) => {
                      const isAlwaysAtHome = !!ingredient.alwaysAtHome;
                      const checked = effectiveAvailableIngredientIds.includes(ingredient.id);
                      return (
                        <CommandItem
                          key={ingredient.id}
                          value={ingredient.name}
                          onSelect={() => {
                            toggleIngredientAvailability(ingredient.id, !checked, isAlwaysAtHome);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                          <span className="flex-1">{ingredient.name}</span>
                          {isAlwaysAtHome && <span className="text-[10px] text-emerald-700">domyślnie</span>}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
                <div className="border-t p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-center text-xs"
                    onClick={resetIngredientSelection}
                  >
                    Resetuj wybór (tylko "zawsze mam w domu")
                  </Button>
                </div>
              </Command>
            </PopoverContent>
          </Popover>

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
              <SelectItem value="favorites">Tylko ulubione</SelectItem>
              <SelectItem value="match">Dopasowanie do składników</SelectItem>
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
                    setSelectedFrequentAddons({ A: {}, B: {} });
                    setAddForBothPeople(true);
                    setSelectedPerson("A");
                    setSelectedRecipeServings(1);
            setSelectedSuggestedRecipes({});
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
                {(() => {
                  const totalIngredients = (recipe.ingredients || []).length;
                  const matchingIngredients = (recipe.ingredients || []).filter((ri: any) =>
                    effectiveAvailableIngredientIds.includes(Number(ri.ingredientId))
                  ).length;
                  const matchScore = totalIngredients === 0 ? 0 : matchingIngredients / totalIngredients;
                  return (
                    <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-sm py-0.5 px-2 inline-flex w-fit">
                      Dopasowanie: {Math.round(matchScore * 100)}% ({matchingIngredients}/{totalIngredients})
                    </div>
                  );
                })()}
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
        onAddToPlan={(recipe, servingsOverride) => {
          setRecipeToPlan(recipe);
          setViewingRecipe(null);
          setSelectedFrequentAddons({ A: {}, B: {} });
          setAddForBothPeople(true);
          setSelectedPerson("A");
          setSelectedRecipeServings(Number(servingsOverride) > 0 ? Number(servingsOverride) : 1);
          const initialSuggestions = ((recipe?.suggestedRecipes || []) as any[]).reduce((acc: Record<string, number>, item: any) => {
            const recipeId = Number(item?.recipeId);
            const servings = Number(item?.servings) || 0;
            if (Number.isFinite(recipeId) && recipeId > 0 && servings > 0) acc[String(recipeId)] = servings;
            return acc;
          }, {});
          setSelectedSuggestedRecipes(initialSuggestions);
          setIsAddToPlanOpen(true);
        }}
        availableIngredientIds={effectiveAvailableIngredientIds}
        allRecipes={recipes || []}
      />

      <Dialog
        open={isAddToPlanOpen}
        onOpenChange={(open) => {
          setIsAddToPlanOpen(open);
          if (!open) {
            setSelectedFrequentAddons({ A: {}, B: {} });
            setAddForBothPeople(true);
            setSelectedPerson("A");
            setSelectedRecipeServings(1);
            setSelectedSuggestedRecipes({});
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
            <div className="grid gap-2">
              <label className="text-sm font-medium">Liczba porcji przepisu</label>
              <Input type="number" step="0.25" min="0.1" value={selectedRecipeServings} onChange={(e) => setSelectedRecipeServings(Math.max(0.1, Number(e.target.value) || 1))} />
            </div>

            {suggestedRecipeOptionsForPlan.length > 0 && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">A może dodać też?</label>
                <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
                  {suggestedRecipeOptionsForPlan.map((entry: any) => {
                    const key = String(entry.recipe.id);
                    const amount = Number(selectedSuggestedRecipes[key] ?? 0);
                    return (
                      <div key={entry.recipe.id} className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-sm flex-1">
                          <input
                            type="checkbox"
                            checked={amount > 0}
                            onChange={(e) => {
                              setSelectedSuggestedRecipes((prev) => ({
                                ...prev,
                                [key]: e.target.checked ? (amount > 0 ? amount : Number(entry.servings) || 1) : 0,
                              }));
                            }}
                          />
                          <span>{entry.recipe.name}</span>
                        </label>
                        <Input
                          type="number"
                          step="0.25"
                          min="0.1"
                          className="h-8 w-24"
                          disabled={amount <= 0}
                          value={amount > 0 ? amount : Number(entry.servings) || 1}
                          onChange={(e) => {
                            const nextAmount = Math.max(0.1, Number(e.target.value) || Number(entry.servings) || 1);
                            setSelectedSuggestedRecipes((prev) => ({ ...prev, [key]: nextAmount }));
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Dla kogo</label>
              <Select value={selectedPerson} onValueChange={(value) => setSelectedPerson(value as "A" | "B")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Tysia</SelectItem>
                  <SelectItem value="B">Mati</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={addForBothPeople}
                  onChange={(e) => setAddForBothPeople(e.target.checked)}
                />
                Dodaj od razu dla obu osób
              </label>
            </div>
            {(recipeToPlan?.frequentAddons || []).length > 0 && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Sugerowane dodatki</label>
                <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
                  {(recipeToPlan.frequentAddons || []).map((addon: any, index: number) => {
                    const addonKey = getAddonSelectionKey(addon, index);
                    return (
                    <div key={addonKey} className="space-y-1 rounded-lg border bg-white p-2 text-sm">
                      <div className="font-medium">{addon.ingredient?.name || "Składnik"}</div>
                      <div className="text-xs text-muted-foreground">Krok: +{formatLocalizedNumber(Number(addon.baseAmount ?? addon.amount) || 0)} {addon.unit || "g"}</div>
                      {(["A", "B"] as const).map((person) => (
                        <div key={`${addonKey}-${person}`} className="flex items-center gap-2">
                          <span className="w-12 text-xs text-muted-foreground font-semibold">{personName[person]}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => adjustAddonAmount(person, addonKey, -(Number(addon.baseAmount ?? addon.amount) || 0))}
                          >
                            -
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            value={selectedFrequentAddons[person][addonKey] || 0}
                            onChange={(e) => {
                              setAddonAmount(person, addonKey, Number(e.target.value) || 0);
                            }}
                            className="h-8 w-24"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => adjustAddonAmount(person, addonKey, Number(addon.baseAmount ?? addon.amount) || 0)}
                          >
                            +
                          </Button>
                          <span className="text-xs text-muted-foreground">{addon.unit || "g"}</span>
                        </div>
                      ))}
                    </div>
                  )})}
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
