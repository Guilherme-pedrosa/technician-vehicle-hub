// Utilitário para calcular sob demanda a divergência entre o KM informado pelo
// técnico a partir da foto do painel no momento do checklist e o KM
// cadastrado do veículo (fonte: Rota Exata, sincronizado de hora em hora).
//
// O cálculo é feito **sempre na exibição** (lista, detalhe, auditorias) para
// que reflita o `km_atual` mais recente do veículo — o cadastro pode ter sido
// atualizado depois do checklist via sync automático.

export const KM_PAINEL_DIVERGENCE_THRESHOLD = 50;
// Diferenças negativas pequenas são esperadas (carro rodou entre a foto e o
// último sync). Mas uma diferença negativa MUITO grande (> 2000 km) é, na
// prática, indício de leitura errada (dígito perdido pela IA, ex.: 27.754
// quando o real é 277.530). Tratamos isso como divergência.
export const KM_PAINEL_NEGATIVE_THRESHOLD = 2000;

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
 * Retorna `null` se o KM do painel não foi informado (ou se o checklist é antigo
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
 * Retorna `null` se não há KM do painel informado ou se o KM do veículo é desconhecido.
 */
export function computeKmPainelDivergence(
  detalhes: any,
  vehicleKmAtual: number | null | undefined,
): KmPainelComparison | null {
  const lido = extractKmLidoPainel(detalhes);
  if (lido === null) return null;
  const esperado = typeof vehicleKmAtual === "number" ? vehicleKmAtual : 0;
  const diferenca = lido - esperado;
  // Divergente quando:
  // - lido > esperado + 50 km (carro não pode estar à frente do sync mais recente)
  // - lido < esperado - 2000 km (queda implausível indica dígito perdido na leitura da IA)
  const divergente =
    diferenca > KM_PAINEL_DIVERGENCE_THRESHOLD ||
    -diferenca > KM_PAINEL_NEGATIVE_THRESHOLD;
  return {
    lido,
    esperado,
    diferenca,
    divergente,
  };
}
