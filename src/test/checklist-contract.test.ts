import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const checklist = read("src/pages/Checklist.tsx");
const detail = read("src/pages/ChecklistDetail.tsx");
const notify = read("supabase/functions/notify-checklist-nc/index.ts");
const validate = read("supabase/functions/validate-checklist-photo/index.ts");
const auth = read("src/contexts/AuthContext.tsx");

describe("captura de fotos", () => {
  it("não oferece galeria — só captura no momento", () => {
    expect(checklist).not.toContain("galleryInputRef");
    expect(checklist).toContain('capture="environment"');
  });

  it("oferece 'Tirar outra' e 'Usar mesmo assim' para foto reprovada", () => {
    expect(checklist).toContain("Tirar outra");
    expect(checklist).toContain("Usar mesmo assim");
  });

  it('não existe mais a trava "forçar não conta" no painel', () => {
    expect(checklist).not.toContain("não permitimos forçar foto do painel");
  });
});

describe("rascunho", () => {
  it("não forja validação ao restaurar foto do rascunho", () => {
    expect(checklist).not.toContain("Foto restaurada do rascunho");
    expect(checklist).toContain("restoredPhotoStatus");
  });

  it("persiste o parecer real da IA no rascunho", () => {
    expect(checklist).toContain("draft_validations");
  });

  it("mostra estado do autosave, incluindo erro", () => {
    expect(checklist).toContain("rascunho NÃO salvo");
  });
});

describe("idempotência e sucesso honesto", () => {
  it("chamado é vinculado ao checklist de origem", () => {
    expect(checklist).toContain("source_checklist_id");
  });

  it("eventos de auditoria usam upsert por event_key", () => {
    expect(checklist).toContain("checklist_ai_audit_events");
    expect(checklist).toContain('onConflict: "event_key"');
  });

  it("mantém detalhes.ai_audit durante a transição", () => {
    expect(checklist).toContain("ai_audit: auditEvents");
  });

  it("avisa ação pendente em vez de sucesso falso", () => {
    expect(checklist).toContain("Ação pendente");
  });
});

describe("revalidação append-only", () => {
  it("não limpa fotos forçadas", () => {
    expect(detail).not.toContain("fotos_forcadas: [], // Clear forced");
    expect(detail).toContain("revalidacoes");
  });

  it("não sobrescreve KM com leitura insegura", () => {
    expect(detail).toContain("normalizeOdometerReading");
    expect(detail).toContain("km_auto_update_allowed === true");
  });
});

describe("notify-checklist-nc", () => {
  it("exige autenticação", () => {
    expect(notify).toContain('JSON.stringify({ error: "Unauthorized" })');
  });

  it("escapa HTML dos campos vindos do cliente", () => {
    expect(notify).toContain("function esc(");
    expect(notify).toMatch(/\$\{esc\(placa\)\}/);
    expect(notify).toMatch(/\$\{esc\(tecnico\)\}/);
    expect(notify).toMatch(/\$\{esc\(observacoes\)\}/);
    // nenhuma interpolação crua dos campos sensíveis dentro do HTML
    expect(notify).not.toMatch(/\$\{placa\} — \$\{modelo\}/);
  });

  it("limita payload, eventos e taxa, e deduplica envios", () => {
    expect(notify).toContain("MAX_BODY_BYTES");
    expect(notify).toContain("MAX_AUDIT_EVENTS");
    expect(notify).toContain("rateLimited");
    expect(notify).toContain("dedupe_key");
  });
});

describe("validate-checklist-photo", () => {
  it("mantém somente modelos OpenAI vindos das constantes compartilhadas", () => {
    expect(validate).toContain("AI_VISION_MODEL");
    expect(validate).not.toMatch(/google\/gemini|anthropic|claude/i);
  });

  it("erro de IA nunca vira valid", () => {
    expect(validate).toContain("valid: null");
    expect(validate).toContain('status: "ai_error"');
  });

  it("painel sem OCR permanece válido, crítico e sem auto-update", () => {
    expect(validate).toContain("km_painel_nao_confirmado = true");
    expect(validate).toContain('result.severity = "critical"');
    expect(validate).toContain("km_auto_update_allowed = false");
  });

  it("aplica a regra de ouro com itens inconclusivos", () => {
    expect(validate).toContain("inconclusive_items");
    expect(validate).toContain("REGRA DE OURO (soberana)");
  });

  it("tem limite de payload, rate limit e categoria correta no erro", () => {
    expect(validate).toContain("MAX_IMAGE_BASE64_CHARS");
    expect(validate).toContain("rateLimited");
    expect(validate).toContain("aiErrorPayload(currentCategory");
    expect(validate).not.toContain("__lastCategory");
  });

  it("suporta análise em conjunto", () => {
    expect(validate).toContain("related_images");
    expect(validate).toContain("ANÁLISE EM CONJUNTO");
  });
});

describe("permissões", () => {
  it("usuário sem role falha fechado (sem virar admin)", () => {
    expect(auth).not.toContain('setRoles(["admin"])');
    expect(auth).toContain("FAIL-CLOSED");
  });
});
