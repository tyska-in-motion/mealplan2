import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useIngredients, useCreateIngredient, useDeleteIngredient, useUpdateIngredient } from "@/hooks/use-ingredients";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Trash2, Edit2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const createIngredientSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().or(z.literal("")),
  calories: z.coerce.number().min(0),
  protein: z.coerce.number().min(0),
  carbs: z.coerce.number().min(0),
  fat: z.coerce.number().min(0),
  unit: z.string().default("g"),
  price: z.coerce.number().min(0).default(0),
  unitWeight: z.coerce.number().optional().or(z.literal(0)),
  unitDescription: z.string().optional().or(z.literal("")),
  imageUrl: z.string().optional().or(z.literal("")),
});

export default function Ingredients() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: ingredients, isLoading } = useIngredients(debouncedSearch);
  const { mutate: createIngredient } = useCreateIngredient();
  const { mutate: updateIngredientMutation } = useUpdateIngredient();
  const { mutate: deleteIngredientMutation } = useDeleteIngredient();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("alphabetical");

  const categories = Array.from(new Set(ingredients?.map(i => i.category).filter(Boolean) || [])) as string[];

  const filteredIngredients = ingredients?.filter(item => {
    if (selectedCategory === "all") return true;
    return item.category === selectedCategory;
  }).sort((a, b) => {
    switch (sortBy) {
      case "alphabetical":
        return a.name.localeCompare(b.name);
      case "calories":
        return b.calories - a.calories;
      case "protein":
        return b.protein - a.protein;
      case "carbs":
        return b.carbs - a.carbs;
      case "fat":
        return b.fat - a.fat;
      default:
        return 0;
    }
  });

  const form = useForm({
    resolver: zodResolver(createIngredientSchema),
    defaultValues: {
      name: "",
      category: "",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      unit: "g",
      unitWeight: 0,
      unitDescription: "",
      imageUrl: "",
      price: 0,
    },
  });

  const openEdit = (ingredient: any) => {
    setEditingIngredient(ingredient);
    form.reset({
      name: ingredient.name,
      category: ingredient.category || "",
      calories: ingredient.calories,
      protein: ingredient.protein,
      carbs: ingredient.carbs,
      fat: ingredient.fat,
      unit: ingredient.unit,
      unitWeight: ingredient.unitWeight || 0,
      unitDescription: ingredient.unitDescription || "",
      price: ingredient.price || 0,
      imageUrl: ingredient.imageUrl || "",
    });
    setIsOpen(true);
  };

  const closeDialog = () => {
    setIsOpen(false);
    setEditingIngredient(null);
    form.reset({
      name: "",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      unit: "g",
      unitWeight: 0,
      unitDescription: "",
      price: 0,
      imageUrl: "",
    });
  };

  const onSubmit = (data: any) => {
    if (editingIngredient) {
      updateIngredientMutation({ id: editingIngredient.id, data }, {
        onSuccess: () => {
          closeDialog();
          toast({ title: "Zaktualizowano składnik" });
        },
      });
    } else {
      createIngredient(data, {
        onSuccess: () => {
          closeDialog();
          toast({ title: "Dodano składnik" });
        },
        onError: (err) => toast({ variant: "destructive", title: "Błąd", description: err.message }),
      });
    }
  };

  if (isLoading) return <Layout><LoadingSpinner /></Layout>;

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Składniki</h1>
          <p className="text-muted-foreground">Zarządzaj swoją bazą produktów (wartości na 100g).</p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-ingredient" className="bg-primary hover:bg-primary/90 rounded-xl" onClick={() => setIsOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Dodaj składnik
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto sm:max-h-[90vh] max-sm:h-[100dvh] max-sm:max-h-none">
            <DialogHeader>
              <DialogTitle>{editingIngredient ? "Edytuj składnik" : "Nowy składnik"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium">Nazwa</label>
                <Input {...form.register("name")} placeholder="np. Pierś z kurczaka" />
              </div>
              <div>
                <label className="text-sm font-medium">Kategoria</label>
                <Input {...form.register("category")} placeholder="np. Mięso, Nabiał, Owoce" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Kalorie (na 100g)</label>
                  <Input type="number" step="1" {...form.register("calories")} />
                </div>
                <div>
                  <label className="text-sm font-medium">Cena (za 100g)</label>
                  <Input type="number" step="0.01" {...form.register("price")} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Białko</label>
                  <Input type="number" step="0.1" {...form.register("protein")} />
                </div>
                <div>
                  <label className="text-sm font-medium">Węglowodany</label>
                  <Input type="number" step="0.1" {...form.register("carbs")} />
                </div>
                <div>
                  <label className="text-sm font-medium">Tłuszcze</label>
                  <Input type="number" step="0.1" {...form.register("fat")} />
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium">Zdjęcie</label>
                <div className="flex gap-2 items-center">
                  <Input {...form.register("imageUrl")} placeholder="URL obrazka (opcjonalnie)" className="flex-1" />
                  <div className="relative">
                    <Input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      id="ingredient-image-upload"
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
                      onClick={() => document.getElementById("ingredient-image-upload")?.click()}
                    >
                      Wgraj
                    </Button>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-dashed">
                <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                  Informacja o sztukach (opcjonalnie)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-[200px] text-[10px]">Pozwala na szybkie sprawdzenie wagi jednej sztuki przy dodawaniu do przepisu.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Waga sztuki (g)</label>
                    <Input type="number" {...form.register("unitWeight")} placeholder="np. 150" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Opis</label>
                    <Input {...form.register("unitDescription")} placeholder="np. 1 średnia sztuka" />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full">Zapisz składnik</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-6 flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input 
            className="pl-10 rounded-xl" 
            placeholder="Szukaj składników..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full sm:w-[180px] rounded-xl bg-white shadow-sm">
              <SelectValue placeholder="Kategoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie kategorie</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full sm:w-[180px] rounded-xl bg-white shadow-sm">
              <SelectValue placeholder="Sortuj według" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alphabetical">Alfabetycznie</SelectItem>
              <SelectItem value="calories">Kalorie (max)</SelectItem>
              <SelectItem value="protein">Białko (max)</SelectItem>
              <SelectItem value="carbs">Węglowodany (max)</SelectItem>
              <SelectItem value="fat">Tłuszcze (max)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredIngredients?.map((item: any) => (
          <div key={item.id} className="bg-white p-4 rounded-2xl shadow-sm border border-border flex items-center justify-between group">
            <div className="flex-1 cursor-pointer" onClick={() => openEdit(item)}>
              <h3 className="font-bold flex items-center gap-2">
                {item.name}
                {item.category && (
                  <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full text-muted-foreground font-normal">
                    {item.category}
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {item.calories} kcal <span className="text-gray-300">|</span> P:{item.protein} C:{item.carbs} F:{item.fat} <span className="text-gray-300">|</span> {item.price} PLN
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => openEdit(item)}
                className="text-primary opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-secondary rounded-lg"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button 
                    className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Czy na pewno?</AlertDialogTitle>
                    <AlertDialogDescription>
                      To trwale usunie składnik "{item.name}".
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Anuluj</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => {
                        deleteIngredientMutation(item.id, {
                          onSuccess: () => {
                            toast({ title: "Usunięto składnik" });
                          },
                          onError: (err) => {
                            toast({ 
                              variant: "destructive", 
                              title: "Błąd", 
                              description: "Nie można usunąć składnika. Prawdopodobnie jest używany w przepisie lub planie posiłków." 
                            });
                          }
                        });
                      }}
                      className="bg-red-500 hover:bg-red-600"
                    >
                      Usuń
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
