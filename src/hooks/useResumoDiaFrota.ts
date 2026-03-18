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
    dt_posicao?: string;
    dt_final_vinculo_motorista?: string;
    motorista?: ResumoDiaMotorista;
    telemetry?: Array<unknown>;
    deslocamento?: {
      dtInicio?: string;
      dtFinal?: string;
      motorista?: ResumoDiaMotorista;
    };
  };
};

export type ResumoDiaRow = {
  adesaoId: string;
  placa: string;
  kmHoje: number;
  telemetrias: number;
  motorista?: { id: number; nome: string };
};

const ROTA_EXATA_LOCAL_OFFSET_MS = 3 * 60 * 60 * 1000;

function toRotaExataLocalDate(value?: string) {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(parsed.getTime() - ROTA_EXATA_LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

function hasDriverContextForDate(raw: ResumoDiaResponse, targetDate: string) {
  const candidateDates = [
    raw.posicao?.dt_final_vinculo_motorista,
    raw.posicao?.dt_posicao,
    raw.posicao?.deslocamento?.dtInicio,
    raw.posicao?.deslocamento?.dtFinal,
  ];

  return candidateDates.some((value) => toRotaExataLocalDate(value) === targetDate);
}

export function useResumoDiaFrota(dateStr?: string) {
  const { rows: vehicles, isLoading: loadingVehicles } = useFleetMetrics();
  const hoje = dateStr ?? format(new Date(), "yyyy-MM-dd");

  const adesaoIds = useMemo(
    () => vehicles.filter((v) => v.adesaoId).map((v) => v.adesaoId!),
    [vehicles]
  );

  const query = useQuery({
    queryKey: ["resumo-dia-frota", hoje, adesaoIds.join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      const results = await Promise.allSettled(
        adesaoIds.map(async (adesaoId) => {
          const raw = (await getResumoDia(adesaoId, hoje)) as ResumoDiaResponse;
          const vehicle = vehicles.find((v) => v.adesaoId === adesaoId);

          const kmMeters = raw?.basico?.km?.total ?? 0;
          const telemetrias = raw?.basico?.telemetria?.quantidade ?? 0;
          const hasValidDriverContext = hasDriverContextForDate(raw, hoje);
          const motorista = hasValidDriverContext
            ? raw?.posicao?.deslocamento?.motorista ?? raw?.posicao?.motorista ?? undefined
            : undefined;

          return {
            adesaoId,
            placa: vehicle?.placa ?? adesaoId,
            kmHoje: kmMeters / 1000,
            telemetrias,
            motorista: motorista?.id
              ? { id: motorista.id, nome: motorista.nome }
              : undefined,
          } satisfies ResumoDiaRow;
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

  const driverRows = useMemo(() => {
    const data = query.data ?? [];
    const groups = new Map<string, { nome: string; kmHoje: number; telemetrias: number }>();

    data.forEach((row) => {
      const key = row.motorista ? String(row.motorista.id) : "sem-condutor";
      const nome = row.motorista?.nome ?? "Sem condutor vinculado";

      if (!groups.has(key)) {
        groups.set(key, { nome, kmHoje: 0, telemetrias: 0 });
      }

      const group = groups.get(key)!;
      group.kmHoje += row.kmHoje;
      group.telemetrias += row.telemetrias;
    });

    return Array.from(groups.entries())
      .map(([id, group]) => {
        const kmRodado = Math.round(group.kmHoje * 100) / 100;
        const kmPorTelemetria =
          group.telemetrias > 0
            ? Math.round((group.kmHoje / group.telemetrias) * 100) / 100
            : kmRodado;

        return {
          id,
          nome: group.nome,
          kmRodado,
          telemetrias: group.telemetrias,
          kmPorTelemetria,
        };
      })
      .sort((a, b) => b.kmRodado - a.kmRodado);
  }, [query.data]);

  const totalKmHoje = useMemo(
    () => (query.data ?? []).reduce((sum, row) => sum + row.kmHoje, 0),
    [query.data]
  );

  const totalTelemetrias = useMemo(
    () => (query.data ?? []).reduce((sum, row) => sum + row.telemetrias, 0),
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
