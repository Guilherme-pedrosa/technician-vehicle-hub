# Auditoria do checklist FleetDesk contra o contrato — plano de correção

Tudo abaixo foi conferido lendo o código atual (linhas citadas).

## 1) Lacunas verificadas no código atual

### Regra operacional (IA não bloqueia) — VIOLADA
- `src/pages/Checklist.tsx` `canAdvance()` (L1814-1832): etapa `painel` exige `painelVals.some(v => v.status === "valid")`. Comentário explícito na L1818: "Status forced NÃO conta — não permitimos forçar foto do painel". Foto forçada, `ai_error` ou `invalid` travam o técnico no passo 2.
- Mesma função (L1826-1831): bloqueia por `kmManualNum < 100` e por quantidade de dígitos menor que o cadastro — o técnico digitando o número certo (hodômetro que "encolheu") fica travado.
- L1812: qualquer upload em `error` bloqueia o avanço sem oferecer retry explícito por foto.
- L2539: botão Salvar usa `disabled={!canAdvance() || ...}` — herda todos os bloqueios acima.

### Status e integridade da IA — PARCIAL
- Bom: taxonomia já existe (`Checklist.tsx` L292-424: `forced`, `pending_at_submit`, `ai_error`, `km_not_confirmed`, `interior_incomplete`, `km_divergence`) e `validate-checklist-photo` nunca devolve `valid` em erro (`aiErrorPayload`, L33-53).
- Falha: ao retomar rascunho, `Checklist.tsx` L1228 marca **todas** as fotos restauradas como `{status:"valid", reason:"Foto restaurada do rascunho"}`. Isso inventa aprovação e apaga `invalid/forced/ai_error` do rascunho.
- Divergência de severidade: edge devolve `severity:"warning"` para `km_not_confirmed` (prompt do painel), frontend classifica como `critical` (L292). Contrato = critical.
- `validate-checklist-photo` L718: `__lastCategory` nunca é setado → erro duro sempre cai como categoria `unknown` e severidade errada.

### Auditoria e reincidência — INSUFICIENTE
- Eventos são gravados só dentro de `vehicle_checklists.detalhes` (L1542-1569: `fotos_forcadas`, `km_painel_nao_confirmado`, `ai_audit`). Não há tabela consultável → impossível listar reincidência, priorizar críticos ou medir indicadores.
- `ChecklistDetail.tsx` L665 e L706-712: revalidação **sobrescreve/limpa** `fotos_forcadas` ("Clear forced since admin is revalidating"). Perde a trilha exigida pelo contrato.
- `ChecklistDetail.tsx` não renderiza timeline de eventos de IA (só `flaggedMap` e `PhotoRow`, L1108-1133).
- Não existe fila administrativa: `src/App.tsx` L35-56 só tem `/auditoria-liberacoes` (liberações de bloqueio), nada de fila de IA.

### E-mail / chamados / idempotência — VIOLADO
- `Checklist.tsx` L1600-1760: criação de chamado, subtarefas e os dois e-mails (`nc` e `audit_alert`) são fire-and-forget dentro de um `setTimeout`/promise sem `await`; falha é só `console.error` → sucesso falso e, em retry do usuário, chamado/e-mail duplicados. Não há chave de idempotência por `checklist_id`.
- `notify-checklist-nc/index.ts`: sem verificação de JWT/role (L10-25 lê o body direto), sem rate limit, sem limite de payload e **sem escapar HTML** — `placa`, `tecnico`, `observacoes`, `motivo`, `photo_url` entram cru no template (L118-225). XSS/injeção de e-mail.
- Sem deduplicação: dois submits geram dois e-mails idênticos.

### Fotos, captura e cobertura — PARCIAL
- Galeria ainda ofertada: `Checklist.tsx` L876-889 (`galleryInputRef`, input sem `capture`) além do input de câmera (L870). Contrato: só captura no momento.
- Análise por conjunto não existe: `validate-checklist-photo` avalia 1 foto por chamada; interior (L600-609) e água são julgados foto a foto.
- Sem rate limit / limite de tamanho do `image_base64` na edge (L248-254 valida só presença).

### Segurança — VIOLADO
- Bucket `checklist-photos` é **público** (migration `20260320152830...sql` L8) e o app usa URL pública, não assinada.
- Leitura anônima concedida a frota/telemetria: migrations `20260525213400`, `20260525214101`, `20260809152926` dão `GRANT SELECT ... TO anon` + policies em `vehicles`, `maintenance_tickets`, `daily_vehicle_km`, `vehicle_telemetry_events`.
- `src/contexts/AuthContext.tsx` L45-46: sem role no banco → assume `admin`. Fail-open.

