import { useEffect, useMemo, useState } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { pl } from "date-fns/locale";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useShoppingList } from "@/hooks/use-meal-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { apiRequest, fetchWithTimeout, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ItemStatus = "NOT_BOUGHT" | "AT_HOME" | "BOUGHT";

const formatAmount = (value: number) => {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const groupByCategory = (items: any[]) => items.reduce((acc: Record<string, any[]>, item: any) => {
  const category = item.category || "Inne";
  if (!acc[category]) acc[category] = [];
  acc[category].push(item);
  return acc;
}, {});

const formatPieces = (totalAmount: number, unitWeight?: number | null) => {
  const grams = Number(totalAmount || 0);
  const weight = Number(unitWeight || 0);
  if (!Number.isFinite(grams) || grams <= 0 || !Number.isFinite(weight) || weight <= 0) return null;
  const pieces = Math.ceil(grams / weight);
  return `${pieces} szt`;
};

export default function ShoppingList() {
  const [range, setRange] = useState({
    start: startOfWeek(new Date(), { weekStartsOn: 1 }),
    end: endOfWeek(new Date(), { weekStartsOn: 1 }),
  });
  const [generatedRange, setGeneratedRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [generatedStatuses, setGeneratedStatuses] = useState<Record<number, ItemStatus>>({});
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const { toast } = useToast();

  const startStr = format(range.start, "yyyy-MM-dd");
  const endStr = format(range.end, "yyyy-MM-dd");

  const { data: generatedItems = [], isLoading: isGenerating } = useShoppingList(
    generatedRange?.startDate || "",
    generatedRange?.endDate || "",
    !!generatedRange,
  );

  useEffect(() => {
    if (!generatedItems.length) return;
    setGeneratedStatuses((prev) => {
      const next: Record<number, ItemStatus> = {};
      for (const item of generatedItems as any[]) {
        next[item.ingredientId] = prev[item.ingredientId] || "NOT_BOUGHT";
      }
      return next;
    });
  }, [generatedItems]);

  const { data: activeLists = [] } = useQuery<any[]>({
    queryKey: ["/api/shopping-lists/active"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/shopping-lists/active", {}, 10000);
      if (!response.ok) throw new Error("Nie udało się pobrać aktywnych list");
      return response.json();
    },
    placeholderData: (previousData) => previousData ?? [],
  });

  const { data: historyLists = [] } = useQuery<any[]>({
    queryKey: ["/api/shopping-lists/snapshots"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/shopping-lists/snapshots", {}, 10000);
      if (!response.ok) throw new Error("Nie udało się pobrać historii");
      return response.json();
    },
    placeholderData: (previousData) => previousData ?? [],
  });

  const { data: selectedSnapshot } = useQuery<any>({
    queryKey: ["/api/shopping-lists/snapshots", selectedSnapshotId],
    queryFn: async () => {
      const response = await fetchWithTimeout(`/api/shopping-lists/snapshots/${selectedSnapshotId}`, {}, 10000);
      if (!response.ok) throw new Error("Nie udało się pobrać listy");
      return response.json();
    },
    enabled: selectedSnapshotId !== null,
  });

  const saveListMutation = useMutation({
    mutationFn: async () => {
      if (!generatedRange) throw new Error("Najpierw wygeneruj listę.");
      const fallbackName = `Lista ${generatedRange.startDate} - ${generatedRange.endDate}`;
      const payload = {
        name: snapshotName.trim() || fallbackName,
        periodStart: generatedRange.startDate,
        periodEnd: generatedRange.endDate,
        items: (generatedItems as any[])
          .filter((item: any) => (generatedStatuses[item.ingredientId] || "NOT_BOUGHT") !== "AT_HOME")
          .map((item: any) => ({
            ingredientId: item.ingredientId,
            name: item.name,
            totalAmount: Number(item.totalAmount || 0),
            unit: item.unit || "g",
            category: item.category || "Inne",
            status: (generatedStatuses[item.ingredientId] || "NOT_BOUGHT") === "BOUGHT" ? "BOUGHT" : "NOT_BOUGHT",
            price: 0,
            isExtra: false,
          })),
      };
      const response = await apiRequest("POST", "/api/shopping-lists/snapshots", payload);
      return response.json();
    },
    onSuccess: (snapshot: any) => {
      setSnapshotName("");
      setSelectedSnapshotId(snapshot.id);
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/active"] });
      toast({ title: "Lista zapisana", description: "Na zapisanej liście są tylko produkty do kupienia." });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { status?: ItemStatus; price?: number } }) => {
      await apiRequest("PATCH", `/api/shopping-lists/snapshot-items/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/snapshots", selectedSnapshotId] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/snapshots"] });
    },
  });

  const completeListMutation = useMutation({
    mutationFn: async (snapshotId: number) => {
      await apiRequest("POST", `/api/shopping-lists/snapshots/${snapshotId}/complete`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/snapshots", selectedSnapshotId] });
      setSelectedSnapshotId(null);
      toast({ title: "Zakupy zakończone", description: "Lista została przeniesiona do historii." });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: async (snapshotId: number) => {
      await apiRequest("DELETE", `/api/shopping-lists/snapshots/${snapshotId}`);
    },
    onSuccess: (_, snapshotId) => {
      if (selectedSnapshotId === snapshotId) setSelectedSnapshotId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shopping-lists/snapshots", snapshotId] });
      toast({ title: "Usunięto", description: "Lista została usunięta." });
    },
  });

  const generatedWithStatus = useMemo(() => {
    return [...(generatedItems as any[])].map((item: any) => ({
      ...item,
      status: generatedStatuses[item.ingredientId] || "NOT_BOUGHT",
    }));
  }, [generatedItems, generatedStatuses]);

  const generatedToBuy = generatedWithStatus.filter((item) => item.status === "NOT_BOUGHT");
  const generatedAtHome = generatedWithStatus.filter((item) => item.status === "AT_HOME");
  const generatedBought = generatedWithStatus.filter((item) => item.status === "BOUGHT");

  const generatedGroupedToBuy = groupByCategory(generatedToBuy);
  const generatedToBuyCategories = Object.keys(generatedGroupedToBuy).sort();

  const generatedCount = generatedWithStatus.length;
  const generatedSavedCount = generatedWithStatus.filter((item) => item.status !== "AT_HOME").length;

  const toggleGeneratedBought = (ingredientId: number) => {
    setGeneratedStatuses((prev) => {
      const current = prev[ingredientId] || "NOT_BOUGHT";
      const next: ItemStatus = current === "BOUGHT" ? "NOT_BOUGHT" : "BOUGHT";
      return { ...prev, [ingredientId]: next };
    });
  };

  const toggleGeneratedAtHome = (ingredientId: number) => {
    setGeneratedStatuses((prev) => {
      const current = prev[ingredientId] || "NOT_BOUGHT";
      const next: ItemStatus = current === "AT_HOME" ? "NOT_BOUGHT" : "AT_HOME";
      return { ...prev, [ingredientId]: next };
    });
  };

  const selectedItems = selectedSnapshot?.items || [];
  const selectedToBuy = selectedItems.filter((item: any) => item.status !== "BOUGHT" && item.status !== "AT_HOME");
  const selectedBought = selectedItems.filter((item: any) => item.status === "BOUGHT");
  const selectedGroupedToBuy = groupByCategory(selectedToBuy);
  const selectedToBuyCategories = Object.keys(selectedGroupedToBuy).sort();

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Lista zakupów</h1>
            <p className="text-muted-foreground">Generuj listę dla zakresu dat, zapisz ją i realizuj w sklepie.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={startStr} onChange={(e) => setRange((prev) => ({ ...prev, start: new Date(e.target.value) }))} className="w-40" />
            <Input type="date" value={endStr} onChange={(e) => setRange((prev) => ({ ...prev, end: new Date(e.target.value) }))} className="w-40" />
            <Button onClick={() => {
              setGeneratedStatuses({});
              setGeneratedRange({ startDate: startStr, endDate: endStr });
            }}>
              Generuj listę
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Podgląd wygenerowanej listy</h2>
            <span className="text-xs text-muted-foreground">{generatedCount} pozycji • do zapisu: {generatedSavedCount}</span>
          </div>
          {!generatedRange ? (
            <p className="text-sm text-muted-foreground">Wybierz zakres dat i kliknij „Generuj listę”.</p>
          ) : isGenerating ? (
            <LoadingSpinner />
          ) : generatedCount === 0 ? (
            <p className="text-sm text-muted-foreground">Brak produktów dla wybranego zakresu.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden">
              {generatedToBuyCategories.map((category) => (
                <div key={`cat-${category}`}>
                  <div className="px-4 py-1.5 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y">
                    {category}
                  </div>
                  {generatedGroupedToBuy[category]
                    .sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"))
                    .map((item: any) => (
                      <div
                        key={`to-buy-${item.ingredientId}`}
                        onClick={() => toggleGeneratedBought(item.ingredientId)}
                        className="py-2 px-3 flex items-center justify-between hover:bg-muted/30 cursor-pointer transition-colors group border-b"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-4 h-4 rounded-full border border-muted-foreground/30 group-hover:border-primary" />
                          <span className="text-sm font-medium truncate">{item.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                            {formatAmount(item.totalAmount)} {item.unit}
                          </span>
                          <Button
                            variant="outline"
                            className="h-6 px-1.5 text-[9px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGeneratedAtHome(item.ingredientId);
                            }}
                          >
                            Mam w domu
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              ))}

              {generatedAtHome.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y">W domu (nie trafi do zapisanej listy)</div>
                  {generatedAtHome
                    .sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"))
                    .map((item: any) => (
                      <div key={`at-home-${item.ingredientId}`} className="py-2 px-3 flex items-center justify-between border-b bg-muted/10">
                        <span className="text-sm text-muted-foreground">{item.name}</span>
                        <Button variant="outline" className="h-6 px-1.5 text-[9px]" onClick={() => toggleGeneratedAtHome(item.ingredientId)}>
                          Przywróć
                        </Button>
                      </div>
                    ))}
                </div>
              )}

              {generatedBought.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y">Kupione</div>
                  {generatedBought
                    .sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"))
                    .map((item: any) => (
                      <div
                        key={`bought-${item.ingredientId}`}
                        onClick={() => toggleGeneratedBought(item.ingredientId)}
                        className="py-2 px-3 flex items-center justify-between cursor-pointer hover:bg-muted/20 transition-colors border-b bg-muted/10"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-4 h-4 rounded-full border bg-primary border-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                          <span className="text-sm text-muted-foreground line-through truncate">{item.name}</span>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                          {formatAmount(item.totalAmount)} {item.unit}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-2">
            <Input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="Nazwa listy (opcjonalnie)"
            />
            <Button
              onClick={() => saveListMutation.mutate()}
              disabled={!generatedRange || generatedSavedCount === 0 || saveListMutation.isPending}
            >
              Zapisz listę
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-4 space-y-2">
          <h2 className="font-semibold">Aktywne listy</h2>
          {activeLists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak aktywnych list.</p>
          ) : (
            activeLists.map((list: any) => (
              <div key={list.id} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSnapshotId(list.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-xl border",
                    selectedSnapshotId === list.id ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <p className="font-medium">{list.name}</p>
                  <p className="text-xs text-muted-foreground">{list.periodStart} - {list.periodEnd}</p>
                </button>
                <Button variant="outline" size="icon" onClick={() => deleteListMutation.mutate(list.id)} disabled={deleteListMutation.isPending}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        {selectedSnapshot && (
          <div className="bg-white rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{selectedSnapshot.name}</h3>
                <p className="text-xs text-muted-foreground">Lista zakupów: checkbox = kupione, pozycja trafi na dół.</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedSnapshot.status !== "COMPLETED" && (
                  <Button onClick={() => completeListMutation.mutate(selectedSnapshot.id)}>
                    Zakończ zakupy
                  </Button>
                )}
                <Button variant="outline" size="icon" onClick={() => deleteListMutation.mutate(selectedSnapshot.id)} disabled={deleteListMutation.isPending}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              {selectedToBuyCategories.map((category) => (
                <div key={`selected-${category}`}>
                  <div className="px-4 py-1.5 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y">
                    {category}
                  </div>
                  {selectedGroupedToBuy[category]
                    .sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"))
                    .map((item: any) => {
                      const pieces = formatPieces(item.totalAmount, item.unitWeight);
                      return (
                        <div key={item.id} className="py-2 px-3 flex items-center justify-between gap-3 border-b hover:bg-muted/20">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              className="w-4 h-4 rounded border border-muted-foreground/50"
                              onClick={() => updateItemMutation.mutate({ id: item.id, data: { status: "BOUGHT" } })}
                              disabled={selectedSnapshot.status === "COMPLETED"}
                            />
                            <div>
                              <p className="text-sm font-medium truncate">{item.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatAmount(item.totalAmount)} {item.unit}
                                {pieces ? ` • ${pieces}` : ""}
                              </p>
                            </div>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 w-24"
                            defaultValue={Number(item.price || 0)}
                            disabled={selectedSnapshot.status === "COMPLETED"}
                            onBlur={(e) => {
                              const price = Number(e.target.value);
                              if (Number.isFinite(price) && price >= 0) {
                                updateItemMutation.mutate({ id: item.id, data: { price } });
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              ))}

              {selectedBought.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-y">Kupione</div>
                  {selectedBought
                    .sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"))
                    .map((item: any) => {
                      const pieces = formatPieces(item.totalAmount, item.unitWeight);
                      return (
                        <div key={`done-${item.id}`} className="py-2 px-3 flex items-center justify-between gap-3 border-b bg-muted/10">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              className="w-4 h-4 rounded border bg-primary border-primary flex items-center justify-center"
                              onClick={() => updateItemMutation.mutate({ id: item.id, data: { status: "NOT_BOUGHT" } })}
                              disabled={selectedSnapshot.status === "COMPLETED"}
                            >
                              <Check className="w-3 h-3 text-white" />
                            </button>
                            <div>
                              <p className="text-sm text-muted-foreground line-through truncate">{item.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatAmount(item.totalAmount)} {item.unit}
                                {pieces ? ` • ${pieces}` : ""}
                              </p>
                            </div>
                          </div>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 w-24"
                            defaultValue={Number(item.price || 0)}
                            disabled={selectedSnapshot.status === "COMPLETED"}
                            onBlur={(e) => {
                              const price = Number(e.target.value);
                              if (Number.isFinite(price) && price >= 0) {
                                updateItemMutation.mutate({ id: item.id, data: { price } });
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border p-4 space-y-2">
          <h2 className="font-semibold">Historia</h2>
          {historyLists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak zakończonych list.</p>
          ) : (
            historyLists.map((snapshot: any) => (
              <div key={snapshot.id} className="p-3 rounded-xl border flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{snapshot.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {snapshot.periodStart} - {snapshot.periodEnd} • Kupione: {snapshot.bought} • W domu: {snapshot.atHome} • Koszt: {formatAmount(snapshot.totalCost || 0)} zł
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Zakończono: {snapshot.completedAt ? format(new Date(snapshot.completedAt), "d MMM yyyy HH:mm", { locale: pl }) : "-"}
                  </p>
                </div>
                <Button variant="outline" size="icon" onClick={() => deleteListMutation.mutate(snapshot.id)} disabled={deleteListMutation.isPending}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
