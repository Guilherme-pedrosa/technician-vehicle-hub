import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { getCustos } from "@/services/rotaexata";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";

export type FuelMetrics = {
  custoTotal: number;
  litrosTotal: number;
  kmTotal: number;
  custoPorKm: number; // R$/km
  kmPorLitro: number; // km/L
  registros: number;
};

type RawCusto = {
  _id?: string;
  adesao?: { id?: number; vei_placa?: string };
  tipo_custo?: { nome?: string };
  dt_lancamento?: string;
  valor?: number | string;
  litros?: number | string;
};

function isCombustivel(nome?: string) {
  if (!nome) return false;
  const n = nome.toLowerCase();
  return n.includes("combust") || n.includes("abastec") || n.includes("gasolin") || n.includes("etanol") || n.includes("diesel");
}

export function useFuelMetrics(inicio: Date, fim: Date) {
  const startISO = inicio.toISOString();
  const endISO = fim.toISOString();
  const startDate = format(inicio, "yyyy-MM-dd");
  const endDate = format(fim, "yyyy-MM-dd");

  return useQuery<FuelMetrics>({
    queryKey: ["fuel-metrics", startISO, endISO],
    queryFn: async () => {
      // 1. Custos de combustível no período (RotaExata API)
      const where = JSON.stringify({
        dt_lancamento: { $gte: startISO, $lte: endISO },
      });
      const raw = await getCustos(where);
      let items: RawCusto[] = [];
      if (Array.isArray(raw)) items = raw as RawCusto[];
      else if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
        items = (raw as Record<string, unknown>).data as RawCusto[];
      }

      const combustiveis = items.filter((c) => {
        const placa = c.adesao?.vei_placa;
        if (placa && EXCLUDED_PLACAS.has(placa)) return false;
        return isCombustivel(c.tipo_custo?.nome);
      });

      const custoTotal = combustiveis.reduce((s, c) => s + Number(c.valor ?? 0), 0);
      const litrosTotal = combustiveis.reduce((s, c) => s + Number(c.litros ?? 0), 0);

      // 2. KM rodado no período (cache local daily_vehicle_km)
      const { data: kmData, error } = await supabase
        .from("daily_vehicle_km")
        .select("placa, km_percorrido")
        .gte("data", startDate)
        .lte("data", endDate);

      if (error) throw error;

      const kmTotal = (kmData ?? [])
        .filter((r) => !EXCLUDED_PLACAS.has(r.placa))
        .reduce((s, r) => s + Number(r.km_percorrido ?? 0), 0);

      const custoPorKm = kmTotal > 0 ? custoTotal / kmTotal : 0;
      const kmPorLitro = litrosTotal > 0 ? kmTotal / litrosTotal : 0;

      return {
        custoTotal,
        litrosTotal,
        kmTotal,
        custoPorKm,
        kmPorLitro,
        registros: combustiveis.length,
      };
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
