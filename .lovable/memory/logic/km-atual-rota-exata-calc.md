---
name: KM Atual Rota Exata Calculation
description: O KM real do veículo é calculado como (última correção em /odometro) + (delta do odometro_rastreador desde a correção)
type: feature
---

O endpoint `/ultima-posicao/todos` da Rota Exata retorna apenas `odometro_original`/`odometro_gps`, que é a distância acumulada pelo rastreador desde a instalação (NÃO o KM real do veículo).

O KM "corrente" exibido no painel da Rota Exata é calculado em tempo real como:

```
km_real = odometro_adesao_da_ultima_correcao_kmManual
        + max(0, odometro_rastreador_atual_km - odometro_rastreador_na_correcao_km)
```

Implementação em `src/hooks/useSyncRotaExata.ts` e `supabase/functions/cron-sync-rotaexata/index.ts`:

1. `getRastreadorKm(pos)` — extrai odômetro bruto do GPS em km
2. `fetchUltimasCorrecoesOdometro(adesoesIds)` — chama `/odometro?where={adesao_id}` por adesão, pega o registro com maior `created`, retorna `{ adesaoKm, rastreadorKm }`
3. `combineKmAtual(rastreadorAtualKm, correcao)` — aplica a fórmula acima

Usar **sempre** essa combinação ao gravar `vehicles.km_atual`. Nunca usar só o odômetro do GPS direto.
