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
};

export function useTelemetryEvents(startDate: Date, endDate: Date) {
  const startStr = format(startDate, "yyyy-MM-dd");
  const endStr = format(endDate, "yyyy-MM-dd");

  const query = useQuery({
    queryKey: ["telemetry-events", startStr, endStr],
    queryFn: async () => {
      const PAGE = 1000;
      const all: TelemetryEventRow[] = [];
      let from = 0;
      // Paginação até esgotar (Supabase limita a 1000 linhas/req)
      // Em prática um mês de frota = ~400 eventos, mas mantemos seguro.
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
        const batch = (data ?? []) as TelemetryEventRow[];
        all.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      // Filtra placas excluídas
      return all.filter((e) => !isExcludedPlaca(e.placa));
    },
    staleTime: 30 * 1000,
  });

  const events = query.data ?? [];

  /** Telemetrias por motorista (key = motorista_id ou "sem-condutor") */
  const byDriver = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; freada: number; aceleracao: number; curva: number; placas: Set<string> }>();
    for (const ev of events) {
      const isSemCondutor = !ev.motorista_id || ev.motorista_nome === "Sem condutor vinculado";
      const key = isSemCondutor ? "sem-condutor" : String(ev.motorista_id);
      const nome = isSemCondutor ? "Sem condutor vinculado" : (ev.motorista_nome ?? "Desconhecido");
      if (!map.has(key)) {
        map.set(key, { nome, total: 0, freada: 0, aceleracao: 0, curva: 0, placas: new Set() });
      }
      const g = map.get(key)!;
      g.total += 1;
      if (ev.event_type === "freada") g.freada += 1;
      else if (ev.event_type === "aceleracao") g.aceleracao += 1;
      else if (ev.event_type === "curva") g.curva += 1;
      g.placas.add(ev.placa);
    }
    return map;
  }, [events]);

  /** Telemetrias por placa */
  const byPlaca = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      map.set(ev.placa, (map.get(ev.placa) ?? 0) + 1);
    }
    return map;
  }, [events]);

  /** Telemetrias por (motorista_id, placa) — usado pra atribuir telemetrias a linhas do daily_vehicle_km */
  const byDriverPlaca = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      const driverKey = ev.motorista_id && ev.motorista_nome !== "Sem condutor vinculado"
        ? String(ev.motorista_id)
        : "sem-condutor";
      const k = `${driverKey}|${ev.placa}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const total = events.length;

  return {
    events,
    total,
    byDriver,
    byPlaca,
    byDriverPlaca,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
