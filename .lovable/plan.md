# Refatoração completa do fluxo de IA — validação, override, auditoria

## Verificação prévia (já feita)
Rodei `rg -i "gemini|google/|anthropic|claude"` em todo o código (excluindo `node_modules` e `.lovable/memory`): **zero ocorrências ativas**. Hoje só tem `openai/*` em todas as chamadas (`validate-checklist-photo` usa `openai/gpt-5.4`, `sync-auvo-expenses` já foi migrado para `openai/gpt-5.4-mini` + `openai/gpt-5.4` na sessão anterior).

## Modelos (constantes centralizadas)
- `AI_VISION_MODEL = "openai/gpt-5.4"` — validação de fotos
- `AI_OCR_MODEL = "openai/gpt-5.4-mini"` — extração OCR Auvo
- `AI_OCR_VERIFY_MODEL = "openai/gpt-5.4"` — verificação de placa quando ambíguo

Vou criar `supabase/functions/_shared/ai-models.ts` exportando essas constantes + `AI_PROVIDER_ALLOWED = "openai"` e usar em todas as edge functions de IA.

## Escopo da entrega

### 1. `validate-checklist-photo/index.ts`
- Importar constantes de `_shared/ai-models.ts`.
- Adicionar campos no JSON de retorno: `severity`, `audit_required`, `model_used`, `prompt_version`, `validation_started_at`, `validation_finished_at`, `validation_duration_ms`, `reject_code`.
- Em erro/timeout retornar `{status: "ai_error", valid: null, audit_required: true, severity: "warning", reason: "Validação IA indisponível..."}` em vez de aprovar genericamente.
- Categoria `painel`: nunca preencher `km_lido` automaticamente quando `km_legivel=false`; setar `km_painel_nao_confirmado=true`.
- Calibração: alinhar critério hardcoded com prompt dinâmico (já está permissivo — só remover qualquer exigência de "valor legível" residual).
- Manter `detail: "high"` (gateway não suporta `original`); registrar log uma vez por cold start.

### 2. `sync-auvo-expenses/index.ts`
- Importar constantes de `_shared/ai-models.ts` (substituir literais `openai/gpt-5.4-mini` e `openai/gpt-5.4`).
- Coerção numérica de `km`, `litros`, `valor` (aceitar `"123,45"`, `"1.234,56"`, `"173552"`) sem zerar quando vier string.
- Vínculo de placa: só atribuir veículo se match exato pós-normalização contra a lista fechada; senão `parse_status = 'unmatched'` para revisão.

### 3. `notify-checklist-nc/index.ts`
- Adicionar suporte a novo tipo de evento: `audit_alert` (fotos forçadas, pendentes, ai_error, KM não confirmado, divergência relevante).
- Novo template de e-mail com assunto **"Alerta de validação IA no checklist"** contendo: veículo, placa, condutor, técnico, data/hora, categorias afetadas, status de cada foto, motivo da IA, severidade, links das fotos, link do checklist, resumo IA.
- Disparado pela página de checklist quando houver eventos auditáveis no submit.

### 4. `src/pages/Checklist.tsx`
- **Não bloquear** botão Salvar por validação pendente/falha/reprovação.
- No submit, varrer todas as fotos e gerar `audit_events`:
  - `pending_at_submit` (validating na hora do save) → severity `warning`.
  - `forced` (técnico clicou "Usar mesmo assim") → severity `critical` para painel/KM/pneus/óleo/água/etiqueta_oleo/itens_seguranca, senão `warning`.
  - `ai_error` (timeout/falha) → severity `warning`.
  - Interior com cobertura insuficiente (`required_items_seen` faltando) → registrar pendência, não bloquear.
- Persistir em `vehicle_checklists.detalhes.ai_audit` (JSON) com:
  - `status`, `categoria`, `label`, `motivo`, `forced_by`/`pending_by`, `forced_at`/`timestamp`, `photo_url`, `photo_index`, `ai_result`, `severity`, `audit_required: true`.
- Para foto reprovada: oferecer botões "Tirar outra" e "Usar mesmo assim" (já existe — garantir que o "Usar mesmo assim" registra evento `forced`).
- Após salvar, se `ai_audit.length > 0`, invocar `notify-checklist-nc` com payload `audit_alert`.

### 5. `src/pages/ChecklistDetail.tsx`
- Renderizar timeline de eventos de auditoria de IA (forçadas, pendentes, ai_error) com badges de severidade.
- Mostrar "KM do painel não confirmado pela IA" quando `km_painel_nao_confirmado=true`.

### 6. `src/lib/km-painel-divergence.ts`
- Adicionar comentário explicando dois thresholds:
  - `KM_PAINEL_DIVERGENCE_THRESHOLD = 50` → alerta visual leve (linha amarela na lista).
  - `KM_PAINEL_NEGATIVE_THRESHOLD = 2000` → divergência relevante; gera ticket via `scan-km-divergence` e dispara e-mail.
- Sem mudança de lógica.

### 7. Migration
Adicionar coluna em `vehicle_checklists` se for útil indexar:
- Não vou criar coluna nova; `ai_audit` vai dentro de `detalhes` (jsonb) — evita migration e mantém compatibilidade. Se precisar query posterior, abriremos índice GIN sob demanda.

## Estrutura de eventos (exemplos)

**Foto forçada:**
```json
{
  "status": "forced",
  "categoria": "painel",
  "label": "Painel do veículo",
  "motivo": "Hodômetro não legível — foto borrada",
  "ai_result": { "valid": false, "confidence": 0.62, "reject_code": "blurred_digits" },
  "forced_by": "uuid-tecnico",
  "forced_at": "2026-05-11T14:32:00-03:00",
  "photo_url": "https://.../painel-1.jpg",
  "photo_index": 0,
  "severity": "critical",
  "audit_required": true
}
```

**IA pendente no submit:**
```json
{
  "status": "pending_at_submit",
  "categoria": "exterior_frente",
  "label": "Frente do veículo",
  "motivo": "Checklist salvo antes da conclusão da validação por IA",
  "pending_by": "uuid-tecnico",
  "timestamp": "2026-05-11T14:32:00-03:00",
  "photo_url": "https://.../frente-1.jpg",
  "photo_index": 0,
  "severity": "warning",
  "audit_required": true
}
```

## Roteiro de teste manual (entregue ao final)
1. Foto aprovada — IA retorna `valid:true` → sem evento de auditoria.
2. Foto reprovada → mostra "Tirar outra" / "Usar mesmo assim".
3. Foto forçada → registra `forced`, dispara e-mail.
4. IA pendente → salvar antes da IA → registra `pending_at_submit`.
5. Erro de IA (mock 500) → registra `ai_error`.
6. Painel sem KM legível → `km_lido=null`, `km_painel_nao_confirmado=true`, KM manual obrigatório.
7. OCR comprovante Auvo com valores em string → coerção funciona.
8. Placa não encontrada no Auvo → `parse_status='unmatched'`.

## O que NÃO vou alterar
- Layout geral, RBAC, fluxo de 8 passos do checklist, draft auto-save, cron de sync, schema de tabelas existentes (sem migration).

---

**Tamanho da mudança:** ~400-600 linhas novas/modificadas distribuídas. Deploy de 3 edge functions ao final. Posso começar agora?