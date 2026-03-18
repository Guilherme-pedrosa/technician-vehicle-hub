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

  const rows = useMemo<FleetMetricRow[]>(() => {
    const vehicles = vehiclesQuery.data ?? [];
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

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.totalVeiculos += 1;
        acc.totalKmAtual += row.kmAtual;
        if (row.posicao?.velocidade && row.posicao.velocidade > 0) acc.emMovimento += 1;
        if (row.posicao && row.posicao.velocidade === 0 && row.posicao.ignicao) acc.paradoLigado += 1;
        if (row.posicao && row.posicao.velocidade === 0 && !row.posicao.ignicao) acc.paradoDesligado += 1;
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