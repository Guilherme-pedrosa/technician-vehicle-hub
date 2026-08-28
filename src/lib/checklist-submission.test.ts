import { describe, expect, it } from "vitest";
import {
  buildAuditEvents,
  buildChecklistPendencias,
  buildKmDivergenceEvent,
  collectPhotoCategories,
  photoSlotCount,
  summarizePhotoValidations,
  type PendenciaInput,
} from "./checklist-submission";

const baseFull: PendenciaInput = {
  missingAnswers: [],
  missingObservations: [],
  missingPhotos: [],
  uploadsPending: [],
  uploadsError: [],
  kmPainelInformado: true,
  kmPainelValido: true,
  kmProximaTrocaInformado: true,
  kmProximaTrocaValido: true,
  kmProximaTrocaForaDoIntervalo: false,
  termoAceito: true,
  resultadoExigeMotivo: false,
  resultadoMotivoInformado: false,
  avariaDeclarada: false,
  avariaDescricaoInformada: false,
  avariaEvidencia: false,
};

describe("pendências de preenchimento (nunca bloqueiam)", () => {
  it("checklist completo não gera pendência", () => {
    const r = buildChecklistPendencias(baseFull);
    expect(r.pendencias).toHaveLength(0);
    expect(r.auditEvents).toHaveLength(0);
  });

  it("respostas, fotos, KM e termo ausentes geram pendências + auditoria e permitem salvar", () => {
    const r = buildChecklistPendencias({
      ...baseFull,
      missingAnswers: [{ key: "freios", label: "Freios funcionando?" }],
      missingObservations: [{ key: "pneus", label: "Pneus em condição de saída?" }],
      missingPhotos: [{ categoria: "painel", label: "Painel" }],
      kmPainelInformado: false,
      kmPainelValido: false,
      kmProximaTrocaInformado: false,
      kmProximaTrocaValido: false,
      termoAceito: false,
      resultadoExigeMotivo: true,
      resultadoMotivoInformado: false,
    });

    const codigos = r.pendencias.map((p) => p.codigo);
    expect(codigos).toContain("resposta_faltante:freios");
    expect(codigos).toContain("observacao_faltante:pneus");
    expect(codigos).toContain("foto_faltante:painel");
    expect(codigos).toContain("km_painel");
    expect(codigos).toContain("km_proxima_troca");
    expect(codigos).toContain("termo");
    expect(codigos).toContain("resultado_motivo");
    // Nenhuma estrutura de bloqueio: só pendências + trilha auditável.
    expect(r.auditEvents.length).toBe(r.pendencias.length);
    expect(r.auditEvents.every((e) => e.audit_required)).toBe(true);
    // KM do painel não confirmado é crítico por contrato.
    expect(r.auditEvents.find((e) => e.status === "km_not_confirmed")?.severity).toBe("critical");
  });

  it("upload pendente ou com erro vira pendência, não impedimento", () => {
    const r = buildChecklistPendencias({
      ...baseFull,
      uploadsPending: [{ categoria: "interior", label: "Interior" }],
      uploadsError: [{ categoria: "estepe", label: "Estepe" }],
    });
    expect(r.pendencias.map((p) => p.codigo)).toEqual(
      expect.arrayContaining(["upload_pendente:interior", "upload_erro:estepe"]),
    );
  });

  it("avaria declarada sem descrição/evidência gera duas pendências", () => {
    const r = buildChecklistPendencias({
      ...baseFull,
      avariaDeclarada: true,
      avariaDescricaoInformada: false,
      avariaEvidencia: false,
    });
    expect(r.pendencias.map((p) => p.codigo)).toEqual(
      expect.arrayContaining(["avaria_descricao", "avaria_foto"]),
    );
  });

  it("próxima troca fora do intervalo vira divergência, não erro fatal", () => {
    const r = buildChecklistPendencias({ ...baseFull, kmProximaTrocaForaDoIntervalo: true });
    expect(r.auditEvents[0].status).toBe("km_divergence");
  });
});

