import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { getRelatorioLogMotorista } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";

export type DriverPeriodRow = {
  id: string;
  nome: string;
  kmRodado: number;
  telemetrias: number;
  kmPorTelemetria: number;
  placas: string[];
};

type LogMotoristaEntry = {
  motorista?: string | { id?: number; nome?: string };
  motorista_nome?: string;
  motorista_id?: number;
  nome?: string;
  km_rodado?: number | string;
  kmRodado?: number | string;
  km?: number | string;
  placa?: string;
  veiculo?: string;
  [key: string]: unknown;
};

function extractEntries(raw: unknown): LogMotoristaEntry[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.registros)) return obj.registros;
    if (Array.isArray(obj.items)) return obj.items;
    // Try first array property
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function getDriverName(entry: LogMotoristaEntry): { id: string; nome: string } | null {
  // Handle nested motorista object
  if (entry.motorista && typeof entry.motorista === "object") {
    const m = entry.motorista as { id?: number; nome?: string };
    if (m.nome && m.nome !== "Desconhecido") {
      return { id: m.id ? String(m.id) : m.nome, nome: m.nome };
    }
    return null;
  }

  // Handle string motorista
  const nome = (entry.motorista as string) ?? entry.motorista_nome ?? entry.nome;
  if (!nome || nome === "Desconhecido") return null;

  const id = entry.motorista_id ? String(entry.motorista_id) : nome;
  return { id, nome };
}

function getKm(entry: LogMotoristaEntry): number {
  const raw = entry.km_rodado ?? entry.kmRodado ?? entry.km;
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number") return raw;
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// Batch with concurrency limit
async function batchCalls<T>(tasks: (() => Promise<T>)[], concurrency = 5): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map((fn) => fn()));
    results.push(...batchResults);
  }
  return results;
}

export function useKmPorTecnicoPeriodo(startDate: Date, endDate: Date) {
  const { rows: vehicles, isLoading: loadingVehicles } = useFleetMetrics();

  const adesaoIds = useMemo(
    () => vehicles.filter((v) => v.adesaoId).map((v) => ({ adesaoId: v.adesaoId!, placa: v.placa })),
    [vehicles]
  );

  const isEnabled = startDate.getTime() > 0 && endDate.getTime() > 0;
  const startStr = isEnabled ? format(startDate, "yyyy-MM-dd") : "";
  const endStr = isEnabled ? format(endDate, "yyyy-MM-dd") : "";

  const query = useQuery({
    queryKey: ["km-periodo-tecnico-log", startStr, endStr, adesaoIds.map((a) => a.adesaoId).join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      const tasks = adesaoIds.map((v) => () =>
        getRelatorioLogMotorista({
          adesao_id: v.adesaoId,
          data_inicio: startStr,
          data_fim: endStr,
        }).then((raw) => ({ placa: v.placa, entries: extractEntries(raw) }))
      );

      const results = await batchCalls(tasks, 6);

      // Aggregate per driver (by name, since API may not return consistent IDs)
      const driverMap = new Map<string, { nome: string; km: number; registros: number; placas: Set<string> }>();

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { placa, entries } = result.value;

        for (const entry of entries) {
          const driver = getDriverName(entry);
          if (!driver) continue;

          const km = getKm(entry);
          if (km <= 0) continue;

          // Use nome as key for consistent grouping
          const key = driver.nome;
          if (!driverMap.has(key)) {
            driverMap.set(key, { nome: driver.nome, km: 0, registros: 0, placas: new Set() });
          }
          const group = driverMap.get(key)!;
          group.km += km;
          group.registros += 1;
          group.placas.add(placa);
        }
      }

      return Array.from(driverMap.entries())
        .map(([key, g]) => {
          const kmRodado = Math.round(g.km * 100) / 100;
          const kmPorTelemetria = g.registros > 0 ? Math.round((g.km / g.registros) * 100) / 100 : kmRodado;
          return {
            id: key,
            nome: g.nome,
            kmRodado,
            telemetrias: g.registros,
            kmPorTelemetria,
            placas: Array.from(g.placas),
          } satisfies DriverPeriodRow;
        })
        .sort((a, b) => b.kmRodado - a.kmRodado);
    },
    enabled: isEnabled && adesaoIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const totalKm = useMemo(() => (query.data ?? []).reduce((s, r) => s + r.kmRodado, 0), [query.data]);
  const totalTelemetrias = useMemo(() => (query.data ?? []).reduce((s, r) => s + r.telemetrias, 0), [query.data]);

  return {
    driverRows: query.data ?? [],
    totalKm: Math.round(totalKm * 100) / 100,
    totalTelemetrias,
    isLoading: loadingVehicles || query.isLoading,
    isError: query.isError,
  };
}
