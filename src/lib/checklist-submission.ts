// ═══════════════════════════════════════════════════════════════
// SUBMISSÃO DO CHECKLIST — helpers puros e testáveis
// ───────────────────────────────────────────────────────────────
// Regra soberana do contrato: NADA além de "sem veículo" ou
// "sem técnico responsável" impede finalizar o formulário.
// Toda incompletude vira PENDÊNCIA + evento de auditoria.
// E NUNCA inventamos "conforme/ok" para resposta ausente.
// ═══════════════════════════════════════════════════════════════

import {
  AUDIT_EVENT_CODES,
  auditSeverityFor,
  type AuditStatus,
  type AuditSeverity,
} from "./checklist-audit";

export type PhotoValidationLike = {
  status: "idle" | "validating" | "valid" | "invalid" | "forced" | string;
  result?: {
    reason?: string;
    reject_code?: string | null;
    confidence?: number;
    model_used?: string;
    prompt_version?: string;
    validation_duration_ms?: number;
    ai_error?: boolean;
    valid?: boolean;
    km_legivel?: boolean;
    km_auto_update_allowed?: boolean;
    km_painel_nao_confirmado?: boolean;
    detected_elements?: string[];
  } | null;
};

export type PhotoUploadLike = {
  status?: string;
  uploadedUrl?: string;
  storagePath?: string;
} | null | undefined;

export type SubmissionAuditEvent = {
  categoria: string;
  label: string;
  status: AuditStatus;
  severity: AuditSeverity;
  /** Código estável do TIPO de pendência — entra na event_key. */
  event_code: string;
  motivo: string;
  reason?: string;
  reject_code?: string | null;
  confidence?: number;
  model_used?: string;
  prompt_version?: string;
  validation_duration_ms?: number;
  photo_url?: string;
  photo_index?: number;
  /** Só preenchido quando o status é realmente "forced" (o trigger também garante). */
  forced_by?: string;
  forced_at?: string;
  audit_required: true;
};

export type Pendencia = { codigo: string; mensagem: string };

function severity(
  category: string,
  status: AuditStatus,
  opts?: { eventCode?: string; criticalCategory?: boolean },
): AuditSeverity {
  return auditSeverityFor(category, status, opts);
}

/**
 * URL da foto no MESMO índice do slot. Nunca usa uma lista filtrada
 * (isso deslocaria a URL quando um índice anterior falhou no upload).
 */
export function photoUrlForSlot(
  uploads: PhotoUploadLike[] | undefined,
  urls: string[] | undefined,
  index: number,
): string | undefined {
  const fromUpload = uploads?.[index]?.uploadedUrl;
  if (fromUpload) return fromUpload;
  // Fallback seguro: só usa a lista persistida quando ela tem o MESMO
  // comprimento dos slots (senão o índice não é comparável).
  if (urls && uploads && urls.length === uploads.length) return urls[index];
  if (urls && !uploads) return urls[index];
  return undefined;
}

/** Categorias presentes em QUALQUER uma das fontes (arquivos, uploads, URLs, validações). */
export function collectPhotoCategories(
  ...maps: Array<Record<string, unknown[]> | null | undefined>
): string[] {
  const set = new Set<string>();
  maps.forEach((map) => {
    Object.entries(map ?? {}).forEach(([cat, list]) => {
      if (Array.isArray(list) && list.length > 0) set.add(cat);
    });
  });
  return Array.from(set);
}

/** Maior comprimento entre as fontes — nunca perde foto restaurada de rascunho. */
export function photoSlotCount(
  ...lists: Array<{ length: number } | null | undefined>
): number {
  return lists.reduce<number>((max, list) => Math.max(max, list?.length ?? 0), 0);
}

export type BuildAuditInput = {
  /** Arquivos capturados nesta sessão (pode estar vazio em rascunho restaurado). */
  photos?: Record<string, unknown[]>;
  /** Estados de upload (pode conter URLs restauradas). */
  photoUploads?: Record<string, PhotoUploadLike[]>;
  /** URLs já persistidas no banco/storage. */
  fotosUrls?: Record<string, string[]>;
  validations?: Record<string, PhotoValidationLike[]>;
  userId: string;
  labelFor?: (category: string) => string;
  /** Cobertura do interior já avaliada (advisória). */
  interiorCoverage?: { ok: boolean; missing: string[] } | null;
};

