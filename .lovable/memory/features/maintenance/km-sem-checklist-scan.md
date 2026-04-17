---
name: KM sem checklist scan
description: Varredura diária e sob demanda que abre chamados pra veículos que rodaram sem checklist
type: feature
---
Função `scan-km-sem-checklist` (isolada do cron horário pra não pesar):
- Limite: 30km/dia
- Excluídos: DIW9D20, IXO3G66, OHW9F00
- Deduplica por veículo no dia (1 chamado/dia)
- Cron `scan-km-sem-checklist-daily` roda às 13:30 UTC (10:30 Brasília)
- Botão "Verificar KM sem checklist" no Dashboard (admin only) dispara sob demanda
- Cria ticket `nao_conformidade` prioridade `alta` + e-mail via `notify-checklist-nc`
