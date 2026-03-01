import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, ChefHat, CalendarPlus, Settings2 } from "lucide-react";

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
}: RecipeViewProps) {
  if (!recipe) return null;

  const isPlannedView = plannedServings !== undefined;
  const recipeServings = Number(recipe.servings) || 1;
  const servingsToUse = isPlannedView ? plannedServings : recipeServings;
  
  // Use entry-specific ingredients if provided (for Meal Plan/Dashboard view of a planned meal)
  const baseIngredients = (mealEntryIngredients && mealEntryIngredients.length > 0) 
    ? mealEntryIngredients 
    : recipe.ingredients;

  const factor = servingsToUse / recipeServings;
  const frequentAddonSet = new Set((frequentAddonIds || []).map((id) => Number(id)));
  const macrosFactor = isPlannedView ? factor : (1 / recipeServings);
  const ingredientsFactor = isPlannedView ? factor : 1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white">
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
            </div>
          </div>
          
          <div className="grid grid-cols-4 gap-4 p-4 bg-secondary/30 rounded-2xl text-center">
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Kalorie</p>
              <p className="text-xl font-bold text-primary">
                {Math.round((baseIngredients.reduce((sum: number, ri: any) => 
                  sum + (ri.ingredient ? (ri.ingredient.calories * ri.amount / 100) : 0), 0)) * macrosFactor
                )}
              </p>
              <p className="text-[8px] text-muted-foreground">{isPlannedView ? "łącznie" : "na porcję"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Białko</p>
              <p className="text-xl font-bold">
                {Math.round((baseIngredients.reduce((sum: number, ri: any) => 
                  sum + (ri.ingredient ? (ri.ingredient.protein * ri.amount / 100) : 0), 0)) * macrosFactor
                )}g
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Węgle</p>
              <p className="text-xl font-bold">
                {Math.round((baseIngredients.reduce((sum: number, ri: any) => 
                  sum + (ri.ingredient ? (ri.ingredient.carbs * ri.amount / 100) : 0), 0)) * macrosFactor
                )}g
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Tłuszcz</p>
              <p className="text-xl font-bold">
                {Math.round((baseIngredients.reduce((sum: number, ri: any) => 
                  sum + (ri.ingredient ? (ri.ingredient.fat * ri.amount / 100) : 0), 0)) * macrosFactor
                )}g
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

                  return (
                  <li
                    key={idx}
                    className={`flex flex-col p-2 rounded-lg border ${isFrequentAddon ? "border-emerald-300 bg-emerald-50/70" : "border-transparent bg-secondary/50"}`}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-semibold">
                        {ri.ingredient?.name}
                        {isFrequentAddon && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Dodatek
                          </span>
                        )}
                      </span>
                      <span className="font-medium">
                        {Math.round(ri.amount * ingredientsFactor)}g
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
              <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">
                {recipe.instructions || "Brak instrukcji."}
              </p>
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
      </DialogContent>
    </Dialog>
  );
}
