import { useQuery } from "@tanstack/react-query";
import { getResumoDia } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";
import { useMemo } from "react";
import { format } from "date-fns";

type ResumoDiaMotorista = {
  id: number;
  nome: string;
  cnh?: string;
  tipo_vinculo?: string;
};

type ResumoDiaBasico = {
  km: { total: number; permitido?: number; proibido?: number };
  telemetria: { quantidade: number };
  velocidade?: { maxima: number; media: number };
  tempo?: { movimento: number; parado: number; total: number };
};

type ResumoDiaResponse = {
  basico?: ResumoDiaBasico;
  posicao?: {
    motorista?: ResumoDiaMotorista;
    deslocamento?: {
      motorista?: ResumoDiaMotorista;
    };
  };
};

export type ResumoDiaRow = {
  adesaoId: string;
  placa: string;
  kmHoje: number; // in km
  telemetrias: number;
  motorista?: { id: number; nome: string };
};

export function useResumoDiaFrota(dateStr?: string) {
  const { rows: vehicles, isLoading: loadingVehicles } = useFleetMetrics();
  const hoje = dateStr ?? format(new Date(), "yyyy-MM-dd");

  // Get adesao IDs for all vehicles that have telemetry
  const adesaoIds = useMemo(
    () => vehicles.filter((v) => v.adesaoId).map((v) => v.adesaoId!),
    [vehicles]
  );

  const query = useQuery({
    queryKey: ["resumo-dia-frota", hoje, adesaoIds.join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      // Fetch resumo-dia for all vehicles in parallel
      const results = await Promise.allSettled(
        adesaoIds.map(async (adesaoId) => {
          const raw = (await getResumoDia(adesaoId, hoje)) as ResumoDiaResponse;
          const vehicle = vehicles.find((v) => v.adesaoId === adesaoId);

          const kmMeters = raw?.basico?.km?.total ?? 0;
          const telemetrias = raw?.basico?.telemetria?.quantidade ?? 0;

          // Get motorista from posicao or deslocamento
          const motorista =
            raw?.posicao?.motorista ?? raw?.posicao?.deslocamento?.motorista ?? undefined;

          return {
            adesaoId,
            placa: vehicle?.placa ?? adesaoId,
            kmHoje: kmMeters / 1000, // meters to km
            telemetrias,
            motorista: motorista?.id
              ? { id: motorista.id, nome: motorista.nome }
              : undefined,
          } as ResumoDiaRow;
        })
      );

      return results
        .filter((r): r is PromiseFulfilledResult<ResumoDiaRow> => r.status === "fulfilled")
        .map((r) => r.value);
    },
    enabled: adesaoIds.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  // Aggregate by driver
  const driverRows = useMemo(() => {
    const data = query.data ?? [];
    const groups = new Map<string, { nome: string; kmHoje: number; telemetrias: number }>();

    data.forEach((row) => {
      const key = row.motorista ? String(row.motorista.id) : "sem-condutor";
      const nome = row.motorista?.nome ?? "Sem condutor vinculado";
      if (!groups.has(key)) {
        groups.set(key, { nome, kmHoje: 0, telemetrias: 0 });
      }
      const g = groups.get(key)!;
      g.kmHoje += row.kmHoje;
      g.telemetrias += row.telemetrias;
    });

    return Array.from(groups.entries())
      .map(([id, g]) => ({
        id,
        nome: g.nome,
        kmRodado: Math.round(g.kmHoje * 100) / 100,
        telemetrias: g.telemetrias,
        kmPorTelemetria:
          g.telemetrias > 0
            ? Math.round((g.kmHoje / g.telemetrias) * 100) / 100
            : 0,
      }))
      .sort((a, b) => b.kmRodado - a.kmRodado);
  }, [query.data]);

  const totalKmHoje = useMemo(
    () => (query.data ?? []).reduce((sum, r) => sum + r.kmHoje, 0),
    [query.data]
  );

  const totalTelemetrias = useMemo(
    () => (query.data ?? []).reduce((sum, r) => sum + r.telemetrias, 0),
    [query.data]
  );

  return {
    vehicleRows: query.data ?? [],
    driverRows,
    totalKmHoje: Math.round(totalKmHoje * 100) / 100,
    totalTelemetrias,
    isLoading: loadingVehicles || query.isLoading,
    isError: query.isError,
  };
}
