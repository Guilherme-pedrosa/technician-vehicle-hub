import { normalizePlaca } from "@/lib/excluded-vehicles";
import type { CustoRotaExata } from "@/hooks/useCustosFlota";
import type { AuvoCusto } from "@/hooks/useAuvoExpenses";
import type { CostPlacaOverride } from "@/hooks/useCostPlacaOverrides";

export type MergedCusto = (CustoRotaExata | AuvoCusto) & {
  source: "rotaexata" | "auvo";
  external_id: string;
  matched_with?: { source: "rotaexata" | "auvo"; id: string };
  manual_placa?: boolean;
  attachment_url?: string | null;
  parse_status?: string;
};

function dateKey(iso?: string) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function valueCents(v?: number) {
  return Math.round((Number(v) || 0) * 100);
}

/**
 * Mescla custos do Rota Exata com despesas do Auvo:
 * - Mesma data + mesmo valor (centavos) = mesma transação.
 * - Rota traz litros/hodômetro; Auvo traz placa/comprovante.
 * - Aplica overrides manuais de placa por cima.
 */
export function mergeCustos(
  rota: CustoRotaExata[],
  auvo: AuvoCusto[],
  overrides: CostPlacaOverride[] = [],
): MergedCusto[] {
  const overrideMap = new Map<string, CostPlacaOverride>();
  overrides.forEach((o) => overrideMap.set(`${o.source}:${o.external_id}`, o));

  // Index Auvo por (data, valor) para casamento rápido.
  const auvoByKey = new Map<string, AuvoCusto[]>();
  auvo.forEach((a) => {
    const key = `${dateKey(a.dt_lancamento)}|${valueCents(a.valor)}`;
    const arr = auvoByKey.get(key) ?? [];
    arr.push(a);
    auvoByKey.set(key, arr);
  });

  const consumedAuvoIds = new Set<string>();
  const merged: MergedCusto[] = [];

  // Percorre Rota Exata, tentando casar com Auvo
  rota.forEach((r) => {
    const key = `${dateKey(r.dt_lancamento)}|${valueCents(r.valor)}`;
    const candidates = auvoByKey.get(key) ?? [];
    const auvoMatch = candidates.find((c) => !consumedAuvoIds.has(c.id));

    const override = overrideMap.get(`rotaexata:${r.id}`);
    let placa = r.placa;
    let veiculo_descricao = r.veiculo_descricao;
    let attachment_url: string | null | undefined;
    let matched_with: MergedCusto["matched_with"];

    if (auvoMatch) {
      consumedAuvoIds.add(auvoMatch.id);
      // Auvo é fonte de verdade pra PLACA (vem do comprovante).
      // O Rota Exata pode ter placa errada cadastrada (ex: Strada, Cobalt),
      // por isso quando há match com Auvo, a placa do Auvo prevalece.
      if (auvoMatch.placa) placa = auvoMatch.placa;
      if (auvoMatch.veiculo_descricao) {
        veiculo_descricao = auvoMatch.veiculo_descricao;
      }
      attachment_url = auvoMatch.attachment_url ?? null;
      matched_with = { source: "auvo", id: auvoMatch.id };
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
    });
  });

  // Auvo restantes (sem match no Rota)
  auvo.forEach((a) => {
    if (consumedAuvoIds.has(a.id)) return;
    const override = overrideMap.get(`auvo:${a.id}`);
    const placa = override ? override.placa : a.placa;
    merged.push({
      ...a,
      placa,
      source: "auvo",
      external_id: a.id,
      manual_placa: !!override,
    });
  });

  // Ordena por data desc
  merged.sort((a, b) => (b.dt_lancamento ?? "").localeCompare(a.dt_lancamento ?? ""));
  return merged;
}

export function isCustoSemPlaca(c: MergedCusto) {
  return !normalizePlaca(c.placa);
}
