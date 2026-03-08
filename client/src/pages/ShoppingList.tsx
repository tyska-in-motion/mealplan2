import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { useShoppingList } from "@/hooks/use-meal-plan";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Check, ShoppingCart, Calendar, FileDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { pl } from "date-fns/locale";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";


const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10;

const formatAmount = (value: number) => {
  const rounded = roundToSingleDecimal(value);
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(1);
};

export default function ShoppingList() {
  const [range, setRange] = useState({
    start: startOfWeek(new Date(), { weekStartsOn: 1 }), // Start on Monday
    end: endOfWeek(new Date(), { weekStartsOn: 1 })
  });

  const [extraName, setExtraName] = useState("");
  const [extraAmount, setExtraAmount] = useState("1");
  const [extraUnit, setExtraUnit] = useState("szt");

  const startStr = format(range.start, "yyyy-MM-dd");
  const endStr = format(range.end, "yyyy-MM-dd");

  const { data: list, isLoading } = useShoppingList(startStr, endStr);
  
  const { data: checkedItems = {} } = useQuery<Record<number, boolean>>({
    queryKey: ["/api/shopping-list/checks", startStr, endStr],
    queryFn: async () => {
      const response = await fetch(`/api/shopping-list/checks?startDate=${startStr}&endDate=${endStr}`);
      if (!response.ok) throw new Error("Nie udało się pobrać statusów");
      return response.json();
    },
    refetchInterval: 3000, // Poll every 3 seconds for multi-device sync
  });

  const { data: excludedItems = [] } = useQuery<number[]>({
    queryKey: ["/api/shopping-list/exclusions", startStr, endStr],
    queryFn: async () => {
      const response = await fetch(`/api/shopping-list/exclusions?startDate=${startStr}&endDate=${endStr}`);
      if (!response.ok) throw new Error("Nie udało się pobrać wykluczeń");
      return response.json();
    },
    refetchInterval: 5000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, checked }: { id: number; checked: boolean }) => {
      await apiRequest("POST", "/api/shopping-list/checks", {
        ingredientId: id,
        isChecked: checked,
        startDate: startStr,
        endDate: endStr,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-list/checks", startStr, endStr] });
    }
  });


  const addExtraMutation = useMutation({
    mutationFn: async ({ name, amount, unit }: { name: string; amount: number; unit: string }) => {
      await apiRequest("POST", "/api/shopping-list/extras", { name, amount, unit, startDate: startStr, endDate: endStr });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-list", startStr, endStr] });
      setExtraName("");
      setExtraAmount("1");
      setExtraUnit("szt");
    }
  });

  const deleteExtraMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/shopping-list/extras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-list", startStr, endStr] });
    }
  });

  const toggleExclusionMutation = useMutation({
    mutationFn: async ({ ingredientId, excluded }: { ingredientId: number; excluded: boolean }) => {
      await apiRequest("POST", "/api/shopping-list/exclusions", {
        ingredientId,
        excluded,
        startDate: startStr,
        endDate: endStr,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-list/exclusions", startStr, endStr] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-list", startStr, endStr] });
    }
  });

  const activeItems = (list || []).filter((item: any) => !item.isExcluded);
  const excludedFromHomeItems = (list || []).filter((item: any) => !!item.isExcluded);

  const sortedActiveItems = useMemo(() => {
    return [...activeItems].sort((a: any, b: any) => {
      const aChecked = a.isExtra ? !!a.isChecked : !!checkedItems[a.ingredientId];
      const bChecked = b.isExtra ? !!b.isChecked : !!checkedItems[b.ingredientId];

      if (aChecked !== bChecked) {
        return Number(aChecked) - Number(bChecked);
      }

      return a.name.localeCompare(b.name, "pl");
    });
  }, [activeItems, checkedItems]);

  const uncheckedActiveItems = sortedActiveItems.filter((item: any) => {
    const isChecked = item.isExtra ? !!item.isChecked : !!checkedItems[item.ingredientId];
    return !isChecked;
  });

  const checkedActiveItems = sortedActiveItems.filter((item: any) => {
    const isChecked = item.isExtra ? !!item.isChecked : !!checkedItems[item.ingredientId];
    return isChecked;
  });

  const groupByCategory = (items: any[]) =>
    items.reduce((acc: Record<string, any[]>, item: any) => {
      const category = item.category || "Inne";
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});

  const uncheckedGroupedList = groupByCategory(uncheckedActiveItems);
  const checkedGroupedList = groupByCategory(checkedActiveItems);
  const uncheckedCategories = Object.keys(uncheckedGroupedList).sort();
  const checkedCategories = Object.keys(checkedGroupedList).sort();

  const toggleCheck = (item: any) => {
    if (item.isExtra) {
      const currentStatus = !!item.isChecked;
      apiRequest("PATCH", `/api/shopping-list/extras/${item.extraId}`, { isChecked: !currentStatus }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/shopping-list", startStr, endStr] });
      });
      return;
    }

    const currentStatus = !!checkedItems[item.ingredientId];
    toggleMutation.mutate({ id: item.ingredientId, checked: !currentStatus });
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

  const handleAddExtra = () => {
    const trimmed = extraName.trim();
    if (!trimmed) return;
    const parsedAmount = Number(extraAmount);
    addExtraMutation.mutate({
      name: trimmed,
      amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 1,
      unit: extraUnit.trim() || "szt",
    });
  };

  const handleExportPdf = () => {
    const printWindow = window.open("", "_blank", "width=900,height=1200");
    if (!printWindow) return;

    const printDate = format(new Date(), "yyyy-MM-dd HH:mm");
    const groupedListForExport = groupByCategory(sortedActiveItems);
    const categoriesForExport = Object.keys(groupedListForExport).sort();

    const content = categoriesForExport
      .map((category) => {
        const rows = groupedListForExport[category]
          .map((item: any) => {
            const isChecked = checkedItems[item.ingredientId] ? "✓" : "☐";
            return `<tr>
              <td style="padding: 6px 8px; border-bottom: 1px solid #eee; width: 30px;">${isChecked}</td>
              <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${item.name}</td>
              <td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align: right; white-space: nowrap;">${formatAmount(item.totalAmount)} ${item.unit}</td>
            </tr>`;
          })
          .join("");

        return `
          <section style="margin-bottom: 18px;">
            <h2 style="font-size: 14px; text-transform: uppercase; color: #6b7280; margin: 0 0 8px;">${category}</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>${rows}</tbody>
            </table>
          </section>
        `;
      })
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Lista zakupów ${startStr} - ${endStr}</title>
        </head>
        <body style="font-family: Inter, Arial, sans-serif; margin: 24px; color: #111827;">
          <h1 style="margin-bottom: 4px;">Lista zakupów</h1>
          <p style="margin-top: 0; color: #6b7280;">
            Okres: ${format(range.start, "d MMMM yyyy", { locale: pl })} - ${format(range.end, "d MMMM yyyy", { locale: pl })}<br/>
            Wygenerowano: ${printDate}
          </p>
          ${content || '<p>Brak produktów dla wybranego okresu.</p>'}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
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
          <Button onClick={handleExportPdf} className="h-9 rounded-lg px-3 text-xs font-semibold w-full sm:w-auto">
            <FileDown className="w-4 h-4 mr-2" />
            Eksportuj PDF
          </Button>
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


      <div className="mb-6 p-4 bg-white rounded-2xl border border-border shadow-sm space-y-3">
        <p className="text-sm font-semibold">Dodaj własny produkt (np. worki na śmieci, płyn do naczyń)</p>
        <div className="flex flex-col md:flex-row gap-2">
          <Input value={extraName} onChange={(e) => setExtraName(e.target.value)} placeholder="Nazwa produktu" className="md:flex-1" />
          <Input value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} type="number" min="0.1" step="0.1" className="md:w-28" />
          <Input value={extraUnit} onChange={(e) => setExtraUnit(e.target.value)} placeholder="szt" className="md:w-28" />
          <Button type="button" onClick={handleAddExtra} className="md:w-auto">
            <Plus className="w-4 h-4 mr-2" />Dodaj
          </Button>
        </div>
      </div>

      {isLoading ? <LoadingSpinner /> : (
        <div className="bg-white rounded-3xl shadow-sm border border-border/50 overflow-hidden">
          <div className="p-6 bg-primary/5 border-b border-border/50 flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Produkty do kupienia
            </h2>
            <span className="text-sm text-muted-foreground">{activeItems.length} pozycji</span>
          </div>
          
          <div className="divide-y divide-border/50">
            {activeItems.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                Twoja lista zakupów jest pusta dla tego okresu. Zaplanuj najpierw posiłki!
              </div>
            ) : (
              <>
                {uncheckedCategories.map((category) => (
                  <div key={`unchecked-${category}`} className="bg-white">
                    <div className="px-4 py-1.5 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y border-border/50">
                      {category}
                    </div>
                    <div className="divide-y divide-border/50">
                      {uncheckedGroupedList[category].map((item: any) => {
                        const isChecked = item.isExtra ? item.isChecked : checkedItems[item.ingredientId];
                        return (
                          <div
                            key={item.isExtra ? `extra-${item.extraId}` : `ingredient-${item.ingredientId}`}
                            onClick={() => toggleCheck(item)}
                            className={cn(
                              "py-2 px-3 flex items-center justify-between hover:bg-muted/30 cursor-pointer transition-colors group",
                              isChecked && "bg-muted/20"
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={cn(
                                "w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0",
                                isChecked ? "bg-primary border-primary" : "border-muted-foreground/30 group-hover:border-primary"
                              )}>
                                {isChecked && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className={cn(
                                "text-sm font-medium transition-all truncate",
                                isChecked && "text-muted-foreground line-through decoration-border"
                              )}>{item.name}</span>
                            </div>
                            <div className="flex items-center gap-2 pl-2 shrink-0">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                                  {formatAmount(item.totalAmount)} {item.unit}
                                </span>
                                {Number(item.unitWeight || 0) > 0 && (
                                  <span className="text-[9px] text-blue-600 font-medium bg-blue-50 px-1.5 py-0 rounded-full border border-blue-100">
                                    ok. {formatAmount(item.totalAmount / Number(item.unitWeight))} szt.
                                  </span>
                                )}
                              </div>
                              {item.isExtra ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteExtraMutation.mutate(item.extraId);
                                  }}
                                >
                                  <X className="w-3.5 h-3.5 text-red-500" />
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  className="h-6 px-1.5 text-[9px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const isExcluded = excludedItems.includes(item.ingredientId);
                                    toggleExclusionMutation.mutate({ ingredientId: item.ingredientId, excluded: !isExcluded });
                                  }}
                                >
                                  {excludedItems.includes(item.ingredientId) ? "W domu" : "Mam w domu"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {checkedActiveItems.length > 0 && (
                  <div className="bg-muted/10 border-t border-border/50">
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border/50">
                      Kupione
                    </div>
                    {checkedCategories.map((category) => (
                      <div key={`checked-${category}`}>
                        <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 bg-muted/20 border-b border-border/30">
                          {category}
                        </div>
                        <div className="divide-y divide-border/40">
                          {checkedGroupedList[category].map((item: any) => {
                            const isChecked = item.isExtra ? item.isChecked : checkedItems[item.ingredientId];
                            return (
                              <div
                                key={item.isExtra ? `checked-extra-${item.extraId}` : `checked-ingredient-${item.ingredientId}`}
                                onClick={() => toggleCheck(item)}
                                className="py-2 px-3 flex items-center justify-between hover:bg-muted/20 cursor-pointer transition-colors group bg-muted/10"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className={cn(
                                    "w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0",
                                    isChecked ? "bg-primary border-primary" : "border-muted-foreground/30 group-hover:border-primary"
                                  )}>
                                    {isChecked && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-sm font-medium text-muted-foreground line-through decoration-border truncate">{item.name}</span>
                                </div>
                                <span className="text-xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0 ml-2">
                                  {formatAmount(item.totalAmount)} {item.unit}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {excludedFromHomeItems.length > 0 && (
        <div className="mt-6 bg-white rounded-3xl shadow-sm border border-border/50 overflow-hidden">
          <div className="p-6 bg-muted/40 border-b border-border/50 flex items-center justify-between">
            <h2 className="font-bold text-lg">Masz już w domu</h2>
            <span className="text-sm text-muted-foreground">{excludedFromHomeItems.length} pozycji</span>
          </div>
          <div className="divide-y divide-border/50">
            {excludedFromHomeItems.map((item: any) => (
              <div key={`excluded-${item.ingredientId}`} className="py-2 px-3 flex items-center justify-between bg-muted/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded-full border border-muted-foreground/30" />
                  <span className="text-sm font-medium text-muted-foreground">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                    {formatAmount(item.totalAmount)} {item.unit}
                  </span>
                  <Button
                    variant="outline"
                    className="h-6 px-1.5 text-[9px]"
                    onClick={() => toggleExclusionMutation.mutate({ ingredientId: item.ingredientId, excluded: false })}
                  >
                    Przywróć
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
