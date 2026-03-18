

## Plano Atualizado — Módulo de Indicadores de Direção & Cuidado com Ativos

### O que muda

Adicionar um módulo de **Scorecard do Condutor** que avalia direção defensiva e cuidado com ativos da empresa. Cada condutor terá uma ficha de desempenho com indicadores mensuráveis e metas.

---

### Nova Tabela: `driver_performance_records`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| driver_id | FK drivers | Condutor avaliado |
| period_start / period_end | date | Período de avaliação |
| km_sem_telemetria | integer | KM rodados sem telemetria (meta: < 120) |
| comprovantes_perdidos | integer | Comprovantes perdidos/esquecidos (meta: ≤ 1) |
| ferramentas_danificadas | integer | Ferramentas danificadas/perdidas por mau uso (meta: 0) |
| danos_veiculo | integer | Danos dolosos/culposos ao veículo (meta: 0) |
| defeitos_sem_lancamento | integer | Defeitos verificados sem lançamento na plataforma (meta: 0) |
| checklists_completos | integer | Checklists diários preenchidos no período |
| checklists_esperados | integer | Checklists esperados no período |
| observacoes | text | Notas do gestor |
| created_by | FK profiles | Gestor que registrou |
| created_at | timestamptz | |

---

### Interface

**Scorecard do Condutor** (nova seção dentro de `/condutores/:id`)
- Cards visuais com cada indicador, mostrando valor atual vs meta
- Semáforo: verde (dentro da meta), amarelo (limite), vermelho (acima)
- Gráfico de evolução mensal (Recharts) dos indicadores
- Botão para gestor registrar avaliação do período

**Listagem de Condutores** — coluna extra com badge de status geral (Conforme / Atenção / Crítico)

**Relatórios** — novo sub-relatório "Desempenho de Direção" com ranking de condutores por score e filtro por período

---

### Regras de Negócio

- KM sem telemetria alimentado automaticamente via API Rota Exata (cruzando `/posicoes` com odômetro)
- Ferramentas danificadas e danos ao veículo vinculados aos chamados de manutenção tipo "não_conformidade"
- Defeitos sem lançamento detectados quando checklist diário não foi preenchido mas veículo teve movimentação na telemetria
- Score geral calculado: % de indicadores dentro da meta

---

### Resumo das fases (atualizado)

As fases 1-5 do plano anterior permanecem iguais. Este módulo se encaixa como parte da **Fase 2** (cadastro de condutores — adicionar aba de scorecard) e **Fase 5** (relatórios — adicionar relatório de desempenho de direção).

