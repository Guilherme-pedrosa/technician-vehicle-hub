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

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${ROTAEXATA_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 502 || res.status === 503 || res.status === 429) {
        lastError = new Error(`Login returned ${res.status}`);
        console.warn(`[sync-daily-km] Login attempt ${attempt}/3 failed with ${res.status}, retrying...`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }

      if (!res.ok) throw new Error(`Login failed: ${res.status}`);
      const data = await res.json();
      cachedToken = data.token || data.access_token || data.authorization;
      if (!cachedToken) throw new Error("No token in response");
      tokenExpiry = Date.now() + 50 * 60 * 1000;
      return cachedToken;
    } catch (err) {
      lastError = err as Error;
      if (attempt < 3) {
        console.warn(`[sync-daily-km] Login attempt ${attempt}/3 error: ${(err as Error).message}, retrying...`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }

  throw lastError ?? new Error("Login failed after 3 attempts");
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

async function fetchDirigibilidade(token: string, adesaoId: string, data: string): Promise<unknown[]> {
  // Event types: 1=Aceleração, 2=Freada, 3=Curva, 4-10=outros (inclui Excesso Velocidade)
  const where = JSON.stringify({
    adesao_id: Number(adesaoId),
    data,
    eventos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  });
  const url = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;

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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { start_date, end_date } = body;
    if (!start_date || !end_date) {
      return new Response(JSON.stringify({ error: "start_date and end_date required (YYYY-MM-DD)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get speed limit from settings
    let limiteVelocidade = 120;
    try {
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "limite_velocidade_kmh")
        .single();
      if (setting?.value) limiteVelocidade = Number(setting.value) || 120;
    } catch { /* use default */ }

    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("adesao_id, placa")
      .not("adesao_id", "is", null);

    if (!vehicles?.length) {
      return new Response(JSON.stringify({ synced: 0, message: "No vehicles found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const days: string[] = [];
    const d = new Date(start_date + "T00:00:00Z");
    const endD = new Date(end_date + "T00:00:00Z");
    while (d <= endD) {
      days.push(d.toISOString().split("T")[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const rotaToken = await getToken();
    let totalSynced = 0;
    let totalErrors = 0;

    for (const vehicle of vehicles) {
      for (const day of days) {
        try {
          // CALL 1: log_motorista (KM per driver session)
          const entries = await fetchLogMotorista(rotaToken, vehicle.adesao_id!, day);

          // CALL 2: dirigibilidade (telemetry events + speed)
          const eventos = await fetchDirigibilidade(rotaToken, vehicle.adesao_id!, day);

          // Build per-driver telemetry stats from dirigibilidade events
          const driverTelemetry = new Map<string, { telemetrias: number; excessos: number; velMax: number }>();
          
          for (const evento of eventos as Record<string, unknown>[]) {
            const mot = evento.motorista as Record<string, unknown> | undefined;
            const driverId = mot?.id ? String(mot.id) : "__unknown__";
            
            if (!driverTelemetry.has(driverId)) {
              driverTelemetry.set(driverId, { telemetrias: 0, excessos: 0, velMax: 0 });
            }
            const dt = driverTelemetry.get(driverId)!;
            dt.telemetrias++;
            
            // Check event name for speed violations
            const eventoNome = String(evento.evento ?? "").toLowerCase();
            const isSpeedEvent = eventoNome.includes("velocidade") || eventoNome.includes("speed");
            
            // Try to extract speed
            const vel = parseFloat(String(
              evento.velocidade ?? evento.speed ?? evento.vel ??
              evento.velocidade_momento ?? evento.velocidadeMomento ??
              evento.velocidade_maxima ?? evento.max_speed ?? 0
            ));
            if (vel > dt.velMax) dt.velMax = vel;
            if (vel > limiteVelocidade) dt.excessos++;
            else if (isSpeedEvent) dt.excessos++; // Count by event name
          }

          if (eventos.length > 0) {
            const eventTypes = [...new Set((eventos as Record<string, unknown>[]).map(e => String((e as Record<string, unknown>).evento ?? "unknown")))];
            console.log(`[sync] ${vehicle.adesao_id} ${day}: ${eventos.length} events, types: ${eventTypes.join(", ")}`);
            // Log per-driver breakdown
            for (const [did, dt] of driverTelemetry) {
              if (dt.excessos > 0) console.log(`[sync] driver ${did}: ${dt.telemetrias} tel, ${dt.excessos} excessos, velMax=${dt.velMax}`);
            }
          }

          if (entries.length === 0 && eventos.length === 0) continue;

          // DELETE all existing records for this vehicle+day (clean slate)
          await supabase
            .from("daily_vehicle_km")
            .delete()
            .eq("adesao_id", vehicle.adesao_id!)
            .eq("data", day);

          // INSERT each driver session individually
          if (entries.length > 0) {
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

              const hrVinculo = (entry.hr_vinculo as string)
                ?? (entry.horario_vinculo as string)
                ?? (entry.dt_inicio as string)
                ?? (entry.hora_inicio as string)
                ?? new Date().toISOString();

              // Match telemetry to this specific driver
              const driverKey = motoristaId ?? "__unknown__";
              const dt = driverTelemetry.get(driverKey) ?? { telemetrias: 0, excessos: 0, velMax: 0 };

              const { error } = await supabase.from("daily_vehicle_km").insert({
                adesao_id: vehicle.adesao_id!,
                placa,
                data: day,
                motorista_nome: motoristaNome,
                motorista_id: motoristaId,
                km_percorrido: km,
                tempo_deslocamento: (entry.tempo_deslocamento as string) ?? null,
                tipo_vinculo:
                  (entry.tipo_vinculo as string) ??
                  ((motorista as Record<string, unknown>)?.tipo_vinculo as string) ??
                  null,
                hr_vinculo: hrVinculo,
                telemetrias: dt.telemetrias,
                velocidade_maxima: dt.velMax,
                excessos_velocidade: dt.excessos,
                synced_at: new Date().toISOString(),
              });

              if (!error) totalSynced++;
              else {
                console.warn(`[sync] Insert failed:`, error.message);
                totalErrors++;
              }
            }
          } else if (eventos.length > 0) {
            // Vehicle had telemetry events but no driver sessions — aggregate all
            const totalTel = eventos.length;
            let totalExc = 0;
            let maxVel = 0;
            for (const [, dt] of driverTelemetry) {
              totalExc += dt.excessos;
              if (dt.velMax > maxVel) maxVel = dt.velMax;
            }
            const { error } = await supabase.from("daily_vehicle_km").insert({
              adesao_id: vehicle.adesao_id!,
              placa: vehicle.placa,
              data: day,
              motorista_nome: "Sem condutor vinculado",
              motorista_id: null,
              km_percorrido: 0,
              hr_vinculo: "00:00:00",
              telemetrias: totalTel,
              velocidade_maxima: maxVel,
              excessos_velocidade: totalExc,
              synced_at: new Date().toISOString(),
            });
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
