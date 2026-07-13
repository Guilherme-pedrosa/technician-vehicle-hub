import { normalizePlaca } from "@/lib/excluded-vehicles";
import type { CustoRotaExata } from "@/hooks/useCustosFlota";
import type { AuvoCusto } from "@/hooks/useAuvoExpenses";
import type { CostPlacaOverride } from "@/hooks/useCostPlacaOverrides";
import type { ManualReconciliation } from "@/hooks/useManualReconciliations";
import type { UnmatchBlock } from "@/hooks/useUnmatchBlocks";

export type MergedCusto = (CustoRotaExata | AuvoCusto) & {
  source: "rotaexata" | "auvo";
  external_id: string;
  matched_with?: {
    source: "rotaexata" | "auvo";
    id: string;
    dt_lancamento?: string;
    valor?: number;
    tipo_custo_nome?: string;
    placa?: string;
  };
  manual_placa?: boolean;
  attachment_url?: string | null;
  parse_status?: string;
  /** Conciliação manual: quando o admin amarra explicitamente os dois lados. */
  manual_reconciliation?: {
    id: string;
    motivo: string;
    other_valor: number;
    other_source: "rotaexata" | "auvo";
    other_external_id: string;
    other_descricao?: string;
    other_criado_por?: string;
    other_attachment_url?: string | null;
  };
  /**
   * Possível divergência de valor: a transação ficou sem par exato,
   * mas existe um lançamento "irmão" na outra fonte com mesma data
   * (±3 dias) e valor parecido. Provável erro humano (digitou valor
   * diferente no comprovante vs. no cartão).
   */
  suspected_divergence?: {
    other_source: "rotaexata" | "auvo";
    other_external_id: string;
    other_valor: number;
    diff: number; // r.valor - other.valor (sinal preserva quem é maior)
    diff_pct: number; // 0..1
    other_descricao?: string;
    other_criado_por?: string;
  };
};

function valueCents(v?: number) {
  return Math.round((Number(v) || 0) * 100);
}

function dayDiff(a: string, b: string) {
  const da = new Date(a.slice(0, 10) + "T00:00:00Z").getTime();
  const db = new Date(b.slice(0, 10) + "T00:00:00Z").getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Infinity;
  return Math.abs(da - db) / 86400000;
}

// Tolerância de data para considerar mesma transação (match exato OU divergência).
export const COST_RECONCILIATION_LOOKAROUND_DAYS = 3;
const MAX_DAY_DIFF = COST_RECONCILIATION_LOOKAROUND_DAYS;

// Faixa para considerar "possível divergência de valor":
//  - até R$ 50,00 OU até 20% do maior valor.
// Acima disso são transações distintas.
const DIVERGENCE_MAX_DIFF_BRL = 50;
const DIVERGENCE_MAX_DIFF_PCT = 0.20;

