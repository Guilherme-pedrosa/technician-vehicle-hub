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
let loginPromise: Promise<string> | null = null;

async function getRotaExataToken(): Promise<string> {
  // Reuse token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  // Deduplicate concurrent login attempts — only one login runs at a time
  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = doLogin().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

async function doLogin(): Promise<string> {

  const email = Deno.env.get("ROTAEXATA_EMAIL");
  const password = Deno.env.get("ROTAEXATA_PASSWORD");

  if (!email) throw new Error("ROTAEXATA_EMAIL is not configured");
  if (!password) throw new Error("ROTAEXATA_PASSWORD is not configured");

  console.log(`Attempting login with email: ${email}`);

  const loginBody = { email, password };

  const res = await fetch(`${ROTAEXATA_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody),
  });

  const responseText = await res.text();
  console.log(`Login response status: ${res.status}, body: ${responseText}`);

  if (!res.ok) {
    throw new Error(`Rota Exata login failed [${res.status}]: ${responseText}`);
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Rota Exata login returned non-JSON: ${responseText}`);
  }

  cachedToken = data.token || data.access_token || data.authorization;

  if (!cachedToken) {
    throw new Error(`Rota Exata login returned no token: ${responseText}`);
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

  const buildOptions = (authorization: string): RequestInit => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: authorization,
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body && (method === "POST" || method === "PUT")) {
      fetchOptions.body = body;
    }

    return fetchOptions;
  };

  let res = await fetch(url, buildOptions(`Bearer ${token}`));

  // Rota Exata docs indicate the raw token is placed directly in Authorization.
  // Retry without Bearer prefix when upstream rejects the bearer format.
  if (res.status === 401) {
    res = await fetch(url, buildOptions(token));
  }

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

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const authToken = authHeader.replace("Bearer ", "");
    const { data, error: authError } = await supabase.auth.getClaims(authToken);
    if (authError || !data?.claims) {
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
