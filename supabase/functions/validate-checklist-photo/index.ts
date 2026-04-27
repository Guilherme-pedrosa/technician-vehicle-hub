import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Critérios específicos por categoria
const CATEGORY_CRITERIA: Record<string, { label: string; criterio: string; has_critical: boolean; has_cleanliness_check?: boolean }> = {
  painel: {
    label: "Painel do veículo",
    criterio: "A foto deve ser um CLOSE-UP DIRETO do painel de instrumentos (cluster) do veículo, com o HODÔMETRO/ODÔMETRO (KM total) NITIDAMENTE LEGÍVEL — os dígitos do KM devem ser claramente identificáveis a olho nu na imagem. REQUISITOS OBRIGATÓRIOS: (1) o cluster de instrumentos (velocímetro, conta-giros, display do KM) deve OCUPAR a maior parte do enquadramento; (2) os números do hodômetro devem estar em FOCO e LEGÍVEIS — se estiverem borrados, distantes, refletindo demais, escuros ou cortados, REJEITE; (3) a foto deve ser tirada de FRENTE para o painel, não de lado. REJEITE OBRIGATORIAMENTE (valid=false, target_match=false, critical_visible=false) se: (a) a foto for uma visão ampla/panorâmica do interior mostrando volante, bancos ou para-brisa com o painel pequeno ao fundo; (b) o foco principal for o volante, console central, rádio ou airbag e não o cluster de instrumentos; (c) o KM/hodômetro não estiver legível ou nem aparecer; (d) a foto for de outro mostrador qualquer (ar-condicionado, rádio, GPS) que não seja o cluster com KM. Na 'reason', se rejeitar, explique exatamente o que está errado (ex: 'Foto panorâmica do interior, hodômetro não legível' ou 'Foco no volante, painel ao fundo sem KM visível').",
    has_critical: true,
  },
  exterior_frente: {
    label: "Frente do veículo (com faróis acesos)",
    criterio: "A foto deve conter a parte DIANTEIRA do veículo (capô, para-choque, grade, faróis, placa) — esses elementos confirmam o enquadramento. ALÉM DISSO, você DEVE analisar o ESTADO DOS FARÓIS DIANTEIROS para verificar se estão ACESOS: procure por brilho/halo emitido pelas lentes dos faróis (luz baixa, luz alta ou luz de posição/DRL), reflexo no chão, ou contraste claro entre as lentes acesas e a carroceria. Retorne os campos extras: 'farois_acesos' (true/false/null) e 'farois_observacao' (curta, ex: 'farol direito apagado', 'ambos acesos com luz baixa', 'não foi possível avaliar pela iluminação ambiente'). Use null APENAS se a foto estiver muito clara/contra-luz/escura demais para concluir. Se UM dos faróis estiver claramente apagado enquanto o outro acende, marque farois_acesos=false e descreva qual lado. NÃO rejeite a foto (target_match continua true) só porque os faróis estão apagados — apenas reporte. A foto só é inválida se não mostrar a frente do veículo.",
    has_critical: false,
  },
  exterior_traseira: {
    label: "Traseira do veículo (com lanternas acesas)",
    criterio: "A foto deve conter a parte TRASEIRA do veículo (para-choque traseiro, lanternas, placa, porta-malas) — esses elementos confirmam o enquadramento. ALÉM DISSO, você DEVE analisar o ESTADO DAS LANTERNAS TRASEIRAS para verificar se estão ACESAS: procure por brilho vermelho/âmbar nas lentes das lanternas (luz de posição, freio ou ré), reflexo no chão, ou contraste claro entre as lentes iluminadas e a carroceria. Retorne os campos extras: 'lanternas_acesas' (true/false/null) e 'lanternas_observacao' (curta, ex: 'lanterna esquerda apagada', 'ambas acesas', 'não foi possível avaliar'). Use null APENAS se a foto estiver muito clara/contra-luz/escura demais para concluir. Se UMA lanterna estiver claramente apagada enquanto a outra acende, marque lanternas_acesas=false e descreva qual lado. NÃO rejeite a foto (target_match continua true) só porque as lanternas estão apagadas — apenas reporte. A foto só é inválida se não mostrar a traseira do veículo.",
    has_critical: false,
  },
  exterior_esquerda: {
    label: "Lateral esquerda do veículo",
    criterio: "A foto deve mostrar o PERFIL LATERAL ESQUERDO do veículo com cobertura suficiente para inspecionar a lataria. ACEITE quando a lateral estiver majoritariamente visível e der para avaliar paralama dianteiro, portas/coluna lateral e paralama traseiro. Um ângulo 3/4 leve, perspectiva normal de celular, distância curta ou a traseira/dianteira aparentar menor por perspectiva NÃO é corte. Só REJEITE por corte se uma extremidade real do veículo estiver claramente fora do enquadramento, escondida por obstáculo, escura demais ou impossível de avaliar. REJEITE também se a foto for aérea/de cima, muito diagonal/rotacionada, mostrar só frente/traseira, ou mostrar apenas um detalhe isolado da lateral. Em caso de dúvida entre perspectiva normal e corte real, ACEITE.",
    has_critical: false,
  },
  exterior_direita: {
    label: "Lateral direita do veículo",
    criterio: "A foto deve mostrar o PERFIL LATERAL DIREITO do veículo com cobertura suficiente para inspecionar a lataria. ACEITE quando a lateral estiver majoritariamente visível e der para avaliar paralama dianteiro, portas/coluna lateral e paralama traseiro. Um ângulo 3/4 leve, perspectiva normal de celular, distância curta ou a traseira/dianteira aparentar menor por perspectiva NÃO é corte. Só REJEITE por corte se uma extremidade real do veículo estiver claramente fora do enquadramento, escondida por obstáculo, escura demais ou impossível de avaliar. REJEITE também se a foto for aérea/de cima, muito diagonal/rotacionada, mostrar só frente/traseira, ou mostrar apenas um detalhe isolado da lateral. Em caso de dúvida entre perspectiva normal e corte real, ACEITE.",
    has_critical: false,
  },
  nivel_oleo: {
    label: "Nível de óleo",
    criterio: "Deve mostrar a vareta de óleo do motor com o NÍVEL DO ÓLEO visível. A vareta deve estar fora do motor e o óleo deve ser visível na ponta da vareta. Verifique se o nível está entre as marcas MIN e MAX. Se o óleo estiver ABAIXO da marca MIN ou não for possível identificar o nível na vareta, marque critical_visible=false. Se o nível estiver entre MIN e MAX ou próximo do MAX, critical_visible=true.",
    has_critical: true,
  },
  reservatorio_agua: {
    label: "Reservatório de água/arrefecimento",
    criterio: "A foto deve mostrar o reservatório de água/arrefecimento do veículo E PRECISA permitir CONFIRMAR VISUALMENTE QUE HÁ LÍQUIDO DENTRO DELE (água/aditivo de arrefecimento). Não basta mostrar o reservatório fechado por cima — é preciso ver o líquido. SINAIS ACEITÁVEIS de presença de líquido: (a) marca/linha de líquido visível na lateral do reservatório (mesmo que opaco, dá pra ver a sombra do nível); (b) líquido visível por dentro/por cima com a tampa aberta; (c) reservatório translúcido onde se vê claramente o líquido (cor verde, rosa, laranja, azul, marrom). REJEITE OBRIGATORIAMENTE (target_match=false, critical_visible=false) se: (1) a foto mostra apenas a TAMPA fechada do reservatório de cima, sem qualquer indício do líquido; (2) o reservatório aparece, mas o ângulo/iluminação/foco não permite afirmar que tem líquido (ex: foto só do plástico amarelo da tampa, ou foto distante onde não dá pra ver dentro); (3) o reservatório está CLARAMENTE VAZIO/SECO (sem nenhuma marca de líquido na lateral nem dentro). Na 'reason', se rejeitar, oriente: 'Tire uma nova foto mostrando o LÍQUIDO dentro do reservatório — preferencialmente da LATERAL para ver a marca do nível, ou abrindo a tampa pra mostrar a água por dentro.' Se aceitar, descreva o que viu (ex: 'Líquido laranja visível pela lateral do reservatório, acima da marca MIN').",
    has_critical: true,
  },
  pneu_de: {
    label: "Pneu dianteiro esquerdo",
    criterio: "Deve mostrar claramente o pneu dianteiro esquerdo com condição visual da banda de rodagem minimamente verificável.",
    has_critical: false,
  },
  pneu_dd: {
    label: "Pneu dianteiro direito",
    criterio: "Deve mostrar claramente o pneu dianteiro direito com condição visual da banda de rodagem minimamente verificável.",
    has_critical: false,
  },
  pneu_te: {
    label: "Pneu traseiro esquerdo",
    criterio: "Deve mostrar claramente o pneu traseiro esquerdo com condição visual da banda de rodagem minimamente verificável.",
    has_critical: false,
  },
  pneu_td: {
    label: "Pneu traseiro direito",
    criterio: "Deve mostrar claramente o pneu traseiro direito com condição visual da banda de rodagem minimamente verificável.",
    has_critical: false,
  },
  calibracao: {
    label: "Calibrador de pressão",
    criterio: "Deve mostrar o calibrador/medidor de pressão de pneus com o valor visível e legível.",
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
    criterio: "A validação do INTERIOR é feita pelo CONJUNTO de fotos, então uma foto individual pode mostrar apenas parte do habitáculo. Para esta foto individual, ACEITE se ela mostrar com nitidez pelo menos uma área interna útil para inspeção entre: bancos_dianteiros, bancos_traseiros, painel_console, volante_cambio, forros_porta, assoalho_tapetes. REJEITE apenas se a foto não mostrar interior de veículo, estiver sem foco/escura demais, ou for um close-up inútil que não ajude a inspecionar limpeza/organização (ex: só alto-falante, só maçaneta, só soleira, só pedal, só um canto sem contexto). Se mostrar porta/assoalho/tapete junto com parte da cabine, aceite como cobertura parcial. Inclua obrigatoriamente 'detected_elements' no JSON usando somente estes valores: bancos_dianteiros, bancos_traseiros, painel_console, volante_cambio, forros_porta, assoalho_tapetes.",
    has_critical: false,
    has_cleanliness_check: true,
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

    const { image_base64, category, vehicle_marca, vehicle_modelo, limpeza_claim } = await req.json();

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

    // Use dynamic prompt if available, otherwise fall back to hardcoded
    const finalCriterio = dynamicPrompt || catConfig.criterio;

    const vehicleInfo = (vehicle_marca || vehicle_modelo)
      ? `${vehicle_marca || "?"} ${vehicle_modelo || "?"}`
      : "Não informado";

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
  "km_lido": "123456",
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
- "focus_ok": true somente se a imagem tiver nitidez suficiente para verificar o item solicitado. Desfoque leve é aceitável se ainda for possível identificar o item.
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
REGRA OBRIGATÓRIA PARA PAINEL — PROVA DE LEITURA DO HODÔMETRO:
Você DEVE tentar LER os dígitos do hodômetro (KM total acumulado) na foto e retornar:
- "km_lido": string com os dígitos exatos que você consegue ler do hodômetro/odômetro (ex: "123456", "87450"). Se NÃO conseguir ler nenhum número do KM (foto borrada, distante, ângulo errado, painel não aparece, painel pequeno demais ao fundo), retorne "" (string vazia).
- "km_legivel": true APENAS se você conseguiu ler os dígitos do KM com certeza absoluta. false em qualquer outro caso (chute, dúvida, ilegível, ausente).
- ATENÇÃO: NÃO confunda velocímetro (km/h), conta-giros (RPM), relógio, temperatura ou marcador de combustível com o hodômetro. O hodômetro é o display de 5-7 dígitos que mostra a quilometragem total do veículo, geralmente um display digital pequeno dentro do painel.
- Se você não vê o hodômetro claramente OU se a foto é uma visão panorâmica do interior/volante onde o painel aparece pequeno ou de longe → km_legivel=false, km_lido="", critical_visible=false, target_match=false, valid=false.
- Sem leitura confirmada do KM, a foto NÃO PODE ser aprovada.
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
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
        max_tokens: 250,
        temperature: 0.1,
      }),
    });

    clearTimeout(aiTimeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
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
    console.log(`OpenAI response for ${category}:`, content);

    let result: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
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
          km_lido: typeof parsed.km_lido === "string" ? parsed.km_lido.replace(/[^\d]/g, "") : "",
          km_legivel: parsed.km_legivel !== undefined ? Boolean(parsed.km_legivel) : false,
          farois_acesos: parsed.farois_acesos === true ? true : parsed.farois_acesos === false ? false : null,
          farois_observacao: typeof parsed.farois_observacao === "string" ? parsed.farois_observacao : "",
          lanternas_acesas: parsed.lanternas_acesas === true ? true : parsed.lanternas_acesas === false ? false : null,
          lanternas_observacao: typeof parsed.lanternas_observacao === "string" ? parsed.lanternas_observacao : "",
        };

        // GATE SERVER-SIDE: para "painel", exigir prova de leitura do KM (mínimo 3 dígitos)
        if (category === "painel") {
          const kmDigits = result.km_lido || "";
          const kmOk = result.km_legivel === true && kmDigits.length >= 3;
          if (!kmOk) {
            console.log(`[painel] Rejeitado por falta de leitura do KM. km_lido="${kmDigits}", km_legivel=${result.km_legivel}`);
            result.valid = false;
            result.target_match = false;
            result.critical_visible = false;
            result.reason = `Hodômetro (KM) não legível na foto. Aproxime-se do painel e enquadre o display do KM. (IA leu: "${kmDigits || "nada"}")`;
          } else {
            console.log(`[painel] KM lido com sucesso: "${kmDigits}"`);
          }
        }

        if (category === "interior") {
          const allowedElements = new Set(["bancos_dianteiros", "bancos_traseiros", "painel_console", "volante_cambio", "forros_porta", "assoalho_tapetes"]);
          result.detected_elements = Array.isArray(result.detected_elements)
            ? result.detected_elements.filter((element: unknown) => typeof element === "string" && allowedElements.has(element))
            : [];
          const visible = result.detected_elements.length;
          const uselessCloseUp = /alto-?falante|maçaneta|puxador|soleira|pedal/i.test(result.reason || "") && visible === 0;
          if (visible < 1 || uselessCloseUp) {
            console.log(`[interior] Rejeitado por não contribuir para a cobertura do interior. detected=${visible}, reason="${result.reason}"`);
            result.valid = false;
            result.target_match = false;
            result.reason = "Foto do interior não contribui para a inspeção: mostre bancos, painel/console, portas ou assoalho/tapetes.";
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