/**
 * Constrói a trilha de auditoria iterando a UNIÃO das fontes.
 * Persistimos invalid, forced, ai_error, validating→pending_at_submit e
 * foto sem parecer (idle/ausente) → pending_at_submit.
 */
export function buildAuditEvents(input: BuildAuditInput): {
  auditEvents: SubmissionAuditEvent[];
  kmPainelNaoConfirmado: boolean;
} {
  const labelFor = input.labelFor ?? ((c: string) => c);
  const events: SubmissionAuditEvent[] = [];
  let kmPainelNaoConfirmado = false;
  const nowIso = new Date().toISOString();

  const categories = collectPhotoCategories(
    input.photos,
    input.photoUploads as Record<string, unknown[]> | undefined,
    input.fotosUrls,
    input.validations,
  );

  for (const category of categories) {
    const files = input.photos?.[category] ?? [];
    const uploads = input.photoUploads?.[category] ?? [];
    const urls = input.fotosUrls?.[category] ?? [];
    const validations = input.validations?.[category] ?? [];
    const label = labelFor(category);
    const total = photoSlotCount(files, uploads, urls, validations);

    for (let idx = 0; idx < total; idx++) {
      const v = validations[idx];
      const photo_url = photoUrlForSlot(uploads, urls, idx);
      const baseMeta = {
        reason: v?.result?.reason,
        reject_code: v?.result?.reject_code ?? null,
        confidence: v?.result?.confidence,
        model_used: v?.result?.model_used,
        prompt_version: v?.result?.prompt_version,
        validation_duration_ms: v?.result?.validation_duration_ms,
        photo_url,
        photo_index: idx,
        audit_required: true as const,
      };

      // Foto existe mas não há parecer de IA registrado → pendência honesta.
      if (!v || v.status === "idle") {
        events.push({
          ...baseMeta,
          categoria: category,
          label,
          status: "pending_at_submit",
          event_code: AUDIT_EVENT_CODES.PHOTO_NO_OPINION,
          severity: severity(category, "pending_at_submit", {
            eventCode: AUDIT_EVENT_CODES.PHOTO_NO_OPINION,
          }),
          motivo: "Foto sem parecer de IA registrado — enviada para análise posterior",
        });
        continue;
      }

      if (v.status === "validating") {
        events.push({
          ...baseMeta,
          categoria: category,
          label,
          status: "pending_at_submit",
          event_code: AUDIT_EVENT_CODES.PHOTO_VALIDATING,
          severity: severity(category, "pending_at_submit", {
            eventCode: AUDIT_EVENT_CODES.PHOTO_VALIDATING,
          }),
          motivo: "Checklist salvo antes da conclusão da validação por IA",
        });
        continue;
      }

      if (v.result?.ai_error) {
        events.push({
          ...baseMeta,
          categoria: category,
          label,
          status: "ai_error",
          event_code: AUDIT_EVENT_CODES.PHOTO_AI_ERROR,
          severity: severity(category, "ai_error", { eventCode: AUDIT_EVENT_CODES.PHOTO_AI_ERROR }),
          motivo: v.result?.reason ?? "Falha na validação automática da IA",
        });
        continue;
      }

      if (v.status === "forced") {
        events.push({
          ...baseMeta,
          categoria: category,
          label,
          status: "forced",
          event_code: AUDIT_EVENT_CODES.PHOTO_FORCED,
          severity: severity(category, "forced", { eventCode: AUDIT_EVENT_CODES.PHOTO_FORCED }),
          motivo: v.result?.reason
            ? `Foto reprovada pela IA e usada mesmo assim: ${v.result.reason}`
            : "Foto reprovada pela IA e usada mesmo assim",
          forced_by: input.userId,
          forced_at: nowIso,
        });
      } else if (v.status === "invalid") {
        // Reprovação entra na fila mesmo sem o técnico clicar "usar mesmo assim".
        events.push({
          ...baseMeta,
          categoria: category,
          label,
          status: "invalid",
          event_code: AUDIT_EVENT_CODES.PHOTO_INVALID,
          severity: severity(category, "invalid", { eventCode: AUDIT_EVENT_CODES.PHOTO_INVALID }),
          motivo: v.result?.reason ?? "Foto reprovada pela IA",
        });
      }

      if (category === "painel" && (v.result?.km_painel_nao_confirmado || v.result?.km_legivel === false)) {
        kmPainelNaoConfirmado = true;
        events.push({
          ...baseMeta,
          categoria: category,
          label,
          status: "km_not_confirmed",
          event_code: AUDIT_EVENT_CODES.PANEL_KM_NOT_CONFIRMED,
          severity: severity(category, "km_not_confirmed"),
          motivo: "KM do hodômetro não confirmado pela IA — verificar valor manual digitado",
        });
      }
    }
  }

  const cov = input.interiorCoverage;
  if (cov && !cov.ok && cov.missing.length > 0) {
    events.push({
      categoria: "interior",
      label: labelFor("interior"),
      status: "interior_incomplete",
      event_code: AUDIT_EVENT_CODES.INTERIOR_COVERAGE,
      severity: severity("interior", "interior_incomplete"),
      motivo: `Cobertura parcial do interior. Faltam: ${cov.missing.join(", ")}`,
      audit_required: true,
    });
  }

  return { auditEvents: events, kmPainelNaoConfirmado };
}