describe("divergência de KM nos dois sentidos", () => {
  it("KM menor que o cadastro gera evento", () => {
    const e = buildKmDivergenceEvent({ kmPainel: 120000, kmCadastro: 125000 });
    expect(e?.status).toBe("km_divergence");
    expect(e?.motivo).toContain("MENOR");
  });

  it("KM maior que o cadastro também gera evento", () => {
    const e = buildKmDivergenceEvent({ kmPainel: 131000, kmCadastro: 125000 });
    expect(e?.status).toBe("km_divergence");
    expect(e?.motivo).toContain("MAIOR");
  });

  it("diferença dentro da tolerância não gera evento", () => {
    expect(buildKmDivergenceEvent({ kmPainel: 125010, kmCadastro: 125000 })).toBeNull();
  });
});

describe("auditoria percorre a UNIÃO das fontes", () => {
  it("inclui fotos restauradas que só existem em fotosUrls", () => {
    const { auditEvents } = buildAuditEvents({
      photos: {},
      fotosUrls: { painel: ["https://x/painel.jpg"] },
      validations: { painel: [{ status: "invalid", result: { reason: "Painel não identificado" } }] },
      userId: "u1",
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].status).toBe("invalid");
    expect(auditEvents[0].photo_url).toBe("https://x/painel.jpg");
    expect(auditEvents[0].severity).toBe("critical");
  });

  it("foto reprovada sem 'usar mesmo assim' entra na fila", () => {
    const { auditEvents } = buildAuditEvents({
      photos: { interior: [{}] },
      validations: { interior: [{ status: "invalid", result: { reason: "Fora de foco" } }] },
      userId: "u1",
    });
    expect(auditEvents.map((e) => e.status)).toContain("invalid");
  });

  it("foto persistida sem parecer vira pending_at_submit", () => {
    const { auditEvents } = buildAuditEvents({
      photoUploads: { estepe: [{ status: "uploaded" }] },
      fotosUrls: { estepe: ["https://x/e.jpg"] },
      validations: {},
      userId: "u1",
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].status).toBe("pending_at_submit");
  });

  it("status idle restaurado também vira pendência de análise", () => {
    const { auditEvents } = buildAuditEvents({
      fotosUrls: { motor: ["https://x/m.jpg"] },
      validations: { motor: [{ status: "idle" }] },
      userId: "u1",
    });
    expect(auditEvents[0].status).toBe("pending_at_submit");
  });

  it("forced preserva forced_by/forced_at; demais status não", () => {
    const { auditEvents } = buildAuditEvents({
      fotosUrls: { pneu_de: ["a"], interior: ["b"] },
      validations: {
        pneu_de: [{ status: "forced", result: { reason: "sujo" } }],
        interior: [{ status: "validating" }],
      },
      userId: "u9",
    });
    const forced = auditEvents.find((e) => e.status === "forced")!;
    const pending = auditEvents.find((e) => e.status === "pending_at_submit")!;
    expect(forced.forced_by).toBe("u9");
    expect(forced.forced_at).toBeTruthy();
    expect(pending.forced_by).toBeUndefined();
    expect(pending.forced_at).toBeUndefined();
  });

  it("erro de IA vira ai_error e nunca aprovação", () => {
    const { auditEvents } = buildAuditEvents({
      fotosUrls: { vidros: ["a"] },
      validations: { vidros: [{ status: "invalid", result: { ai_error: true, reason: "timeout" } }] },
      userId: "u1",
    });
    expect(auditEvents[0].status).toBe("ai_error");
  });

  it("painel sem KM confirmado marca kmPainelNaoConfirmado e severidade crítica", () => {
    const { auditEvents, kmPainelNaoConfirmado } = buildAuditEvents({
      fotosUrls: { painel: ["a"] },
      validations: { painel: [{ status: "valid", result: { valid: true, km_painel_nao_confirmado: true } }] },
      userId: "u1",
    });
    expect(kmPainelNaoConfirmado).toBe(true);
    const ev = auditEvents.find((e) => e.status === "km_not_confirmed")!;
    expect(ev.severity).toBe("critical");
  });

  it("cobertura parcial de interior é advertência", () => {
    const { auditEvents } = buildAuditEvents({
      fotosUrls: { interior: ["a"] },
      validations: { interior: [{ status: "valid", result: { valid: true } }] },
      userId: "u1",
      interiorCoverage: { ok: false, missing: ["quebra-sol/teto"] },
    });
    const ev = auditEvents.find((e) => e.status === "interior_incomplete")!;
    expect(ev.severity).toBe("warning");
  });
});

