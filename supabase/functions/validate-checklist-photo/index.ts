import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Critérios específicos por categoria
const CATEGORY_CRITERIA: Record<string, { label: string; criterio: string; has_critical: boolean }> = {
  painel: {
    label: "Painel do veículo",
    criterio: "Deve mostrar o painel/dashboard do veículo com o hodômetro (KM) visível e legível. O painel deve ser de um veículo automotivo real.",
    has_critical: true,
  },
  exterior_frente: {
    label: "Frente do veículo",
    criterio: "A foto deve conter a parte dianteira de um veículo automotivo. Elementos que confirmam: capô, para-choque dianteiro, grade, faróis dianteiros, placa dianteira, logo frontal. Se QUALQUER desses elementos estiver presente, a foto é válida.",
    has_critical: false,
  },
  exterior_traseira: {
    label: "Traseira do veículo",
    criterio: "A foto deve conter a parte traseira de um veículo automotivo. Elementos que confirmam: para-choque traseiro, lanternas traseiras, placa traseira, porta-malas, logo traseiro. Se QUALQUER desses elementos estiver presente, a foto é válida.",
    has_critical: false,
  },
  exterior_esquerda: {
    label: "Lateral esquerda do veículo",
    criterio: "A foto deve mostrar o PERFIL LATERAL ESQUERDO COMPLETO do veículo de forma que seja possível inspecionar a lataria inteira. REQUISITOS OBRIGATÓRIOS: (1) A foto deve ser tirada de uma POSIÇÃO LATERAL, com o fotógrafo ao lado do carro, aproximadamente na altura da cintura/peito, olhando para a lateral. (2) O veículo deve aparecer na HORIZONTAL na foto. (3) A lateral deve estar QUASE TODA visível, permitindo analisar claramente as regiões do paralama dianteiro, portas, saias/parte inferior e paralama traseiro. (4) Não pode haver corte relevante nas extremidades: se o paralama dianteiro, a dianteira da lateral, o paralama traseiro ou a traseira da lateral não estiverem visíveis o suficiente para inspeção, REJEITE. (5) A imagem deve permitir avaliar possíveis amassados, riscos e avarias ao longo da lateral inteira. REJEITE se: (1) a foto foi tirada de cima/ângulo alto, (2) o carro aparece rotacionado, vertical ou em diagonal forte, (3) qualquer parte importante da lateral ficou fora do enquadramento, escondida, escura ou distante demais para inspeção, (4) a foto mostra só parte da lateral, mesmo que grande, mas sem permitir verificar as extremidades, (5) o ângulo impede avaliar o paralama dianteiro e o traseiro. Só ACEITE se der para inspecionar visualmente a lateral completa, de ponta a ponta.",
    has_critical: false,
  },
  exterior_direita: {
    label: "Lateral direita do veículo",
    criterio: "A foto deve mostrar o PERFIL LATERAL DIREITO COMPLETO do veículo de forma que seja possível inspecionar a lataria inteira. REQUISITOS OBRIGATÓRIOS: (1) A foto deve ser tirada de uma POSIÇÃO LATERAL, com o fotógrafo ao lado do carro, aproximadamente na altura da cintura/peito, olhando para a lateral. (2) O veículo deve aparecer na HORIZONTAL na foto. (3) A lateral deve estar QUASE TODA visível, permitindo analisar claramente as regiões do paralama dianteiro, portas, saias/parte inferior e paralama traseiro. (4) Não pode haver corte relevante nas extremidades: se o paralama dianteiro, a dianteira da lateral, o paralama traseiro ou a traseira da lateral não estiverem visíveis o suficiente para inspeção, REJEITE. (5) A imagem deve permitir avaliar possíveis amassados, riscos e avarias ao longo da lateral inteira. REJEITE se: (1) a foto foi tirada de cima/ângulo alto, (2) o carro aparece rotacionado, vertical ou em diagonal forte, (3) qualquer parte importante da lateral ficou fora do enquadramento, escondida, escura ou distante demais para inspeção, (4) a foto mostra só parte da lateral, mesmo que grande, mas sem permitir verificar as extremidades, (5) o ângulo impede avaliar o paralama dianteiro e o traseiro. Só ACEITE se der para inspecionar visualmente a lateral completa, de ponta a ponta.",
    has_critical: false,
  },
  nivel_oleo: {
    label: "Nível de óleo",
    criterio: "Deve mostrar a vareta de óleo do motor com o NÍVEL DO ÓLEO visível. A vareta deve estar fora do motor e o óleo deve ser visível na ponta da vareta. Verifique se o nível está entre as marcas MIN e MAX. Se o óleo estiver ABAIXO da marca MIN ou não for possível identificar o nível na vareta, marque critical_visible=false. Se o nível estiver entre MIN e MAX ou próximo do MAX, critical_visible=true.",
    has_critical: true,
  },
  reservatorio_agua: {
    label: "Reservatório de água",
    criterio: "Deve mostrar o reservatório de água/arrefecimento do veículo. ACEITE a foto se o reservatório estiver visível e identificável, mesmo que o nível do líquido não seja perfeitamente visível (reservatórios opacos, sujos ou escuros são comuns). Só REJEITE (target_match=false) se: (1) a foto não mostrar o reservatório de água, ou (2) o reservatório estiver CLARAMENTE vazio/seco. Se há dúvida sobre o nível mas o reservatório está presente, ACEITE.",
    has_critical: false,
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
    criterio: "A foto DEVE mostrar os três itens de segurança obrigatórios: triângulo de sinalização, macaco hidráulico/mecânico e chave de roda. REGRAS CRÍTICAS: (1) Só afirme que um item está presente se você conseguir IDENTIFICÁ-LO COM CERTEZA na imagem. (2) Se a foto está escura, desfocada ou os itens estão dentro de um estojo fechado/difícil de ver, NÃO ADIVINHE quais itens são — diga que NÃO foi possível identificar os itens e rejeite. (3) Na mensagem de 'reason', liste APENAS os itens que você tem CERTEZA ABSOLUTA de ver. Se não tem certeza de nenhum, diga 'Não foi possível identificar os itens de segurança na foto'. (4) NUNCA invente ou suponha que um item está presente — é melhor rejeitar uma foto boa do que aceitar uma ruim. (5) Para aceitar (target_match=true), os 3 itens devem ser CLARAMENTE visíveis e identificáveis.",
    has_critical: true,
  },
  interior: {
    label: "Interior do veículo",
    criterio: "A foto deve mostrar uma VISÃO AMPLA do interior do veículo, permitindo avaliar o estado de conservação. REQUISITOS MÍNIMOS: a foto deve ter um ENQUADRAMENTO ABERTO que mostre uma área significativa do interior — pelo menos 2 dos seguintes elementos devem ser CLARAMENTE visíveis e desobstruídos: bancos_dianteiros (assento + encosto expostos), bancos_traseiros, painel_console (volante/instrumentos/console central), forros_porta. REJEITE (target_match=false) se: (1) a foto mostra apenas UM elemento isolado (ex: só um banco de perto, só o forro de uma porta), (2) o ângulo é muito fechado/close-up sem contexto do interior, (3) a foto foi tirada de fora do carro olhando para dentro com ângulo muito estreito mostrando apenas uma faixa do interior, (4) objetos cobrem as superfícies (mochilas, bolsas, ferramentas — se algo está em cima do banco, o banco NÃO conta). ACEITE se: a foto mostra pelo menos 2 elementos com visão aberta suficiente para avaliar limpeza e conservação. Inclua 'detected_elements' no JSON com os elementos visíveis.",
    has_critical: false,
  },
  danos: {
    label: "Dano/avaria",
    criterio: "Esta foto documenta um dano, avaria, defeito ou irregularidade no veículo. ACEITE a foto se ela mostrar QUALQUER parte do veículo (interior ou exterior) que possa estar sendo documentada como problema — isso inclui: peças quebradas, soltas, faltando, mal encaixadas, rachadas, amassadas, riscadas, sujas em excesso, fora de posição, com mau funcionamento aparente, ou qualquer componente que o técnico julgou necessário registrar (ex: quebra-sol danificado, maçaneta solta, forro rasgado, calotas faltando, parafusos expostos, peças improvisadas). NÃO exija que o dano seja óbvio ou dramático — muitos defeitos são sutis. Se a foto mostra uma parte do veículo em close-up ou contexto, ACEITE. Só REJEITE se a foto claramente NÃO for de um veículo (ex: foto de pessoa, paisagem, objeto não automotivo).",
    has_critical: false,
  },
  avaria: {
    label: "Dano/avaria",
    criterio: "Esta foto documenta um dano, avaria, defeito ou irregularidade no veículo. ACEITE a foto se ela mostrar QUALQUER parte do veículo (interior ou exterior) que possa estar sendo documentada como problema — isso inclui: peças quebradas, soltas, faltando, mal encaixadas, rachadas, amassadas, riscadas, sujas em excesso, fora de posição, com mau funcionamento aparente, ou qualquer componente que o técnico julgou necessário registrar (ex: quebra-sol danificado, maçaneta solta, forro rasgado, calotas faltando, parafusos expostos, peças improvisadas). NÃO exija que o dano seja óbvio ou dramático — muitos defeitos são sutis. Se a foto mostra uma parte do veículo em close-up ou contexto, ACEITE. Só REJEITE se a foto claramente NÃO for de um veículo (ex: foto de pessoa, paisagem, objeto não automotivo).",
    has_critical: false,
  },
};

// Categories where vehicle model verification matters
const VEHICLE_CHECK_CATEGORIES = [
  "exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita", "painel",
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

    const { image_base64, category, vehicle_marca, vehicle_modelo } = await req.json();

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
  "confidence": 0.95
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
- Para laterais: a foto DEVE permitir inspeção visual da lateral completa, de ponta a ponta. Não basta mostrar "boa parte" do carro: o paralama dianteiro, portas e paralama traseiro precisam estar visíveis o suficiente para análise de avarias.
- REJEITE laterais em que qualquer extremidade importante ficou cortada, escondida, distante demais, escura demais ou em ângulo que impeça avaliar amassados/riscos — especialmente se não der para analisar o paralama dianteiro ou traseiro.
- Fotos laterais tiradas de cima (vista aérea), com rotação forte, diagonal forte, ou sem enquadramento suficiente da lateral inteira devem ser rejeitadas, mesmo que ainda pareçam mostrar um carro lateralmente.

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

    let result;
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
        };
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
