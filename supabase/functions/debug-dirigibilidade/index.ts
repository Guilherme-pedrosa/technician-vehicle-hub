// Debug v3: lê adesoes da tabela vehicle_telemetry_events e itera dia-a-dia

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ROTAEXATA_API = "https://api.rotaexata.com.br";

async function login(): Promise<string> {
  const res = await fetch(`${ROTAEXATA_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: Deno.env.get("ROTAEXATA_EMAIL"), password: Deno.env.get("ROTAEXATA_PASSWORD") }),
  });
  const data = await res.json();
  return data.token || data.access_token || data.authorization;
}

function eachDay(s: string, e: string): string[] {
  const out: string[] = [];
  const a = new Date(s + "T00:00:00Z"); const b = new Date(e + "T00:00:00Z");
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const dataInicio = url.searchParams.get("inicio") || "2026-03-01";
    const dataFim = url.searchParams.get("fim") || "2026-03-31";
    const eventos = (url.searchParams.get("eventos") || "1,2,3,4").split(",").map(Number);

    // Adesões fixas que já tiveram telemetria em março (do banco)
    const adesoes = ["73280","73281","73283","73284","73285","74192","93505","73282","89859","89860","75591"];
    // OBS: adicionei alguns extras pra cobrir casos onde a placa mudou
    const adesoesParam = url.searchParams.get("adesoes");
    const lista = adesoesParam ? adesoesParam.split(",") : adesoes;

    const token = await login();
    const dias = eachDay(dataInicio, dataFim);
    const porMotorista: Record<string, number> = {};
    const porAdesao: Record<string, number> = {};
    let total = 0;
    const sample: unknown[] = [];

    const tasks: Promise<Array<{ motorista?: { nome?: string }; adesao: string }>>[] = [];
    for (const dia of dias) {
      for (const adesao of lista) {
        tasks.push((async () => {
          const where = JSON.stringify({ adesao_id: Number(adesao), data: dia, eventos });
          const u = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
          const res = await fetch(u, { headers: { "Content-Type": "application/json", Authorization: token } });
          if (!res.ok) return [];
          const j = await res.json();
          const arr = (Array.isArray(j) ? j : (j?.data ?? [])) as Array<{ motorista?: { nome?: string } }>;
          return arr.map(ev => ({ ...ev, adesao }));
        })());
      }
    }
    const all = (await Promise.all(tasks)).flat();
    for (const ev of all) {
      total++;
      const nome = ev.motorista?.nome?.trim() || "Sem condutor vinculado";
      porMotorista[nome] = (porMotorista[nome] || 0) + 1;
      porAdesao[ev.adesao] = (porAdesao[ev.adesao] || 0) + 1;
    }
    if (all.length) sample.push(all[0]);

    return new Response(JSON.stringify({
      periodo: { dataInicio, dataFim, eventos, dias: dias.length, adesoes: lista.length },
      total,
      por_motorista: Object.entries(porMotorista).sort((a, b) => b[1] - a[1]),
      por_adesao: porAdesao,
      sample,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
