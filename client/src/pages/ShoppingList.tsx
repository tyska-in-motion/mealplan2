import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { format, addDays, startOfWeek, endOfWeek } from "date-fns";
import { useShoppingList } from "@/hooks/use-meal-plan";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Check, ShoppingCart, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { pl } from "date-fns/locale";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function ShoppingList() {
  const [range, setRange] = useState({
    start: startOfWeek(new Date(), { weekStartsOn: 1 }), // Start on Monday
    end: endOfWeek(new Date(), { weekStartsOn: 1 })
  });

  const startStr = format(range.start, "yyyy-MM-dd");
  const endStr = format(range.end, "yyyy-MM-dd");

  const { data: list, isLoading } = useShoppingList(startStr, endStr);
  
  const { data: checkedItems = {} } = useQuery<Record<number, boolean>>({
    queryKey: ["/api/shopping-list/checks"],
    refetchInterval: 3000, // Poll every 3 seconds for multi-device sync
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, checked }: { id: number; checked: boolean }) => {
      await apiRequest("POST", "/api/shopping-list/checks", { ingredientId: id, isChecked: checked });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-list/checks"] });
    }
  });

  const groupedList = (list || []).reduce((acc: Record<string, any[]>, item: any) => {
    const category = item.category || "Inne";
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  const categories = Object.keys(groupedList).sort();

  const toggleCheck = (id: number) => {
    const currentStatus = !!checkedItems[id];
    toggleMutation.mutate({ id, checked: !currentStatus });
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value);
    if (!isNaN(newDate.getTime())) {
      setRange(prev => ({ ...prev, start: newDate }));
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value);
    if (!isNaN(newDate.getTime())) {
      setRange(prev => ({ ...prev, end: newDate }));
    }
  };

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Lista zakupów</h1>
          <p className="text-muted-foreground">Wszystko czego potrzebujesz na wybrany okres.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-3 rounded-2xl border border-border shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Od:</label>
            <Input 
              type="date" 
              value={startStr} 
              onChange={handleStartDateChange}
              className="h-9 w-40 rounded-lg border-muted"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Do:</label>
            <Input 
              type="date" 
              value={endStr} 
              onChange={handleEndDateChange}
              className="h-9 w-40 rounded-lg border-muted"
            />
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 bg-primary/5 rounded-2xl border border-primary/10 flex items-center gap-3">
        <Calendar className="w-5 h-5 text-primary" />
        <span className="text-sm font-medium">
          Wybrany okres: <span className="font-bold text-primary">
            {format(range.start, "d MMMM", { locale: pl })} - {format(range.end, "d MMMM", { locale: pl })}
          </span>
        </span>
      </div>

      {isLoading ? <LoadingSpinner /> : (
        <div className="bg-white rounded-3xl shadow-sm border border-border/50 overflow-hidden">
          <div className="p-6 bg-primary/5 border-b border-border/50 flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Produkty do kupienia
            </h2>
            <span className="text-sm text-muted-foreground">{(list || []).length} pozycji</span>
          </div>
          
          <div className="divide-y divide-border/50">
            {!list || list.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Twoja lista zakupów jest pusta dla tego okresu. Zaplanuj najpierw posiłki!
              </div>
            ) : (
              categories.map(category => (
                <div key={category} className="bg-white">
                  <div className="px-6 py-2 bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground border-y border-border/50">
                    {category}
                  </div>
                  <div className="divide-y divide-border/50">
                    {groupedList[category].map((item: any) => {
                      const isChecked = checkedItems[item.ingredientId];
                      return (
                        <div 
                          key={item.ingredientId} 
                          onClick={() => toggleCheck(item.ingredientId)}
                          className={cn(
                            "p-4 flex items-center justify-between hover:bg-muted/30 cursor-pointer transition-colors group",
                            isChecked && "bg-muted/20"
                          )}
                        >
                          <div className="flex items-center gap-4">
                            <div className={cn(
                              "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                              isChecked ? "bg-primary border-primary" : "border-muted-foreground/30 group-hover:border-primary"
                            )}>
                              {isChecked && <Check className="w-4 h-4 text-white" />}
                            </div>
                            <span className={cn(
                              "font-medium transition-all",
                              isChecked && "text-muted-foreground line-through decoration-border"
                            )}>{item.name}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-sm font-mono text-muted-foreground bg-secondary px-2 py-1 rounded">
                              {Math.round(item.totalAmount)} {item.unit}
                            </span>
                            {Number(item.unitWeight || 0) > 0 && (
                              <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                                ok. {(item.totalAmount / Number(item.unitWeight)).toFixed(1)} szt.
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
