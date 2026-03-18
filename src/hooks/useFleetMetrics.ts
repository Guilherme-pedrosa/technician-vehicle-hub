import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { startOfDay, startOfMonth, startOfWeek, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { getResumoDia } from "@/services/rotaexata";
import { useUltimaPosicaoTodos, type RotaExataPosicao } from "@/hooks/useRotaExata";

export type FleetMetricRow = {
  id: string;
  adesaoId: string | null;
  placa: string;
  marca: string;
  modelo: string;
  status: string;
  kmAtual: number;
  kmDia: number;
  kmSemana: number;
  kmMes: number;
  posicao?: RotaExataPosicao;
};

function getDateRanges() {
  const now = new Date();
  return {
    hoje: format(startOfDay(now), "yyyy-MM-dd"),
    semana: format(startOfWeek(now, { weekStartsOn: 1, locale: ptBR }), "yyyy-MM-dd"),
    mes: format(startOfMonth(now), "yyyy-MM-dd"),
    fim: format(now, "yyyy-MM-dd"),
  };
}

function extractKmValue(payload: unknown): number {
  const candidates = [
    "km",
    "km_rodado",
    "kmRodado",
    "distancia",
    "distancia_total",
    "distanciaTotal",
    "total_km",
    "totalKm",
    "quilometragem",
    "odometro_percorrido",
  ];

  if (typeof payload === "number") return Number.isFinite(payload) ? payload : 0;

  if (typeof payload === "string") {
    const normalized = Number(payload.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(normalized) ? normalized : 0;
  }

  if (Array.isArray(payload)) {
    return payload.reduce<number>((sum, item) => sum + extractKmValue(item), 0);
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    for (const key of candidates) {
      const value = record[key];
      if (value !== undefined) return extractKmValue(value);
    }

    if ("data" in record) return extractKmValue(record.data);

    return Object.values(record).reduce<number>((sum, value) => {
      return sum + extractKmValue(value);
    }, 0);
  }

  return 0;
}

export function useFleetMetrics() {
  const ranges = getDateRanges();

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", "fleet-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, status, placa, modelo, marca, adesao_id, km_atual")
        .order("placa");

      if (error) throw error;
      return data;
    },
  });

  const positionsQuery = useUltimaPosicaoTodos();

  const kmQuery = useQuery({
    queryKey: ["rotaexata", "km-periodos", vehiclesQuery.data?.map((vehicle) => vehicle.adesao_id).join("|"), ranges.hoje, ranges.semana, ranges.mes, ranges.fim],
    enabled: !!vehiclesQuery.data?.some((vehicle) => vehicle.adesao_id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const vehicles = vehiclesQuery.data?.filter((vehicle) => vehicle.adesao_id) ?? [];

      const results = await Promise.allSettled(
        vehicles.map(async (vehicle) => {
          const adesaoId = vehicle.adesao_id!;
          const { getResumoDia } = await import("@/services/rotaexata");
          const [dia, semana, mes] = await Promise.allSettled([
            getResumoDia(adesaoId, ranges.hoje),
            getResumoDia(adesaoId, ranges.semana),
            getResumoDia(adesaoId, ranges.mes),
          ]);

          return {
            adesaoId,
            kmDia: dia.status === "fulfilled" ? extractKmValue(dia.value) : 0,
            kmSemana: semana.status === "fulfilled" ? extractKmValue(semana.value) : 0,
            kmMes: mes.status === "fulfilled" ? extractKmValue(mes.value) : 0,
          };
        })
      );

      const m = new Map<string, { kmDia: number; kmSemana: number; kmMes: number }>();
      results.forEach(r => { if (r.status === "fulfilled") m.set(r.value.adesaoId, r.value); });
      return m;
    },
  });

  const rows = useMemo<FleetMetricRow[]>(() => {
    const vehicles = vehiclesQuery.data ?? [];
    const positions = positionsQuery.data ?? [];
    const positionMap = new Map<string, RotaExataPosicao>();
    const kmMap = kmQuery.data ?? new Map<string, { kmDia: number; kmSemana: number; kmMes: number }>();

    positions.forEach((position) => {
      if (position.adesao_id) positionMap.set(String(position.adesao_id), position);
    });

    return vehicles.map((vehicle) => {
      const metrics = vehicle.adesao_id ? kmMap.get(vehicle.adesao_id) : undefined;
      return {
        id: vehicle.id,
        adesaoId: vehicle.adesao_id,
        placa: vehicle.placa,
        marca: vehicle.marca,
        modelo: vehicle.modelo,
        status: vehicle.status,
        kmAtual: vehicle.km_atual,
        kmDia: metrics?.kmDia ?? 0,
        kmSemana: metrics?.kmSemana ?? 0,
        kmMes: metrics?.kmMes ?? 0,
        posicao: vehicle.adesao_id ? positionMap.get(vehicle.adesao_id) : undefined,
      };
    });
  }, [vehiclesQuery.data, positionsQuery.data, kmQuery.data]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.totalVeiculos += 1;
        acc.totalKmAtual += row.kmAtual;
        acc.totalKmDia += row.kmDia;
        acc.totalKmSemana += row.kmSemana;
        acc.totalKmMes += row.kmMes;
        if (row.posicao?.velocidade && row.posicao.velocidade > 0) acc.emMovimento += 1;
        if (row.posicao && row.posicao.velocidade === 0 && row.posicao.ignicao) acc.paradoLigado += 1;
        if (row.posicao && row.posicao.velocidade === 0 && !row.posicao.ignicao) acc.paradoDesligado += 1;
        return acc;
      },
      {
        totalVeiculos: 0,
        totalKmAtual: 0,
        totalKmDia: 0,
        totalKmSemana: 0,
        totalKmMes: 0,
        emMovimento: 0,
        paradoLigado: 0,
        paradoDesligado: 0,
      }
    );
  }, [rows]);

  return {
    rows,
    summary,
    isLoading: vehiclesQuery.isLoading || positionsQuery.isLoading || kmQuery.isLoading,
    isError: vehiclesQuery.isError || positionsQuery.isError || kmQuery.isError,
    ranges,
  };
}
