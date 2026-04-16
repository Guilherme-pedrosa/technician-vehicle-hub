import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";
import type { CustoRotaExata } from "@/hooks/useCustosFlota";

export type VeiculoCustoRow = {
  adesaoId: string;
  placa: string;
  modelo: string;
  /** KM rodado no período (cache local daily_vehicle_km) */
  kmRodado: number;
  /** Total gasto no período (todos os tipos) */
  custoTotal: number;
  /** Apenas combustível */
  custoCombustivel: number;
  /** Apenas manutenção/oficina/peças */
  custoManutencao: number;
  /** Outros custos (não combustível, não manutenção) */
  custoOutros: number;
  /** Litros abastecidos */
  litros: number;
  /** R$/km — total gasto / km rodado */
  custoPorKm: number;
  /** km/L — km rodado / litros abastecidos */
  kmPorLitro: number;
  /** Quantidade de registros de custo */
  registros: number;
};

function isCombustivel(nome?: string) {
  if (!nome) return false;
  const n = nome.toLowerCase();
  return (
    n.includes("combust") ||
    n.includes("abastec") ||
    n.includes("gasolin") ||
    n.includes("etanol") ||
    n.includes("diesel")
  );
}

function isManutencao(nome?: string) {
  if (!nome) return false;
  const n = nome.toLowerCase();
  return (
    n.includes("manuten") ||
    n.includes("oficina") ||
    n.includes("peça") ||
    n.includes("peca") ||
    n.includes("revis") ||
    n.includes("reparo") ||
    n.includes("mecân") ||
    n.includes("mecan")
  );
}

/**
 * Agrega custos + KM rodado por veículo no período.
 * Usa lista de custos já carregada (do useCustosFlota) e busca KM no cache local.
 */
export function useCustosPorVeiculo(custos: CustoRotaExata[], inicio: Date, fim: Date) {
  const startDate = format(inicio, "yyyy-MM-dd");
  const endDate = format(fim, "yyyy-MM-dd");

  const kmQuery = useQuery({
    queryKey: ["custos-por-veiculo-km", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_vehicle_km")
        .select("placa, adesao_id, km_percorrido")
        .gte("data", startDate)
        .lte("data", endDate);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const rows = useMemo<VeiculoCustoRow[]>(() => {
    const map = new Map<string, VeiculoCustoRow>();

    // 1. Inicia com KM rodado por veículo
    (kmQuery.data ?? []).forEach((r) => {
      if (isExcludedPlaca(r.placa)) return;
      const key = String(r.adesao_id ?? r.placa);
      if (!map.has(key)) {
        map.set(key, {
          adesaoId: String(r.adesao_id ?? ""),
          placa: r.placa,
          modelo: "",
          kmRodado: 0,
          custoTotal: 0,
          custoCombustivel: 0,
          custoManutencao: 0,
          custoOutros: 0,
          litros: 0,
          custoPorKm: 0,
          kmPorLitro: 0,
          registros: 0,
        });
      }
      map.get(key)!.kmRodado += Number(r.km_percorrido ?? 0);
    });

    // 2. Acumula custos
    custos.forEach((c) => {
      if (isExcludedPlaca(c.placa)) return;
      const key = String(c.adesao_id || c.placa || "");
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          adesaoId: String(c.adesao_id ?? ""),
          placa: c.placa ?? `ID ${c.adesao_id}`,
          modelo: c.veiculo_descricao ?? "",
          kmRodado: 0,
          custoTotal: 0,
          custoCombustivel: 0,
          custoManutencao: 0,
          custoOutros: 0,
          litros: 0,
          custoPorKm: 0,
          kmPorLitro: 0,
          registros: 0,
        });
      }
      const row = map.get(key)!;
      if (!row.modelo && c.veiculo_descricao) row.modelo = c.veiculo_descricao;
      if (!row.placa.startsWith("ID") && c.placa) row.placa = c.placa;

      const valor = Number(c.valor ?? 0);
      row.custoTotal += valor;
      row.registros += 1;

      if (isCombustivel(c.tipo_custo_nome)) {
        row.custoCombustivel += valor;
        row.litros += Number(c.litros ?? 0);
      } else if (isManutencao(c.tipo_custo_nome)) {
        row.custoManutencao += valor;
      } else {
        row.custoOutros += valor;
      }
    });

    // 3. Calcula derivados
    const result = Array.from(map.values()).map((r) => ({
      ...r,
      kmRodado: Math.round(r.kmRodado * 100) / 100,
      custoPorKm: r.kmRodado > 0 ? r.custoTotal / r.kmRodado : 0,
      kmPorLitro: r.litros > 0 ? r.kmRodado / r.litros : 0,
    }));

    return result.sort((a, b) => b.custoTotal - a.custoTotal);
  }, [custos, kmQuery.data]);

  return {
    rows,
    isLoading: kmQuery.isLoading,
    isError: kmQuery.isError,
  };
}
