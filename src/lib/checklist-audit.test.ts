import { describe, expect, it } from "vitest";
import {
  auditSeverityFor,
  auditStatusBlocksTechnician,
  buildAuditEventKey,
  compareAuditQueue,
  computeAuditIndicators,
  countRecurrences,
  dedupeAuditEvents,
  restoredPhotoStatus,
} from "./checklist-audit";

describe("severidade", () => {
  it("km_not_confirmed é sempre crítico", () => {
    expect(auditSeverityFor("painel", "km_not_confirmed")).toBe("critical");
  });

  it("forçar foto em categoria crítica é critical", () => {
    for (const cat of ["painel", "pneu_de", "nivel_oleo", "reservatorio_agua", "etiqueta_oleo", "itens_seguranca"]) {
      expect(auditSeverityFor(cat, "forced")).toBe("critical");
    }
  });

  it("IA pendente/erro e interior incompleto são warning", () => {
    expect(auditSeverityFor("painel", "pending_at_submit")).toBe("warning");
    expect(auditSeverityFor("painel", "ai_error")).toBe("warning");
    expect(auditSeverityFor("interior", "interior_incomplete")).toBe("warning");
  });

  it("avaria forçada é warning", () => {
    expect(auditSeverityFor("avaria", "forced")).toBe("warning");
  });
});

describe("não bloqueio", () => {
  it("nenhum status bloqueia o técnico", () => {
    for (const s of ["invalid", "forced", "pending_at_submit", "ai_error", "km_not_confirmed", "interior_incomplete", "km_divergence"]) {
      expect(auditStatusBlocksTechnician(s)).toBe(false);
    }
  });
});

describe("idempotência", () => {
  it("event_key é estável", () => {
    const a = buildAuditEventKey({ checklistId: "c1", categoria: "painel", photoIndex: 0, status: "forced" });
    const b = buildAuditEventKey({ checklistId: "c1", categoria: "painel", photoIndex: 0, status: "forced" });
    expect(a).toBe(b);
    expect(a).toBe("c1|painel|0|forced|generico");
  });

  it("event_code distingue pendências diferentes na mesma categoria", () => {
    const base = { checklistId: "c1", categoria: "etiqueta_oleo", photoIndex: null, status: "pending_at_submit" } as const;
    const k1 = buildAuditEventKey({ ...base, eventCode: "evidencia_faltante" });
    const k2 = buildAuditEventKey({ ...base, eventCode: "km_proxima_troca_ausente" });
    expect(k1).not.toBe(k2);
  });

  it("dedupe remove repetidos preservando o primeiro", () => {
    const out = dedupeAuditEvents([
      { event_key: "k1", n: 1 },
      { event_key: "k1", n: 2 },
      { event_key: "k2", n: 3 },
    ] as any[]);
    expect(out).toHaveLength(2);
    expect((out[0] as any).n).toBe(1);
  });
});

describe("restauração de rascunho", () => {
  it("foto sem metadado NUNCA vira valid", () => {
    expect(restoredPhotoStatus(null)).toBe("idle");
    expect(restoredPhotoStatus({})).toBe("idle");
    expect(restoredPhotoStatus({ status: "restaurada" })).toBe("idle");
  });

  it("preserva metadado real persistido", () => {
    expect(restoredPhotoStatus({ status: "forced" })).toBe("forced");
    expect(restoredPhotoStatus({ status: "invalid" })).toBe("invalid");
    expect(restoredPhotoStatus({ status: "valid" })).toBe("valid");
  });
});

describe("fila administrativa", () => {
  it("ordena críticos antes de warnings e respeita a prioridade por status", () => {
    const rows = [
      { severity: "warning", status: "pending_at_submit", created_at: "2026-01-01" },
      { severity: "critical", status: "forced", created_at: "2026-01-01" },
      { severity: "critical", status: "km_not_confirmed", created_at: "2026-01-01" },
    ];
    const sorted = [...rows].sort(compareAuditQueue);
    expect(sorted.map((r) => r.status)).toEqual(["km_not_confirmed", "forced", "pending_at_submit"]);
  });

  it("conta reincidência por técnico/categoria/status", () => {
    const m = countRecurrences([
      { user_id: "u1", categoria: "painel", status: "forced" },
      { user_id: "u1", categoria: "painel", status: "forced" },
      { user_id: "u2", categoria: "painel", status: "forced" },
    ]);
    expect(m.get("u1|painel|forced")).toBe(2);
    expect(m.get("u2|painel|forced")).toBe(1);
  });

  it("indicadores usam finalizados como denominador", () => {
    const ind = computeAuditIndicators({
      finalizados: 10,
      events: [
        { checklist_id: "a", severity: "critical", status: "forced", resolved_at: null },
        { checklist_id: "a", severity: "warning", status: "ai_error", resolved_at: null },
        { checklist_id: "b", severity: "warning", status: "pending_at_submit", resolved_at: "2026-01-02" },
      ],
    });
    expect(ind.finalizados).toBe(10);
    expect(ind.comAlerta).toBe(2);
    expect(ind.criticos).toBe(1);
    expect(ind.pendentes).toBe(2);
    expect(ind.analisados).toBe(1);
    expect(ind.pctComAlerta).toBe(20);
  });
});
