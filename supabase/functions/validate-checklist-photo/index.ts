import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Prompts de validação por categoria de foto
const VALIDATION_PROMPTS: Record<string, string> = {
  painel: "Esta foto mostra o painel/dashboard de um veículo com o hodômetro (KM) visível e legível? Verifique se o KM pode ser lido claramente.",
  exterior_frente: "Esta foto mostra a frente completa de um veículo (capô, para-choque dianteiro, faróis)?",
  exterior_traseira: "Esta foto mostra a traseira completa de um veículo (para-choque traseiro, lanternas, placa)?",
  exterior_esquerda: "Esta foto mostra a lateral esquerda completa de um veículo?",
  exterior_direita: "Esta foto mostra a lateral direita completa de um veículo?",
  nivel_oleo: "Esta foto mostra a vareta de óleo ou indicador de nível de óleo de um motor de veículo?",
  reservatorio_agua: "Esta foto mostra o reservatório de água/arrefecimento de um veículo?",
  pneu_de: "Esta foto mostra um pneu de veículo com a banda de rodagem visível?",
  pneu_dd: "Esta foto mostra um pneu de veículo com a banda de rodagem visível?",
  pneu_te: "Esta foto mostra um pneu de veículo com a banda de rodagem visível?",
  pneu_td: "Esta foto mostra um pneu de veículo com a banda de rodagem visível?",
  calibracao: "Esta foto mostra um calibrador/medidor de pressão de pneus com o valor visível?",
  estepe: "Esta foto mostra um pneu estepe (pneu reserva) de veículo?",
  farois_lanternas: "Esta foto mostra faróis ou lanternas de um veículo, preferencialmente acesos?",
  motor: "Esta foto mostra o compartimento do motor de um veículo com o capô aberto?",
  itens_seguranca: "Esta foto mostra itens de segurança veicular como triângulo, macaco ou chave de roda?",
  interior: "Esta foto mostra o interior/cabine de um veículo?",
  danos: "Esta foto mostra um dano, avaria ou defeito em um veículo? O dano está claramente visível?",
  avaria: "Esta foto mostra um dano, avaria ou defeito em um veículo? O dano está claramente visível?",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !authData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY não configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { image_base64, category } = await req.json();

    if (!image_base64 || !category) {
      return new Response(JSON.stringify({ error: "image_base64 e category são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentPrompt = VALIDATION_PROMPTS[category] || "Esta foto é relevante para uma inspeção veicular?";

    const systemPrompt = `Você é um sistema de validação de fotos para checklist de inspeção veicular.
Analise a imagem e responda APENAS com um JSON válido no formato:
{
  "valid": true/false,
  "quality": "boa" | "aceitavel" | "ruim",
  "reason": "motivo breve em português"
}

Critérios de qualidade:
- RUIM: foto muito escura, borrada, desfocada, não dá pra ver nada
- ACEITÁVEL: foto com foco parcial mas ainda dá pra identificar o que foi pedido
- BOA: foto nítida e clara

Critérios de conteúdo:
${contentPrompt}

Se a foto estiver com qualidade ruim OU não mostrar o conteúdo esperado, retorne valid=false.
Se a foto tiver qualidade aceitável ou boa E mostrar o conteúdo correto, retorne valid=true.
Seja rápido e objetivo.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}`, detail: "low" } },
              { type: "text", text: "Valide esta foto." },
            ],
          },
        ],
        max_tokens: 150,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI error:", response.status, errorText);
      // On API error, allow the photo (don't block the user)
      return new Response(JSON.stringify({
        valid: true,
        quality: "aceitavel",
        reason: "Validação indisponível no momento. Foto aceita automaticamente.",
        ai_error: true,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the JSON from the response
    let result;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { valid: true, quality: "aceitavel", reason: "Não foi possível interpretar a resposta" };
    } catch {
      result = { valid: true, quality: "aceitavel", reason: "Não foi possível interpretar a resposta" };
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Validation error:", error);
    // On any error, allow the photo
    return new Response(JSON.stringify({
      valid: true,
      quality: "aceitavel",
      reason: "Erro na validação. Foto aceita automaticamente.",
      ai_error: true,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
