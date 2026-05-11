import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Modelo definido com consentimento explícito do dono do app para melhorar a leitura visual do KM do painel.
const PHOTO_VALIDATION_MODEL = "openai/gpt-5.4";

// Critérios específicos por categoria
const CATEGORY_CRITERIA: Record<string, { label: string; criterio: string; has_critical: boolean; has_cleanliness_check?: boolean }> = {
  painel: {
    label: "Painel do veículo",
    criterio: "A foto deve ser um CLOSE-UP DIRETO do painel de instrumentos (cluster) do veículo, com o HODÔMETRO/ODÔMETRO (KM total) NITIDAMENTE LEGÍVEL — os dígitos do KM devem ser claramente identificáveis a olho nu na imagem. REQUISITOS OBRIGATÓRIOS: (1) o cluster de instrumentos (velocímetro, conta-giros, display do KM) deve OCUPAR a maior parte do enquadramento; (2) os números do hodômetro devem estar em FOCO e LEGÍVEIS — se estiverem borrados, distantes, refletindo demais, escuros ou cortados, REJEITE; (3) a foto deve ser tirada de FRENTE para o painel, não de lado. REJEITE OBRIGATORIAMENTE (valid=false, target_match=false, critical_visible=false) se: (a) a foto for uma visão ampla/panorâmica do interior mostrando volante, bancos ou para-brisa com o painel pequeno ao fundo; (b) o foco principal for o volante, console central, rádio ou airbag e não o cluster de instrumentos; (c) o KM/hodômetro não estiver legível ou nem aparecer; (d) a foto for de outro mostrador qualquer (ar-condicionado, rádio, GPS) que não seja o cluster com KM. Na 'reason', se rejeitar, explique exatamente o que está errado (ex: 'Foto panorâmica do interior, hodômetro não legível' ou 'Foco no volante, painel ao fundo sem KM visível').",
    has_critical: true,
  },
  exterior_frente: {
    label: "Frente do veículo (com faróis acesos)",
    criterio: "A foto deve conter a parte DIANTEIRA do veículo (capô, para-choque, grade, faróis, placa) — esses elementos confirmam o enquadramento. OBSTRUÇÃO: REJEITE (target_match=false) se a PLACA, o PARA-CHOQUE ou os FARÓIS estiverem SIGNIFICATIVAMENTE OBSTRUÍDOS/TAMPADOS por outro veículo, objeto, pessoa ou qualquer obstáculo que impeça a inspeção visual dessas áreas. A foto deve permitir verificar o estado do para-choque, grade, faróis e placa — se um desses está escondido atrás de outro carro, barreira ou objeto, a foto NÃO serve para inspeção. Na 'reason', descreva o que está obstruído (ex: 'Placa tampada por outro veículo estacionado à frente', 'Para-choque não visível por obstrução'). ALÉM DISSO, você DEVE analisar o ESTADO DOS FARÓIS DIANTEIROS para verificar se estão ACESOS: procure por brilho/halo emitido pelas lentes dos faróis (luz baixa, luz alta ou luz de posição/DRL), reflexo no chão, ou contraste claro entre as lentes acesas e a carroceria. Retorne os campos extras: 'farois_acesos' (true/false/null) e 'farois_observacao' (curta, ex: 'farol direito apagado', 'ambos acesos com luz baixa', 'não foi possível avaliar pela iluminação ambiente'). Use null APENAS se a foto estiver muito clara/contra-luz/escura demais para concluir. Se UM dos faróis estiver claramente apagado enquanto o outro acende, marque farois_acesos=false e descreva qual lado. NÃO rejeite a foto só porque os faróis estão apagados — apenas reporte.",
    has_critical: false,
  },
  exterior_traseira: {
    label: "Traseira do veículo (com lanternas acesas)",
    criterio: "A foto deve conter a parte TRASEIRA do veículo (para-choque traseiro, lanternas, placa, porta-malas) — esses elementos confirmam o enquadramento. OBSTRUÇÃO: REJEITE (target_match=false) se a PLACA, o PARA-CHOQUE TRASEIRO ou as LANTERNAS estiverem SIGNIFICATIVAMENTE OBSTRUÍDOS/TAMPADOS por outro veículo, objeto, pessoa ou qualquer obstáculo que impeça a inspeção visual. A foto deve permitir verificar o estado do para-choque traseiro, lanternas e placa — se algum está escondido, a foto NÃO serve. Na 'reason', descreva o que está obstruído. ALÉM DISSO, você DEVE analisar o ESTADO DAS LANTERNAS TRASEIRAS para verificar se estão ACESAS: procure por brilho vermelho/âmbar nas lenses das lanternas (luz de posição, freio ou ré), reflexo no chão, ou contraste claro entre as lentes iluminadas e a carroceria. Retorne os campos extras: 'lanternas_acesas' (true/false/null) e 'lanternas_observacao' (curta, ex: 'lanterna esquerda apagada', 'ambas acesas', 'não foi possível avaliar'). Use null APENAS se a foto estiver muito clara/contra-luz/escura demais para concluir. Se UMA lanterna estiver claramente apagada enquanto a outra acende, marque lanternas_acesas=false e descreva qual lado. NÃO rejeite a foto só porque as lanternas estão apagadas — apenas reporte.",
    has_critical: false,
  },
  exterior_esquerda: {
    label: "Lateral esquerda do veículo",
    criterio: "A foto deve mostrar o PERFIL LATERAL ESQUERDO do veículo (lado do MOTORISTA em veículos brasileiros). ACEITE quando a lateral estiver majoritariamente visível e der para avaliar paralama dianteiro, portas/coluna lateral e paralama traseiro. OBSTRUÇÃO: REJEITE (target_match=false) se uma porção SIGNIFICATIVA da lateral estiver OBSTRUÍDA/TAMPADA por outro veículo, parede, objeto grande ou qualquer obstáculo que impeça a inspeção visual do estado da carroceria. A lateral precisa estar suficientemente livre para verificar amassados, riscos e danos. Na 'reason', descreva o que está obstruindo. VERIFICAÇÃO DE LADO: Identifique se a foto mostra o lado esquerdo (motorista) ou direito (passageiro). Se a foto CLARAMENTE mostra a lateral DIREITA ao invés da esquerda, REJEITE com target_match=false. Só REJEITE por corte se uma extremidade real do veículo estiver claramente fora do enquadramento. REJEITE também se a foto for aérea/de cima, muito diagonal/rotacionada, mostrar só frente/traseira, ou mostrar apenas um detalhe isolado.",
    has_critical: false,
  },
  exterior_direita: {
    label: "Lateral direita do veículo",
    criterio: "A foto deve mostrar o PERFIL LATERAL DIREITO do veículo (lado do PASSAGEIRO em veículos brasileiros). ACEITE quando a lateral estiver majoritariamente visível e der para avaliar paralama dianteiro, portas/coluna lateral e paralama traseiro. OBSTRUÇÃO: REJEITE (target_match=false) se uma porção SIGNIFICATIVA da lateral estiver OBSTRUÍDA/TAMPADA por outro veículo, parede, objeto grande ou qualquer obstáculo que impeça a inspeção visual do estado da carroceria. A lateral precisa estar suficientemente livre para verificar amassados, riscos e danos. Na 'reason', descreva o que está obstruindo. VERIFICAÇÃO DE LADO: Identifique se a foto mostra o lado direito (passageiro) ou esquerdo (motorista). Se a foto CLARAMENTE mostra a lateral ESQUERDA ao invés da direita, REJEITE com target_match=false. Só REJEITE por corte se uma extremidade real do veículo estiver claramente fora do enquadramento. REJEITE também se a foto for aérea/de cima, muito diagonal/rotacionada, mostrar só frente/traseira, ou mostrar apenas um detalhe isolado.",
    has_critical: false,
  },
  nivel_oleo: {
    label: "Nível de óleo",
    criterio: "Deve mostrar a vareta de óleo do motor com o NÍVEL DO ÓLEO visível. A vareta deve estar fora do motor e o óleo deve ser visível na ponta da vareta. Verifique se o nível está entre as marcas MIN e MAX. Se o óleo estiver ABAIXO da marca MIN ou não for possível identificar o nível na vareta, marque critical_visible=false. Se o nível estiver entre MIN e MAX ou próximo do MAX, critical_visible=true.",
    has_critical: true,
  },
  etiqueta_oleo: {
    label: "Etiqueta de troca de óleo",
    criterio: "A foto deve mostrar a ETIQUETA/ADESIVO de troca de óleo do veículo. Essa etiqueta geralmente está colada no para-brisa (canto superior), na coluna da porta do motorista, ou dentro do compartimento do motor. Deve conter informações como a quilometragem da PRÓXIMA TROCA e/ou a data da última troca. ACEITE se a etiqueta estiver legível e mostrar dados de troca de óleo (KM, data). REJEITE se: (1) não houver etiqueta visível; (2) a foto estiver desfocada e não der pra ler os dados; (3) a foto mostrar outra coisa que não é uma etiqueta de óleo. Na 'reason', descreva o que está visível na etiqueta.",
    has_critical: false,
  },
  reservatorio_agua: {
    label: "Reservatório de água/arrefecimento",
    criterio: "A foto deve mostrar o reservatório de água/arrefecimento do veículo E PRECISA permitir CONFIRMAR VISUALMENTE QUE HÁ LÍQUIDO DENTRO DELE (água/aditivo de arrefecimento). Não basta mostrar o reservatório fechado por cima — é preciso ver o líquido. SINAIS ACEITÁVEIS de presença de líquido: (a) marca/linha de líquido visível na lateral do reservatório (mesmo que opaco, dá pra ver a sombra do nível); (b) líquido visível por dentro/por cima com a tampa aberta; (c) reservatório translúcido onde se vê claramente o líquido (cor verde, rosa, laranja, azul, marrom). REJEITE OBRIGATORIAMENTE (target_match=false, critical_visible=false) se: (1) a foto mostra apenas a TAMPA fechada do reservatório de cima, sem qualquer indício do líquido; (2) o reservatório aparece, mas o ângulo/iluminação/foco não permite afirmar que tem líquido (ex: foto só do plástico amarelo da tampa, ou foto distante onde não dá pra ver dentro); (3) o reservatório está CLARAMENTE VAZIO/SECO (sem nenhuma marca de líquido na lateral nem dentro). Na 'reason', se rejeitar, oriente: 'Tire uma nova foto mostrando o LÍQUIDO dentro do reservatório — preferencialmente da LATERAL para ver a marca do nível, ou abrindo a tampa pra mostrar a água por dentro.' Se aceitar, descreva o que viu (ex: 'Líquido laranja visível pela lateral do reservatório, acima da marca MIN').",
    has_critical: true,
  },
  pneu_de: {
    label: "Pneu dianteiro esquerdo",
    criterio: "DEFINIÇÃO IMPORTANTE: 'banda de rodagem' = a SUPERFÍCIE EXTERNA do pneu que toca o chão, onde ficam os SULCOS/RANHURAS/DESENHO do pneu (a 'sola' do pneu). Não é a lateral lisa (flanco), não é a roda/aro/calota. ACEITE quando a foto mostrar nitidamente essa superfície com sulcos visíveis (mesmo que de ângulo, basta dar para enxergar o desenho/ranhuras do pneu). REJEITE quando a foto mostrar apenas a LATERAL do pneu (flanco liso, com letras/números), apenas a roda/calota/parafusos, estiver muito longe/fora de foco, ou quando a banda de rodagem estiver TOTALMENTE COBERTA (por terra, lama, sujeira ou outro objeto) a ponto de não ser possível ver os sulcos. Na 'reason' ao rejeitar, oriente OBJETIVAMENTE o que tirar: 'Aproxime e fotografe a parte do pneu que toca o chão, mostrando os sulcos/desenho da borracha (banda de rodagem). A foto atual mostra apenas [a lateral / a roda / está coberta e não dá para ver os sulcos].' PROIBIDO diagnosticar estado do pneu (careca, murcho, vazio, furado, pressão). PROIBIDO citar 'sujeira' ou 'terra' como motivo isolado — só mencione cobertura por sujeira se ela realmente impedir ver QUALQUER sulco.",
    has_critical: false,
  },
  pneu_dd: {
    label: "Pneu dianteiro direito",
    criterio: "DEFINIÇÃO IMPORTANTE: 'banda de rodagem' = a SUPERFÍCIE EXTERNA do pneu que toca o chão, onde ficam os SULCOS/RANHURAS/DESENHO. Não é a lateral lisa (flanco), não é a roda/aro/calota. ACEITE quando a foto mostrar nitidamente essa superfície com sulcos visíveis (mesmo de ângulo, basta enxergar o desenho/ranhuras). REJEITE quando mostrar apenas a LATERAL do pneu, apenas a roda/calota, estiver muito longe/fora de foco, ou a banda estiver TOTALMENTE coberta a ponto de não ver nenhum sulco. Na 'reason' ao rejeitar, oriente: 'Aproxime e fotografe a parte do pneu que toca o chão, mostrando os sulcos/desenho da borracha.' PROIBIDO diagnosticar estado do pneu. PROIBIDO usar 'sujo/terra' como motivo isolado.",
    has_critical: false,
  },
  pneu_te: {
    label: "Pneu traseiro esquerdo",
    criterio: "DEFINIÇÃO IMPORTANTE: 'banda de rodagem' = a SUPERFÍCIE EXTERNA do pneu que toca o chão, onde ficam os SULCOS/RANHURAS/DESENHO. Não é a lateral lisa (flanco), não é a roda/aro/calota. ACEITE quando a foto mostrar nitidamente essa superfície com sulcos visíveis (mesmo de ângulo, basta enxergar o desenho/ranhuras). REJEITE quando mostrar apenas a LATERAL do pneu, apenas a roda/calota, estiver muito longe/fora de foco, ou a banda estiver TOTALMENTE coberta a ponto de não ver nenhum sulco. Na 'reason' ao rejeitar, oriente: 'Aproxime e fotografe a parte do pneu que toca o chão, mostrando os sulcos/desenho da borracha.' PROIBIDO diagnosticar estado do pneu. PROIBIDO usar 'sujo/terra' como motivo isolado.",
    has_critical: false,
  },
  pneu_td: {
    label: "Pneu traseiro direito",
    criterio: "DEFINIÇÃO IMPORTANTE: 'banda de rodagem' = a SUPERFÍCIE EXTERNA do pneu que toca o chão, onde ficam os SULCOS/RANHURAS/DESENHO. Não é a lateral lisa (flanco), não é a roda/aro/calota. ACEITE quando a foto mostrar nitidamente essa superfície com sulcos visíveis (mesmo de ângulo, basta enxergar o desenho/ranhuras). REJEITE quando mostrar apenas a LATERAL do pneu, apenas a roda/calota, estiver muito longe/fora de foco, ou a banda estiver TOTALMENTE coberta a ponto de não ver nenhum sulco. Na 'reason' ao rejeitar, oriente: 'Aproxime e fotografe a parte do pneu que toca o chão, mostrando os sulcos/desenho da borracha.' PROIBIDO diagnosticar estado do pneu. PROIBIDO usar 'sujo/terra' como motivo isolado.",
    has_critical: false,
  },
  calibracao_de: {
    label: "Calibragem — Dianteiro Esquerdo",
    criterio: "REGRA EXTREMAMENTE PERMISSIVA. ACEITE a foto se houver QUALQUER indício de cenário de calibragem: bico/mangueira no pneu, OU aparelho calibrador/manômetro/reloginho/inflador visível em QUALQUER parte da imagem (mesmo MUITO ao fundo, desfocado, parcial, pequeno, em cima do carro, ao lado, no chão, em outro veículo próximo, em estrutura do posto/borracharia/oficina), OU contexto típico de posto/borracharia (bomba, totem, mangueiras penduradas). NÃO exija ver bico E aparelho juntos — UM dos dois já basta. NÃO exija nitidez, leitura de pressão, enquadramento perfeito, nem ver o pneu inteiro. EM CASO DE DÚVIDA, ACEITE. REJEITE somente se a foto NÃO tiver nenhum pneu visível OU for claramente de outro contexto (selfie, documento, tela, ambiente sem qualquer relação com calibragem).",
    has_critical: true,
  },
  calibracao_dd: {
    label: "Calibragem — Dianteiro Direito",
    criterio: "REGRA EXTREMAMENTE PERMISSIVA. ACEITE a foto se houver QUALQUER indício de cenário de calibragem: bico/mangueira no pneu, OU aparelho calibrador/manômetro/reloginho/inflador visível em QUALQUER parte da imagem (mesmo MUITO ao fundo, desfocado, parcial, pequeno, em cima do carro, ao lado, no chão, em outro veículo próximo, em estrutura do posto/borracharia/oficina), OU contexto típico de posto/borracharia (bomba, totem, mangueiras penduradas). NÃO exija ver bico E aparelho juntos — UM dos dois já basta. NÃO exija nitidez, leitura de pressão, enquadramento perfeito, nem ver o pneu inteiro. EM CASO DE DÚVIDA, ACEITE. REJEITE somente se a foto NÃO tiver nenhum pneu visível OU for claramente de outro contexto (selfie, documento, tela, ambiente sem qualquer relação com calibragem).",
    has_critical: true,
  },
  calibracao_te: {
    label: "Calibragem — Traseiro Esquerdo",
    criterio: "REGRA EXTREMAMENTE PERMISSIVA. ACEITE a foto se houver QUALQUER indício de cenário de calibragem: bico/mangueira no pneu, OU aparelho calibrador/manômetro/reloginho/inflador visível em QUALQUER parte da imagem (mesmo MUITO ao fundo, desfocado, parcial, pequeno, em cima do carro, ao lado, no chão, em outro veículo próximo, em estrutura do posto/borracharia/oficina), OU contexto típico de posto/borracharia (bomba, totem, mangueiras penduradas). NÃO exija ver bico E aparelho juntos — UM dos dois já basta. NÃO exija nitidez, leitura de pressão, enquadramento perfeito, nem ver o pneu inteiro. EM CASO DE DÚVIDA, ACEITE. REJEITE somente se a foto NÃO tiver nenhum pneu visível OU for claramente de outro contexto (selfie, documento, tela, ambiente sem qualquer relação com calibragem).",
    has_critical: true,
  },
  calibracao_td: {
    label: "Calibragem — Traseiro Direito",
    criterio: "REGRA EXTREMAMENTE PERMISSIVA. ACEITE a foto se houver QUALQUER indício de cenário de calibragem: bico/mangueira no pneu, OU aparelho calibrador/manômetro/reloginho/inflador visível em QUALQUER parte da imagem (mesmo MUITO ao fundo, desfocado, parcial, pequeno, em cima do carro, ao lado, no chão, em outro veículo próximo, em estrutura do posto/borracharia/oficina), OU contexto típico de posto/borracharia (bomba, totem, mangueiras penduradas). NÃO exija ver bico E aparelho juntos — UM dos dois já basta. NÃO exija nitidez, leitura de pressão, enquadramento perfeito, nem ver o pneu inteiro. EM CASO DE DÚVIDA, ACEITE. REJEITE somente se a foto NÃO tiver nenhum pneu visível OU for claramente de outro contexto (selfie, documento, tela, ambiente sem qualquer relação com calibragem).",
    has_critical: true,
  },
  estepe: {
    label: "Pneu estepe",
    criterio: "Deve mostrar o pneu estepe (pneu reserva) do veículo de forma identificável.",
    has_critical: false,
  },
  farois_lanternas: {
    label: "Faróis e lanternas",
    criterio: "A foto deve mostrar faróis OU lanternas de um veículo. Faróis são as luzes dianteiras (podem estar apagados ou acesos). Lanternas são as luzes traseiras. Se a foto mostra a frente do veículo, os faróis estão visíveis na imagem — isso é válido. Se mostra a traseira, as lanternas estão visíveis — isso também é válido. NÃO exija close-up dos faróis. Uma foto do veículo de frente ou de trás CONTÉM faróis/lanternas por definição.",
    has_critical: false,
  },
  motor: {
    label: "Compartimento do motor",
    criterio: "Deve mostrar o compartimento do motor do veículo com o capô aberto.",
    has_critical: false,
  },
  itens_seguranca: {
    label: "Itens de segurança",
    criterio: "A foto DEVE mostrar os três itens de segurança obrigatórios: triângulo de sinalização (peça refletiva vermelha/laranja, geralmente triangular OU em formato de placa retangular refletiva quando dobrado/quebrado), macaco hidráulico/mecânico e chave de roda. REGRAS CRÍTICAS: (1) Só afirme que um item está presente se você conseguir IDENTIFICÁ-LO COM CERTEZA na imagem. (2) ITEM DANIFICADO/QUEBRADO AINDA CONTA COMO PRESENTE — o objetivo aqui é verificar a EXISTÊNCIA do item, não o estado de conservação. Um triângulo quebrado, dobrado ou em pedaços (desde que reconhecível como peça refletiva de sinalização) deve ser considerado VISÍVEL. (3) Se a foto está escura, desfocada ou os itens estão dentro de um estojo fechado/difícil de ver, NÃO ADIVINHE quais itens são — diga que NÃO foi possível identificar os itens e rejeite. (4) Na mensagem de 'reason', liste APENAS os itens que você tem CERTEZA ABSOLUTA de ver. Se identificar algum item danificado, MENCIONE no reason (ex: 'triângulo presente mas aparenta estar quebrado') mas considere target_match=true. (5) Se não tem certeza de nenhum, diga 'Não foi possível identificar os itens de segurança na foto'. (6) NUNCA invente um item que não está visível — mas TAMBÉM NUNCA rejeite um item visível só porque está danificado. (7) Para aceitar (target_match=true), os 3 itens devem ser identificáveis (mesmo que algum esteja danificado).",
    has_critical: true,
  },
  interior: {
    label: "Interior do veículo",
    criterio: "A validação do INTERIOR é feita pelo CONJUNTO de fotos, então uma foto individual pode mostrar apenas parte do habitáculo. Para esta foto individual, ACEITE se ela mostrar com nitidez uma VISÃO AMPLA de pelo menos uma área interna útil para inspeção. REJEITE OBRIGATORIAMENTE se a foto: (1) não mostrar interior de veículo; (2) estiver DESFOCADA/BORRADA a ponto de não identificar os elementos; (3) for um CLOSE-UP restrito que mostra APENAS o câmbio, alavanca de marchas, console central, rádio/multimídia, volante, alto-falante, maçaneta, soleira, pedal ou qualquer detalhe isolado SEM CONTEXTO DO RESTANTE DO INTERIOR — esses close-ups NÃO servem para inspeção do interior; (4) mostrar apenas um ângulo muito restrito sem contexto suficiente. PARA SER ACEITA, a foto precisa ter uma visão que permita avaliar o ESTADO GERAL de pelo menos uma zona do interior (ex: visão dos bancos dianteiros COM parte do assoalho/portas visível; visão do teto COM quebra-sol; visão ampla desde o volante até os bancos traseiros). Inclua obrigatoriamente 'detected_elements' no JSON usando somente estes valores: bancos_dianteiros, bancos_traseiros, painel_console, volante_cambio, forros_porta, assoalho_tapetes, quebra_sol, teto_forro. SEJA RIGOROSO: só inclua um elemento em detected_elements se ele estiver REALMENTE VISÍVEL e IDENTIFICÁVEL na foto. NÃO presuma que quebra-sol está visível só porque aparece o teto — ele precisa estar claramente na foto (a aba/viseira rebatível). Close-ups do câmbio/alavanca = detected_elements VAZIO = REJEITAR.",
    has_critical: false,
    has_cleanliness_check: true,
  },
  exc_limpeza_organizacao: {
    label: "Evidência de limpeza/organização",
    criterio: "Esta foto documenta uma NÃO CONFORMIDADE de limpeza/organização que o técnico já identificou. ACEITE se a imagem mostrar evidência relacionada a sujeira, lixo, objetos soltos, itens retirados de dentro do carro, bagunça, para-sol/objetos fora do lugar, ou qualquer material usado para comprovar que o veículo não estava limpo/organizado. NÃO exija que apareça uma peça do veículo: lixo retirado do carro, objetos removidos da cabine ou itens fotografados fora do veículo continuam sendo evidência relevante. REJEITE apenas se a foto não tiver relação nenhuma com limpeza/organização ou estiver impossível de entender.",
    has_critical: false,
  },
  danos: {
    label: "Dano/avaria",
    criterio: "Esta foto documenta um dano/avaria que o TÉCNICO já identificou — sua função NÃO é decidir se existe defeito, e sim CONFIRMAR que a foto mostra alguma parte de um veículo. ACEITE OBRIGATORIAMENTE se a imagem mostrar qualquer componente automotivo (interior, exterior, motor, porta-malas, vão do motor, soleira, alavancas, cabos, forros, painéis, parafusos, encaixes, mecanismos, etc.), seja em close-up ou em contexto. NUNCA rejeite com justificativas como 'parece ser apenas um mecanismo normal', 'é o cabo de abertura do capô', 'é uma peça funcional', 'não vejo dano óbvio' — o técnico é quem identifica o problema; você só valida que é foto de veículo. REJEITE EXCLUSIVAMENTE se a foto não tiver nada de automotivo (pessoa, paisagem, comida, tela de celular, objeto sem relação com veículo). Em caso de dúvida → ACEITE.",
    has_critical: false,
  },
  avaria: {
    label: "Dano/avaria",
    criterio: "Esta foto documenta um dano/avaria que o TÉCNICO já identificou — sua função NÃO é decidir se existe defeito, e sim CONFIRMAR que a foto mostra alguma parte de um veículo. ACEITE OBRIGATORIAMENTE se a imagem mostrar qualquer componente automotivo (interior, exterior, motor, porta-malas, vão do motor, soleira, alavancas, cabos, forros, painéis, parafusos, encaixes, mecanismos, etc.), seja em close-up ou em contexto. NUNCA rejeite com justificativas como 'parece ser apenas um mecanismo normal', 'é o cabo de abertura do capô', 'é uma peça funcional', 'não vejo dano óbvio' — o técnico é quem identifica o problema; você só valida que é foto de veículo. REJEITE EXCLUSIVAMENTE se a foto não tiver nada de automotivo (pessoa, paisagem, comida, tela de celular, objeto sem relação com veículo). Em caso de dúvida → ACEITE.",
    has_critical: false,
  },
};

