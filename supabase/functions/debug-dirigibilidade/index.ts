// Debug: puxa /dirigibilidade do mês inteiro por veículo e agrega por motorista

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
    const adesoesParam = url.searchParams.get("adesoes");

    const token = await login();

    // Pega lista de adesoes do banco
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let adesoes: string[] = [];
    if (adesoesParam) {
      adesoes = adesoesParam.split(",");
    } else {
      const r = await fetch(`${supaUrl}/rest/v1/vehicles?select=adesao_id&adesao_id=not.is.null`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
      });
      const arr = (await r.json()) as Array<{ adesao_id: string }>;
      adesoes = [...new Set(arr.map(v => v.adesao_id).filter(Boolean))];
    }

    // Tenta puxar período por adesao (intervalo data_inicio/data_fim)
    const porMotorista: Record<string, number> = {};
    let totalGlobal = 0;
    const perVehicle: Record<string, { total: number; status: number }> = {};
    const errors: Array<{ adesao: string; status: number; body: string }> = [];

    for (const adesao of adesoes) {
      // Tentativa 1: data_inicio/data_fim
      const where = JSON.stringify({
        adesao_id: Number(adesao),
        data_inicio: dataInicio,
        data_fim: dataFim,
        eventos,
      });
      const u = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
      const res = await fetch(u, {
        headers: { "Content-Type": "application/json", Authorization: token },
      });
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch {/**/}
      const arr = Array.isArray(parsed) ? parsed : ((parsed as { data?: unknown[] })?.data ?? []);
      perVehicle[adesao] = { total: arr.length, status: res.status };
      if (!res.ok || arr.length === 0 && res.status !== 200) {
        errors.push({ adesao, status: res.status, body: text.slice(0, 200) });
        continue;
      }
      totalGlobal += arr.length;
      for (const ev of arr as Array<{ motorista?: { nome?: string } }>) {
        const nome = ev.motorista?.nome?.trim() || "Sem condutor vinculado";
        porMotorista[nome] = (porMotorista[nome] || 0) + 1;
      }
    }

    return new Response(
      JSON.stringify({
        params: { dataInicio, dataFim, eventos, adesoes_count: adesoes.length },
        total_global: totalGlobal,
        por_motorista: Object.entries(porMotorista).sort((a,b)=>b[1]-a[1]),
        per_vehicle: perVehicle,
        errors_sample: errors.slice(0, 5),
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
