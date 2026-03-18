import { useMemo } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { getResumoDia } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";

type ResumoDiaMotorista = {
  id: number;
  nome: string;
  cnh?: string;
  tipo_vinculo?: string;
};

type ResumoDiaResponse = {
  basico?: {
    km?: { total?: number; permitido?: number; proibido?: number };
    telemetria?: { quantidade?: number };
    velocidade?: { maxima?: number; media?: number };
    tempo?: { movimento?: number; parado?: number; total?: number };
  };
  posicao?: {
    dt_posicao?: string;
    motorista?: ResumoDiaMotorista;
    deslocamento?: {
      dtInicio?: string;
      dtFinal?: string;
      kmRodado?: number;
      motorista?: ResumoDiaMotorista;
    };
  };
};

export type ResumoDiaRow = {
  adesaoId: string;
  placa: string;
  kmHoje: number;
  telemetrias: number;
  motoristaId?: number;
  motoristaNome?: string;
};

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

          const kmTotal = raw?.basico?.km?.total ?? 0;
          const telemetrias = raw?.basico?.telemetria?.quantidade ?? 0;
          const tempoMovimento = raw?.basico?.tempo?.movimento ?? 0;

          // Skip vehicles with no KM at all (truly idle)
          // Use a threshold: < 50 meters is GPS noise
          const kmMeters = kmTotal;
          const kmReal = kmMeters > 50 ? kmMeters / 1000 : 0;
          const telemetriasReal = kmReal > 0 ? telemetrias : 0;

          // Driver info: use resumo-dia's motorista (this is the QR Code driver, not system user)
          const motorista =
            raw?.posicao?.deslocamento?.motorista ??
            raw?.posicao?.motorista ??
            undefined;

          return {
            adesaoId,
            placa: vehicle?.placa ?? adesaoId,
            kmHoje: kmReal,
            telemetrias: telemetriasReal,
            motoristaId: motorista?.id,
            motoristaNome: motorista?.nome,
          } satisfies ResumoDiaRow;
        })
      );

      return results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value as ResumoDiaRow);
    },
    enabled: adesaoIds.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const driverRows = useMemo(() => {
    const data = query.data ?? [];
    const groups = new Map<
      string,
      { nome: string; kmHoje: number; telemetrias: number; placas: string[] }
    >();

    data.forEach((row) => {
      if (row.kmHoje === 0) return; // Skip idle vehicles

      const key = row.motoristaId ? String(row.motoristaId) : "sem-condutor";
      const nome = row.motoristaNome ?? "Sem condutor vinculado";

      if (!groups.has(key)) {
        groups.set(key, { nome, kmHoje: 0, telemetrias: 0, placas: [] });
      }

      const group = groups.get(key)!;
      group.kmHoje += row.kmHoje;
      group.telemetrias += row.telemetrias;
      group.placas.push(row.placa);
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
          placas: group.placas,
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
