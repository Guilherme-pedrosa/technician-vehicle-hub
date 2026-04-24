---
name: Liberação de checklist bloqueado
description: Admins podem liberar veículos bloqueados; toda ação fica registrada em log com auditoria
type: feature
---
- Apenas admins podem liberar veículo bloqueado ou re-bloquear um já liberado
- Botão "Liberar" aparece na lista (Checklist.tsx) e no detalhe (ChecklistDetail.tsx) quando `resultado === "bloqueado"`
- Botão "Re-bloquear" aparece quando `resultado === "liberado_obs"` (permite reverter com nova justificativa)
- Justificativa obrigatória (mín 5 chars) — atualiza `vehicle_checklists.resultado_motivo`
- Liberação muda resultado para `liberado_obs`
- Cada ação grava em `checklist_release_log` (action: liberacao | rebloqueio)
- Timeline aparece no fim do ChecklistDetail
- Página `/auditoria-liberacoes` lista todas as liberações da frota com filtros de data e busca
- Componentes: `LiberarBloqueioDialog`, `ReleaseLogTimeline` em `src/components/checklist/`