### Testes — INEXISTENTES para checklist
- Só `src/test/example.test.ts` e `src/lib/merge-custos.test.ts`. Zero cobertura de KM/OCR, auditoria, idempotência.

### O que já está conforme (não mexer)
- Modelos: `_shared/ai-models.ts` fixa `openai/gpt-5.4` / `gpt-5.4-mini`, sem chave no frontend.
- Ordem das etapas (L915-942) já casa com o contrato: painel+etiqueta_oleo → capô (óleo/água/motor) → calibração+pneus+segurança → exterior → interior.
- Painel: foto válida separada do OCR e regra de ambiguidade "27754 1 → 277541" já no prompt (L390-420) + reconciliação server-side.
- Laterais em perspectiva, vareta sem MIN/MAX, calibração permissiva, limpeza NC: gates server-side já presentes (L619-677).
- Liberação administrativa com log (`checklist_release_log`, `LiberarBloqueioDialog`).

## 2) Correções exatas, por arquivo

**Migration nova (`checklist_ai_audit_events`)**
- Tabela: `checklist_id`, `vehicle_id`, `driver_id`, `user_id`, `categoria`, `label`, `status`, `severity`, `motivo`, `reason_original`, `reject_code`, `confidence`, `model_used`, `prompt_version`, `duration_ms`, `photo_url`, `photo_index`, `forced_by`, `forced_at`, `audit_required`, `resolved_at`, `resolved_by`, `event_key` (único, para idempotência), `created_at`.
- `GRANT` para `authenticated`/`service_role` (sem `anon`), RLS: técnico lê/insere os próprios; admin lê/atualiza tudo; sem DELETE.
- Colunas em `maintenance_tickets` já existentes bastam para idempotência via `external_ref`; adicionar índice único parcial em `(vehicle_id, maintenance_plan_id)`? Não — usar chave dedicada: coluna `source_checklist_id uuid` + índice único parcial para impedir chamado duplicado por checklist.
- Revogar `anon` de `vehicles`, `maintenance_tickets`, `daily_vehicle_km`, `vehicle_telemetry_events`; substituir o consumo externo por edge function com chave de serviço (`FROTA_EXTERNAL_API_KEY` já existe).
- Tornar o bucket `checklist-photos` privado (via ferramenta de bucket) + policies por role; front passa a gerar signed URLs.

**`src/pages/Checklist.tsx`**
- `canAdvance()`: remover exigência de foto `valid` no painel (aceitar `valid|forced|ai_error|invalid` com foto enviada); trocar o bloqueio por dígitos/`<100` do KM por aviso + evento `km_divergence`; upload em `error` mostra "Tentar novamente" sem travar.
- Restauração de rascunho (L1220-1235): restaurar o `photoValidations` persistido em `detalhes.ai_audit`/`validacoes` em vez de forjar `valid`; sem metadado → `status:"idle"` + revalidação sob demanda, nunca `valid`.
- Remover input/botão de galeria (L876-889).
- Persistência de auditoria: além de `detalhes.ai_audit`, inserir os eventos em `checklist_ai_audit_events` com `event_key = checklist_id|categoria|photo_index|status`, `onConflict` ignore → idempotente.
- Submit: transformar o bloco fire-and-forget (L1600-1760) em pipeline sequencial aguardado com estado por etapa (checklist salvo → auditoria → chamado → e-mail), cada uma idempotente; falha de chamado/e-mail vira aviso visível ("salvo, notificação pendente"), nunca sucesso falso nem bloqueio.
- Chamado: usar `source_checklist_id` + upsert; subtarefa por item de NC; recriar de forma idempotente quando o checklist editado ainda tem NC.

**`supabase/functions/validate-checklist-photo/index.ts`**
- `severity = "critical"` para `km_not_confirmed` (alinha com o frontend e o contrato) e status explícito `km_not_confirmed` no payload.
- Corrigir o catch final: capturar `category` em variável de escopo em vez de `__lastCategory` (L718).
- Limite de payload (~8 MB base64) e rate limit por usuário (janela em memória + contagem no banco).
- Reforçar a regra de ouro no prompt: proibir afirmar item presente/defeituoso sem evidência; exigir `inconclusive_items[]` e "não foi possível verificar X".
- Itens de segurança: exigir identificação individual de macaco, triângulo e chave de roda; estojo fechado = inconclusivo, não conforme.
- Suporte a análise de conjunto: aceitar `related_images[]` (interior, água, laterais) para julgar cobertura no mesmo chamado.

**`supabase/functions/notify-checklist-nc/index.ts`**
- Exigir JWT válido (ou `FLEETDESK_CALLBACK_KEY` para chamada server-to-server) e rejeitar anônimo.
- `escapeHtml()` em todos os campos interpolados; validar payload com Zod; limitar tamanho e nº de eventos.
- Deduplicar por `(checklist_id, event_type, hash dos eventos)` consultando `email_send_log` antes de enviar.

