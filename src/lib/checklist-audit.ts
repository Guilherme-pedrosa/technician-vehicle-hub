// ═══════════════════════════════════════════════════════════════
// AUDITORIA DE IA DO CHECKLIST — helpers puros (testáveis)
// ───────────────────────────────────────────────────────────────
// Regra soberana: nenhum status de IA bloqueia o técnico.
// ═══════════════════════════════════════════════════════════════

export type AuditStatus =
  | "forced"
  | "pending_at_submit"
  | "ai_error"
  | "invalid"
  | "km_not_confirmed"
  | "interior_incomplete"
  | "km_divergence";

export type AuditSeverity = "critical" | "warning" | "info";

/** Categorias críticas conforme contrato (painel/KM, pneus, óleo, água, etiqueta, segurança). */
export const CRITICAL_AUDIT_CATEGORIES = new Set<string>([
  "painel",
  "pneu_de",
  "pneu_dd",
  "pneu_te",
  "pneu_td",
  "estepe",
  "calibracao_de",
  "calibracao_dd",
  "calibracao_te",
  "calibracao_td",
  "nivel_oleo",
  "reservatorio_agua",
  "etiqueta_oleo",
  "itens_seguranca",
]);

export function auditSeverityFor(category: string, status: AuditStatus | string): AuditSeverity {
  // Painel/KM não confirmado é sempre crítico.
  if (status === "km_not_confirmed") return "critical";
  // IA pendente, erro de IA e interior incompleto são warning por contrato,
  // salvo quando a categoria é crítica e a foto foi forçada/reprovada.
  if (status === "pending_at_submit" || status === "ai_error" || status === "interior_incomplete") {
    return "warning";
  }
  if (status === "forced" || status === "invalid") {
    return CRITICAL_AUDIT_CATEGORIES.has(category) ? "critical" : "warning";
  }
  if (status === "km_divergence") return "warning";
  return "warning";
}

/** A IA nunca bloqueia: helper explícito usado pelo wizard e pelos testes. */
export function auditStatusBlocksTechnician(_status: AuditStatus | string): boolean {
  return false;
}

/**
 * Chave estável de idempotência de evento. O banco também recalcula/garante
 * unicidade — o cliente apenas coopera para evitar duplicatas óbvias.
 */
export function buildAuditEventKey(params: {
  checklistId: string;
  categoria: string;
  photoIndex?: number | null;
  status: AuditStatus | string;
}): string {
  const idx =
    typeof params.photoIndex === "number" && Number.isFinite(params.photoIndex)
      ? String(params.photoIndex)
      : "na";
  return `${params.checklistId}|${params.categoria}|${idx}|${params.status}`;
}

/** Deduplica eventos pela event_key preservando o primeiro ocorrido. */
export function dedupeAuditEvents<T extends { event_key?: string | null }>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    const key = e.event_key ?? "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * Restauração honesta de rascunho: uma foto persistida SEM metadado de
 * validação nunca pode virar "valid". Vira "idle" (pendente de revalidação).
 */
export function restoredPhotoStatus(
  persisted?: { status?: string | null } | null,
): "idle" | "valid" | "invalid" | "forced" | "validating" {
  const status = persisted?.status;
  if (status === "valid" || status === "invalid" || status === "forced" || status === "validating") {
    return status;
  }
  return "idle";
}

/** Prioridade da fila administrativa: críticos → pendentes → erros → forçados → KM → cobertura. */
export const AUDIT_QUEUE_PRIORITY: Record<string, number> = {
  km_not_confirmed: 0,
  forced: 1,
  invalid: 2,
  ai_error: 3,
  pending_at_submit: 4,
  km_divergence: 5,
  interior_incomplete: 6,
};

export function compareAuditQueue(
  a: { severity?: string | null; status: string; created_at?: string | null },
  b: { severity?: string | null; status: string; created_at?: string | null },
): number {
  const sev = (s?: string | null) => (s === "critical" ? 0 : s === "warning" ? 1 : 2);
  if (sev(a.severity) !== sev(b.severity)) return sev(a.severity) - sev(b.severity);
  const pa = AUDIT_QUEUE_PRIORITY[a.status] ?? 9;
  const pb = AUDIT_QUEUE_PRIORITY[b.status] ?? 9;
  if (pa !== pb) return pa - pb;
  return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
}

/** Conta reincidência por (usuário, categoria, status) para a fila administrativa. */
export function countRecurrences<
  T extends { user_id?: string | null; categoria: string; status: string },
>(events: T[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events) {
    const key = `${e.user_id ?? "?"}|${e.categoria}|${e.status}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** Indicadores com denominadores corretos. */
export function computeAuditIndicators(params: {
  finalizados: number;
  events: Array<{ checklist_id: string; severity?: string | null; status: string; resolved_at?: string | null }>;
}) {
  const { finalizados, events } = params;
  const byChecklist = new Map<string, { critical: boolean; pending: boolean; analyzed: boolean }>();
  for (const e of events) {
    const cur = byChecklist.get(e.checklist_id) ?? { critical: false, pending: false, analyzed: true };
    cur.critical = cur.critical || e.severity === "critical";
    cur.pending = cur.pending || e.status === "pending_at_submit" || e.status === "ai_error";
    cur.analyzed = cur.analyzed && Boolean(e.resolved_at);
    byChecklist.set(e.checklist_id, cur);
  }
  const comAlerta = byChecklist.size;
  const criticos = Array.from(byChecklist.values()).filter((v) => v.critical).length;
  const pendentes = Array.from(byChecklist.values()).filter((v) => v.pending).length;
  const analisados = Array.from(byChecklist.values()).filter((v) => v.analyzed).length;
  const pct = (n: number) => (finalizados > 0 ? Math.round((n / finalizados) * 1000) / 10 : 0);
  return {
    finalizados,
    comAlerta,
    criticos,
    pendentes,
    analisados,
    pctComAlerta: pct(comAlerta),
    pctCriticos: pct(criticos),
  };
}
