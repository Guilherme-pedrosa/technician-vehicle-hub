Deno.serve(async () => {
  const email = Deno.env.get("ROTAEXATA_EMAIL")!;
  const password = Deno.env.get("ROTAEXATA_PASSWORD")!;
  const login = await fetch("https://api.rotaexata.com.br/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await login.json();
  const where = encodeURIComponent(JSON.stringify({
    "adesao.vei_placa": "OOL5I22",
    "dt_lancamento": { "$gte": "2026-05-01T00:00:00Z", "$lte": "2026-05-14T00:00:00Z" },
  }));
  const r = await fetch(`https://api.rotaexata.com.br/custos?where=${where}&limit=3`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  return new Response(await r.text(), { headers: { "Content-Type": "application/json" } });
});
