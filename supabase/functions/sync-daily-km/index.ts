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
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${ROTAEXATA_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 502 || res.status === 503 || res.status === 429) {
        lastError = new Error(`Login returned ${res.status}`);
        const delay = Math.min(attempt * 3000, 15000);
        console.warn(`[sync-daily-km] Login attempt ${attempt}/5 failed with ${res.status}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
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
      if (attempt < 5) {
        const delay = Math.min(attempt * 3000, 15000);
        console.warn(`[sync-daily-km] Login attempt ${attempt}/5 error: ${(err as Error).message}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error("Login failed after 5 attempts");
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

/** Fetch raw driving events (freadas/acelerações/curvas bruscas) with timestamps */
async function fetchDirigibilidade(token: string, adesaoId: string, data: string): Promise<Record<string, unknown>[]> {
  const where = JSON.stringify({ adesao_id: Number(adesaoId), data });
  const url = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });
    if (res.status === 404 || !res.ok) return [];
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json?.data && Array.isArray(json.data) ? json.data : []);
    return arr as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/** Parse a date string like "2026-04-01 02:09:53" or ISO into ms */
function parseDateMs(s: unknown): number {
  if (!s) return 0;
  const str = String(s).trim();
  // Try ISO first
  const iso = Date.parse(str);
  if (!isNaN(iso)) return iso;
  // Try "YYYY-MM-DD HH:MM:SS"
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  // Try "DD/MM/YYYY HH:MM:SS"
  const m2 = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m2) {
    return Date.UTC(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]), Number(m2[4]), Number(m2[5]), Number(m2[6]));
  }
  return 0;
}

/** Extract event timestamp from dirigibilidade entry */
function getEventMs(ev: Record<string, unknown>): number {
  return parseDateMs(
    ev.data_evento ?? ev.dt_evento ?? ev.data_horario ?? ev.dt_horario ??
    ev.horario ?? ev.data ?? ev.dt ?? ev.timestamp
  );
}

/** Get session start/end ms for a log_motorista entry */
function getSessionRangeMs(s: Record<string, unknown>): { start: number; end: number } {
  const start = parseDateMs(
    s.dt_inicio ?? s.hr_vinculo ?? s.horario_vinculo ?? s.hora_inicio ?? s.dt_inicio_vinculo
  );
  const end = parseDateMs(
    s.dt_fim ?? s.dt_fim_vinculo ?? s.hr_desvinculo ?? s.horario_desvinculo ?? s.hora_fim
  ) || (start + 24 * 60 * 60 * 1000); // fallback: open session = end of day
  return { start, end };
}

