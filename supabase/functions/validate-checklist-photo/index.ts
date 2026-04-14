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
    criterio: "A foto deve mostrar o PERFIL COMPLETO da lateral esquerda (lado do motorista) do veículo, desde a região do para-lama dianteiro até o para-lama traseiro. A foto deve ser tirada a uma distância suficiente para enquadrar todo o comprimento lateral do carro. REJEITE se: (1) a foto mostra apenas uma parte da lateral (só portas traseiras, só a frente, etc), (2) a foto foi tirada muito de perto e não cabe o veículo inteiro, (3) o ângulo é tão inclinado que não se vê o perfil lateral. ACEITE se: o veículo inteiro (ou quase inteiro) cabe na foto de lado, mesmo com leve ângulo ou objetos parcialmente obstruindo as extremidades.",
    has_critical: false,
  },
  exterior_direita: {
    label: "Lateral direita do veículo",
    criterio: "A foto deve mostrar o PERFIL COMPLETO da lateral direita (lado do passageiro) do veículo, desde a região do para-lama dianteiro até o para-lama traseiro. A foto deve ser tirada a uma distância suficiente para enquadrar todo o comprimento lateral do carro. REJEITE se: (1) a foto mostra apenas uma parte da lateral (só portas traseiras, só a frente, etc), (2) a foto foi tirada muito de perto e não cabe o veículo inteiro, (3) o ângulo é tão inclinado que não se vê o perfil lateral. ACEITE se: o veículo inteiro (ou quase inteiro) cabe na foto de lado, mesmo com leve ângulo ou objetos parcialmente obstruindo as extremidades.",
    has_critical: false,
  },
  nivel_oleo: {
    label: "Nível de óleo",
    criterio: "Deve mostrar a vareta de óleo ou indicador de nível de óleo de um motor de veículo.",
    has_critical: false,
  },
  reservatorio_agua: {
    label: "Reservatório de água",
    criterio: "Deve mostrar o reservatório de água/arrefecimento do veículo com o NÍVEL DO LÍQUIDO visível. É necessário que se consiga identificar a presença do líquido de arrefecimento dentro do reservatório (pela cor do líquido, marca de nível, ou transparência do reservatório mostrando o líquido). Se o reservatório aparece mas não é possível verificar se há líquido dentro, a foto é INVÁLIDA (target_match=false).",
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
    criterio: "A foto DEVE mostrar os três itens de segurança obrigatórios juntos: triângulo de sinalização, macaco hidráulico/mecânico e chave de roda. Se apenas um ou dois itens estiverem visíveis, a foto é INVÁLIDA (target_match=false). Todos os três precisam aparecer na mesma foto.",
    has_critical: true,
  },
  interior: {
    label: "Interior do veículo",
    criterio: "Deve mostrar o interior/cabine do veículo.",
    has_critical: false,
  },
  danos: {
    label: "Dano/avaria",
    criterio: "Deve mostrar claramente o dano, avaria ou defeito no veículo. O dano deve ser visível.",
    has_critical: true,
  },
  avaria: {
    label: "Dano/avaria",
    criterio: "Deve mostrar claramente o dano, avaria ou defeito no veículo. O dano deve ser visível.",
    has_critical: true,
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

    const catConfig = CATEGORY_CRITERIA[category] || {
      label: category,
      criterio: "A foto deve ser relevante para uma inspeção veicular.",
      has_critical: false,
    };

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
  ? 'true se a imagem for compatível com o veículo esperado; false se mostrar CLARAMENTE outro veículo de modelo/marca diferente. Se não for possível determinar (ângulo parcial, iluminação), aceite como true. Só reprove se for CLARAMENTE um veículo diferente.'
  : 'true (não aplicável para esta categoria — não é possível verificar o veículo por este tipo de foto)'}
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
- Nunca invente detalhes não visíveis na foto
- Analise a foto com base nos ELEMENTOS VISUAIS listados no critério. Se qualquer um dos elementos indicados estiver presente na imagem, target_match deve ser true.
- Para faróis/lanternas: qualquer foto que mostre a frente ou traseira de um veículo CONTÉM faróis ou lanternas — valide como target_match=true.
- Para laterais: a foto DEVE mostrar o perfil completo do veículo (de ponta a ponta). Fotos parciais que só mostram parte do carro (ex: só as portas traseiras) devem ser REJEITADAS com target_match=false.

Veículo esperado: ${vehicleInfo}
Categoria esperada: ${catConfig.label}
Critério esperado: ${catConfig.criterio}`;

    console.log(`Validating photo: category=${category}, vehicle=${vehicleInfo}, user=${user.id}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
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
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}`, detail: "auto" } },
              { type: "text", text: "Valide esta foto conforme os critérios informados." },
            ],
          },
        ],
        max_tokens: 250,
        temperature: 0.1,
      }),
    });

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
