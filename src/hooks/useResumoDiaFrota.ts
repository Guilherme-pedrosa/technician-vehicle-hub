import { useMemo } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { getRelatorioLogMotorista } from "@/services/rotaexata";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";
import { useTelemetryEvents } from "@/hooks/useTelemetryEvents";

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
  const hojeDate = useMemo(() => new Date(hoje + "T00:00:00"), [hoje]);

  const adesaoIds = useMemo(
    () => vehicles.filter((v) => v.adesaoId).map((v) => ({ adesaoId: v.adesaoId!, placa: v.placa })),
    [vehicles]
  );

  // Telemetrias do dia (fonte de verdade)
  const telemetry = useTelemetryEvents(hojeDate, hojeDate);

  const query = useQuery({
    queryKey: ["resumo-dia-frota", hoje, adesaoIds.map((a) => a.adesaoId).join(",")],
    queryFn: async () => {
      if (!adesaoIds.length) return [];

      const results = await Promise.allSettled(
        adesaoIds.map(async ({ adesaoId, placa }) => {
          const raw = await getRelatorioLogMotorista({
            adesao_id: adesaoId,
            data: hoje,
          }).catch((err) => {
            console.warn(`[log_motorista] adesao=${adesaoId} placa=${placa} skipped:`, (err as Error).message);
            return [];
          });

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
          const km = extractKmFromEntry(entry as unknown as Record<string, unknown>);
          if (km <= 0) continue;

          const motoristaId =
            typeof entry.motorista?.id === "number" ? entry.motorista.id : undefined;
          const isDesconhecido = !entry.motorista?.nome || entry.motorista.nome === "Desconhecido";
          const motoristaNome = isDesconhecido ? "Desconhecido" : entry.motorista!.nome;

          allSegments.push({
            adesaoId,
            placa,
            kmPercorrido: km,
            motoristaId,
            motoristaNome,
          });
        }
      }

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
            telemetrias: 0, // preenchido depois com telemetry.byPlaca
            motoristaId: v.motoristaId,
            motoristaNome: v.motoristaNome,
          }) satisfies ResumoDiaRow
      );
    },
    enabled: adesaoIds.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  // Enriquecimento: telemetrias por placa vêm da nova tabela
  const vehicleRows = useMemo<ResumoDiaRow[]>(() => {
    const data = query.data ?? [];
    return data.map((row) => ({
      ...row,
      telemetrias: telemetry.byPlaca.get(row.placa) ?? 0,
    }));
  }, [query.data, telemetry.byPlaca]);

  const driverRows = useMemo(() => {
    const groups = new Map<
      string,
      { nome: string; kmHoje: number; placas: Set<string> }
    >();

    vehicleRows.forEach((row) => {
      if (row.kmHoje === 0) return;

      const key = row.motoristaId ? String(row.motoristaId) : "sem-condutor";
      const nome = row.motoristaNome ?? "Desconhecido";

      if (!groups.has(key)) {
        groups.set(key, { nome, kmHoje: 0, placas: new Set() });
      }

      const group = groups.get(key)!;
      group.kmHoje += row.kmHoje;
      group.placas.add(row.placa);
    });

    // Adiciona motoristas que tiveram telemetria mas não aparecem em log_motorista
    telemetry.byDriver.forEach((info, key) => {
      if (!groups.has(key)) {
        groups.set(key, { nome: info.nome, kmHoje: 0, placas: new Set(info.placas) });
      } else {
        info.placas.forEach((p) => groups.get(key)!.placas.add(p));
      }
    });

    return Array.from(groups.entries())
      .map(([id, group]) => {
        const kmRodado = Math.round(group.kmHoje * 100) / 100;
        const tel = telemetry.byDriver.get(id)?.total ?? 0;
        const kmPorTelemetria = tel > 0 ? Math.round((kmRodado / tel) * 100) / 100 : kmRodado;

        return {
          id,
          nome: group.nome,
          kmRodado,
          telemetrias: tel,
          kmPorTelemetria,
          placas: Array.from(group.placas),
        };
      })
      .sort((a, b) => b.kmRodado - a.kmRodado);
  }, [vehicleRows, telemetry.byDriver]);

  const totalKmHoje = useMemo(
    () => vehicleRows.reduce((sum, row) => sum + row.kmHoje, 0),
    [vehicleRows]
  );

  const totalTelemetrias = telemetry.total;

  return {
    vehicleRows,
    driverRows,
    totalKmHoje: Math.round(totalKmHoje * 100) / 100,
    totalTelemetrias,
    isLoading: loadingVehicles || query.isLoading || telemetry.isLoading,
    isError: query.isError || telemetry.isError,
  };
}
