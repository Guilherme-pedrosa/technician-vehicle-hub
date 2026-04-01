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

async function fetchPosicoes(token: string, adesaoId: string, data: string): Promise<Record<string, unknown>[]> {
  const allPositions: Record<string, unknown>[] = [];
  let page = 1;
  const limit = 1000;

  while (true) {
    const where = JSON.stringify({ adesao_id: Number(adesaoId), data, horario: "00:00-23:59" });
    const url = `${ROTAEXATA_API}/relatorios/rastreamento/posicoes?where=${encodeURIComponent(where)}&limit=${limit}&page=${page}`;

    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });

    if (res.status === 404) break;
    if (!res.ok) break;

    const json = await res.json();
    const items = Array.isArray(json) ? json : (json?.data && Array.isArray(json.data) ? json.data : []);
    if (items.length === 0) break;

    allPositions.push(...items);
    if (items.length < limit) break;
    page++;
  }

  return allPositions;
}

type NormalizedPosition = {
  timestampMs: number | null;
  speed: number;
  driverId: string | null;
  driverNameKey: string | null;
};

function normalizeDriverNameKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "Desconhecido") return null;
  return trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizePosition(entry: Record<string, unknown>): NormalizedPosition {
  const raw = ((entry.posicao as Record<string, unknown> | undefined) ?? entry) as Record<string, unknown>;
  const motorista = ((raw.motorista as Record<string, unknown> | undefined) ??
    (entry.motorista as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;

  const driverIdRaw = motorista?.id ?? raw.motorista_id ?? entry.motorista_id ?? null;
  const driverNameRaw = motorista?.nome ?? raw.motorista_nome ?? entry.motorista_nome ?? null;

  return {
    timestampMs: parseTimestampMs(
      raw.data_posicao ?? raw.dt_posicao ?? raw.data ?? entry.data_posicao ?? entry.dt_posicao
    ),
    speed: Math.max(
      0,
      parseNumber(
        raw.velocidade ?? raw.speed ?? raw.vel ?? raw.velocidade_momento ?? entry.velocidade ?? entry.speed ?? entry.vel
      )
    ),
    driverId: driverIdRaw == null || String(driverIdRaw).trim() === "" ? null : String(driverIdRaw),
    driverNameKey: normalizeDriverNameKey(driverNameRaw),
  };
}

function getSessionDriver(entry: Record<string, unknown>) {
  const motorista = (entry.motorista as Record<string, unknown> | undefined) ?? undefined;
  const driverId = motorista?.id == null || String(motorista.id).trim() === "" ? null : String(motorista.id);
  const driverNameKey = normalizeDriverNameKey(motorista?.nome);
  return { driverId, driverNameKey };
}

function getSessionStartMs(entry: Record<string, unknown>): number | null {
  return parseTimestampMs(
    entry.hr_vinculo ?? entry.horario_vinculo ?? entry.dt_inicio ?? entry.hora_inicio ?? null
  );
}

function sameSessionDriver(
  left: { driverId: string | null; driverNameKey: string | null },
  right: { driverId: string | null; driverNameKey: string | null }
) {
  if (left.driverId && right.driverId) return left.driverId === right.driverId;
  if (left.driverNameKey && right.driverNameKey) return left.driverNameKey === right.driverNameKey;
  return !left.driverId && !left.driverNameKey && !right.driverId && !right.driverNameKey;
}

function summarizePositions(
  positions: NormalizedPosition[],
  startMs: number | null,
  endMs: number | null,
  speedLimit: number
) {
  let posicoes = 0;
  let excessos = 0;
  let velMax = 0;

  for (const position of positions) {
    if (startMs !== null) {
      if (position.timestampMs === null || position.timestampMs < startMs) continue;
    }
    if (endMs !== null) {
      if (position.timestampMs === null || position.timestampMs >= endMs) continue;
    }

    posicoes++;
    if (position.speed > velMax) velMax = position.speed;
    if (position.speed > speedLimit) excessos++;
  }

  return { posicoes, excessos, velMax };
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

          // CALL 2: posicoes (GPS positions with speed)
          const posicoes = await fetchPosicoes(rotaToken, vehicle.adesao_id!, day);
          const normalizedPositions = posicoes.map(normalizePosition);

          const positionsById = new Map<string, NormalizedPosition[]>();
          const positionsByName = new Map<string, NormalizedPosition[]>();
          const unknownPositions: NormalizedPosition[] = [];

          for (const position of normalizedPositions) {
            if (position.driverId) {
              const list = positionsById.get(position.driverId) ?? [];
              list.push(position);
              positionsById.set(position.driverId, list);
            }

            if (position.driverNameKey) {
              const list = positionsByName.get(position.driverNameKey) ?? [];
              list.push(position);
              positionsByName.set(position.driverNameKey, list);
            }

            if (!position.driverId && !position.driverNameKey) {
              unknownPositions.push(position);
            }
          }

          if (entries.length === 0 && posicoes.length === 0) continue;

          // DELETE all existing records for this vehicle+day (clean slate)
          await supabase
            .from("daily_vehicle_km")
            .delete()
            .eq("adesao_id", vehicle.adesao_id!)
            .eq("data", day);

          // INSERT each driver session individually
          if (entries.length > 0) {
            const normalizedEntries = (entries as Record<string, unknown>[]).map((entry) => ({
              entry,
              ...getSessionDriver(entry),
              startMs: getSessionStartMs(entry),
            }));

            for (const current of normalizedEntries) {
              const entry = current.entry;
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

              const nextStartMs = normalizedEntries
                .filter((candidate) => candidate !== current && sameSessionDriver(candidate, current))
                .map((candidate) => candidate.startMs)
                .filter((value): value is number => value !== null && (current.startMs === null || value > current.startMs))
                .sort((a, b) => a - b)[0] ?? null;

              const matchingPositions = current.driverId && positionsById.has(current.driverId)
                ? positionsById.get(current.driverId)!
                : current.driverNameKey && positionsByName.has(current.driverNameKey)
                  ? positionsByName.get(current.driverNameKey)!
                  : unknownPositions;

              const dt = summarizePositions(matchingPositions, current.startMs, nextStartMs, limiteVelocidade);

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
                telemetrias: dt.posicoes,
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
          } else if (posicoes.length > 0) {
            // Vehicle had positions but no driver sessions — aggregate all
            const aggregate = summarizePositions(normalizedPositions, null, null, limiteVelocidade);
            const { error } = await supabase.from("daily_vehicle_km").insert({
              adesao_id: vehicle.adesao_id!,
              placa: vehicle.placa,
              data: day,
              motorista_nome: "Sem condutor vinculado",
              motorista_id: null,
              km_percorrido: 0,
              hr_vinculo: "00:00:00",
              telemetrias: aggregate.posicoes,
              velocidade_maxima: aggregate.velMax,
              excessos_velocidade: aggregate.excessos,
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
