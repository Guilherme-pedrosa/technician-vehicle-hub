import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ROTAEXATA_API = "https://api.rotaexata.com.br";

// Simple in-memory token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getRotaExataToken(): Promise<string> {
  // Reuse token if still valid (cache for 50 minutes, tokens usually last 1h)
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const username = Deno.env.get("ROTAEXATA_EMAIL");
  const password = Deno.env.get("ROTAEXATA_PASSWORD");

  if (!username) throw new Error("ROTAEXATA_EMAIL is not configured");
  if (!password) throw new Error("ROTAEXATA_PASSWORD is not configured");

  // Rota Exata API uses /token with form-urlencoded (OAuth2 password grant)
  const formBody = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    companyId: "1",
  });

  const res = await fetch(`${ROTAEXATA_API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Rota Exata login failed [${res.status}]: ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token || data.token || data.authorization;

  if (!cachedToken) {
    throw new Error(`Rota Exata login returned no token: ${JSON.stringify(data)}`);
  }

  tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 minutes
  return cachedToken;
}

async function proxyRequest(
  token: string,
  path: string,
  method: string,
  queryParams: string,
  body?: string
): Promise<Response> {
  const url = `${ROTAEXATA_API}${path}${queryParams ? `?${queryParams}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const fetchOptions: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PUT")) {
    fetchOptions.body = body;
  }

  const res = await fetch(url, fetchOptions);
  const responseBody = await res.text();

  return new Response(responseBody, {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Allowed endpoint prefixes for security
const ALLOWED_PREFIXES = [
  "/adesoes",
  "/usuarios",
  "/grupos",
  "/faturas",
  "/comandos-enviados",
  "/comando",
  "/odometro",
  "/ativar",
  "/posicoes",
  "/resumo-dia",
  "/ultima-posicao",
  "/destinos",
  "/destinos-proximos",
  "/cercas",
  "/reservas-veiculos",
  "/relatorios",
  "/me",
  // Módulos
  "/documentos",
  "/rotas",
  "/custos",
  "/multas",
  "/respostas",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated via Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the request
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) {
      return new Response(
        JSON.stringify({ error: "Missing 'path' query parameter. Example: ?path=/adesoes" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Security: validate path prefix
    const isAllowed = ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (!isAllowed) {
      return new Response(
        JSON.stringify({ error: `Path '${path}' is not allowed` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Forward query params (except 'path')
    const forwardParams = new URLSearchParams();
    url.searchParams.forEach((value, key) => {
      if (key !== "path") forwardParams.set(key, value);
    });

    // Get token and proxy
    const token = await getRotaExataToken();
    let body: string | undefined;
    if (req.method === "POST" || req.method === "PUT") {
      body = await req.text();
    }

    return await proxyRequest(token, path, req.method, forwardParams.toString(), body);
  } catch (error: unknown) {
    console.error("Rota Exata proxy error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    // If token expired, clear cache
    if (message.includes("401") || message.includes("login")) {
      cachedToken = null;
      tokenExpiry = 0;
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
