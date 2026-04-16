UPDATE public.checklist_config
SET photo_categories = jsonb_set_lax(
  photo_categories::jsonb,
  '{}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem->>'key' IN ('danos', 'avaria')
        THEN jsonb_set(elem, '{ai_prompt}', '"Esta foto documenta um dano, avaria, defeito ou irregularidade no veículo. ACEITE a foto se ela mostrar QUALQUER parte do veículo (interior ou exterior) que possa estar sendo documentada como problema — isso inclui: peças quebradas, soltas, faltando, mal encaixadas, rachadas, amassadas, riscadas, sujas em excesso, fora de posição, com mau funcionamento aparente, ou qualquer componente que o técnico julgou necessário registrar (ex: quebra-sol danificado, maçaneta solta, forro rasgado, calotas faltando, parafusos expostos, peças improvisadas). NÃO exija que o dano seja óbvio ou dramático — muitos defeitos são sutis. Se a foto mostra uma parte do veículo em close-up ou contexto, ACEITE. Só REJEITE se a foto claramente NÃO for de um veículo (ex: foto de pessoa, paisagem, objeto não automotivo)."')
        ELSE elem
      END
    )
    FROM jsonb_array_elements(photo_categories::jsonb) AS elem
  )
)
WHERE config_key = 'default';