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
