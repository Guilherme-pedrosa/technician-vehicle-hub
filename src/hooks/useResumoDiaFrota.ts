import { useMemo } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { getRelatorioLogMotorista } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";

/**
 * log_motorista response: array of driver segments per vehicle per day.
 * Each entry has the actual driver who drove that segment, with km and time.
 */
type LogMotoristaEntry = {
  placa?: string;
  descricao?: string;
  data?: string;
  dt_inicio?: string;
  dt_fim?: string;
  km_percorrido?: string | number;
  motorista?: {
    id?: number | string;
    nome?: string;
    email?: string;
    tipo_vinculo?: string;
  };
  tempo_deslocamento?: string;
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
    () => vehicles.filter((v) => v.adesaoId).map((v) => ({ adesaoId: v.adesaoId!, placa: v.placa })),
    [vehicles]
  );

  const query = useQuery({
    queryKey: ["resumo-dia-frota", hoje, adesaoIds.map((a) => a.adesaoId).join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      const results = await Promise.allSettled(
        adesaoIds.map(async ({ adesaoId, placa }) => {
          let raw: unknown;
          try {
            raw = await getRelatorioLogMotorista({
              adesao_id: adesaoId,
              data: hoje,
            });
          } catch (err) {
            // 404 = no data for this vehicle today, 5xx = transient — skip silently
            console.warn(`[log_motorista] adesao=${adesaoId} placa=${placa} skipped:`, (err as Error).message);
            return [];
          }

          // DEBUG: log raw API response to identify real structure
          console.log(`[log_motorista] adesao=${adesaoId} placa=${placa} raw=`, JSON.stringify(raw, null, 2));

          // Resilient parsing: handle both array and { data: [...] } shapes
          const unwrapped = raw && typeof raw === "object" && !Array.isArray(raw) && "data" in (raw as Record<string, unknown>)
            ? (raw as Record<string, unknown>).data
            : raw;
          const entries = (Array.isArray(unwrapped) ? unwrapped : []) as LogMotoristaEntry[];
          return entries.map((entry) => ({
            adesaoId,
            placa: entry.placa ?? placa,
            entry,
          }));
        })
      );

      // Flatten all segments from all vehicles
      const allSegments: {
        adesaoId: string;
        placa: string;
        kmPercorrido: number;
        motoristaId?: number;
        motoristaNome?: string;
      }[] = [];

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        for (const { adesaoId, placa, entry } of result.value) {
          const km = parseFloat(String(entry.km_percorrido ?? "0")) || 0;
          if (km <= 0) continue;

          const motoristaId =
            typeof entry.motorista?.id === "number" ? entry.motorista.id : undefined;
          const motoristaNome =
            entry.motorista?.nome && entry.motorista.nome !== "Desconhecido"
              ? entry.motorista.nome
              : undefined;

          allSegments.push({
            adesaoId,
            placa,
            kmPercorrido: km,
            motoristaId,
            motoristaNome,
          });
        }
      }

      // Group by vehicle for vehicleRows
      const vehicleMap = new Map<
        string,
        { adesaoId: string; placa: string; kmHoje: number; motoristaId?: number; motoristaNome?: string }
      >();

      for (const seg of allSegments) {
        if (!vehicleMap.has(seg.adesaoId)) {
          vehicleMap.set(seg.adesaoId, {
            adesaoId: seg.adesaoId,
            placa: seg.placa,
            kmHoje: 0,
            motoristaId: seg.motoristaId,
            motoristaNome: seg.motoristaNome,
          });
        }
        const v = vehicleMap.get(seg.adesaoId)!;
        v.kmHoje += seg.kmPercorrido;
        // Use the driver with the most recent/largest segment
        if (seg.motoristaId) {
          v.motoristaId = seg.motoristaId;
          v.motoristaNome = seg.motoristaNome;
        }
      }

      return Array.from(vehicleMap.values()).map(
        (v) =>
          ({
            adesaoId: v.adesaoId,
            placa: v.placa,
            kmHoje: Math.round(v.kmHoje * 100) / 100,
            telemetrias: 0, // log_motorista doesn't provide telemetry count
            motoristaId: v.motoristaId,
            motoristaNome: v.motoristaNome,
          }) satisfies ResumoDiaRow
      );
    },
    enabled: adesaoIds.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const driverRows = useMemo(() => {
    // Re-aggregate raw segments by driver (not by vehicle)
    const data = query.data ?? [];
    // We need the raw segments, but we only have vehicleRows.
    // Better approach: group driverRows from vehicleRows
    const groups = new Map<
      string,
      { nome: string; kmHoje: number; telemetrias: number; placas: string[] }
    >();

    data.forEach((row) => {
      if (row.kmHoje === 0) return;

      const key = row.motoristaId ? String(row.motoristaId) : "sem-condutor";
      const nome = row.motoristaNome ?? "Sem condutor vinculado";

      if (!groups.has(key)) {
        groups.set(key, { nome, kmHoje: 0, telemetrias: 0, placas: [] });
      }

      const group = groups.get(key)!;
      group.kmHoje += row.kmHoje;
      group.telemetrias += row.telemetrias;
      if (!group.placas.includes(row.placa)) {
        group.placas.push(row.placa);
      }
    });

    return Array.from(groups.entries())
      .map(([id, group]) => {
        const kmRodado = Math.round(group.kmHoje * 100) / 100;
        const kmPorTelemetria = kmRodado; // No telemetry data from log_motorista

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
