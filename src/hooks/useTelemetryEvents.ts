import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";

/**
 * Fonte de verdade para CONTAGEM DE TELEMETRIAS:
 * lê eventos brutos do /relatorios/rastreamento/dirigibilidade
 * armazenados em `vehicle_telemetry_events` (1 linha por evento).
 *
 * Cada linha = 1 freada/aceleração/curva brusca real, com timestamp e motorista.
 * COUNT(*) bate 100% com o relatório de Telemetrias do Rota Exata.
 */

export type TelemetryEventRow = {
  id: string;
  adesao_id: string;
  placa: string;
  data: string;
  event_at: string;
  event_type: string;
  motorista_id: string | null;
  motorista_nome: string | null;
  velocidade: number | null;
  weight: number;
};

export function useTelemetryEvents(startDate: Date, endDate: Date) {
  const startStr = format(startDate, "yyyy-MM-dd");
  const endStr = format(endDate, "yyyy-MM-dd");

  const query = useQuery({
    queryKey: ["telemetry-events", startStr, endStr],
    queryFn: async () => {
      const PAGE = 1000;
      const rawEvents: TelemetryEventRow[] = [];
      let from = 0;

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data, error } = await supabase
            .from("vehicle_telemetry_events")
            .select("id, adesao_id, placa, data, event_at, event_type, motorista_id, motorista_nome, velocidade")
            .gte("data", startStr)
            .lte("data", endStr)
            .order("event_at", { ascending: true })
            .range(from, from + PAGE - 1);

          if (error) throw error;

          const batch = ((data ?? []) as Omit<TelemetryEventRow, "weight">[])
            .filter((event) => !isExcludedPlaca(event.placa))
            .map((event) => ({ ...event, weight: 1 }));

          rawEvents.push(...batch);
          if (batch.length < PAGE) break;
          from += PAGE;
        }
      } catch (error) {
        console.warn("[telemetry-events] raw event query failed, using aggregate fallback:", (error as Error).message);
      }

      if (rawEvents.length > 0) {
        return { source: "raw" as const, rows: rawEvents };
      }

      const { data, error } = await supabase
        .from("daily_vehicle_km")
        .select("adesao_id, placa, data, motorista_id, motorista_nome, telemetrias")
        .gte("data", startStr)
        .lte("data", endStr)
        .gt("telemetrias", 0)
        .order("data", { ascending: true });

      if (error) throw error;

      const aggregateRows: TelemetryEventRow[] = (data ?? [])
        .filter((row) => !isExcludedPlaca(row.placa))
        .map((row, index) => ({
          id: `agg-${row.adesao_id}-${row.data}-${row.motorista_id ?? "sem-condutor"}-${index}`,
          adesao_id: row.adesao_id,
          placa: row.placa,
          data: row.data,
          event_at: `${row.data}T00:00:00.000Z`,
          event_type: "outro",
          motorista_id: row.motorista_id,
          motorista_nome: row.motorista_nome,
          velocidade: null,
          weight: Number(row.telemetrias) || 0,
        }))
        .filter((row) => row.weight > 0);

      return { source: "aggregate" as const, rows: aggregateRows };
    },
    staleTime: 30 * 1000,
  });

  const events = query.data?.rows ?? [];

  /** Telemetrias por motorista (key = motorista_id ou "sem-condutor") */
  const byDriver = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; freada: number; aceleracao: number; curva: number; placas: Set<string> }>();
    for (const ev of events) {
      const isSemCondutor = !ev.motorista_id || ev.motorista_nome === "Desconhecido" || ev.motorista_nome === "Sem condutor vinculado";
      const key = isSemCondutor ? "sem-condutor" : String(ev.motorista_id);
      const nome = isSemCondutor ? "Desconhecido" : (ev.motorista_nome ?? "Desconhecido");
      if (!map.has(key)) {
        map.set(key, { nome, total: 0, freada: 0, aceleracao: 0, curva: 0, placas: new Set() });
      }
      const g = map.get(key)!;
      g.total += ev.weight;
      if (ev.event_type === "freada") g.freada += ev.weight;
      else if (ev.event_type === "aceleracao") g.aceleracao += ev.weight;
      else if (ev.event_type === "curva") g.curva += ev.weight;
      g.placas.add(ev.placa);
    }
    return map;
  }, [events]);

  /** Telemetrias por placa */
  const byPlaca = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      map.set(ev.placa, (map.get(ev.placa) ?? 0) + ev.weight);
    }
    return map;
  }, [events]);

  /** Telemetrias por (motorista_id, placa) — usado pra atribuir telemetrias a linhas do daily_vehicle_km */
  const byDriverPlaca = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      const driverKey = ev.motorista_id && ev.motorista_nome !== "Desconhecido" && ev.motorista_nome !== "Sem condutor vinculado"
        ? String(ev.motorista_id)
        : "sem-condutor";
      const k = `${driverKey}|${ev.placa}`;
      map.set(k, (map.get(k) ?? 0) + ev.weight);
    }
    return map;
  }, [events]);

  const total = useMemo(() => events.reduce((sum, event) => sum + event.weight, 0), [events]);

  return {
    events,
    source: query.data?.source ?? "raw",
    total,
    byDriver,
    byPlaca,
    byDriverPlaca,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
