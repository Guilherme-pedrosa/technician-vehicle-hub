---
name: KM Painel Auto-Correction Policy
description: Quando a IA lê o KM do painel com alta confiança, deve sugerir correção do km_atual do veículo ao invés de bloquear o checklist por divergência
type: preference
---

Quando a validação da foto do painel lê o KM com alta confiança (sem ambiguidade nos dígitos), o sistema deve:

1. **Nunca bloquear o checklist** apenas por divergência de KM entre foto e cadastro
2. **Sugerir a correção** do `km_atual` do veículo se o KM lido na foto for diferente do cadastrado — mesmo que seja MENOR
3. O KM cadastrado pode estar errado por diversas razões (ex: frentista abastecendo com KM errado e atualizando no Rota Exata)
4. A foto do painel é a fonte de verdade mais confiável quando a leitura é clara

O scan de divergência (`scan-km-divergence`) continua criando tickets para diferenças grandes (>5000 km), mas isso é apenas um alerta — não deve impedir o checklist.
