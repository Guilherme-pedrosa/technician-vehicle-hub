import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXTERNAL_ENDPOINT =
  "https://scgcbifmcvazmalqqpju.supabase.co/functions/v1/external-create-task";

const PRIORITY_MAP: Record<string, string> = {
  critica: "p1",
  alta: "p2",
  media: "p3",
  média: "p3",
  baixa: "p4",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FROTA_EXTERNAL_API_KEY");
    if (!apiKey) {
      console.error("[forward-ticket] FROTA_EXTERNAL_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "External API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { titulo, descricao, prioridade, placa, modelo, tipo } = body;

    if (!titulo) {
      return new Response(
        JSON.stringify({ error: "titulo is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build description with vehicle info
    const parts: string[] = [];
    if (placa) parts.push(`Veículo: ${placa}${modelo ? ` (${modelo})` : ""}`);
    if (tipo) parts.push(`Tipo: ${tipo}`);
    if (descricao) parts.push(descricao);
    const fullDescription = parts.join("\n") || undefined;

    const priority = PRIORITY_MAP[prioridade?.toLowerCase()] ?? "p3";

    console.log(`[forward-ticket] Forwarding: "${titulo}" priority=${priority}`);

    const res = await fetch(EXTERNAL_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `[Frota] ${titulo}`,
        description: fullDescription,
        priority,
      }),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("[forward-ticket] External API error:", res.status, result);
      return new Response(
        JSON.stringify({ error: "External API error", detail: result }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[forward-ticket] Success:", result);
    return new Response(
      JSON.stringify({ ok: true, external_task: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[forward-ticket] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
