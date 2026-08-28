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

/**
 * Códigos estáveis por TIPO de pendência. Entram na event_key (junto com o
 * servidor) para que duas pendências diferentes da MESMA categoria sem foto
 * não colidam (ex.: "etiqueta ausente" × "KM da próxima troca ausente").
 */
export const AUDIT_EVENT_CODES = {
  PHOTO_NO_OPINION: "photo_sem_parecer",
  PHOTO_VALIDATING: "photo_validando",
  PHOTO_AI_ERROR: "photo_erro_ia",
  PHOTO_FORCED: "photo_forcada",
  PHOTO_INVALID: "photo_reprovada",
  PANEL_KM_NOT_CONFIRMED: "painel_km_nao_confirmado",
  INTERIOR_COVERAGE: "interior_cobertura",
  ANSWER_MISSING: "resposta_faltante",
  OBSERVATION_MISSING: "observacao_faltante",
  PHOTO_MISSING: "evidencia_faltante",
  UPLOAD_PENDING: "upload_pendente",
  UPLOAD_ERROR: "upload_erro",
  KM_PANEL_MISSING: "km_painel_ausente",
  KM_NEXT_OIL_MISSING: "km_proxima_troca_ausente",
  KM_NEXT_OIL_RANGE: "km_proxima_troca_intervalo",
  TERM_NOT_ACCEPTED: "termo_nao_aceito",
  RESULT_WITHOUT_REASON: "resultado_sem_motivo",
  DAMAGE_NO_DESCRIPTION: "avaria_sem_descricao",
  DAMAGE_NO_PHOTO: "avaria_sem_foto",
  KM_DIVERGENCE: "km_divergencia_manual",
} as const;

export type AuditEventCode = (typeof AUDIT_EVENT_CODES)[keyof typeof AUDIT_EVENT_CODES];

/**
 * Códigos que representam EVIDÊNCIA CRÍTICA ausente/não confirmada.
 * Contrato: isso é `critical`, mesmo que o status seja "pending_at_submit".
 * Indisponibilidade da IA (pending/erro) continua `warning`.
 */
const MISSING_CRITICAL_EVIDENCE_CODES = new Set<string>([
  AUDIT_EVENT_CODES.ANSWER_MISSING,
  AUDIT_EVENT_CODES.OBSERVATION_MISSING,
  AUDIT_EVENT_CODES.PHOTO_MISSING,
  AUDIT_EVENT_CODES.UPLOAD_ERROR,
  AUDIT_EVENT_CODES.KM_PANEL_MISSING,
  AUDIT_EVENT_CODES.KM_NEXT_OIL_MISSING,
]);

export function auditSeverityFor(
  category: string,
  status: AuditStatus | string,
  opts?: { eventCode?: string | null; criticalCategory?: boolean },
): AuditSeverity {
  const isCriticalCategory =
    opts?.criticalCategory === true || CRITICAL_AUDIT_CATEGORIES.has(category);

  // Painel/KM não confirmado é sempre crítico.
  if (status === "km_not_confirmed") return "critical";

  // Evidência crítica AUSENTE (não é indisponibilidade da IA) → critical.
  if (opts?.eventCode && MISSING_CRITICAL_EVIDENCE_CODES.has(opts.eventCode)) {
    return isCriticalCategory ? "critical" : "warning";
  }

  // IA pendente, erro de IA e interior incompleto são warning por contrato.
  if (status === "pending_at_submit" || status === "ai_error" || status === "interior_incomplete") {
    return "warning";
  }
  if (status === "forced" || status === "invalid") {
    return isCriticalCategory ? "critical" : "warning";
  }
  if (status === "km_divergence") return "warning";
  return "warning";
}

/** A IA nunca bloqueia: helper explícito usado pelo wizard e pelos testes. */
export function auditStatusBlocksTechnician(_status: AuditStatus | string): boolean {
  return false;
}

/**
 * Chave estável de idempotência de evento. Inclui o `eventCode` para que
 * pendências distintas na mesma categoria/índice/status não se sobreponham.
 * O banco recalcula a mesma fórmula no trigger.
 */
export function buildAuditEventKey(params: {
  checklistId: string;
  categoria: string;
  photoIndex?: number | null;
  status: AuditStatus | string;
  eventCode?: string | null;
}): string {
  const idx =
    typeof params.photoIndex === "number" && Number.isFinite(params.photoIndex)
      ? String(params.photoIndex)
      : "na";
  const code = (params.eventCode ?? "").trim() || "generico";
  return `${params.checklistId}|${params.categoria}|${idx}|${params.status}|${code}`;
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
