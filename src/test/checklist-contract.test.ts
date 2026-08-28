import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const checklist = read("src/pages/Checklist.tsx");
const detail = read("src/pages/ChecklistDetail.tsx");
const notify = read("supabase/functions/notify-checklist-nc/index.ts");
const validate = read("supabase/functions/validate-checklist-photo/index.ts");
const auth = read("src/contexts/AuthContext.tsx");
const auditoria = read("src/pages/AuditoriaIA.tsx");
const migration = read("supabase/migrations/20260828131915_3fd781c3-3715-456d-acea-25e05c3ed388.sql");

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

  it("avisa pendências em vez de sucesso falso", () => {
    expect(checklist).toContain("Checklist salvo COM PENDÊNCIAS");
  });

  it("subtarefa usa onConflict compatível com o índice único (ticket_id, descricao)", () => {
    expect(checklist).toContain('onConflict: "ticket_id,descricao"');
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_action_por_descricao");
    expect(migration).toContain("ON public.ticket_actions (ticket_id, descricao)");
    expect(migration).not.toContain("md5(descricao)");
  });

  it("trigger não preenche forced_at em eventos que não são 'forced'", () => {
    expect(migration).toMatch(/IF NEW\.status = 'forced' THEN[\s\S]*ELSE[\s\S]*NEW\.forced_at := NULL;[\s\S]*NEW\.forced_by := NULL;/);
    expect(checklist).toContain('e.status === "forced" ? (e.forced_by ?? userId) : null');
  });

  it("finalização só é bloqueada por falta de veículo/técnico", () => {
    expect(migration).toContain("Checklist inválido: veículo obrigatório");
    expect(migration).toContain("Checklist inválido: técnico responsável obrigatório");
    expect(migration).not.toContain("Checklist incompleto: foto obrigatória ausente");
  });
});

describe("não bloquear o preenchimento", () => {
  it("canAdvance só exige veículo e técnico", () => {
    const trecho = checklist.slice(checklist.indexOf("const canAdvance = ()"));
    const corpo = trecho.slice(0, trecho.indexOf("const renderStep"));
    expect(corpo).toContain("return !!vehicleId && !!selectedDriverId;");
    expect(corpo).not.toContain("getMissingChecklistAnswers");
    expect(corpo).not.toContain("resultadoMotivo");
    expect(corpo).not.toContain("kmPainelManual");
  });

  it("mutationFn não lança por incompletude", () => {
    const trecho = checklist.slice(checklist.indexOf("mutationFn: async ()"));
    const corpo = trecho.slice(0, trecho.indexOf("onSuccess:"));
    expect(corpo).not.toContain("Aguarde o upload das fotos terminar");
    expect(corpo).not.toContain("Checklist incompleto: preencha");
    expect(corpo).not.toContain("KM da próxima troca inválido");
    expect(corpo).not.toContain("Falha no envio das fotos de");
  });

  it("não grava resposta em branco nas colunas do checklist", () => {
    expect(checklist).toContain('CHECKLIST_DB_FIELD_KEYS.has(key) && String(value ?? "").trim().length > 0');
  });

  it("resumo final lista as pendências enviadas ao gestor", () => {
    expect(checklist).toContain("pendência(s) serão enviadas ao gestor");
    expect(checklist).toContain("pendencias_preenchimento");
  });

  it("salvar não é desabilitado por upload em andamento", () => {
    expect(checklist).toContain("disabled={!canAdvance() || mutation.isPending}");
  });
});

