import { useMemo, useState } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { pl } from "date-fns/locale";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useShoppingList } from "@/hooks/use-meal-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { apiRequest, fetchWithTimeout, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ItemStatus = "NOT_BOUGHT" | "AT_HOME" | "BOUGHT";

const statusOrder: ItemStatus[] = ["NOT_BOUGHT", "AT_HOME", "BOUGHT"];

const statusLabel = (status: ItemStatus) => {
  if (status === "AT_HOME") return "Mam w domu";
  if (status === "BOUGHT") return "Kupione";
  return "Do kupienia";
};

const nextStatus = (status: ItemStatus): ItemStatus => {
  const idx = statusOrder.indexOf(status);
  return statusOrder[(idx + 1) % statusOrder.length];
};

const formatAmount = (value: number) => {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export default function ShoppingList() {
  const [range, setRange] = useState({
    start: startOfWeek(new Date(), { weekStartsOn: 1 }),
    end: endOfWeek(new Date(), { weekStartsOn: 1 }),
  });
  const [generatedRange, setGeneratedRange] = useState<{ startDate: string; endDate: string } | null>(null);
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
        items: generatedItems.map((item: any) => ({
          ingredientId: item.ingredientId,
          name: item.name,
          totalAmount: Number(item.totalAmount || 0),
          unit: item.unit || "g",
          category: item.category || "Inne",
          status: "NOT_BOUGHT",
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
      toast({ title: "Lista zapisana", description: "Lista czeka na realizację zakupów." });
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
      setSelectedSnapshotId(null);
      toast({ title: "Zakupy zakończone", description: "Lista została przeniesiona do historii." });
    },
  });

  const generatedPreview = useMemo(() => {
    return [...generatedItems].sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"));
  }, [generatedItems]);

  const generatedCount = generatedPreview.length;

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
            <Button onClick={() => setGeneratedRange({ startDate: startStr, endDate: endStr })}>Generuj listę</Button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Podgląd wygenerowanej listy</h2>
            <span className="text-xs text-muted-foreground">{generatedCount} pozycji</span>
          </div>
          {!generatedRange ? (
            <p className="text-sm text-muted-foreground">Wybierz zakres dat i kliknij „Generuj listę”.</p>
          ) : isGenerating ? (
            <LoadingSpinner />
          ) : generatedCount === 0 ? (
            <p className="text-sm text-muted-foreground">Brak produktów dla wybranego zakresu.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto pr-1">
              {generatedPreview.map((item: any) => (
                <div key={item.ingredientId} className="flex justify-between text-sm border-b pb-1">
                  <span>{item.name}</span>
                  <span className="text-muted-foreground">{formatAmount(item.totalAmount)} {item.unit}</span>
                </div>
              ))}
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
              disabled={!generatedRange || generatedCount === 0 || saveListMutation.isPending}
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
              <button
                key={list.id}
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
            ))
          )}
        </div>

        {selectedSnapshot && (
          <div className="bg-white rounded-2xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{selectedSnapshot.name}</h3>
                <p className="text-xs text-muted-foreground">Klikaj status: Do kupienia → Mam w domu → Kupione.</p>
              </div>
              {selectedSnapshot.status !== "COMPLETED" && (
                <Button onClick={() => completeListMutation.mutate(selectedSnapshot.id)}>
                  Zakończ zakupy
                </Button>
              )}
            </div>

            <div className="divide-y">
              {(selectedSnapshot.items || []).map((item: any) => (
                <div key={item.id} className="py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{formatAmount(item.totalAmount)} {item.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => updateItemMutation.mutate({ id: item.id, data: { status: nextStatus(item.status as ItemStatus) } })}
                      disabled={selectedSnapshot.status === "COMPLETED"}
                    >
                      {statusLabel(item.status as ItemStatus)}
                    </Button>
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
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border p-4 space-y-2">
          <h2 className="font-semibold">Historia</h2>
          {historyLists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Brak zakończonych list.</p>
          ) : (
            historyLists.map((snapshot: any) => (
              <div key={snapshot.id} className="p-3 rounded-xl border">
                <p className="font-medium">{snapshot.name}</p>
                <p className="text-xs text-muted-foreground">
                  {snapshot.periodStart} - {snapshot.periodEnd} • Kupione: {snapshot.bought} • W domu: {snapshot.atHome} • Koszt: {formatAmount(snapshot.totalCost || 0)} zł
                </p>
                <p className="text-xs text-muted-foreground">
                  Zakończono: {snapshot.completedAt ? format(new Date(snapshot.completedAt), "d MMM yyyy HH:mm", { locale: pl }) : "-"}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
