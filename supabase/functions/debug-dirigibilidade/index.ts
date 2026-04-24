// Debug v4: faz N passadas e une por chave única, busca convergir com o painel (381)

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

type Ev = { data?: string; evento?: string; motorista?: { nome?: string; id?: number }; vei_placa?: string; endereco?: string; duracao?: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const dataInicio = url.searchParams.get("inicio") || "2026-03-01";
    const dataFim = url.searchParams.get("fim") || "2026-03-31";
    const eventos = (url.searchParams.get("eventos") || "1,2,4").split(",").map(Number);
    const adesoesParam = url.searchParams.get("adesoes");
    const lista = adesoesParam ? adesoesParam.split(",") : ["73280","73281","73283","73284","73285","74192","89859","89860","93505"];
    const passes = Number(url.searchParams.get("passes") || "5");

    const token = await login();
    const dias = eachDay(dataInicio, dataFim);
    const unique = new Map<string, Ev>();
    const perPass: number[] = [];

    for (let pass = 0; pass < passes; pass++) {
      const tasks: Promise<Ev[]>[] = [];
      for (const dia of dias) {
        for (const adesao of lista) {
          tasks.push((async () => {
            const where = JSON.stringify({ adesao_id: Number(adesao), data: dia, eventos });
            const u = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
            const res = await fetch(u, { headers: { "Content-Type": "application/json", Authorization: token } });
            if (!res.ok) return [];
            const j = await res.json();
            return (Array.isArray(j) ? j : (j?.data ?? [])) as Ev[];
          })());
        }
      }
      const all = (await Promise.all(tasks)).flat();
      perPass.push(all.length);
      for (const ev of all) {
        const key = `${ev.vei_placa}|${ev.data}|${ev.evento}|${ev.motorista?.id ?? ""}|${ev.duracao ?? ""}|${ev.endereco ?? ""}`;
        if (!unique.has(key)) unique.set(key, ev);
      }
    }

    const porMotorista: Record<string, number> = {};
    const porTipo: Record<string, number> = {};
    for (const ev of unique.values()) {
      const nome = ev.motorista?.nome?.trim() || "Sem condutor vinculado";
      porMotorista[nome] = (porMotorista[nome] || 0) + 1;
      porTipo[ev.evento ?? "?"] = (porTipo[ev.evento ?? "?"] || 0) + 1;
    }

    return new Response(JSON.stringify({
      periodo: { dataInicio, dataFim, eventos, dias: dias.length, adesoes: lista.length, passes },
      total_unico: unique.size,
      por_pass: perPass,
      por_tipo: porTipo,
      por_motorista: Object.entries(porMotorista).sort((a, b) => b[1] - a[1]),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
