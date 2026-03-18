import { useQuery } from "@tanstack/react-query";
import {
  getAdesoes,
  getUltimaPosicaoTodos,
  getUltimaPosicao,
  getUsuariosRotaExata,
  getRespostas,
  getRelatorioKmRodado,
  getResumoDia,
  type RotaExataAdesaoResponse,
  type RotaExataPosicaoResponse,
  type RotaExataUsuarioResponse,
  type RotaExataChecklistResponse,
} from "@/services/rotaexata";

// Re-export types with simpler names
export type RotaExataAdesao = RotaExataAdesaoResponse;
export type RotaExataPosicao = RotaExataPosicaoResponse;
export type RotaExataUsuario = RotaExataUsuarioResponse;
export type RotaExataChecklist = RotaExataChecklistResponse;

// ===========================
// HOOKS
// ===========================

/** Lista todas as adesões (veículos rastreados) */
export function useRotaExataAdesoes() {
  return useQuery<RotaExataAdesao[]>({
    queryKey: ["rotaexata", "adesoes"],
    queryFn: () => getAdesoes() as Promise<RotaExataAdesao[]>,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Última posição de todos os veículos */
export function useUltimaPosicaoTodos() {
  return useQuery<RotaExataPosicao[]>({
    queryKey: ["rotaexata", "ultima-posicao-todos"],
    queryFn: () => getUltimaPosicaoTodos(),
    refetchInterval: 60 * 1000,
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
    queryFn: () => getUsuariosRotaExata() as Promise<RotaExataUsuario[]>,
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