// Categories where vehicle model verification matters
const VEHICLE_CHECK_CATEGORIES = [
  "exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita", "painel",
];

const INTERIOR_OVERSTRICT_REJECTION_PATTERNS = [
  /vis[aã]o ampla do interior/i,
  /pelo menos dois elementos/i,
  /n[ãa]o permitem visualizar/i,
  /focando apenas nos bancos/i,
  /parte dos bancos dianteiros/i,
];

function extractJsonObject(content: unknown): Record<string, unknown> | null {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => part?.text ?? part?.content ?? "").join("\n")
      : "";

  const candidates = [
    text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim(),
    text.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (_) {
      // tenta próximo formato
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({
        valid: false, vehicle_match: false, target_match: false, focus_ok: false,
        critical_visible: false, quality: "ruim", confidence: 0,
        reason: "Validação IA não configurada. Contate o administrador.",
        ai_error: true,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { image_base64, category, vehicle_marca, vehicle_modelo, limpeza_claim, expected_vehicle_km } = await req.json();

    if (!image_base64 || !category) {
      return new Response(JSON.stringify({ error: "image_base64 e category são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to load dynamic prompt from checklist_config
    let dynamicPrompt: string | null = null;
    try {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data: configData } = await adminClient
        .from("checklist_config")
        .select("photo_categories")
        .eq("config_key", "default")
        .single();
      if (configData?.photo_categories) {
        const cats = configData.photo_categories as any[];
        const match = cats.find((c: any) => c.key === category);
        if (match?.ai_prompt) {
          dynamicPrompt = match.ai_prompt;
        }
      }
    } catch (e) {
      console.log("Could not load dynamic prompt, using hardcoded:", e);
    }

    const catConfig = CATEGORY_CRITERIA[category] || {
      label: category,
      criterio: "A foto deve ser relevante para uma inspeção veicular.",
      has_critical: false,
    };

    // Painel usa o critério versionado no código para não herdar prompts antigos que desativavam o OCR.
    const finalCriterio = category === "painel" ? catConfig.criterio : (dynamicPrompt || catConfig.criterio);

    const vehicleInfo = (vehicle_marca || vehicle_modelo)
      ? `${vehicle_marca || "?"} ${vehicle_modelo || "?"}`
      : "Não informado";

    const expectedVehicleKm = typeof expected_vehicle_km === "number" && Number.isFinite(expected_vehicle_km) && expected_vehicle_km > 0
      ? Math.trunc(expected_vehicle_km)
      : null;
    const expectedKmDigits = expectedVehicleKm ? String(expectedVehicleKm).length : null;

    const shouldCheckVehicle = VEHICLE_CHECK_CATEGORIES.includes(category);

    const systemPrompt = `Você é um sistema de validação de fotos para checklist de inspeção veicular.

Sua função é verificar separadamente:
1. Se a foto parece ser do veículo correto
2. Se a foto mostra exatamente o item/área solicitada
3. Se a imagem tem foco e qualidade suficientes
4. Se o conteúdo está legível/confirmável quando houver dado crítico

Responda APENAS com um JSON válido, sem texto extra, no formato:

{
  "valid": true,
  "vehicle_match": true,
  "target_match": true,
  "focus_ok": true,
  "critical_visible": true,
  "quality": "boa",
  "reason": "motivo breve em português",
  "confidence": 0.95${category === "painel" ? `,
  "km_lido": "173552",
  "km_legivel": true` : ""}${category === "exterior_frente" ? `,
  "farois_acesos": true,
  "farois_observacao": "ambos os faróis aparentam estar acesos"` : ""}${category === "exterior_traseira" ? `,
  "lanternas_acesas": true,
  "lanternas_observacao": "ambas as lanternas aparentam estar acesas"` : ""}
}

Regras:

- "vehicle_match": ${shouldCheckVehicle
  ? 'true se a imagem mostrar um veículo automotivo. Só marque false se a foto mostrar algo que DEFINITIVAMENTE NÃO É um veículo (ex: foto de pessoa, objeto aleatório). NÃO tente identificar marca/modelo específico — veículos da mesma frota podem ter adesivos, cores e versões diferentes. Variações como sedan vs hatch, cores diferentes, ou logotipos de empresa NÃO são motivo para rejeitar. Na dúvida, SEMPRE aceite como true.'
  : 'true (não aplicável para esta categoria)'}
- "target_match": true somente se a imagem mostrar exatamente o item, peça ou área solicitada. Se mostrar algo completamente diferente (ex: foto de pessoa quando deveria ser pneu), false.
- "focus_ok": true somente se a imagem tiver nitidez suficiente para verificar o item solicitado. Se a foto estiver BORRADA, TREMIDA, DESFOCADA ao ponto que detalhes importantes (textos, bordas, contornos) não são nítidos, marque focus_ok=false e quality="ruim". NÃO aceite fotos desfocadas — o técnico pode e deve tirar outra foto. Uma leve perda de foco em áreas periféricas é tolerável, mas o ASSUNTO PRINCIPAL da foto deve estar nítido.
- "critical_visible": ${catConfig.has_critical
  ? 'true somente quando o dado crítico principal estiver visível e legível na foto. false se o dado aparecer mas não puder ser lido/confirmado.'
  : 'true (não há dado crítico a ser verificado nesta categoria)'}
- "quality":
  - "boa" = imagem nítida, clara, bem enquadrada
  - "aceitavel" = pequena limitação de ângulo ou iluminação, mas ainda validável
  - "ruim" = desfocada, escura, tremida, estourada ou insuficiente para validação
- "valid": true somente se TODAS estas condições forem verdadeiras:
  - target_match = true
  - focus_ok = true
  - quality = "boa" ou "aceitavel"
  - vehicle_match = true (quando aplicável)
  - critical_visible = true (quando aplicável)
- "reason": deve ser curta, objetiva e em português
- "confidence": número de 0.00 a 1.00 indicando a confiança geral da análise
- REGRA DE OURO: Nunca invente detalhes não visíveis na foto. Se não consegue identificar um objeto com certeza, NÃO diga que ele está presente. É preferível rejeitar do que afirmar algo falso. Na "reason", mencione SOMENTE o que você tem certeza de ver.
- Analise a foto com base nos ELEMENTOS VISUAIS listados no critério. Se qualquer um dos elementos indicados estiver presente na imagem, target_match deve ser true.
- Para faróis/lanternas: qualquer foto que mostre a frente ou traseira de um veículo CONTÉM faróis ou lanternas — valide como target_match=true.
- Para laterais: aceite quando a lateral estiver majoritariamente visível e der para inspecionar paralama dianteiro, portas/coluna lateral e paralama traseiro. Não confunda perspectiva normal do celular ou ângulo 3/4 leve com corte.
- Só rejeite laterais por corte quando uma extremidade real estiver claramente FORA do enquadramento, escondida por obstáculo, escura demais ou impossível de avaliar. Se a dianteira/traseira aparece menor por perspectiva, mas ainda está dentro da foto, isso NÃO é corte.
- Fotos laterais tiradas de cima (vista aérea), com rotação forte, diagonal forte, mostrando só frente/traseira, ou sem cobertura suficiente da lateral devem ser rejeitadas.
${category === "painel" ? `
REGRA OBRIGATÓRIA PARA PAINEL — LEGIBILIDADE DO HODÔMETRO:
Você DEVE enxergar, ler e retornar o número do KM total do hodômetro para preenchimento automático do app — mas SOMENTE quando todos os dígitos estiverem visualmente claros.

PROCEDIMENTO OBRIGATÓRIO PASSO A PASSO:
1. Localize o display do HODÔMETRO (NÃO velocímetro, NÃO RPM, NÃO trip parcial "TRIP A/B", NÃO temperatura, NÃO combustível, NÃO relógio). É o display de 5–7 dígitos da quilometragem TOTAL acumulada.
2. Leia o KM dígito por dígito, da esquerda para a direita. Confira especialmente o PRIMEIRO dígito — nunca ignore "1" inicial em odômetros de 6 dígitos.
${expectedKmDigits ? `3. CONTEXTO DE VALIDAÇÃO: o veículo cadastrado está em torno de ${expectedVehicleKm} km e tem ${expectedKmDigits} dígitos. Portanto, a leitura da foto também deve ter ${expectedKmDigits} dígitos. Se você enxergar só ${expectedKmDigits - 1} dígitos, provavelmente perdeu o primeiro dígito — rejeite em vez de retornar leitura incompleta.` : ""}
4. Retorne "km_lido" como string contendo APENAS os dígitos do KM total, sem pontos, vírgulas, espaços, unidade ou decimal (ex.: "173552").
5. Se houver casas decimais pequenas no fim do hodômetro, IGNORE o decimal e retorne apenas a parte inteira.
6. Se QUALQUER dígito estiver ambíguo, parcialmente coberto, com reflexo, fora de foco, com pixel quebrado, baixa resolução, ângulo ruim, ou houver risco de confundir 3/5/6/8/9/0 — km_legivel=false, km_lido="", valid=false, e na reason explique o problema.
7. NÃO invente sequência numérica. NÃO use "valor mais provável". NÃO infira pela posição esperada. NÃO arredonde. Se não conseguir ler 100%, rejeite.

CAMPOS:
- "km_lido": obrigatório quando km_legivel=true; vazio quando houver qualquer dúvida.
- "km_legivel": true APENAS com 100% de certeza de que TODOS os dígitos foram lidos corretamente. Em qualquer outro caso, false.
- Se a foto for panorâmica, painel distante, borrada ou ângulo ruim → km_legivel=false, valid=false.
- Sem leitura 100% confirmada e sem km_lido, a foto NÃO PODE ser aprovada. Prefira SEMPRE rejeitar a errar um dígito.
` : ""}${catConfig.has_cleanliness_check && limpeza_claim === "sim" ? `
VERIFICAÇÃO DE LIMPEZA E ORGANIZAÇÃO:
O técnico afirmou que o veículo está LIMPO E ORGANIZADO. Verifique se a foto confirma isso.
REJEITE a foto (valid=false, target_match=false) se o interior mostrar CLARAMENTE:
- Lixo visível (embalagens, papéis, restos de comida, garrafas, copos)
- Objetos jogados/espalhados pelo chão, bancos ou painel (roupas, ferramentas fora de lugar, sacolas, coletes jogados)
- Sujeira excessiva nos bancos, painel ou assoalho
- Desorganização evidente que contradiz a afirmação de "limpo e organizado"
Na "reason", descreva especificamente o que foi encontrado que contradiz a limpeza (ex: "Lixo visível no assoalho, embalagem no banco, colete jogado no chão").
Pequenas imperfeições cosméticas (poeira leve, desgaste natural) NÃO são motivo de rejeição.
` : ''}
Veículo esperado: ${vehicleInfo}
Categoria esperada: ${catConfig.label}
Critério esperado: ${finalCriterio}`;

    console.log(`Validating photo: category=${category}, vehicle=${vehicleInfo}, user=${user.id}`);

    const aiController = new AbortController();
    const aiTimeout = setTimeout(() => aiController.abort(), 25000);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: aiController.signal,
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PHOTO_VALIDATION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}`, detail: "high" } },
              { type: "text", text: "Valide esta foto conforme os critérios informados." },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    clearTimeout(aiTimeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      return new Response(JSON.stringify({
        valid: false, vehicle_match: false, target_match: false, focus_ok: false,
        critical_visible: false, quality: "ruim", confidence: 0,
        reason: "Erro na validação IA. Tente novamente.",
        ai_error: true,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`AI response for ${category}:`, content);

    let result: any;
    try {
      const parsed = extractJsonObject(content);
      if (parsed) {
        // Ensure all fields exist with defaults
        result = {
          valid: Boolean(parsed.valid),
          vehicle_match: parsed.vehicle_match !== undefined ? Boolean(parsed.vehicle_match) : true,
          target_match: parsed.target_match !== undefined ? Boolean(parsed.target_match) : false,
          focus_ok: parsed.focus_ok !== undefined ? Boolean(parsed.focus_ok) : false,
          critical_visible: parsed.critical_visible !== undefined ? Boolean(parsed.critical_visible) : !catConfig.has_critical,
          quality: ["boa", "aceitavel", "ruim"].includes(parsed.quality) ? parsed.quality : "ruim",
          reason: parsed.reason || "Sem motivo informado",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          detected_elements: Array.isArray(parsed.detected_elements) ? parsed.detected_elements : undefined,
          km_lido: typeof parsed.km_lido === "string"
            ? parsed.km_lido.replace(/[^\d]/g, "")
            : typeof parsed.km_lido === "number"
              ? String(Math.trunc(parsed.km_lido)).replace(/[^\d]/g, "")
              : "",
          km_legivel: parsed.km_legivel !== undefined ? Boolean(parsed.km_legivel) : false,
          farois_acesos: parsed.farois_acesos === true ? true : parsed.farois_acesos === false ? false : null,
          farois_observacao: typeof parsed.farois_observacao === "string" ? parsed.farois_observacao : "",
          lanternas_acesas: parsed.lanternas_acesas === true ? true : parsed.lanternas_acesas === false ? false : null,
          lanternas_observacao: typeof parsed.lanternas_observacao === "string" ? parsed.lanternas_observacao : "",
        };

        // GATE SERVER-SIDE GLOBAL: rejeitar fotos desfocadas/borradas em TODAS as categorias
        if (result.quality === "ruim" && result.focus_ok === false) {
          console.log(`[${category}] Rejeitado globalmente por foto desfocada/borrada. quality=${result.quality}, focus_ok=${result.focus_ok}`);
          result.valid = false;
          if (!result.reason || !/desfocad|borrad|tremid|n[ií]tid/i.test(result.reason)) {
            result.reason = "Foto desfocada/borrada — tire outra foto com mais nitidez. " + (result.reason || "");
          }
        }

        // GATE SERVER-SIDE: para "painel", exigir leitura numérica segura para autopreenchimento.
        // Se houver qualquer dúvida, a foto é rejeitada para evitar aceitar KM incorreto.
        if (category === "painel") {
          const kmOk = result.km_legivel === true && /^\d{5,7}$/.test(result.km_lido || "");
          const kmHasExpectedDigits = !expectedKmDigits || (result.km_lido || "").length === expectedKmDigits;
          if (!kmOk) {
            console.log(`[painel] Rejeitado por falta de leitura segura do KM. km_legivel=${result.km_legivel} km_lido=${result.km_lido || "-"}`);
            result.valid = false;
            result.target_match = false;
            result.critical_visible = false;
            result.km_lido = "";
            result.reason = "Hodômetro (KM) não legível com segurança para preenchimento automático. Aproxime-se do painel e enquadre o display do KM.";
          } else if (!kmHasExpectedDigits) {
            console.log(`[painel] Rejeitado por quantidade de dígitos incompatível. esperado=${expectedKmDigits} lido=${result.km_lido}`);
            result.valid = false;
            result.target_match = false;
            result.critical_visible = false;
            result.km_lido = "";
            result.reason = `Leitura rejeitada: o KM cadastrado tem ${expectedKmDigits} dígitos e a IA retornou uma leitura incompleta. Tire outra foto mais próxima do display.`;
          } else {
            console.log(`[painel] Hodômetro lido com segurança para autopreenchimento: ${result.km_lido}`);
          }
        }

        if (category === "interior") {
          const allowedElements = new Set(["bancos_dianteiros", "bancos_traseiros", "painel_console", "volante_cambio", "forros_porta", "assoalho_tapetes", "quebra_sol", "teto_forro"]);
          result.detected_elements = Array.isArray(result.detected_elements)
            ? result.detected_elements.filter((element: unknown) => typeof element === "string" && allowedElements.has(element))
            : [];
          const visible = result.detected_elements.length;
          const uselessCloseUp = /alto-?falante|maçaneta|puxador|soleira|pedal|c[aâ]mbio|alavanca|marcha|console\s*central|r[aá]dio|multim[ií]dia|volante/i.test(result.reason || "") && visible <= 1;
          if (visible < 1 || uselessCloseUp) {
            console.log(`[interior] Rejeitado por não contribuir para a cobertura do interior. detected=${visible}, uselessCloseUp=${uselessCloseUp}, reason="${result.reason}"`);
            result.valid = false;
            result.target_match = false;
            result.reason = "Foto do interior não contribui para a inspeção: close-ups do câmbio, console ou volante não são válidos. Tire uma foto ampla mostrando bancos, quebra-sol/teto, portas ou assoalho.";
          }

          // Server-side blur rejection for interior
          if (result.quality === "ruim" || result.focus_ok === false) {
            console.log(`[interior] Rejeitado por falta de foco/qualidade. quality=${result.quality}, focus_ok=${result.focus_ok}`);
            result.valid = false;
            result.reason = result.reason || "Foto desfocada/borrada. Tire outra foto com mais nitidez.";
          }
        }
      } else {
        result = {
          valid: false, vehicle_match: false, target_match: false, focus_ok: false,
          critical_visible: false, quality: "ruim", reason: "Resposta inválida da IA", confidence: 0,
        };
      }
    } catch {
      result = {
        valid: false, vehicle_match: false, target_match: false, focus_ok: false,
        critical_visible: false, quality: "ruim", reason: "Resposta inválida da IA", confidence: 0,
      };
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Validation error:", error);
    return new Response(JSON.stringify({
      valid: false, vehicle_match: false, target_match: false, focus_ok: false,
      critical_visible: false, quality: "ruim", confidence: 0,
      reason: "Erro na validação. Tente novamente.",
      ai_error: true,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