describe("ordem do wizard e cobertura de fotos", () => {
  it("Capô vem antes do Painel, e Calibração antes do Exterior", () => {
    const stepsBloco = checklist.slice(checklist.indexOf("const STEPS = ["), checklist.indexOf("const CALIBRACAO_STEP_INDEX"));
    const idx = (id: string) => stepsBloco.indexOf(`id: "${id}"`);
    expect(idx("capo")).toBeGreaterThan(idx("info"));
    expect(idx("painel")).toBeGreaterThan(idx("capo"));
    expect(idx("calibracao")).toBeGreaterThan(idx("painel"));
    expect(idx("exterior_360")).toBeGreaterThan(idx("calibracao"));
  });

  it("calibração pede uma evidência por pneu", () => {
    const bloco = checklist.slice(checklist.indexOf("const STEP_PHOTOS"), checklist.indexOf("function getFirstIncompleteRequiredPhotoStepIndex"));
    for (const cat of ["calibracao_de", "calibracao_dd", "calibracao_te", "calibracao_td"]) {
      expect(bloco).toContain(`"${cat}"`);
    }
  });

  it("interior não tem número fixo de fotos", () => {
    expect(checklist).toMatch(/interior: \{ label: "🪑 Interior do Veículo"[\s\S]*?min: 1 \}/);
  });

  it("água/interior/laterais são avaliadas em conjunto", () => {
    expect(checklist).toContain('SET_ANALYSIS_CATEGORIES = new Set(["interior", "reservatorio_agua"');
    expect(checklist).toContain("body.related_images = related");
    expect(detail).toContain("REVALIDATION_SET_CATEGORIES");
    expect(detail).toContain("related_images: relatedImages");
  });
});

describe("erro de IA não é aprovação (frontend)", () => {
  it("catch do validatePhoto devolve estado inconclusivo", () => {
    const trecho = checklist.slice(checklist.indexOf("Photo validation error:"));
    const corpo = trecho.slice(0, trecho.indexOf("function summarizePhotoValidations"));
    expect(corpo).toContain("valid: false");
    expect(corpo).toContain('status: "ai_error"');
    expect(corpo).not.toContain("valid: true");
    expect(corpo).not.toContain("critical_visible: true");
  });

  it("UI não mostra selo verde em ai_error", () => {
    expect(checklist).toContain('v?.status === "valid" && !v?.result?.ai_error');
  });

  it("detalhe do checklist não chama de OK foto sem análise", () => {
    expect(detail).toContain("Sem alerta registrado");
    expect(detail).toContain("Não analisada");
    expect(detail).toContain("categoriaFoiAnalisada");
  });
});

describe("dashboard de auditoria", () => {
  it("tem filtros de período, técnico, veículo, categoria, status e severidade", () => {
    for (const filtro of ["dataInicio", "dataFim", "tecnicoFiltro", "veiculoFiltro", "categoriaFiltro", "statusFiltro", "severidadeFiltro"]) {
      expect(auditoria).toContain(filtro);
    }
  });

  it("exige nota de análise e registra quem/quando", () => {
    expect(auditoria).toContain("resolution_note: nota");
    expect(auditoria).toContain("resolved_by: resolvedBy");
    expect(auditoria).toContain("resolved_at: new Date().toISOString()");
    expect(auditoria).toContain("resolutionNote.trim().length === 0");
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

  it("reserva a linha de log com dedupe_key ANTES de chamar o Resend", () => {
    const reservaIdx = notify.indexOf("dedupe_key: recipientKey");
    const resendIdx = notify.indexOf("https://api.resend.com/emails");
    expect(reservaIdx).toBeGreaterThan(-1);
    expect(resendIdx).toBeGreaterThan(-1);
    expect(reservaIdx).toBeLessThan(resendIdx);
    expect(notify).toContain('status: "pending"');
  });

  it("nunca devolve sucesso quando falta chave ou o envio falha", () => {
    expect(notify).toContain('{ success: false, error: "RESEND_API_KEY não configurada" }');
    expect(notify).toContain("status: 503");
    expect(notify).toContain("Falha ao enviar parte dos e-mails");
    expect(notify).toContain("status: 502");
  });

  it("autoriza apenas o autor do checklist ou admin", () => {
    expect(notify).toContain('.eq("role", "admin")');
    expect(notify).toContain("checklistRow.created_by !== callerId");
    expect(notify).toContain('{ success: false, error: "Forbidden" }');
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
