import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval, isSameDay } from "date-fns";
import { getResumoDia } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";

type ResumoDiaMotorista = {
  id: number;
  nome: string;
};

type ResumoDiaResponse = {
  basico?: {
    km?: { total?: number };
    telemetria?: { quantidade?: number };
    tempo?: { movimento?: number };
  };
  posicao?: {
    dt_posicao?: string;
    motorista?: ResumoDiaMotorista;
    deslocamento?: {
      motorista?: ResumoDiaMotorista;
      kmRodado?: number;
    };
  };
};

export type DriverPeriodRow = {
  id: string;
  nome: string;
  kmRodado: number;
  telemetrias: number;
  kmPorTelemetria: number;
  placas: string[];
};

// Batch calls with concurrency limit
async function batchCalls<T>(
  tasks: (() => Promise<T>)[],
  concurrency = 5
): Promise<PromiseSettledResult<T>[]> {
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
  const isSingleDay = isEnabled && isSameDay(startDate, endDate);
  const days = useMemo(
    () => (isEnabled ? eachDayOfInterval({ start: startDate, end: endDate }) : []),
    [startDate.getTime(), endDate.getTime(), isEnabled]
  );

  const startStr = isEnabled ? format(startDate, "yyyy-MM-dd") : "";
  const endStr = isEnabled ? format(endDate, "yyyy-MM-dd") : "";

  const query = useQuery({
    queryKey: ["km-periodo-tecnico", startStr, endStr, adesaoIds.map((a) => a.adesaoId).join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      // Build tasks: one per vehicle per day
      const tasks: { adesaoId: string; placa: string; dateStr: string; fn: () => Promise<ResumoDiaResponse> }[] = [];

      for (const day of days) {
        const dateStr = format(day, "yyyy-MM-dd");
        for (const v of adesaoIds) {
          tasks.push({
            adesaoId: v.adesaoId,
            placa: v.placa,
            dateStr,
            fn: () => getResumoDia(v.adesaoId, dateStr) as Promise<ResumoDiaResponse>,
          });
        }
      }

      const results = await batchCalls(
        tasks.map((t) => t.fn),
        6
      );

      // Aggregate per driver
      const driverMap = new Map<
        string,
        { nome: string; km: number; telemetrias: number; placas: Set<string> }
      >();

      results.forEach((result, idx) => {
        if (result.status !== "fulfilled") return;
        const raw = result.value;
        const task = tasks[idx];

        const dtPosicao = raw?.posicao?.dt_posicao;
        const posicaoDate = dtPosicao ? dtPosicao.substring(0, 10) : null;
        const isFromRequestedDate = posicaoDate === task.dateStr;
        const tempoMovimento = raw?.basico?.tempo?.movimento ?? 0;
        const kmTotal = raw?.basico?.km?.total ?? 0;
        const telemetrias = raw?.basico?.telemetria?.quantidade ?? 0;
        const isRealMovement = isFromRequestedDate && tempoMovimento > 60 && kmTotal > 50;

        if (!isRealMovement) return;

        const kmReal = kmTotal / 1000;
        const telReal = telemetrias;
        const motorista =
          raw?.posicao?.deslocamento?.motorista ?? raw?.posicao?.motorista ?? undefined;
        const key = motorista?.id ? String(motorista.id) : "sem-condutor";
        const nome = motorista?.nome ?? "Sem condutor vinculado";

        if (!driverMap.has(key)) {
          driverMap.set(key, { nome, km: 0, telemetrias: 0, placas: new Set() });
        }
        const group = driverMap.get(key)!;
        group.km += kmReal;
        group.telemetrias += telReal;
        group.placas.add(task.placa);
      });

      return Array.from(driverMap.entries())
        .map(([id, g]) => {
          const kmRodado = Math.round(g.km * 100) / 100;
          const kmPorTelemetria =
            g.telemetrias > 0 ? Math.round((g.km / g.telemetrias) * 100) / 100 : kmRodado;
          return {
            id,
            nome: g.nome,
            kmRodado,
            telemetrias: g.telemetrias,
            kmPorTelemetria,
            placas: Array.from(g.placas),
          } satisfies DriverPeriodRow;
        })
        .sort((a, b) => b.kmRodado - a.kmRodado);
    },
    enabled: adesaoIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const totalKm = useMemo(
    () => (query.data ?? []).reduce((s, r) => s + r.kmRodado, 0),
    [query.data]
  );

  const totalTelemetrias = useMemo(
    () => (query.data ?? []).reduce((s, r) => s + r.telemetrias, 0),
    [query.data]
  );

  return {
    driverRows: query.data ?? [],
    totalKm: Math.round(totalKm * 100) / 100,
    totalTelemetrias,
    isLoading: loadingVehicles || query.isLoading,
    isError: query.isError,
  };
}
