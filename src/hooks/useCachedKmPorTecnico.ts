import { useMemo, useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, eachDayOfInterval, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";
import { useTelemetryEvents } from "@/hooks/useTelemetryEvents";

export type DriverPeriodRow = {
  id: string;
  nome: string;
  kmRodado: number;
  telemetrias: number;
  kmPorTelemetria: number;
  excessosVelocidade: number;
  velocidadeMaxima: number;
  placas: string[];
};

export function useCachedKmPorTecnico(startDate: Date, endDate: Date) {
  const startStr = format(startDate, "yyyy-MM-dd");
  const endStr = format(endDate, "yyyy-MM-dd");
  const totalDaysInRange = differenceInCalendarDays(endDate, startDate) + 1;

  // KM por técnico = log_motorista (gravado em daily_vehicle_km.km_percorrido)
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
    staleTime: 30 * 1000,
  });

  // Telemetrias = eventos brutos do /dirigibilidade (gravados em vehicle_telemetry_events)
  const telemetry = useTelemetryEvents(startDate, endDate);

  const syncedDays = useMemo(() => {
    const rows = query.data ?? [];
    const uniqueDays = new Set(rows.map((r) => r.data));
    return uniqueDays.size;
  }, [query.data]);

  const driverRows = useMemo<DriverPeriodRow[]>(() => {
    const rows = query.data ?? [];
    const groups = new Map<string, { nome: string; km: number; excessos: number; velMax: number; placas: Set<string> }>();

    for (const row of rows) {
      if (isExcludedPlaca(row.placa)) continue;
      const km = Number(row.km_percorrido) || 0;
      if (km <= 0) continue;
      const isSemCondutor = !row.motorista_id || row.motorista_nome === "Desconhecido" || row.motorista_nome === "Sem condutor vinculado";
      const key = isSemCondutor ? "sem-condutor" : (row.motorista_id ?? row.motorista_nome);
      const nome = isSemCondutor ? "Desconhecido" : row.motorista_nome;
      if (!groups.has(key)) {
        groups.set(key, { nome, km: 0, excessos: 0, velMax: 0, placas: new Set() });
      }
      const g = groups.get(key)!;
      g.km += km;
      g.excessos += Number((row as Record<string, unknown>).excessos_velocidade) || 0;
      const vel = Number((row as Record<string, unknown>).velocidade_maxima) || 0;
      if (vel > g.velMax) g.velMax = vel;
      g.placas.add(row.placa);
    }

    // Garante que motoristas com telemetria mas sem KM ainda apareçam
    telemetry.byDriver.forEach((info, key) => {
      if (!groups.has(key)) {
        groups.set(key, { nome: info.nome, km: 0, excessos: 0, velMax: 0, placas: new Set(info.placas) });
      } else {
        const g = groups.get(key)!;
        info.placas.forEach((p) => g.placas.add(p));
      }
    });

    return Array.from(groups.entries())
      .map(([key, g]) => {
        const tel = telemetry.byDriver.get(key)?.total ?? 0;
        const kmRound = Math.round(g.km * 100) / 100;
        // KM por Telemetria = KM rodado (log_motorista) / Eventos de telemetria (/dirigibilidade)
        const kmPorTel = tel > 0 && g.km > 0 ? Math.round((g.km / tel) * 100) / 100 : 0;
        return {
          id: key,
          nome: g.nome,
          kmRodado: kmRound,
          telemetrias: tel,
          kmPorTelemetria: kmPorTel,
          excessosVelocidade: g.excessos,
          velocidadeMaxima: g.velMax,
          placas: Array.from(g.placas),
        };
      })
      .sort((a, b) => b.kmRodado - a.kmRodado || b.telemetrias - a.telemetrias);
  }, [query.data, telemetry.byDriver]);

  // Totais EXCLUEM "Sem condutor vinculado" — só contam KM/telemetrias atribuídos a motoristas reais.
  // Isso bate com o relatório oficial da Rota Exata (que filtra por motorista identificado).
  const totalKm = useMemo(
    () => driverRows.filter((r) => r.id !== "sem-condutor").reduce((s, r) => s + r.kmRodado, 0),
    [driverRows]
  );
  const totalTelemetrias = useMemo(
    () => driverRows.filter((r) => r.id !== "sem-condutor").reduce((s, r) => s + r.telemetrias, 0),
    [driverRows]
  );
  const totalExcessos = useMemo(
    () => driverRows.filter((r) => r.id !== "sem-condutor").reduce((s, r) => s + r.excessosVelocidade, 0),
    [driverRows]
  );

  return {
    driverRows,
    totalKm: Math.round(totalKm * 100) / 100,
    totalTelemetrias,
    totalExcessos,
    isLoading: query.isLoading || telemetry.isLoading,
    isError: query.isError || telemetry.isError,
    isEmpty: (query.data ?? []).length === 0,
    syncedDays,
    totalDaysInRange,
    isComplete: syncedDays >= totalDaysInRange,
    refetch: query.refetch,
  };
}