**`src/pages/ChecklistDetail.tsx`**
- Revalidação passa a **acrescentar** histórico (`revalidacoes[]`) em vez de zerar `fotos_forcadas` (L665, L706-712); grava novo evento de auditoria com `prompt_version`/`model_used`.
- Nova seção "Trilha de auditoria de IA": eventos ordenados, badge de severidade, motivo original, modelo, duração, link da foto (signed URL), e aviso "KM do painel não confirmado".
- Nunca sobrescrever KM com leitura insegura na revalidação.

**Nova página `src/pages/AuditoriaIA.tsx` + rota `/auditoria-ia`**
- Fila administrativa lendo `checklist_ai_audit_events`: ordenação críticos → pendentes → erros IA → forçados → KM → cobertura; filtros por período/técnico/veículo/categoria; coluna de reincidência (contagem por técnico/categoria nos últimos 30 dias); ação "marcar analisado".
- Indicadores com denominadores corretos: finalizados no período, % com alerta, % críticos, pendentes, analisados.

**`src/contexts/AuthContext.tsx`**
- Remover fallback para `admin` (L45): sem role → sem permissão, com mensagem clara. (Antes disso, garantir via consulta que os usuários atuais têm role em `user_roles`.)

**`src/lib/checklist-km.ts` (novo)**
- Extrair normalização de OCR do painel (raw, dígitos, decimal, ambiguidade, comparação com histórico, decisão `km_auto_update_allowed`) para módulo puro testável, usado pelo front e espelhado pela edge.

## 3) Sequência segura de implementação
1. Módulo puro `checklist-km.ts` + testes (sem efeito em produção).
2. Migration da tabela de auditoria + índice de idempotência do chamado (aditivo, sem drop).
3. Frontend: desbloqueios do `canAdvance`, fim da galeria, restauração honesta de rascunho, persistência dupla de auditoria.
4. Submit idempotente (chamado/e-mail aguardados com estado visível).
5. Edge `validate-checklist-photo` (severidade, catch, limites, regra de ouro, conjunto).
6. Edge `notify-checklist-nc` (auth, escape, dedupe).
7. `ChecklistDetail` (histórico de revalidação + timeline).
8. Fila `/auditoria-ia` e indicadores.
9. Endurecimento de segurança: bucket privado + signed URLs, revogação de `anon`, fim do fallback admin. **Último passo**, pois quebra integrações externas.

## 4) Testes a criar
Unitários (Vitest): normalização de KM ("27754 1"→277541, "27754.1"→27754 decimal, Onix 277541, leitura menor = sugestão sem bloqueio, ambíguo = sem auto-update); `auditSeverityFor` por status/categoria; construção de `audit_events` para valid/invalid/forced/pending/error/km_not_confirmed/interior_incomplete; `event_key` estável (idempotência); cobertura de interior multi-foto e repetida; filtros por data da lista.
Integração (mock Supabase): novo checklist vs retomada de rascunho (nunca vira `valid` forjado); ADM editar não muda autoria; autosave e fechamento sem perder fotos; remoção de foto sincroniza storage; chamado + e-mail idempotentes em duplo submit; falha de e-mail não impede salvar nem reporta sucesso falso; permissões (sem role ≠ admin); revalidação preserva histórico.
Edge (deno test/fetch mockado): `ai_error` nunca vira valid; painel sem OCR → `valid:true` + `km_not_confirmed` + `critical`; calibração com manômetro ao fundo aceita; escape de HTML no e-mail; rejeição sem JWT; payload acima do limite.

## 5) Riscos de migração e rollback
- **Bucket privado**: qualquer URL pública salva em `detalhes`/e-mails antigos deixa de abrir. Mitigação: manter leitura por signed URL no app e rollback = voltar o bucket a público (1 comando).
- **Revogar `anon`**: quebra o consumo externo (Auvo GC Sync / agendamento). Fazer só depois de publicar a edge autenticada; rollback = reaplicar os GRANT/policies das migrations `20260525*`/`20260809*`.
- **Fim do fallback admin**: risco de lockout. Mitigação: conferir/semear `user_roles` antes; rollback = restaurar as 2 linhas do `AuthContext`.
- **Índice único do chamado por checklist**: pode falhar se já existirem duplicados. Criar como índice parcial após limpeza; rollback = `DROP INDEX`.
- Tabela de auditoria é aditiva; `detalhes.ai_audit` continua sendo escrito em paralelo durante a transição, então rollback do frontend não perde dados.
