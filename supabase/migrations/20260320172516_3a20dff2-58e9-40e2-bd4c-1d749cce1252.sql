
INSERT INTO public.checklist_config (config_key, photo_categories, inspection_fields)
VALUES ('default',
  '[
    {"key":"painel","label":"Painel do Veículo","hint":"KM e indicadores visíveis, veículo ligado","min":1,"step":1},
    {"key":"exterior_frente","label":"Frente do Veículo","hint":"Foto frontal completa","min":1,"step":2},
    {"key":"exterior_traseira","label":"Traseira do Veículo","hint":"Foto traseira completa","min":1,"step":2},
    {"key":"exterior_esquerda","label":"Lateral Esquerda","hint":"Foto lateral esquerda completa","min":1,"step":2},
    {"key":"exterior_direita","label":"Lateral Direita","hint":"Foto lateral direita completa","min":1,"step":2},
    {"key":"nivel_oleo","label":"Nível de Óleo","hint":"Foto da vareta ou indicador de nível","min":1,"step":4},
    {"key":"reservatorio_agua","label":"Reservatório de Água","hint":"Foto do reservatório de arrefecimento","min":1,"step":4},
    {"key":"pneu_de","label":"Pneu Dianteiro Esquerdo","hint":"Foto mostrando banda de rodagem","min":1,"step":3},
    {"key":"pneu_dd","label":"Pneu Dianteiro Direito","hint":"Foto mostrando banda de rodagem","min":1,"step":3},
    {"key":"pneu_te","label":"Pneu Traseiro Esquerdo","hint":"Foto mostrando banda de rodagem","min":1,"step":3},
    {"key":"pneu_td","label":"Pneu Traseiro Direito","hint":"Foto mostrando banda de rodagem","min":1,"step":3},
    {"key":"calibracao","label":"Calibração dos Pneus","hint":"Foto do calibrador mostrando pressão","min":1,"step":3},
    {"key":"estepe","label":"Pneu Estepe","hint":"Foto mostrando condição do estepe","min":1,"step":3},
    {"key":"farois_lanternas","label":"Faróis e Lanternas","hint":"Faróis acesos, setas funcionando","min":1,"step":2},
    {"key":"motor","label":"Compartimento do Motor","hint":"Foto do motor aberto","min":1,"step":4},
    {"key":"itens_seguranca","label":"Itens de Segurança","hint":"Triângulo, macaco, chave de roda visíveis","min":1,"step":3},
    {"key":"interior","label":"Interior do Veículo","hint":"Foto da organização e limpeza interna","min":1,"step":5},
    {"key":"danos","label":"Registro de Dano/Avaria","hint":"Foto detalhada do dano encontrado","min":1,"step":6},
    {"key":"avaria","label":"Nova Avaria","hint":"Foto obrigatória da avaria encontrada","min":1,"step":6}
  ]'::jsonb,
  '[
    {"key":"farois_lanternas","label":"Faróis e lanternas funcionando?","category":"Exterior","optionType":"conforme_nao","critical":true},
    {"key":"vidros","label":"Vidros sem trincas/danos?","category":"Exterior","optionType":"sim_nao","critical":false},
    {"key":"limpeza_organizacao","label":"Veículo limpo e organizado?","category":"Exterior","optionType":"sim_nao","critical":false},
    {"key":"pneus","label":"Pneus em condição de saída?","category":"Pneus","optionType":"conforme_nao","critical":true},
    {"key":"pneu_estepe","label":"Estepe em boas condições?","category":"Pneus","optionType":"conforme_nao","critical":false},
    {"key":"itens_seguranca","label":"Triângulo, macaco e chave de roda?","category":"Pneus","optionType":"sim_nao","critical":true},
    {"key":"motor","label":"Motor funcionando normalmente?","category":"Capô","optionType":"conforme_nao","critical":true},
    {"key":"nivel_oleo","label":"Nível de óleo OK?","category":"Capô","optionType":"conforme_nao","critical":true},
    {"key":"nivel_agua","label":"Nível de água/arrefecimento OK?","category":"Capô","optionType":"conforme_nao","critical":true},
    {"key":"ruido_anormal","label":"Existe algum ruído anormal?","category":"Capô","optionType":"nao_sim","critical":true},
    {"key":"cambio","label":"Câmbio funcionando corretamente?","category":"Interior","optionType":"conforme_nao","critical":true},
    {"key":"som","label":"Som/rádio funcionando?","category":"Interior","optionType":"conforme_nao","critical":false},
    {"key":"acessorios","label":"Acessórios e ferramentas presentes?","category":"Interior","optionType":"sim_nao","critical":false},
    {"key":"danos_veiculo","label":"Há algum dano/avaria nova no veículo?","category":"Danos","optionType":"nao_sim","critical":false}
  ]'::jsonb
);
