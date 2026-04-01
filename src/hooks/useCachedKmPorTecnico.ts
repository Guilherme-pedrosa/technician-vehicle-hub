import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";

export type DriverPeriodRow = {
  id: string;
  nome: string;
  kmRodado: number;
  telemetrias: number;
  kmPorTelemetria: number;
  placas: string[];
};

export function useCachedKmPorTecnico(startDate: Date, endDate: Date) {
  const startStr = format(startDate, "yyyy-MM-dd");
  const endStr = format(endDate, "yyyy-MM-dd");

  const query = useQuery({
    queryKey: ["cached-km-tecnico", startStr, endStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_vehicle_km")
        .select("*")
        .gte("data", startStr)
        .lte("data", endStr)
        .order("data", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60 * 1000,
  });

  const driverRows = useMemo<DriverPeriodRow[]>(() => {
    const rows = query.data ?? [];
    const groups = new Map<string, { nome: string; km: number; placas: Set<string> }>();

    for (const row of rows) {
      const km = Number(row.km_percorrido) || 0;
      if (km <= 0) continue;

      const key = row.motorista_id ?? row.motorista_nome;
      if (!groups.has(key)) {
        groups.set(key, { nome: row.motorista_nome, km: 0, placas: new Set() });
      }
      const g = groups.get(key)!;
      g.km += km;
      g.placas.add(row.placa);
    }

    return Array.from(groups.entries())
      .map(([key, g]) => ({
        id: key,
        nome: g.nome,
        kmRodado: Math.round(g.km * 100) / 100,
        telemetrias: 0,
        kmPorTelemetria: Math.round(g.km * 100) / 100,
        placas: Array.from(g.placas),
      }))
      .sort((a, b) => b.kmRodado - a.kmRodado);
  }, [query.data]);

  const totalKm = useMemo(() => driverRows.reduce((s, r) => s + r.kmRodado, 0), [driverRows]);

  return {
    driverRows,
    totalKm: Math.round(totalKm * 100) / 100,
    totalTelemetrias: 0,
    isLoading: query.isLoading,
    isError: query.isError,
    isEmpty: (query.data ?? []).length === 0,
  };
}

export function useSyncDailyKm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Não autenticado");

      const { data, error } = await supabase.functions.invoke("sync-daily-km", {
        body: { start_date: startDate, end_date: endDate },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cached-km-tecnico"] });
      toast.success(`Sincronização: ${result.synced} registros atualizados`);
    },
    onError: (err: Error) => {
      toast.error(`Erro na sincronização: ${err.message}`);
    },
  });
}
