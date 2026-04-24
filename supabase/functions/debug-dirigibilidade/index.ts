// Debug: itera dia-a-dia × veículo, sem gravar no banco. Conta por motorista.

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

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const dataInicio = url.searchParams.get("inicio") || "2026-03-01";
    const dataFim = url.searchParams.get("fim") || "2026-03-31";
    const eventos = (url.searchParams.get("eventos") || "1,2,3,4").split(",").map(Number);

    const token = await login();
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const r = await fetch(`${supaUrl}/rest/v1/vehicles?select=adesao_id,placa&adesao_id=not.is.null`, {
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    });
    const veiculos = (await r.json()) as Array<{ adesao_id: string; placa: string }>;

    const dias = eachDay(dataInicio, dataFim);
    const porMotorista: Record<string, number> = {};
    const eventosUnicosKey = new Set<string>();
    let totalBruto = 0;

    // paraleliza por dia mas sequencial por veículo dentro do dia (rate limit)
    for (const dia of dias) {
      const calls = veiculos.map(async (v) => {
        const where = JSON.stringify({ adesao_id: Number(v.adesao_id), data: dia, eventos });
        const u = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
        const res = await fetch(u, { headers: { "Content-Type": "application/json", Authorization: token } });
        if (!res.ok) return [];
        const j = await res.json();
        const arr = Array.isArray(j) ? j : (j?.data ?? []);
        return arr as Array<{ data?: string; evento?: string; motorista?: { nome?: string; id?: number }; vei_placa?: string }>;
      });
      const resultsArr = await Promise.all(calls);
      for (const arr of resultsArr) {
        for (const ev of arr) {
          totalBruto++;
          const nome = ev.motorista?.nome?.trim() || "Sem condutor vinculado";
          porMotorista[nome] = (porMotorista[nome] || 0) + 1;
          eventosUnicosKey.add(`${ev.vei_placa}|${ev.data}|${ev.evento}|${ev.motorista?.id ?? ""}`);
        }
      }
    }

    const sorted = Object.entries(porMotorista).sort((a, b) => b[1] - a[1]);
    return new Response(JSON.stringify({
      periodo: { dataInicio, dataFim, eventos, dias: dias.length, veiculos: veiculos.length },
      total_bruto: totalBruto,
      total_unico: eventosUnicosKey.size,
      por_motorista_bruto: sorted,
      por_motorista_total: sorted.reduce((s, [, n]) => s + n, 0),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