// =============================================
// SYNC EM CHUNKS — chunked sync with progress
// =============================================

const CHUNK_SIZE_DAYS = 5;

export function useSyncDailyKm() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<{ current: number; total: number; synced: number; errors: number } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const abortRef = useRef(false);

  const refreshTelemetryQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cached-km-tecnico"] }),
      queryClient.invalidateQueries({ queryKey: ["telemetry-events"] }),
    ]);
  }, [queryClient]);

  const sync = useCallback(async (startDate: string, endDate: string) => {
    if (isSyncing) return;
    setIsSyncing(true);
    abortRef.current = false;

    try {
      const start = new Date(startDate + "T00:00:00");
      const end = new Date(endDate + "T00:00:00");
      const allDays = eachDayOfInterval({ start, end }).map((d) => format(d, "yyyy-MM-dd"));

      const chunks: { start: string; end: string }[] = [];
      for (let i = 0; i < allDays.length; i += CHUNK_SIZE_DAYS) {
        const chunkDays = allDays.slice(i, i + CHUNK_SIZE_DAYS);
        chunks.push({ start: chunkDays[0], end: chunkDays[chunkDays.length - 1] });
      }

      let totalSynced = 0;
      let totalErrors = 0;

      setProgress({ current: 0, total: allDays.length, synced: 0, errors: 0 });

      for (let i = 0; i < chunks.length; i++) {
        if (abortRef.current) {
          toast.info("Sincronização cancelada pelo usuário");
          break;
        }

        const chunk = chunks[i];
        const daysProcessed = Math.min((i + 1) * CHUNK_SIZE_DAYS, allDays.length);

        setProgress({
          current: daysProcessed,
          total: allDays.length,
          synced: totalSynced,
          errors: totalErrors,
        });

        try {
          const { data, error } = await supabase.functions.invoke("sync-daily-km", {
            body: {
              start_date: chunk.start,
              end_date: chunk.end,
              mode: "resilient",
            },
          });

          if (error) {
            console.warn(`[sync] Chunk ${chunk.start} to ${chunk.end} failed:`, error.message);
            totalErrors += differenceInCalendarDays(new Date(`${chunk.end}T00:00:00`), new Date(`${chunk.start}T00:00:00`)) + 1;
          } else if (data) {
            totalSynced += (data as { synced?: number }).synced ?? 0;
            totalErrors += (data as { errors?: number }).errors ?? 0;
          }
        } catch (err) {
          console.warn(`[sync] Chunk ${chunk.start} to ${chunk.end} exception:`, (err as Error).message);
          totalErrors += differenceInCalendarDays(new Date(`${chunk.end}T00:00:00`), new Date(`${chunk.start}T00:00:00`)) + 1;
        }

        if ((i + 1) % 5 === 0) {
          await refreshTelemetryQueries();
        }
      }

      await refreshTelemetryQueries();

      if (totalSynced > 0) {
        toast.success(`Sincronização concluída: ${totalSynced} registros em ${allDays.length} dias`);
      } else if (totalErrors > 0) {
        toast.error(`Sincronização com falhas: ${totalErrors} erros`);
      } else {
        toast.info("Nenhum dado novo encontrado no período");
      }

      return { synced: totalSynced, errors: totalErrors, days: allDays.length };
    } catch (err) {
      toast.error(`Erro na sincronização: ${(err as Error).message}`);
      throw err;
    } finally {
      setIsSyncing(false);
      setProgress(null);
    }
  }, [isSyncing, refreshTelemetryQueries]);

  const cancel = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    sync,
    cancel,
    isSyncing,
    progress,
  };
}
