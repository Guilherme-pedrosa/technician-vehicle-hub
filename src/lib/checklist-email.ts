// ═══════════════════════════════════════════════════════════════
// RESERVA DE E-MAIL — especificação pura da idempotência
// ───────────────────────────────────────────────────────────────
// A decisão real acontece dentro da função SQL transacional
// public.reserve_email_send (SELECT ... FOR UPDATE). Este módulo é a
// MESMA regra em forma pura/testável, usada como contrato de referência.
// ═══════════════════════════════════════════════════════════════

export const EMAIL_RESERVATION_STALE_MS = 10 * 60 * 1000;

export type EmailLogRow = {
  id?: string;
  status: "sent" | "pending" | "failed" | string;
  attempted_at?: string | null;
  created_at?: string | null;
} | null | undefined;

export type EmailReservationDecision = "reserved" | "already_sent" | "in_flight" | "retry";

/**
 * - sem linha            → reserva nova
 * - sent                 → nunca reenviar
 * - pending recente      → outra execução está no ar
 * - pending obsoleto     → crash: nova tentativa atômica na MESMA linha
 * - failed               → nova tentativa
 */
export function decideEmailReservation(params: {
  existing: EmailLogRow;
  now?: number;
  staleAfterMs?: number;
}): EmailReservationDecision {
  const { existing } = params;
  if (!existing) return "reserved";

  const now = params.now ?? Date.now();
  const staleAfter = params.staleAfterMs ?? EMAIL_RESERVATION_STALE_MS;

  if (existing.status === "sent") return "already_sent";

  if (existing.status === "pending") {
    const ts = Date.parse(existing.attempted_at ?? existing.created_at ?? "");
    const age = Number.isFinite(ts) ? now - ts : Number.POSITIVE_INFINITY;
    return age <= staleAfter ? "in_flight" : "retry";
  }

  // failed ou qualquer estado terminal não-sent
  return "retry";
}

/**
 * Chave de deduplicação SEMPRE gerada no servidor.
 * O cliente só pode influenciar um discriminador curto e sanitizado —
 * nunca a chave global.
 */
export function buildServerDedupeKey(params: {
  eventType: string;
  checklistId?: string | null;
  recipient: string;
  discriminator?: unknown;
}): string {
  const clean = (v: unknown, max: number) =>
    String(v ?? "")
      .trim()
      .replace(/[|\s]+/g, "_")
      .slice(0, max);

  const eventType = clean(params.eventType, 32) || "nc";
  const checklistId = clean(params.checklistId, 64) || "sem-checklist";
  const recipient = clean(params.recipient, 160).toLowerCase();
  const disc = clean(params.discriminator, 40);

  return `${eventType}|${checklistId}|${recipient}${disc ? `|${disc}` : ""}`;
}

/**
 * Erro de banco só é "deduplicação" quando é violação de unicidade (23505).
 * Qualquer outro erro é FALHA e precisa devolver não-2xx.
 */
export function isDuplicateReservationError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}
