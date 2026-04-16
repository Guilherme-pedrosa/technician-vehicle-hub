import { useQuery } from "@tanstack/react-query";
import { getCustos } from "@/services/rotaexata";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";

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
  litros?: number;
  [key: string]: unknown;
};

type RawCusto = {
  _id?: string;
  adesao?: {
    id?: number;
    vei_placa?: string;
    vei_descricao?: string;
  };
  tipo_custo?: {
    nome?: string;
  };
  usuario_responsavel?: {
    nome?: string;
  };
  [key: string]: unknown;
};

function normalizeCusto(raw: RawCusto): CustoRotaExata {
  return {
    id: String(raw._id ?? ""),
    adesao_id: raw.adesao?.id ?? 0,
    placa: raw.adesao?.vei_placa ?? undefined,
    veiculo_descricao: raw.adesao?.vei_descricao ?? undefined,
    tipo_custo_nome: raw.tipo_custo?.nome ?? "",
    dt_lancamento: String(raw.dt_lancamento ?? ""),
    dt_criacao: raw.created ? String(raw.created) : undefined,
    valor: Number(raw.valor ?? 0),
    parcelado: Boolean(raw.parcelado),
    mensalidade: Boolean(raw.mensalidade),
    quantidade_parcelas: raw.quantidade_parcelas ? Number(raw.quantidade_parcelas) : undefined,
    descricao: raw.descricao ? String(raw.descricao) : undefined,
    hodometro: raw.km_veiculo ? Number(raw.km_veiculo) : (raw.km_rastreador ? Number(raw.km_rastreador) : undefined),
    fornecedor_nome: undefined,
    criado_por_nome: raw.usuario_responsavel?.nome ?? undefined,
    litros: raw.litros ? Number(raw.litros) : undefined,
  };
}

export function useCustosFlota(where?: string) {
  return useQuery<CustoRotaExata[]>({
    queryKey: ["rotaexata", "custos", where ?? "all"],
    queryFn: async () => {
      const raw = await getCustos(where);
      let items: RawCusto[] = [];
      if (Array.isArray(raw)) {
        items = raw;
      } else if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
        items = (raw as Record<string, unknown>).data as RawCusto[];
      }
      return items
        .filter((it) => !isExcludedPlaca(it.adesao?.vei_placa))
        .map(normalizeCusto);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
