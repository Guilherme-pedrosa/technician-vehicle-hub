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

  // Index Auvo por VALOR (centavos) — buscamos por valor exato e tolerância de data.
  const auvoByValue = new Map<number, AuvoCusto[]>();
  auvo.forEach((a) => {
    const cents = valueCents(a.valor);
    if (!cents) return;
    const arr = auvoByValue.get(cents) ?? [];
    arr.push(a);
    auvoByValue.set(cents, arr);
  });

  const consumedAuvoIds = new Set<string>();
  const merged: MergedCusto[] = [];

  // Tolerância: até 3 dias de diferença entre lançamento Rota e Auvo
  // (atrasos comuns: comprovante anexado depois, fuso, lançamento manual).
  const MAX_DAY_DIFF = 3;

  function dayDiff(a: string, b: string) {
    const da = new Date(a.slice(0, 10) + "T00:00:00Z").getTime();
    const db = new Date(b.slice(0, 10) + "T00:00:00Z").getTime();
    if (!Number.isFinite(da) || !Number.isFinite(db)) return Infinity;
    return Math.abs(da - db) / 86400000;
  }

  // Percorre Rota Exata, tentando casar com Auvo (mesmo valor, data próxima)
  rota.forEach((r) => {
    const cents = valueCents(r.valor);
    const candidates = (auvoByValue.get(cents) ?? []).filter((c) => !consumedAuvoIds.has(c.id));
    let auvoMatch: AuvoCusto | undefined;
    if (candidates.length && r.dt_lancamento) {
      let bestDiff = Infinity;
      for (const c of candidates) {
        const diff = dayDiff(r.dt_lancamento, c.dt_lancamento ?? "");
        if (diff < bestDiff && diff <= MAX_DAY_DIFF) {
          bestDiff = diff;
          auvoMatch = c;
        }
      }
    }

    const override = overrideMap.get(`rotaexata:${r.id}`);
    let placa = r.placa;
    let veiculo_descricao = r.veiculo_descricao;
    let attachment_url: string | null | undefined;
    let matched_with: MergedCusto["matched_with"];

    if (auvoMatch) {
      consumedAuvoIds.add(auvoMatch.id);
      // Auvo é fonte de verdade pra PLACA (vem do comprovante).
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
