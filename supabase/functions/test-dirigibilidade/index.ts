// Função TEMPORÁRIA de debug — testa variações do payload do /dirigibilidade
// até descobrir qual a API aceita. APAGAR depois de descobrir.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROTAEXATA_API = "https://api.rotaexata.com.br";

async function login(): Promise<string> {
  const email = Deno.env.get("ROTAEXATA_EMAIL")!;
  const password = Deno.env.get("ROTAEXATA_PASSWORD")!;
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

  const body = await req.json().catch(() => ({}));
  const adesaoId = body.adesao_id ?? 73280;
  const data = body.data ?? "2026-04-22";

  const token = await login();

  // Variações do payload pra descobrir o que a API aceita
  const variations: Record<string, unknown>[] = [
    { adesao_id: Number(adesaoId), data, eventos: ["freada_brusca", "aceleracao_brusca", "curva_brusca"] },
    { adesao_id: Number(adesaoId), data, eventos: ["freadabrusca", "aceleracaobrusca", "curvabrusca"] },
    { adesao_id: Number(adesaoId), data, eventos: ["freada", "aceleracao", "curva"] },
    { adesao_id: Number(adesaoId), data, eventos: ["FREADA_BRUSCA", "ACELERACAO_BRUSCA", "CURVA_BRUSCA"] },
    { adesao_id: Number(adesaoId), data, eventos: "freada_brusca,aceleracao_brusca,curva_brusca" },
    { adesao_id: Number(adesaoId), data, eventos: "all" },
    { adesao_id: Number(adesaoId), data, eventos: "*" },
    { adesao_id: Number(adesaoId), data, eventos: 1 },
    { adesao_id: Number(adesaoId), data, eventos: ["1", "2", "3", "4", "5"] },
    { adesao_id: Number(adesaoId), data, eventos: [1, 2, 3, 4, 5] },
    { adesao_id: Number(adesaoId), data, horario: "00:00-23:59", eventos: ["freada_brusca", "aceleracao_brusca", "curva_brusca"] },
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const where of variations) {
    const url = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(JSON.stringify(where))}`;
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json", Authorization: token } });
      const txt = await res.text();
      results.push({
        where,
        status: res.status,
        body: txt.substring(0, 400),
      });
    } catch (err) {
      results.push({ where, error: (err as Error).message });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
