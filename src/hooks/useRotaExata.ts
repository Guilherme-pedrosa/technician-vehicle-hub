import { useQuery } from "@tanstack/react-query";
import {
  getAdesoes,
  getUltimaPosicaoTodos,
  getUltimaPosicao,
  getUsuariosRotaExata,
  getRespostas,
  getRelatorioKmRodado,
  getResumoDia,
} from "@/services/rotaexata";

// ===========================
// TIPOS
// ===========================

export interface RotaExataAdesao {
  id: number;
  placa: string;
  veiculo_marca?: string;
  veiculo_modelo?: string;
  veiculo_ano?: number;
  veiculo_cor?: string;
  equipamento_codigo?: string;
  grupo_id?: number;
  grupo_nome?: string;
  status?: string;
  [key: string]: unknown;
}

export interface RotaExataPosicao {
  adesao_id: number;
  placa?: string;
  latitude: number;
  longitude: number;
  velocidade: number;
  ignicao: boolean;
  data_posicao: string;
  endereco?: string;
  odometro?: number;
  direcao?: number;
  [key: string]: unknown;
}

export interface RotaExataUsuario {
  id: number;
  nome: string;
  email?: string;
  cpf?: string;
  telefone?: string;
  cnh?: string;
  cnh_validade?: string;
  cnh_categoria?: string;
  status?: string;
  [key: string]: unknown;
}

export interface RotaExataChecklist {
  id: number;
  adesao_id?: number;
  usuario_id?: number;
  formulario_nome?: string;
  data_resposta?: string;
  respostas?: unknown[];
  [key: string]: unknown;
}

// ===========================
// HOOKS
// ===========================

/** Lista todas as adesões (veículos rastreados) */
export function useRotaExataAdesoes() {
  return useQuery<RotaExataAdesao[]>({
    queryKey: ["rotaexata", "adesoes"],
    queryFn: () => getAdesoes(),
    staleTime: 5 * 60 * 1000, // 5 min
    retry: 1,
  });
}

/** Última posição de todos os veículos */
export function useUltimaPosicaoTodos() {
  return useQuery<RotaExataPosicao[]>({
    queryKey: ["rotaexata", "ultima-posicao-todos"],
    queryFn: () => getUltimaPosicaoTodos(),
    refetchInterval: 60 * 1000, // refresh every 60s
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/** Última posição de um veículo específico */
export function useUltimaPosicao(adesaoId: string | null) {
  return useQuery<RotaExataPosicao>({
    queryKey: ["rotaexata", "ultima-posicao", adesaoId],
    queryFn: () => getUltimaPosicao(adesaoId!),
    enabled: !!adesaoId,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/** Usuários do Rota Exata (motoristas) */
export function useRotaExataUsuarios() {
  return useQuery<RotaExataUsuario[]>({
    queryKey: ["rotaexata", "usuarios"],
    queryFn: () => getUsuariosRotaExata(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Respostas de formulários (checklists) */
export function useRotaExataChecklists() {
  return useQuery<RotaExataChecklist[]>({
    queryKey: ["rotaexata", "respostas"],
    queryFn: () => getRespostas(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** KM rodado por veículo em um período */
export function useKmRodado(adesaoId: string | null, dataInicio: string, dataFim: string) {
  return useQuery({
    queryKey: ["rotaexata", "km-rodado", adesaoId, dataInicio, dataFim],
    queryFn: () =>
      getRelatorioKmRodado({
        adesao_id: adesaoId!,
        data_inicio: dataInicio,
        data_fim: dataFim,
      }),
    enabled: !!adesaoId && !!dataInicio && !!dataFim,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Resumo do dia de um veículo */
export function useResumoDia(adesaoId: string | null, data: string) {
  return useQuery({
    queryKey: ["rotaexata", "resumo-dia", adesaoId, data],
    queryFn: () => getResumoDia(adesaoId!, data),
    enabled: !!adesaoId && !!data,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