describe("resumo de validações", () => {
  it("foto sem parecer não é chamada de OK — vai para 'não analisada'", () => {
    const s = summarizePhotoValidations({
      fotosUrls: { som: ["a"] },
      validations: {},
    });
    expect(s.naoAnalisadas).toHaveLength(1);
    expect(s.invalid).toHaveLength(0);
    expect(s.forced).toHaveLength(0);
  });

  it("conta reprovada restaurada de rascunho", () => {
    const s = summarizePhotoValidations({
      photoUploads: { painel: [{ status: "uploaded" }] },
      validations: { painel: [{ status: "invalid", result: { reason: "borrada" } }] },
    });
    expect(s.invalid[0].motivos).toContain("borrada");
    expect(s.hasBadPhotos).toBe(true);
  });
});

describe("helpers de união", () => {
  it("photoSlotCount usa o maior comprimento", () => {
    expect(photoSlotCount([1], [1, 2, 3], undefined, [])).toBe(3);
  });
  it("collectPhotoCategories une categorias não vazias", () => {
    expect(collectPhotoCategories({ a: [1] }, { b: [] }, { c: ["x"] }).sort()).toEqual(["a", "c"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// TERCEIRA CORREÇÃO — testes de comportamento
// ═══════════════════════════════════════════════════════════════

import {
  buildAnswerPayload,
  photoUrlForSlot,
  resolveOperationalResultado,
  resolveTrocaOleoStatus,
} from "./checklist-submission";
import { AUDIT_EVENT_CODES, buildAuditEventKey } from "./checklist-audit";

const DB_KEYS = [
  "nivel_oleo", "nivel_agua", "motor", "freios", "pneus", "itens_seguranca", "danos_veiculo",
];

describe("payload honesto: resposta ausente NUNCA vira 'conforme'", () => {
  it("formulário vazio grava NULL explícito em todas as colunas operacionais", () => {
    const payload = buildAnswerPayload({}, DB_KEYS);
    expect(Object.keys(payload).sort()).toEqual([...DB_KEYS].sort());
    for (const key of DB_KEYS) {
      expect(payload[key]).toBeNull();
    }
  });

  it("nenhuma chave é omitida (omitir deixaria o default do banco inventar resposta)", () => {
    const payload = buildAnswerPayload({ freios: "conforme" }, DB_KEYS);
    expect(Object.prototype.hasOwnProperty.call(payload, "pneus")).toBe(true);
    expect(payload.pneus).toBeNull();
    expect(payload.freios).toBe("conforme");
  });

  it("valor stale de rascunho é sobrescrito por null quando a resposta é limpa", () => {
    const payload = buildAnswerPayload({ pneus: "   " }, DB_KEYS);
    expect(payload.pneus).toBeNull();
  });
});

describe("troca de óleo honesta", () => {
  it("sem KM da próxima troca NÃO fica 'ok'", () => {
    expect(resolveTrocaOleoStatus({
      kmProximaTrocaValido: false, vencida: false, quaseVencida: false, proxima: false,
    })).toBeNull();
  });
  it("vencida e quase vencida viram 'vencido'", () => {
    expect(resolveTrocaOleoStatus({ kmProximaTrocaValido: true, vencida: true, quaseVencida: false, proxima: false })).toBe("vencido");
    expect(resolveTrocaOleoStatus({ kmProximaTrocaValido: true, vencida: false, quaseVencida: true, proxima: false })).toBe("vencido");
  });
  it("dentro do intervalo com KM informado é 'ok'", () => {
    expect(resolveTrocaOleoStatus({ kmProximaTrocaValido: true, vencida: false, quaseVencida: false, proxima: false })).toBe("ok");
  });
});

describe("resultado operacional nunca fica 'liberado' silencioso", () => {
  it("qualquer pendência eleva para liberado_obs (aguardando análise)", () => {
    const r = resolveOperationalResultado({ userChoice: "liberado", suggested: "liberado", hasPendencias: true });
    expect(r.resultado).toBe("liberado_obs");
    expect(r.elevadoPorPendencia).toBe(true);
  });
  it("resultado mais grave já sugerido é preservado", () => {
    const r = resolveOperationalResultado({ userChoice: "liberado", suggested: "bloqueado", hasPendencias: true });
    expect(r.resultado).toBe("bloqueado");
    expect(r.elevadoPorPendencia).toBe(false);
  });
  it("sem pendência e sem problema continua liberado", () => {
    const r = resolveOperationalResultado({ userChoice: "liberado", suggested: "liberado", hasPendencias: false });
    expect(r.resultado).toBe("liberado");
  });
});

describe("chaves de auditoria distintas por tipo de pendência", () => {
  it("dois eventos pendentes na MESMA categoria sem foto não colidem", () => {
    const { auditEvents } = buildChecklistPendencias({
      ...baseFull,
      missingPhotos: [{ categoria: "etiqueta_oleo", label: "Etiqueta de óleo", critical: true }],
      kmProximaTrocaInformado: false,
      kmProximaTrocaValido: false,
    });
    const etiqueta = auditEvents.filter((e) => e.categoria === "etiqueta_oleo");
    expect(etiqueta).toHaveLength(2);
    const keys = etiqueta.map((e) => buildAuditEventKey({
      checklistId: "cl1", categoria: e.categoria, photoIndex: e.photo_index ?? null,
      status: e.status, eventCode: e.event_code,
    }));
    expect(new Set(keys).size).toBe(2);
    expect(etiqueta.map((e) => e.event_code).sort()).toEqual(
      [AUDIT_EVENT_CODES.KM_NEXT_OIL_MISSING, AUDIT_EVENT_CODES.PHOTO_MISSING].sort(),
    );
  });

  it("evidência crítica ausente é critical; indisponibilidade da IA continua warning", () => {
    const { auditEvents } = buildChecklistPendencias({
      ...baseFull,
      missingAnswers: [{ key: "pneus", label: "Pneus", categoria: "pneus", critical: true }],
      missingPhotos: [{ categoria: "painel", label: "Painel", critical: true }],
      uploadsPending: [{ categoria: "painel", label: "Painel" }],
    });
    expect(auditEvents.find((e) => e.event_code === AUDIT_EVENT_CODES.ANSWER_MISSING)!.severity).toBe("critical");
    expect(auditEvents.find((e) => e.event_code === AUDIT_EVENT_CODES.PHOTO_MISSING)!.severity).toBe("critical");
    expect(auditEvents.find((e) => e.event_code === AUDIT_EVENT_CODES.UPLOAD_PENDING)!.severity).toBe("warning");
  });

  it("resposta não crítica ausente permanece warning", () => {
    const { auditEvents } = buildChecklistPendencias({
      ...baseFull,
      missingAnswers: [{ key: "som", label: "Som", categoria: "som", critical: false }],
    });
    expect(auditEvents[0].severity).toBe("warning");
  });
});

describe("URL da foto não desloca de índice", () => {
  it("erro no índice anterior não empurra a URL para o slot errado", () => {
    const uploads = [{ status: "error" }, { status: "uploaded", uploadedUrl: "https://cdn/segunda.jpg" }];
    expect(photoUrlForSlot(uploads, undefined, 0)).toBeUndefined();
    expect(photoUrlForSlot(uploads, undefined, 1)).toBe("https://cdn/segunda.jpg");
  });

  it("evento de auditoria da foto 1 carrega a URL da foto 1", () => {
    const { auditEvents } = buildAuditEvents({
      photoUploads: { pneus: [{ status: "error" }, { status: "uploaded", uploadedUrl: "https://cdn/b.jpg" }] },
      // lista filtrada (com apenas 1 URL) NÃO pode ser usada por índice
      fotosUrls: { pneus: ["https://cdn/b.jpg"] },
      validations: { pneus: [{ status: "idle" }, { status: "invalid", result: { reason: "borrada" } }] },
      userId: "u1",
    });
    const ev1 = auditEvents.find((e) => e.photo_index === 1)!;
    const ev0 = auditEvents.find((e) => e.photo_index === 0)!;
    expect(ev1.photo_url).toBe("https://cdn/b.jpg");
    expect(ev0.photo_url).toBeUndefined();
  });
});
