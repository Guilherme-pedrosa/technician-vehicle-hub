import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval } from "date-fns";
import { getResumoDia } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";

export type DriverPeriodRow = {
  id: string;
  nome: string;
  kmRodado: number;
  telemetrias: number;
  kmPorTelemetria: number;
  placas: string[];
};

type ResumoDiaMotorista = {
  id?: number;
  nome?: string;
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
      kmRodado?: number;
      motorista?: ResumoDiaMotorista;
    };
  };
};

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

      // Generate all days in range
      const days = eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
        format(d, "yyyy-MM-dd")
      );

      // Create tasks: one per vehicle per day
      const tasks = adesaoIds.flatMap((v) =>
        days.map((day) => () =>
          getResumoDia(v.adesaoId, day).then((raw): { placa: string; day: string; data: ResumoDiaResponse } => ({
            placa: v.placa,
            day,
            data: raw as ResumoDiaResponse,
          }))
        )
      );

      const results = await batchCalls(tasks, 8);

      // Aggregate per driver
      const driverMap = new Map<string, { nome: string; km: number; registros: number; placas: Set<string> }>();

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { placa, day, data } = result.value;

        const tempoMovimento = data?.basico?.tempo?.movimento ?? 0;
        const kmTotal = data?.basico?.km?.total ?? 0;
        const telemetrias = data?.basico?.telemetria?.quantidade ?? 0;

        // Validate that posicao.dt_posicao matches the requested day.
        // The API returns stale basico.km data for vehicles inactive for months.
        const dtPosicao = data?.posicao?.dt_posicao ?? "";
        const posicaoDate = dtPosicao ? dtPosicao.substring(0, 10) : "";
        if (posicaoDate !== day) continue;

        // Skip no real movement
        if (tempoMovimento <= 60 || kmTotal <= 50) continue;

        const kmKm = kmTotal / 1000;

        // Get driver info
        const motorista =
          data?.posicao?.deslocamento?.motorista ??
          data?.posicao?.motorista;

        const nome = motorista?.nome;
        if (!nome || nome === "Desconhecido") continue;

        const key = motorista?.id ? String(motorista.id) : nome;

        if (!driverMap.has(key)) {
          driverMap.set(key, { nome, km: 0, registros: 0, placas: new Set() });
        }
        const group = driverMap.get(key)!;
        group.km += kmKm;
        group.registros += telemetrias;
        group.placas.add(placa);
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
