// Debug: conta eventos de /dirigibilidade direto da API Rota Exata para validar 381

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROTAEXATA_API = "https://api.rotaexata.com.br";

async function login(): Promise<string> {
  const email = Deno.env.get("ROTAEXATA_EMAIL");
  const password = Deno.env.get("ROTAEXATA_PASSWORD");
  const res = await fetch(`${ROTAEXATA_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return data.token || data.access_token || data.authorization;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const dataInicio = url.searchParams.get("inicio") || "2026-03-01";
    const dataFim = url.searchParams.get("fim") || "2026-03-31";
    const eventos = (url.searchParams.get("eventos") || "1,2,3,4").split(",").map(Number);

    const token = await login();

    // 1) Tenta puxar o período inteiro de uma vez (sem adesao_id)
    const whereGlobal = JSON.stringify({
      data_inicio: dataInicio,
      data_fim: dataFim,
      eventos,
    });
    const urlGlobal = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(whereGlobal)}`;
    const resGlobal = await fetch(urlGlobal, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });
    const bodyGlobal = await resGlobal.text();
    let parsedGlobal: unknown = null;
    try { parsedGlobal = JSON.parse(bodyGlobal); } catch { /* ignore */ }

    const arrGlobal = Array.isArray(parsedGlobal)
      ? parsedGlobal
      : ((parsedGlobal as { data?: unknown[] })?.data ?? []);

    // Agrega por motorista
    const porMotorista: Record<string, number> = {};
    for (const ev of arrGlobal as Array<{ motorista?: { nome?: string } }>) {
      const nome = ev.motorista?.nome?.trim() || "Sem condutor vinculado";
      porMotorista[nome] = (porMotorista[nome] || 0) + 1;
    }

    return new Response(
      JSON.stringify({
        params: { dataInicio, dataFim, eventos },
        global_status: resGlobal.status,
        global_total: arrGlobal.length,
        global_por_motorista: porMotorista,
        global_sample: arrGlobal.slice(0, 2),
        global_body_preview: bodyGlobal.slice(0, 500),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
