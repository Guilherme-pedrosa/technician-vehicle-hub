import { useQuery } from "@tanstack/react-query";
import { getCustos } from "@/services/rotaexata";

export type CustoRotaExata = {
  id: string;
  adesao_id: number;
  placa?: string;
  veiculo_descricao?: string;
  tipo_custo_nome: string;
  dt_lancamento: string;
  dt_criacao?: string;
  valor: number;
  parcelado: boolean;
  mensalidade: boolean;
  quantidade_parcelas?: number;
  descricao?: string;
  periodo?: string;
  hodometro?: number;
  fornecedor_nome?: string;
  criado_por_nome?: string;
  [key: string]: unknown;
};

export function useCustosFlota(where?: string) {
  return useQuery<CustoRotaExata[]>({
    queryKey: ["rotaexata", "custos", where ?? "all"],
    queryFn: async () => {
      const raw = await getCustos(where);
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
        return (raw as Record<string, unknown>).data as CustoRotaExata[];
      }
      return [];
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