function normalizeName(n?: string): string {
  return (n ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/**
 * Retorna true se os nomes têm pelo menos um token de >=4 letras em comum
 * (ex.: "Denilson Melo de Sousa" vs "Denilson Melo" → match).
 */
function namesLikelyMatch(a?: string, b?: string): boolean {
  const ta = new Set(normalizeName(a).split(" ").filter((w) => w.length >= 4));
  const tb = new Set(normalizeName(b).split(" ").filter((w) => w.length >= 4));
  if (!ta.size || !tb.size) return false;
  for (const w of ta) if (tb.has(w)) return true;
  return false;
}

function matchedWithFrom(c: CustoRotaExata | AuvoCusto, source: "rotaexata" | "auvo"): NonNullable<MergedCusto["matched_with"]> {
  return {
    source,
    id: c.id,
    dt_lancamento: c.dt_lancamento,
    valor: Number(c.valor) || 0,
    tipo_custo_nome: c.tipo_custo_nome,
    placa: c.placa,
  };
}

function parseMergedDate(value?: string): number {
  if (!value) return Number.NaN;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return new Date(normalized).getTime();
}

export function isMergedCustoInDateRange(custo: MergedCusto, start: Date, end: Date): boolean {
  const startTime = start.getTime();
  const endTime = end.getTime();
  return [custo.dt_lancamento, custo.matched_with?.dt_lancamento].some((date) => {
    const time = parseMergedDate(date);
    return Number.isFinite(time) && time >= startTime && time <= endTime;
  });
}

/**
 * Mescla custos do Rota Exata com despesas do Auvo:
 * - Mesma data (±3 dias) + mesmo valor exato (centavos) = mesma transação.
 * - Sobras: tenta detectar "possível divergência de valor" entre Rota e Auvo
 *   quando há um lançamento muito parecido na outra fonte (mesma pessoa,
 *   mesma data, valores próximos).
 */
export function mergeCustos(
  rota: CustoRotaExata[],
  auvo: AuvoCusto[],
  overrides: CostPlacaOverride[] = [],
  manualReconciliations: ManualReconciliation[] = [],
  unmatchBlocks: UnmatchBlock[] = [],
): MergedCusto[] {
  const overrideMap = new Map<string, CostPlacaOverride>();
  overrides.forEach((o) => overrideMap.set(`${o.source}:${o.external_id}`, o));

  // Pares bloqueados (nunca reconciliar automaticamente).
  const blockedPairs = new Set<string>();
  unmatchBlocks.forEach((b) => blockedPairs.add(`${b.rota_external_id}::${b.auvo_external_id}`));
  const isBlocked = (rotaId: string, auvoId: string) => blockedPairs.has(`${rotaId}::${auvoId}`);

  // --- 0. CONCILIAÇÕES MANUAIS — sempre prevalecem sobre o algoritmo ---
  const auvoById = new Map<string, AuvoCusto>();
  auvo.forEach((a) => auvoById.set(a.id, a));
  const rotaById = new Map<string, CustoRotaExata>();
  rota.forEach((r) => rotaById.set(r.id, r));

  const manualByRota = new Map<string, { auvo: AuvoCusto | null; rec: ManualReconciliation }>();
  const manualByAuvo = new Map<string, { rota: CustoRotaExata | null; rec: ManualReconciliation }>();
  manualReconciliations.forEach((rec) => {
    // Se esse par manual está bloqueado, ignora.
    if (isBlocked(rec.rota_external_id, rec.auvo_external_id)) return;
    const r = rotaById.get(rec.rota_external_id);
    const a = auvoById.get(rec.auvo_external_id);
    if (r) manualByRota.set(r.id, { auvo: a ?? null, rec });
    if (a) manualByAuvo.set(a.id, { rota: r ?? null, rec });
  });


  // --- 1. MATCH EXATO POR VALOR + DATA TOLERANTE ---
  const auvoByValue = new Map<number, AuvoCusto[]>();
  auvo.forEach((a) => {
    const cents = valueCents(a.valor);
    if (!cents) return;
    const arr = auvoByValue.get(cents) ?? [];
    arr.push(a);
    auvoByValue.set(cents, arr);
  });

  const consumedAuvoIds = new Set<string>();
  const matchedRota = new Map<string, AuvoCusto>(); // rota.id → auvo

  rota.forEach((r) => {
    if (manualByRota.has(r.id)) return;
    const cents = valueCents(r.valor);
    const candidates = (auvoByValue.get(cents) ?? []).filter(
      (c) =>
        !consumedAuvoIds.has(c.id) &&
        !manualByAuvo.has(c.id) &&
        !isBlocked(r.id, c.id),
    );
    if (!candidates.length || !r.dt_lancamento) return;

    const pr = normalizePlaca(r.placa);

    let bestDiff = Infinity;
    let best: AuvoCusto | undefined;
    let bestPlacaMatch = false;
    for (const c of candidates) {
      const diff = dayDiff(r.dt_lancamento, c.dt_lancamento ?? "");
      if (diff > MAX_DAY_DIFF) continue;
      const pc = normalizePlaca(c.placa);
      // Se ambos têm placa e são diferentes, NUNCA casa (evita roubar o
      // registro de outro veículo com mesmo valor/data).
      if (pr && pc && pr !== pc) continue;
      const placaMatch = !!(pr && pc && pr === pc);
      // Prefere candidato com placa igual; entre iguais, o mais próximo em data.
      if (placaMatch && !bestPlacaMatch) {
        bestPlacaMatch = true;
        bestDiff = diff;
        best = c;
      } else if (placaMatch === bestPlacaMatch && diff < bestDiff) {
        bestDiff = diff;
        best = c;
      }
    }
    if (best) {
      consumedAuvoIds.add(best.id);
      matchedRota.set(r.id, best);
    }
  });

  // --- 2. DETECÇÃO DE DIVERGÊNCIA (nas sobras) ---
  const unmatchedRota = rota.filter((r) => !matchedRota.has(r.id) && !manualByRota.has(r.id));
  const unmatchedAuvo = auvo.filter((a) => !consumedAuvoIds.has(a.id) && !manualByAuvo.has(a.id));

  // mapa rota.id → auvo "irmão" suspeito  e  auvo.id → rota "irmão" suspeito
  const divergenceForRota = new Map<string, AuvoCusto>();
  const divergenceForAuvo = new Map<string, CustoRotaExata>();
  const usedAuvoForDiv = new Set<string>();

  for (const r of unmatchedRota) {
    if (!r.dt_lancamento) continue;
    let best: AuvoCusto | undefined;
    let bestScore = Infinity;
    for (const a of unmatchedAuvo) {
      if (usedAuvoForDiv.has(a.id)) continue;
      if (!a.dt_lancamento) continue;
      const dDiff = dayDiff(r.dt_lancamento, a.dt_lancamento);
      if (dDiff > MAX_DAY_DIFF) continue;
      const vr = Number(r.valor) || 0;
      const va = Number(a.valor) || 0;
      const diffAbs = Math.abs(vr - va);
      const diffPct = diffAbs / Math.max(vr, va, 1);
      if (diffAbs > DIVERGENCE_MAX_DIFF_BRL && diffPct > DIVERGENCE_MAX_DIFF_PCT) continue;
      // EXIGIR PLACA IGUAL nos dois lados (quando ambos têm placa).
      // Evita falsos positivos onde só o nome+data+valor batem.
      const pr = normalizePlaca(r.placa);
      const pa = normalizePlaca(a.placa);
      if (pr && pa && pr !== pa) continue;
      // Se temos nomes nos dois lados, exigir compatibilidade.
      // Se um dos lados não tem nome, deixa passar (não bloqueia).
      if (r.criado_por_nome && a.criado_por_nome && !namesLikelyMatch(r.criado_por_nome, a.criado_por_nome)) {
        continue;
      }
      // Score: prioriza menor diferença de valor, depois menor diff de data.
      const score = diffPct * 1000 + dDiff;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (best) {
      divergenceForRota.set(r.id, best);
      divergenceForAuvo.set(best.id, r);
      usedAuvoForDiv.add(best.id);
    }
  }

  // --- 3. MONTAGEM DO RESULTADO ---
  const merged: MergedCusto[] = [];

  rota.forEach((r) => {
    const auvoMatch = matchedRota.get(r.id);
    const manual = manualByRota.get(r.id);
    const override = overrideMap.get(`rotaexata:${r.id}`);
    let placa = r.placa;
    let veiculo_descricao = r.veiculo_descricao;
    let attachment_url: string | null | undefined;
    let matched_with: MergedCusto["matched_with"];
    let suspected_divergence: MergedCusto["suspected_divergence"];
    let manual_reconciliation: MergedCusto["manual_reconciliation"];

    if (manual) {
      const a = manual.auvo;
      if (a?.placa) placa = a.placa;
      if (a?.veiculo_descricao) veiculo_descricao = a.veiculo_descricao;
      attachment_url = a?.attachment_url ?? null;
      matched_with = a ? matchedWithFrom(a, "auvo") : { source: "auvo", id: manual.rec.auvo_external_id };
      manual_reconciliation = {
        id: manual.rec.id,
        motivo: manual.rec.motivo,
        other_valor: a ? Number(a.valor) || 0 : 0,
        other_source: "auvo",
        other_external_id: manual.rec.auvo_external_id,
        other_descricao: a?.descricao ?? "(fora do intervalo do filtro)",
        other_criado_por: a?.criado_por_nome,
        other_attachment_url: a?.attachment_url ?? null,
      };
    } else if (auvoMatch) {
      if (auvoMatch.placa) placa = auvoMatch.placa;
      if (auvoMatch.veiculo_descricao) veiculo_descricao = auvoMatch.veiculo_descricao;
      attachment_url = auvoMatch.attachment_url ?? null;
      matched_with = matchedWithFrom(auvoMatch, "auvo");
    } else {
      const sibling = divergenceForRota.get(r.id);
      if (sibling) {
        if (sibling.placa && !placa) placa = sibling.placa;
        attachment_url = sibling.attachment_url ?? null;
        const vr = Number(r.valor) || 0;
        const va = Number(sibling.valor) || 0;
        suspected_divergence = {
          other_source: "auvo",
          other_external_id: sibling.id,
          other_valor: va,
          diff: vr - va,
          diff_pct: Math.abs(vr - va) / Math.max(vr, va, 1),
          other_descricao: sibling.descricao,
          other_criado_por: sibling.criado_por_nome,
        };
      }
    }

    if (override) placa = override.placa;

    merged.push({
      ...r,
      placa,
      veiculo_descricao,
      source: "rotaexata",
      external_id: r.id,
      matched_with,
      manual_placa: !!override,
      attachment_url,
      suspected_divergence,
      manual_reconciliation,
    });
  });

  auvo.forEach((a) => {
    if (consumedAuvoIds.has(a.id)) return;
    const manual = manualByAuvo.get(a.id);
    // Se há conciliação manual E o lado Rota está carregado, ele já representa
    // a linha (skip). Se Rota está fora do filtro, renderiza a linha do Auvo
    // marcada como conciliada.
    if (manual && manual.rota) return;

    const override = overrideMap.get(`auvo:${a.id}`);
    const placa = override ? override.placa : a.placa;
    let suspected_divergence: MergedCusto["suspected_divergence"];
    let manual_reconciliation: MergedCusto["manual_reconciliation"];
    let matched_with: MergedCusto["matched_with"];

    if (manual) {
      matched_with = manual.rota
        ? matchedWithFrom(manual.rota, "rotaexata")
        : { source: "rotaexata", id: manual.rec.rota_external_id };
      manual_reconciliation = {
        id: manual.rec.id,
        motivo: manual.rec.motivo,
        other_valor: 0,
        other_source: "rotaexata",
        other_external_id: manual.rec.rota_external_id,
        other_descricao: "(fora do intervalo do filtro)",
      };
    } else {
      const sibling = divergenceForAuvo.get(a.id);
      if (sibling) {
        const va = Number(a.valor) || 0;
        const vr = Number(sibling.valor) || 0;
        suspected_divergence = {
          other_source: "rotaexata",
          other_external_id: sibling.id,
          other_valor: vr,
          diff: va - vr,
          diff_pct: Math.abs(va - vr) / Math.max(va, vr, 1),
          other_descricao: sibling.descricao,
          other_criado_por: sibling.criado_por_nome,
        };
      }
    }
    merged.push({
      ...a,
      placa,
      source: "auvo",
      external_id: a.id,
      manual_placa: !!override,
      matched_with,
      suspected_divergence,
      manual_reconciliation,
    });
  });

  merged.sort((a, b) => (b.dt_lancamento ?? "").localeCompare(a.dt_lancamento ?? ""));
  return merged;
}

export function isCustoSemPlaca(c: MergedCusto) {
  return !normalizePlaca(c.placa);
}
