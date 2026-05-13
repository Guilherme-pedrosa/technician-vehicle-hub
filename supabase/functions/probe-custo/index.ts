Deno.serve(async () => {
  const r = await fetch("https://qfmpyrekjbbqekxrjgov.supabase.co/functions/v1/rotaexata-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
    },
    body: JSON.stringify({
      path: "/custos",
      method: "GET",
      params: {
        where: JSON.stringify({
          "adesao.vei_placa": "OOL5I22",
          "dt_lancamento": { "$gte": "2026-05-01T00:00:00Z", "$lte": "2026-05-14T00:00:00Z" },
        }),
        limit: 3,
      },
    }),
  });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
});
