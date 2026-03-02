import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, ChefHat, CalendarPlus, Settings2, Play, Pause, RotateCcw, ChefHatIcon } from "lucide-react";
import { calculateScaledAmount } from "@shared/scaling";
import type { InstructionStep } from "@shared/schema";
import { parseInstructionLines } from "@/lib/instruction-steps";

const parseDurationFromStep = (step: string) => {
  const explicitTimer = step.match(/\[timer\s*:\s*(\d+)\]/i);
  if (explicitTimer) return Number(explicitTimer[1]);

  const naturalLanguage = step.match(/(\d+)\s*(min|minut|minuty|minute|minutes)/i);
  return naturalLanguage ? Number(naturalLanguage[1]) : 0;
};

interface RecipeViewProps {
  recipe: any;
  isOpen: boolean;
  onClose: () => void;
  onAddToPlan: (recipe: any) => void;
  plannedServings?: number;
  onEditIngredients?: () => void;
  showFooter?: boolean;
  mealEntryIngredients?: any[];
  frequentAddonIds?: number[];
  availableIngredientIds?: number[];
}

export function RecipeView({ 
  recipe, 
  isOpen, 
  onClose, 
  onAddToPlan, 
  plannedServings, 
  onEditIngredients,
  showFooter = true,
  mealEntryIngredients,
  frequentAddonIds = [],
  availableIngredientIds = [],
}: RecipeViewProps) {
  const [isCookingMode, setIsCookingMode] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const instructionSteps = useMemo<InstructionStep[]>(() => {
    if (Array.isArray(recipe?.instructionSteps) && recipe.instructionSteps.length > 0) return recipe.instructionSteps;
    return parseInstructionLines(recipe?.instructions).map((step) => ({ segments: [{ type: "text", text: step }] }));
  }, [recipe?.instructionSteps, recipe?.instructions]);

  const isPlannedView = plannedServings !== undefined;
  const recipeServings = Number(recipe?.servings) || 1;
  const servingsToUse = isPlannedView ? plannedServings : recipeServings;
  
  // Use entry-specific ingredients if provided (for Meal Plan/Dashboard view of a planned meal)
  const baseIngredients = (mealEntryIngredients && mealEntryIngredients.length > 0) 
    ? mealEntryIngredients 
    : (recipe?.ingredients || []);

  const frequentAddonSet = new Set((frequentAddonIds || []).map((id) => Number(id)));
  const availableIngredientSet = new Set((availableIngredientIds || []).map((id) => Number(id)));

  const currentStep = instructionSteps[currentStepIndex];
  const currentStepText = (currentStep?.segments || []).map((segment: any) => segment.text).join("") || "";
  const currentStepDurationMinutes = parseDurationFromStep(currentStepText);

  useEffect(() => {
    if (!isOpen) {
      setIsCookingMode(false);
      setCurrentStepIndex(0);
      setTimerRemainingSeconds(0);
      setIsTimerRunning(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isCookingMode || !isTimerRunning || timerRemainingSeconds <= 0) {
      if (timerRemainingSeconds <= 0) setIsTimerRunning(false);
      return;
    }

    const interval = window.setInterval(() => {
      setTimerRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isCookingMode, isTimerRunning, timerRemainingSeconds]);

  useEffect(() => {
    if (!isCookingMode || !("wakeLock" in navigator)) return;

    let wakeLock: any;
    const requestWakeLock = async () => {
      try {
        wakeLock = await (navigator as any).wakeLock.request("screen");
      } catch {
        // Ignore if the browser blocks Wake Lock API.
      }
    };

    requestWakeLock();

    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => undefined);
      }
    };
  }, [isCookingMode]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const getScaledAmount = (ri: any) => {
    if (typeof ri?.calculatedAmount === "number" && Number.isFinite(ri.calculatedAmount)) {
      return ri.calculatedAmount;
    }
    return calculateScaledAmount(ri, servingsToUse, recipeServings);
  };

  const getCookingModeIngredientLabel = (segment: { text: string; ingredientId: number; multiplier?: number }) => {
    const ingredientData = baseIngredients.find((ri: any) => Number(ri.ingredientId) === Number(segment.ingredientId));
    if (!ingredientData) return segment.text;

    const multiplier = typeof segment.multiplier === "number" && segment.multiplier > 0 ? segment.multiplier : 1;
    const amount = Math.round(getScaledAmount(ingredientData) * multiplier);
    const unit = ingredientData.unit || ingredientData.ingredient?.unit || "g";
    return `${ingredientData.ingredient?.name || segment.text}-${amount}${unit}`;
  };

  const baseCaloriesPerServing = Math.round((recipe?.ingredients || []).reduce((sum: number, ri: any) =>
    sum + (ri.ingredient ? (ri.ingredient.calories * ri.amount / 100) : 0), 0
  ) / recipeServings);
  const withAddonsCaloriesPerServing = Math.round(((recipe?.ingredients || []).reduce((sum: number, ri: any) =>
    sum + (ri.ingredient ? (ri.ingredient.calories * ri.amount / 100) : 0), 0
  ) + (recipe?.frequentAddons || []).reduce((sum: number, addon: any) =>
    sum + (addon.ingredient ? (addon.ingredient.calories * addon.amount / 100) : 0), 0
  )) / recipeServings);

  if (!recipe) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setIsCookingMode(false);
          onClose();
        }
      }}
    >
      <DialogContent className={isCookingMode ? "max-w-3xl h-[92vh] overflow-hidden bg-white p-3 sm:p-4" : "max-w-3xl max-h-[90vh] overflow-y-auto bg-white"}>
        {isCookingMode ? (
          <div className="h-full flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-base sm:text-lg"><ChefHatIcon className="w-4 h-4 sm:w-5 sm:h-5" /> Tryb gotowania</span>
                <Button size="sm" variant="outline" onClick={() => setIsCookingMode(false)}>Wyjdź</Button>
              </DialogTitle>
            </DialogHeader>

            <div className="rounded-2xl bg-secondary/30 p-3 sm:p-4 text-center space-y-2">
              <p className="text-xs sm:text-sm text-muted-foreground">Krok {Math.min(currentStepIndex + 1, instructionSteps.length)} / {instructionSteps.length || 1}</p>
              <p className="text-lg sm:text-2xl font-bold leading-snug">
                {(currentStep?.segments || []).length > 0 ? currentStep.segments.map((segment: any, idx: number) => (
                  segment.type === "ingredient" ? (
                    <span
                      key={`${segment.ingredientId}-${idx}`}
                      className="inline rounded-full bg-primary/10 text-primary px-2 py-0.5 mx-0.5"
                    >{getCookingModeIngredientLabel(segment)}</span>
                  ) : <span key={`${segment.text}-${idx}`}>{segment.text}</span>
                )) : "Brak kroków. Dodaj instrukcje do przepisu."}
              </p>
              {currentStepDurationMinutes > 0 && (
                <p className="text-xs sm:text-sm text-muted-foreground">Wykryto timer: {currentStepDurationMinutes} min</p>
              )}
            </div>

            <div className="rounded-2xl border p-3 sm:p-4 space-y-2">
              <p className="text-3xl sm:text-4xl font-bold text-center tabular-nums">{formatTime(timerRemainingSeconds)}</p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  className="h-11 sm:h-12 text-sm sm:text-base"
                  onClick={() => {
                    if (timerRemainingSeconds === 0 && currentStepDurationMinutes > 0) {
                      setTimerRemainingSeconds(currentStepDurationMinutes * 60);
                    }
                    setIsTimerRunning((prev) => !prev);
                  }}
                  disabled={currentStepDurationMinutes <= 0 && timerRemainingSeconds <= 0}
                >
                  {isTimerRunning ? <Pause className="w-5 h-5 mr-2" /> : <Play className="w-5 h-5 mr-2" />}
                  {isTimerRunning ? "Pauza" : "Start"}
                </Button>
                <Button
                  variant="outline"
                  className="h-11 sm:h-12 text-sm sm:text-base"
                  onClick={() => {
                    setIsTimerRunning(false);
                    setTimerRemainingSeconds(currentStepDurationMinutes * 60);
                  }}
                  disabled={currentStepDurationMinutes <= 0}
                >
                  <RotateCcw className="w-5 h-5 mr-2" />
                  Reset
                </Button>
                <Button
                  variant="outline"
                  className="h-11 sm:h-12 text-sm sm:text-base"
                  onClick={() => {
                    setIsTimerRunning(false);
                    setTimerRemainingSeconds(0);
                  }}
                >
                  Stop
                </Button>
              </div>
            </div>

            <Button
              className="w-full h-12 sm:h-14 text-base sm:text-xl font-bold mt-auto"
              onClick={() => {
                const nextIndex = Math.min(currentStepIndex + 1, Math.max(instructionSteps.length - 1, 0));
                setCurrentStepIndex(nextIndex);
                setIsTimerRunning(false);
                const nextStepText = (instructionSteps[nextIndex]?.segments || []).map((segment: any) => segment.text).join("");
                setTimerRemainingSeconds(parseDurationFromStep(nextStepText || "") * 60);
              }}
            >
              Następny krok
            </Button>

          </div>
        ) : (
        <div className="space-y-6">
          <div 
            className="h-64 rounded-2xl bg-cover bg-center"
            style={{ backgroundImage: `url(${recipe.imageUrl || 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800'})` }}
          />
          <div>
            <h2 className="text-3xl font-bold font-display">{recipe.name}</h2>
            <div className="flex flex-wrap gap-1 mt-2">
              {recipe.tags?.map((tag: string, i: number) => (
                <span key={i} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-lg font-bold">
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex gap-4 mt-2 text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-lg text-xs"><Clock className="w-4 h-4" /> {recipe.prepTime} min</span>
              <span className="flex items-center gap-1 bg-secondary/50 px-2 py-1 rounded-lg text-xs"><ChefHat className="w-4 h-4" /> {baseIngredients.length} składników</span>
              <span className="flex items-center gap-1 bg-primary/10 text-primary font-bold px-2 py-1 rounded-lg text-xs">
                {isPlannedView ? `${servingsToUse} zaplanowanych porcji` : `${recipeServings} porcji`}
              </span>
              {!isPlannedView && (
                <span className="flex items-center gap-1 bg-amber-100/60 text-amber-900 font-semibold px-2 py-1 rounded-lg text-xs">
                  {withAddonsCaloriesPerServing > baseCaloriesPerServing
                    ? `${baseCaloriesPerServing}-${withAddonsCaloriesPerServing} kcal / porcja`
                    : `${baseCaloriesPerServing} kcal / porcja`}
                </span>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-4 gap-4 p-4 bg-secondary/30 rounded-2xl text-center">
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Kalorie</p>
              <p className="text-xl font-bold text-primary">
                {Math.round(baseIngredients.reduce((sum: number, ri: any) => {
                  if (!ri.ingredient) return sum;
                  const amount = getScaledAmount(ri);
                  return sum + (ri.ingredient.calories * amount / 100);
                }, 0))}
              </p>
              <p className="text-[8px] text-muted-foreground">{isPlannedView ? "łącznie" : "na porcję"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Białko</p>
              <p className="text-xl font-bold">
                {Math.round(baseIngredients.reduce((sum: number, ri: any) => {
                  if (!ri.ingredient) return sum;
                  const amount = getScaledAmount(ri);
                  return sum + (ri.ingredient.protein * amount / 100);
                }, 0))}g
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Węgle</p>
              <p className="text-xl font-bold">
                {Math.round(baseIngredients.reduce((sum: number, ri: any) => {
                  if (!ri.ingredient) return sum;
                  const amount = getScaledAmount(ri);
                  return sum + (ri.ingredient.carbs * amount / 100);
                }, 0))}g
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Tłuszcz</p>
              <p className="text-xl font-bold">
                {Math.round(baseIngredients.reduce((sum: number, ri: any) => {
                  if (!ri.ingredient) return sum;
                  const amount = getScaledAmount(ri);
                  return sum + (ri.ingredient.fat * amount / 100);
                }, 0))}g
              </p>
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">Składniki</h3>
                {onEditIngredients && (
                  <Button variant="ghost" size="sm" onClick={onEditIngredients} className="text-primary hover:text-primary/80 h-7 text-xs">
                    <Settings2 className="w-3 h-3 mr-1" />
                    Edytuj składniki
                  </Button>
                )}
              </div>
              <ul className="space-y-2">
                {baseIngredients.map((ri: any, idx: number) => {
                  const isFrequentAddon = frequentAddonSet.has(Number(ri.ingredientId));
                  const isAvailable = availableIngredientSet.has(Number(ri.ingredientId));
                  const ingredientItemClass = isFrequentAddon
                    ? "border-emerald-300 bg-emerald-50/70"
                    : isAvailable
                      ? "border-sky-300 bg-sky-50/80"
                      : "border-transparent bg-secondary/50";

                  return (
                  <li
                    key={idx}
                    className={`flex flex-col p-2 rounded-lg border ${ingredientItemClass}`}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-semibold">
                        {ri.ingredient?.name}
                        {isAvailable && !isFrequentAddon && (
                          <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                            Posiadam
                          </span>
                        )}
                        {isFrequentAddon && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Dodatek
                          </span>
                        )}
                      </span>
                      <span className="font-medium">
                        {Math.round(getScaledAmount(ri))}{ri.unit || "g"}
                      </span>
                    </div>
                    {Number(ri.ingredient?.unitWeight || 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground italic">
                        ({ri.ingredient.unitDescription ? `${ri.ingredient.unitDescription} - ` : ""}1 sztuka to ok. {ri.ingredient.unitWeight}g)
                      </span>
                    )}
                  </li>
                );
                })}
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-3">Instrukcje</h3>
              {instructionSteps.length > 0 ? (
                <ol className="list-decimal pl-5 space-y-1 text-muted-foreground leading-relaxed">
                  {instructionSteps.map((step: InstructionStep, idx: number) => (
                    <li key={`step-${idx}`}>
                      {step.segments.map((segment: any, segmentIdx: number) => (
                        segment.type === "ingredient" ? (
                          <span
                            key={`${segment.ingredientId}-${segmentIdx}`}
                            className="inline rounded-full bg-primary/10 text-primary px-2 py-0.5 mx-0.5"
                          >{segment.text}</span>
                        ) : <span key={`${segment.text}-${segmentIdx}`}>{segment.text}</span>
                      ))}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">Brak instrukcji.</p>
              )}
              {instructionSteps.length > 0 && (
                <Button className="mt-4" onClick={() => {
                  setCurrentStepIndex(0);
                  const firstStepText = (instructionSteps[0]?.segments || []).map((segment: any) => segment.text).join("");
                  setTimerRemainingSeconds(parseDurationFromStep(firstStepText) * 60);
                  setIsTimerRunning(false);
                  setIsCookingMode(true);
                }}>
                  <ChefHatIcon className="w-4 h-4 mr-2" />
                  Uruchom cooking mode
                </Button>
              )}
            </div>
          </div>
          {showFooter && (
            <DialogFooter>
              <Button 
                className="w-full sm:w-auto gap-2"
                onClick={() => onAddToPlan(recipe)}
              >
                <CalendarPlus className="w-4 h-4" />
                Dodaj do planu
              </Button>
            </DialogFooter>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
