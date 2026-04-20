// Utilitário para calcular sob demanda a divergência entre o KM lido na foto do
// painel (extraído pela IA durante a validação no momento do checklist) e o KM
// cadastrado do veículo (fonte: Rota Exata, sincronizado de hora em hora).
//
// O cálculo é feito **sempre na exibição** (lista, detalhe, auditorias) para
// que reflita o `km_atual` mais recente do veículo — o cadastro pode ter sido
// atualizado depois do checklist via sync automático.

export const KM_PAINEL_DIVERGENCE_THRESHOLD = 50;

export type KmPainelComparison = {
  lido: number;
  esperado: number;
  diferenca: number;
  divergente: boolean;
};

/**
 * Extrai o KM lido do painel a partir do `detalhes` do checklist.
 * - Checklists novos: campo `km_lido_painel` (número direto).
 * - Checklists antigos: campo `km_painel.lido` (formato anterior).
 * Retorna `null` se a IA não conseguiu ler o KM (ou se o checklist é antigo
 * sem nenhum desses campos).
 */
export function extractKmLidoPainel(detalhes: any): number | null {
  if (!detalhes || typeof detalhes !== "object") return null;
  const direct = detalhes.km_lido_painel;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const legacy = detalhes.km_painel?.lido;
  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
    return legacy;
  }
  return null;
}

/**
 * Compara o KM lido com o KM cadastrado atual do veículo.
 * Retorna `null` se não há KM lido pela IA ou se o KM do veículo é desconhecido.
 */
export function computeKmPainelDivergence(
  detalhes: any,
  vehicleKmAtual: number | null | undefined,
): KmPainelComparison | null {
  const lido = extractKmLidoPainel(detalhes);
  if (lido === null) return null;
  const esperado = typeof vehicleKmAtual === "number" ? vehicleKmAtual : 0;
  const diferenca = lido - esperado;
  // Só é divergente quando o KM lido na foto é MAIOR que o cadastrado + threshold.
  // Diferenças negativas (lido < esperado) são esperadas: o carro rodou entre a
  // hora da foto e o sync mais recente do Rota Exata, então o cadastro evoluiu.
  return {
    lido,
    esperado,
    diferenca,
    divergente: diferenca > KM_PAINEL_DIVERGENCE_THRESHOLD,
  };
}
