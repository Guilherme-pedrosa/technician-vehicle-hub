import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUltimaPosicaoTodos, type RotaExataPosicao } from "@/hooks/useRotaExata";

export type FleetMetricRow = {
  id: string;
  adesaoId: string | null;
  placa: string;
  marca: string;
  modelo: string;
  status: string;
  kmAtual: number;
  posicao?: RotaExataPosicao;
};

export function useFleetMetrics() {
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

  // Plates to ignore across the entire system
  const IGNORED_PLATES = new Set(["DIW9D20"]);

  const rows = useMemo<FleetMetricRow[]>(() => {
    const vehicles = (vehiclesQuery.data ?? []).filter((v) => !IGNORED_PLATES.has(v.placa));
    const positions = positionsQuery.data ?? [];
    const positionMap = new Map<string, RotaExataPosicao>();

    positions.forEach((p) => {
      if (p.adesao_id) positionMap.set(String(p.adesao_id), p);
    });

    return vehicles.map((v) => ({
      id: v.id,
      adesaoId: v.adesao_id,
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      status: v.status,
      kmAtual: v.km_atual,
      posicao: v.adesao_id ? positionMap.get(v.adesao_id) : undefined,
    }));
  }, [vehiclesQuery.data, positionsQuery.data]);

  // Consider positions older than 10 minutes as stale (vehicle status unknown)
  const STALE_THRESHOLD_MS = 10 * 60 * 1000;

  const summary = useMemo(() => {
    const now = Date.now();
    return rows.reduce(
      (acc, row) => {
        acc.totalVeiculos += 1;
        acc.totalKmAtual += row.kmAtual;

        if (!row.posicao) return acc;

        // Check if position data is fresh (within last 10 minutes)
        const posDate = row.posicao.data_posicao ? new Date(row.posicao.data_posicao).getTime() : 0;
        const isStale = !posDate || (now - posDate) > STALE_THRESHOLD_MS;

        if (isStale) {
          // Stale position → treat as stopped/off regardless of reported velocity
          acc.paradoDesligado += 1;
        } else if (row.posicao.velocidade > 0) {
          acc.emMovimento += 1;
        } else if (row.posicao.ignicao) {
          acc.paradoLigado += 1;
        } else {
          acc.paradoDesligado += 1;
        }

        return acc;
      },
      {
        totalVeiculos: 0,
        totalKmAtual: 0,
        emMovimento: 0,
        paradoLigado: 0,
        paradoDesligado: 0,
      }
    );
  }, [rows]);

  return {
    rows,
    summary,
    isLoading: vehiclesQuery.isLoading || positionsQuery.isLoading,
    isError: vehiclesQuery.isError || positionsQuery.isError,
  };
}