export type ValidationSummaryItem = { categoria: string; label: string; motivos: string[] };

/** Resumo de validações também pela união das fontes (inclui restauradas). */
export function summarizePhotoValidations(input: {
  photos?: Record<string, unknown[]>;
  photoUploads?: Record<string, unknown[]>;
  fotosUrls?: Record<string, string[]>;
  validations?: Record<string, PhotoValidationLike[]>;
  labelFor?: (category: string) => string;
}) {
  const labelFor = input.labelFor ?? ((c: string) => c);
  const maps = {
    pending: new Map<string, ValidationSummaryItem>(),
    invalid: new Map<string, ValidationSummaryItem>(),
    forced: new Map<string, ValidationSummaryItem>(),
    errors: new Map<string, ValidationSummaryItem>(),
    naoAnalisadas: new Map<string, ValidationSummaryItem>(),
  };

  const ensure = (map: Map<string, ValidationSummaryItem>, category: string) => {
    if (!map.has(category)) map.set(category, { categoria: category, label: labelFor(category), motivos: [] });
    return map.get(category)!;
  };
  const push = (map: Map<string, ValidationSummaryItem>, category: string, motivo: string) => {
    const item = ensure(map, category);
    if (!item.motivos.includes(motivo)) item.motivos.push(motivo);
  };

  const categories = collectPhotoCategories(input.photos, input.photoUploads, input.fotosUrls, input.validations);

  for (const category of categories) {
    const total = photoSlotCount(
      input.photos?.[category],
      input.photoUploads?.[category],
      input.fotosUrls?.[category],
      input.validations?.[category],
    );
    for (let index = 0; index < total; index++) {
      const validation = input.validations?.[category]?.[index];

      if (!validation || validation.status === "idle") {
        // Contrato: nunca chamar de "OK" o que não foi analisado.
        push(maps.naoAnalisadas, category, "Não analisada pela IA");
        continue;
      }
      if (validation.status === "validating") {
        push(maps.pending, category, "Validação em andamento");
        continue;
      }
      if (validation.status === "forced") {
        push(maps.forced, category, validation.result?.reason ?? "Foto forçada pelo técnico");
        continue;
      }
      if (validation.result?.ai_error) {
        push(maps.errors, category, validation.result?.reason ?? "Falha na validação automática");
        continue;
      }
      if (validation.status === "invalid") {
        const painelAceitoKmNaoConfirmado =
          category === "painel" &&
          validation.result?.valid === true &&
          validation.result?.km_auto_update_allowed === false &&
          validation.result?.km_painel_nao_confirmado === true;
        if (painelAceitoKmNaoConfirmado) continue;
        push(maps.invalid, category, validation.result?.reason ?? "Foto reprovada pela IA");
      }
    }
  }

  const pending = Array.from(maps.pending.values());
  const invalid = Array.from(maps.invalid.values());
  const forced = Array.from(maps.forced.values());
  const errors = Array.from(maps.errors.values());
  const naoAnalisadas = Array.from(maps.naoAnalisadas.values());

  return {
    pending,
    invalid,
    forced,
    errors,
    naoAnalisadas,
    hasPending: pending.length > 0,
    hasBadPhotos: invalid.length > 0 || forced.length > 0 || errors.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// PAYLOAD HONESTO — resposta ausente vira NULL, nunca "conforme"
// ═══════════════════════════════════════════════════════════════

/**
 * Monta o payload das colunas operacionais SEMPRE com todas as chaves.
 * Resposta não preenchida vai explicitamente como `null` — isso impede
 * tanto o default do banco ("conforme"/"sim") quanto valor stale num
 * rascunho retomado.
 */
export function buildAnswerPayload(
  answers: Record<string, string | null | undefined>,
  dbFieldKeys: Iterable<string>,
): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  for (const key of dbFieldKeys) {
    const value = String(answers?.[key] ?? "").trim();
    payload[key] = value.length > 0 ? value : null;
  }
  return payload;
}

/**
 * Estado honesto da troca de óleo. Sem KM da próxima troca informado,
 * NUNCA devolve "ok" — devolve `null` ("Não informado").
 */
export function resolveTrocaOleoStatus(params: {
  kmProximaTrocaValido: boolean;
  vencida: boolean;
  quaseVencida: boolean;
  proxima: boolean;
}): "vencido" | "proximo" | "ok" | null {
  if (!params.kmProximaTrocaValido) return null;
  if (params.vencida || params.quaseVencida) return "vencido";
  if (params.proxima) return "proximo";
  return "ok";
}

export const RESULTADO_SEVERITY: Record<string, number> = {
  liberado: 0,
  liberado_obs: 1,
  bloqueado: 2,
};

/**
 * Resultado operacional final. Nunca termina em "liberado" silencioso quando
 * existe qualquer pendência: eleva para no mínimo "liberado_obs" (aguardando
 * análise). Um resultado mais grave já escolhido/sugerido é preservado.
 */
export function resolveOperationalResultado(params: {
  userChoice?: string | null;
  suggested?: string | null;
  hasPendencias: boolean;
}): { resultado: string; elevadoPorPendencia: boolean } {
  const sev = (v?: string | null) => RESULTADO_SEVERITY[v ?? ""] ?? -1;
  const user = params.userChoice || "";
  const suggested = params.suggested || "liberado";
  let resultado = sev(suggested) > sev(user) ? suggested : user || suggested;
  if (!RESULTADO_SEVERITY[resultado]) resultado = resultado || "liberado";

  if (params.hasPendencias && sev(resultado) < RESULTADO_SEVERITY.liberado_obs) {
    return { resultado: "liberado_obs", elevadoPorPendencia: true };
  }
  return { resultado, elevadoPorPendencia: false };
}

// ═══════════════════════════════════════════════════════════════
// PENDÊNCIAS DE PREENCHIMENTO
// ═══════════════════════════════════════════════════════════════

export type MissingAnswerRef = {
  key: string;
  label: string;
  /** Categoria de auditoria (default: a própria key). */
  categoria?: string;
  /** Item crítico do contrato (painel/KM, pneus, óleo, água, etiqueta, segurança). */
  critical?: boolean;
};

export type PendenciaInput = {
  missingAnswers: MissingAnswerRef[];
  missingObservations: MissingAnswerRef[];
  /** Categorias obrigatórias sem nenhuma evidência disponível. */
  missingPhotos: Array<{ categoria: string; label: string; critical?: boolean }>;
  uploadsPending: Array<{ categoria: string; label: string }>;
  uploadsError: Array<{ categoria: string; label: string }>;
  kmPainelInformado: boolean;
  kmPainelValido: boolean;
  kmProximaTrocaInformado: boolean;
  kmProximaTrocaValido: boolean;
  kmProximaTrocaForaDoIntervalo: boolean;
  termoAceito: boolean;
  resultadoExigeMotivo: boolean;
  resultadoMotivoInformado: boolean;
  avariaDeclarada: boolean;
  avariaDescricaoInformada: boolean;
  avariaEvidencia: boolean;
  labelFor?: (category: string) => string;
  userId?: string;
};

/**
 * Traduz incompletudes em pendências + eventos de auditoria.
 * NUNCA devolve "bloqueio": o formulário sempre pode ser salvo.
 */
export function buildChecklistPendencias(input: PendenciaInput): {
  pendencias: Pendencia[];
  auditEvents: SubmissionAuditEvent[];
} {
  const pendencias: Pendencia[] = [];
  const auditEvents: SubmissionAuditEvent[] = [];
  const labelFor = input.labelFor ?? ((c: string) => c);

  const addEvent = (
    categoria: string,
    label: string,
    status: AuditStatus,
    eventCode: string,
    motivo: string,
    criticalCategory?: boolean,
  ) => {
    auditEvents.push({
      categoria,
      label,
      status,
      event_code: eventCode,
      severity: severity(categoria, status, { eventCode, criticalCategory }),
      motivo,
      audit_required: true,
    });
  };

  for (const field of input.missingAnswers) {
    pendencias.push({ codigo: `resposta_faltante:${field.key}`, mensagem: `Resposta não preenchida: ${field.label}` });
    addEvent(
      field.categoria ?? field.key,
      field.label,
      "pending_at_submit",
      AUDIT_EVENT_CODES.ANSWER_MISSING,
      `Resposta não preenchida: ${field.label}`,
      field.critical,
    );
  }

  for (const field of input.missingObservations) {
    pendencias.push({
      codigo: `observacao_faltante:${field.key}`,
      mensagem: `Não conformidade sem observação: ${field.label}`,
    });
    addEvent(
      field.categoria ?? field.key,
      field.label,
      "pending_at_submit",
      AUDIT_EVENT_CODES.OBSERVATION_MISSING,
      `Não conformidade sem observação do técnico: ${field.label}`,
      field.critical,
    );
  }

  for (const photo of input.missingPhotos) {
    pendencias.push({
      codigo: `foto_faltante:${photo.categoria}`,
      mensagem: `Evidência obrigatória ausente: ${photo.label}`,
    });
    addEvent(
      photo.categoria,
      photo.label,
      "pending_at_submit",
      AUDIT_EVENT_CODES.PHOTO_MISSING,
      `Evidência obrigatória ausente: ${photo.label}`,
      photo.critical,
    );
  }

  for (const photo of input.uploadsPending) {
    pendencias.push({
      codigo: `upload_pendente:${photo.categoria}`,
      mensagem: `Upload não finalizado: ${photo.label}`,
    });
    addEvent(
      photo.categoria,
      photo.label,
      "pending_at_submit",
      AUDIT_EVENT_CODES.UPLOAD_PENDING,
      `Upload da foto ainda em andamento no envio: ${photo.label}`,
    );
  }

  for (const photo of input.uploadsError) {
    pendencias.push({ codigo: `upload_erro:${photo.categoria}`, mensagem: `Falha no envio da foto: ${photo.label}` });
    addEvent(
      photo.categoria,
      photo.label,
      "pending_at_submit",
      AUDIT_EVENT_CODES.UPLOAD_ERROR,
      `Falha no upload da foto: ${photo.label}`,
    );
  }

  if (!input.kmPainelInformado || !input.kmPainelValido) {
    const motivo = input.kmPainelInformado
      ? "KM do painel digitado é inválido — não confirmado"
      : "KM do painel não informado pelo técnico";
    pendencias.push({ codigo: "km_painel", mensagem: motivo });
    addEvent("painel", labelFor("painel"), "km_not_confirmed", AUDIT_EVENT_CODES.KM_PANEL_MISSING, motivo);
  }

  if (!input.kmProximaTrocaInformado || !input.kmProximaTrocaValido) {
    const motivo = input.kmProximaTrocaInformado
      ? "KM da próxima troca de óleo inválido"
      : "KM da próxima troca de óleo não informado";
    pendencias.push({ codigo: "km_proxima_troca", mensagem: motivo });
    addEvent(
      "etiqueta_oleo",
      labelFor("etiqueta_oleo"),
      "pending_at_submit",
      AUDIT_EVENT_CODES.KM_NEXT_OIL_MISSING,
      motivo,
    );
  } else if (input.kmProximaTrocaForaDoIntervalo) {
    const motivo = "KM da próxima troca de óleo fora do intervalo esperado — conferir hodômetro/etiqueta";
    pendencias.push({ codigo: "km_proxima_troca_intervalo", mensagem: motivo });
    addEvent(
      "etiqueta_oleo",
      labelFor("etiqueta_oleo"),
      "km_divergence",
      AUDIT_EVENT_CODES.KM_NEXT_OIL_RANGE,
      motivo,
    );
  }

  if (!input.termoAceito) {
    pendencias.push({ codigo: "termo", mensagem: "Termo de responsabilidade não aceito" });
    addEvent(
      "termo",
      "Termo de responsabilidade",
      "pending_at_submit",
      AUDIT_EVENT_CODES.TERM_NOT_ACCEPTED,
      "Termo de responsabilidade não aceito no envio",
    );
  }

  if (input.resultadoExigeMotivo && !input.resultadoMotivoInformado) {
    pendencias.push({ codigo: "resultado_motivo", mensagem: "Resultado sem justificativa" });
    addEvent(
      "resultado",
      "Resultado da inspeção",
      "pending_at_submit",
      AUDIT_EVENT_CODES.RESULT_WITHOUT_REASON,
      "Resultado diferente de liberado sem justificativa",
    );
  }

  if (input.avariaDeclarada) {
    if (!input.avariaDescricaoInformada) {
      pendencias.push({ codigo: "avaria_descricao", mensagem: "Avaria declarada sem descrição" });
      addEvent(
        "avaria",
        labelFor("avaria"),
        "pending_at_submit",
        AUDIT_EVENT_CODES.DAMAGE_NO_DESCRIPTION,
        "Avaria declarada sem descrição do técnico",
      );
    }
    if (!input.avariaEvidencia) {
      pendencias.push({ codigo: "avaria_foto", mensagem: "Avaria declarada sem evidência fotográfica" });
      addEvent(
        "avaria",
        labelFor("avaria"),
        "pending_at_submit",
        AUDIT_EVENT_CODES.DAMAGE_NO_PHOTO,
        "Avaria declarada sem foto de evidência",
      );
    }
  }

  return { pendencias, auditEvents };
}

/**
 * Divergência manual de KM (painel × cadastro) nos DOIS sentidos.
 * Nunca bloqueia — só gera evento/alerta.
 */
export function buildKmDivergenceEvent(params: {
  kmPainel: number | null;
  kmCadastro: number | null;
  labelFor?: (category: string) => string;
  /** Tolerância absoluta antes de considerar divergência relevante. */
  tolerancia?: number;
}): SubmissionAuditEvent | null {
  const { kmPainel, kmCadastro } = params;
  const tol = params.tolerancia ?? 50;
  if (kmPainel === null || kmCadastro === null || !Number.isFinite(kmPainel) || !Number.isFinite(kmCadastro)) {
    return null;
  }
  const diff = kmPainel - kmCadastro;
  if (Math.abs(diff) <= tol) return null;
  const labelFor = params.labelFor ?? ((c: string) => c);
  const sentido = diff < 0 ? "MENOR" : "MAIOR";
  return {
    categoria: "painel",
    label: labelFor("painel"),
    status: "km_divergence",
    event_code: AUDIT_EVENT_CODES.KM_DIVERGENCE,
    severity: severity("painel", "km_divergence", { eventCode: AUDIT_EVENT_CODES.KM_DIVERGENCE }),
    motivo: `KM do painel ${sentido} que o cadastro: painel ${kmPainel.toLocaleString("pt-BR")} km, cadastro ${kmCadastro.toLocaleString("pt-BR")} km (diferença ${diff.toLocaleString("pt-BR")} km)`,
    audit_required: true,
  };
}
