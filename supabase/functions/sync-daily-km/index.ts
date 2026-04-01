import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ROTAEXATA_API = "https://api.rotaexata.com.br";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const email = Deno.env.get("ROTAEXATA_EMAIL");
  const password = Deno.env.get("ROTAEXATA_PASSWORD");
  if (!email || !password) throw new Error("ROTAEXATA credentials not configured");

  const res = await fetch(`${ROTAEXATA_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.token || data.access_token || data.authorization;
  if (!cachedToken) throw new Error("No token in response");
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

async function fetchLogMotorista(token: string, adesaoId: string, data: string): Promise<unknown[]> {
  const where = JSON.stringify({ adesao_id: Number(adesaoId), data, horario: "00:00-23:59" });
  const url = `${ROTAEXATA_API}/relatorios/rastreamento/log_motorista?where=${encodeURIComponent(where)}`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", Authorization: token },
  });

  if (res.status === 404) return [];
  if (!res.ok) return [];

  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (json?.data && Array.isArray(json.data)) return json.data;
  return [];
}

function extractKm(entry: Record<string, unknown>): number {
  for (const field of ["km_percorrido", "kmPercorrido", "km", "km_rodado", "km_total", "distancia"]) {
    const val = entry[field];
    if (val == null) continue;
    const num = parseFloat(String(val).replace(",", "."));
    if (!isNaN(num) && num > 0) return num;
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client for writes
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { start_date, end_date, force } = body;
    if (!start_date || !end_date) {
      return new Response(JSON.stringify({ error: "start_date and end_date required (YYYY-MM-DD)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const forceSync = force === true;

    // Get all vehicles
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("adesao_id, placa")
      .not("adesao_id", "is", null);

    if (!vehicles?.length) {
      return new Response(JSON.stringify({ synced: 0, message: "No vehicles found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate days (cap at 60)
    const days: string[] = [];
    const d = new Date(start_date + "T00:00:00Z");
    const endD = new Date(end_date + "T00:00:00Z");
    while (d <= endD) {
      days.push(d.toISOString().split("T")[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    if (days.length > 365) days.length = 365;

    const rotaToken = await getToken();
    let totalSynced = 0;
    let totalErrors = 0;

    for (const vehicle of vehicles) {
      for (const day of days) {
        try {
          // Check if already synced recently
          const { data: existing } = await supabase
            .from("daily_vehicle_km")
            .select("id, synced_at")
            .eq("adesao_id", vehicle.adesao_id!)
            .eq("data", day)
            .limit(1);

          if (existing?.length) {
            const syncedAt = new Date(existing[0].synced_at).getTime();
            const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
            if (syncedAt > sixHoursAgo) continue;
          }

          const entries = await fetchLogMotorista(rotaToken, vehicle.adesao_id!, day);
          if (entries.length === 0) continue;

          for (const entry of entries as Record<string, unknown>[]) {
            const km = extractKm(entry);
            if (km <= 0) continue;

            const motorista = entry.motorista as Record<string, unknown> | undefined;
            const motoristaNome =
              motorista?.nome && motorista.nome !== "Desconhecido"
                ? String(motorista.nome)
                : "Sem condutor vinculado";
            const motoristaId = motorista?.id ? String(motorista.id) : null;
            const placa = (entry.placa as string) ?? vehicle.placa;

            const { error } = await supabase.from("daily_vehicle_km").upsert(
              {
                adesao_id: vehicle.adesao_id!,
                placa,
                data: day,
                motorista_nome: motoristaNome,
                motorista_id: motoristaId,
                km_percorrido: km,
                tempo_deslocamento: (entry.tempo_deslocamento as string) ?? null,
                tipo_vinculo:
                  (entry.tipo_vinculo as string) ??
                  (motorista as Record<string, unknown>)?.tipo_vinculo as string ??
                  null,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "adesao_id,data,motorista_nome" }
            );

            if (!error) totalSynced++;
            else totalErrors++;
          }

          await new Promise((r) => setTimeout(r, 200));
        } catch (err) {
          console.warn(
            `[sync-daily-km] Failed: vehicle=${vehicle.adesao_id} day=${day}:`,
            (err as Error).message
          );
          totalErrors++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        synced: totalSynced,
        errors: totalErrors,
        vehicles: vehicles.length,
        days: days.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[sync-daily-km] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