async function fetchResumoDia(token: string, adesaoId: string | number, data: string): Promise<{
  telemetrias: number;
  velocidadeMaxima: number;
}> {
  const url = `${ROTAEXATA_API}/resumo-dia/${adesaoId}/${data}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });
    if (res.status === 404 || !res.ok) return { telemetrias: 0, velocidadeMaxima: 0 };
    const json = await res.json();

    // Log raw response (first 500 chars) for debugging
    console.log(`[resumo-dia RAW] adesao=${adesaoId}:`, JSON.stringify(json).substring(0, 500));

    // The API may return nested structure: basico.telemetria.quantidade and basico.velocidade.maxima
    const basico = json?.basico ?? json?.data?.basico ?? json;
    const telemetrias = Number(
      basico?.telemetria?.quantidade ??
      basico?.telemetrias ??
      basico?.telemetria ??
      json?.telemetria?.quantidade ??
      json?.rowCount ??
      0
    ) || 0;
    const velocidadeMaxima = Number(
      basico?.velocidade?.maxima ??
      basico?.velocidade_maxima ??
      basico?.vel_maxima ??
      json?.velocidade?.maxima ??
      0
    ) || 0;

    console.log(`[resumo-dia] adesao=${adesaoId} data=${data} tel=${telemetrias} velMax=${velocidadeMaxima}`);
    return { telemetrias, velocidadeMaxima };
  } catch {
    return { telemetrias: 0, velocidadeMaxima: 0 };
  }
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
          // CALL 1: log_motorista — KM per driver session
          const entries = await fetchLogMotorista(rotaToken, vehicle.adesao_id!, day);

          // CALL 2: resumo-dia — telemetrias + velocidade máxima (REAL endpoint)
          const resumo = await fetchResumoDia(rotaToken, vehicle.adesao_id!, day);

          if (entries.length === 0 && resumo.telemetrias === 0) {
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }

          // Determine excessos: if max speed exceeded the limit
          const excessos = resumo.velocidadeMaxima > limiteVelocidade ? 1 : 0;

          if (entries.length > 0) {
            // Log raw first entry to discover available fields
            console.log(`[log_motorista RAW] adesao=${vehicle.adesao_id} day=${day} count=${entries.length} keys=${Object.keys(entries[0] as object).join(",")} sample=${JSON.stringify(entries[0]).substring(0, 800)}`);

            // Count sessions per driver for this vehicle+day
            const totalSessionsThisVehicleDay = entries.length;

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

              const hrVinculo =
                (entry.hr_vinculo as string) ??
                (entry.horario_vinculo as string) ??
                (entry.dt_inicio as string) ??
                (entry.hora_inicio as string) ??
                new Date().toISOString();

              // Try to extract per-entry telemetria count from log_motorista fields
              const entryTelemetrias = Number(
                entry.telemetrias ??
                entry.qtd_telemetria ??
                entry.telemetria ??
                entry.quantidade_telemetrias ??
                0
              ) || 0;

              // Attribution logic:
              // 1. If log_motorista provides per-entry telemetria count → use it (real data)
              // 2. If only 1 driver session for this vehicle+day → all vehicle telemetrias are theirs
              // 3. Multiple sessions without per-entry data → each gets 1 (conservative)
              let telemetriasForEntry: number;
              if (entryTelemetrias > 0) {
                telemetriasForEntry = entryTelemetrias;
              } else if (totalSessionsThisVehicleDay === 1) {
                telemetriasForEntry = resumo.telemetrias;
              } else {
                telemetriasForEntry = 1;
              }

              console.log(`[sync] driver=${motoristaNome} entry_tel=${entryTelemetrias} resumo_tel=${resumo.telemetrias} sessions=${totalSessionsThisVehicleDay} → assigned=${telemetriasForEntry}`);

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
                    ((motorista as Record<string, unknown>)?.tipo_vinculo as string) ??
                    null,
                  hr_vinculo: hrVinculo,
                  telemetrias: telemetriasForEntry,
                  velocidade_maxima: resumo.velocidadeMaxima,
                  excessos_velocidade: excessos,
                  synced_at: new Date().toISOString(),
                },
                {
                  onConflict: "adesao_id,data,motorista_nome,hr_vinculo",
                  ignoreDuplicates: false,
                }
              );

              if (!error) totalSynced++;
              else {
                console.warn(`[sync] Upsert failed:`, error.message);
                totalErrors++;
              }
            }
          } else if (resumo.telemetrias > 0) {
            // Vehicle had movement but no driver sessions
            const { error } = await supabase.from("daily_vehicle_km").upsert(
              {
                adesao_id: vehicle.adesao_id!,
                placa: vehicle.placa,
                data: day,
                motorista_nome: "Sem condutor vinculado",
                motorista_id: null,
                km_percorrido: 0,
                hr_vinculo: "00:00:00",
                telemetrias: 1,
                velocidade_maxima: resumo.velocidadeMaxima,
                excessos_velocidade: excessos,
                synced_at: new Date().toISOString(),
              },
              {
                onConflict: "adesao_id,data,motorista_nome,hr_vinculo",
                ignoreDuplicates: false,
              }
            );
            if (!error) totalSynced++;
            else totalErrors++;
          }

          await new Promise((r) => setTimeout(r, 150));
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
