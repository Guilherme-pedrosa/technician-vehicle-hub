---
name: sync-daily-km contract
description: Modos strict/resilient, pool de concorrência, retry/backoff, eventos [1,2,3,4], failed_pairs e dedup por external_id no sync-daily-km
type: feature
---

A edge function `sync-daily-km` segue contrato estrito da API RotaExata:

- **Endpoints**: `log_motorista` (KM por motorista, fonte de verdade do vínculo), `dirigibilidade` (eventos brutos com `eventos: [1,2,3,4]` — NÃO existe 5), `resumo-dia` (velocidade máxima).
- **Concorrência**: pool fixo de 5 jobs simultâneos. Cada job dispara as 3 chamadas em paralelo.
- **Retry**: backoff exponencial 500/1500/4000ms apenas em 429/5xx/timeout (25s). Outras falhas (4xx) abortam imediatamente o par.
- **Modos** (parâmetro `mode` no body):
  - `strict` (default): no primeiro par (adesao,dia) que falha após 3 retries, aborta TUDO. Não grava nada. Retorna **502** com `failed_pairs`. Usado em backfill/validação.
  - `resilient`: persiste o que conseguiu e retorna **207** com `failed_pairs`. Usado no sync diário de produção.
- **Resposta**: `{ mode, total_jobs, ok, failed, total_attempts, failed_pairs, inserted_events, inserted_sessions }`.
- **Dedup**: cada evento recebe `external_id` (id RotaExata ou synthetic key `placa|ts|tipo|duracao|endereco`). Upsert com `onConflict: external_id` torna re-syncs idempotentes.
- **Resolução motorista**: helper `_shared/driver-resolution.ts` constrói janelas a partir do `log_motorista` e atribui motorista por timestamp do evento. Fallback para `motorista.nome` do próprio evento só quando NÃO há janela ativa E o nome vem preenchido (≠ "Desconhecido"). Caso contrário, "Sem condutor vinculado".
