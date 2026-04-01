import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval } from "date-fns";
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
  placa?: string;
  km_percorrido?: string | number;
  motorista?: {
    id?: number | string;
    nome?: string;
  };
};

/** Robust km extraction: tries multiple fields, handles comma decimals */
function extractKmFromEntry(entry: Record<string, unknown>): number {
  const candidates = [
    entry.km_percorrido,
    entry.kmPercorrido,
    entry.km,
    entry.distancia,
    entry.distance,
    entry.km_rodado,
    entry.km_total,
  ];
  for (const val of candidates) {
    if (val == null) continue;
    const str = String(val).replace(",", ".");
    const num = parseFloat(str);
    if (!isNaN(num) && num > 0) return num;
  }
  return 0;
}

// Batch with concurrency limit
async function batchCalls<T>(tasks: (() => Promise<T>)[], concurrency = 6): Promise<PromiseSettledResult<T>[]> {
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
    queryKey: ["km-periodo-tecnico", startStr, endStr, adesaoIds.map((a) => a.adesaoId).join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      const days = eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
        format(d, "yyyy-MM-dd")
      );

      const tasks = adesaoIds.flatMap((v) =>
        days.map((day) => () =>
          getRelatorioLogMotorista({ adesao_id: v.adesaoId, data: day }).then(
            (raw): { placa: string; entries: LogMotoristaEntry[] } => ({
              placa: v.placa,
              entries: (Array.isArray(raw) ? raw : []) as LogMotoristaEntry[],
            })
          )
        )
      );

      const results = await batchCalls(tasks, 8);

      const driverMap = new Map<string, { nome: string; km: number; placas: Set<string> }>();

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { placa, entries } = result.value;

        for (const entry of entries) {
          const km = extractKmFromEntry(entry as unknown as Record<string, unknown>);
          if (km <= 0) continue;

          const motorista = entry.motorista;
          const isDesconhecido = !motorista?.nome || motorista.nome === "Desconhecido";
          const nome = isDesconhecido ? "Sem condutor vinculado" : motorista!.nome!;
          const key = isDesconhecido
            ? `sem-condutor-${entry.placa ?? placa}`
            : (typeof motorista?.id === "number" ? String(motorista.id) : nome);

          if (!driverMap.has(key)) {
            driverMap.set(key, { nome: isDesconhecido ? `Sem condutor vinculado (${entry.placa ?? placa})` : nome, km: 0, placas: new Set() });
          }
          const group = driverMap.get(key)!;
          group.km += km;
          group.placas.add(entry.placa ?? placa);
        }
      }

      return Array.from(driverMap.entries())
        .map(([key, g]) => {
          const kmRodado = Math.round(g.km * 100) / 100;
          return {
            id: key,
            nome: g.nome,
            kmRodado,
            telemetrias: 0,
            kmPorTelemetria: kmRodado,
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
