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
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error("Login failed after 5 attempts");
}

// =====================================================
// FONTES DE DADOS — REGRA DE NEGÓCIO
// =====================================================
// KM rodado por motorista       => GET /relatorios/rastreamento/log_motorista
// Telemetrias por motorista     => GET /relatorios/rastreamento/dirigibilidade
// Velocidade máxima do veículo  => GET /resumo-dia/{adesao}/{data}
// =====================================================

async function fetchLogMotorista(token: string, adesaoId: string, data: string): Promise<Record<string, unknown>[]> {
  const where = JSON.stringify({ adesao_id: Number(adesaoId), data });
  const url = `${ROTAEXATA_API}/relatorios/rastreamento/log_motorista?where=${encodeURIComponent(where)}`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", Authorization: token },
  });

  if (res.status === 404 || !res.ok) return [];
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (json?.data && Array.isArray(json.data)) return json.data;
  return [];
}

async function fetchDirigibilidade(token: string, adesaoId: string, data: string): Promise<Record<string, unknown>[]> {
  const where = JSON.stringify({
    adesao_id: Number(adesaoId),
    data,
    eventos: [1, 2, 3, 4, 5],
  });
  const url = `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json?.data && Array.isArray(json.data) ? json.data : []);
    return arr as Record<string, unknown>[];
  } catch {
    return [];
  }
}

async function fetchResumoDia(token: string, adesaoId: string | number, data: string): Promise<{
  velocidadeMaxima: number;
}> {
  const url = `${ROTAEXATA_API}/resumo-dia/${adesaoId}/${data}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });
    if (res.status === 404 || !res.ok) return { velocidadeMaxima: 0 };
    const json = await res.json();
    const basico = json?.basico ?? json?.data?.basico ?? json;
    const velocidadeMaxima = Number(
      basico?.velocidade?.maxima ??
      basico?.velocidade_maxima ??
      basico?.vel_maxima ??
      json?.velocidade?.maxima ??
      0
    ) || 0;
    return { velocidadeMaxima };
  } catch {
    return { velocidadeMaxima: 0 };
  }
}

function normalizeEventType(raw: unknown): { type: string; raw: string } {
  const original = String(raw ?? "").trim();
  const lower = original.toLowerCase();
  if (lower.includes("freada") || lower.includes("frenagem") || lower.includes("brake")) {
    return { type: "freada", raw: original };
  }
  if (lower.includes("acelera")) {
    return { type: "aceleracao", raw: original };
  }
  if (lower.includes("curva") || lower.includes("corner")) {
    return { type: "curva", raw: original };
  }
  return { type: "outro", raw: original };
}

function extractEventType(ev: Record<string, unknown>): { type: string; raw: string } {
  const candidates = [ev.evento, ev.tipo_evento, ev.tipo, ev.descricao, ev.event, ev.event_type, ev.nome, ev.titulo];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return normalizeEventType(c);
  }
  return { type: "outro", raw: "" };
}

function extractNumber(ev: Record<string, unknown>, fields: string[]): number | null {
  for (const f of fields) {
    const v = ev[f];
    if (v == null) continue;
    const n = parseFloat(String(v).replace(",", "."));
    if (!isNaN(n)) return n;
  }
  return null;
}

function parseDateMs(s: unknown): number {
  if (!s) return 0;
  const str = String(s).trim();
  const iso = Date.parse(str);
  if (!isNaN(iso)) return iso;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const m2 = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m2) return Date.UTC(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]), Number(m2[4]), Number(m2[5]), Number(m2[6]));
  return 0;
}

function getEventMs(ev: Record<string, unknown>): number {
  return parseDateMs(
    ev.data_evento ?? ev.dt_evento ?? ev.data_horario ?? ev.dt_horario ??
    ev.horario ?? ev.data ?? ev.dt ?? ev.timestamp
  );
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

function getMotoristaFromEntry(entry: Record<string, unknown>): { nome: string; id: string | null } {
  const motorista = entry.motorista as Record<string, unknown> | undefined;
  const nomeRaw = motorista?.nome
    ? String(motorista.nome)
    : (entry.motorista_nome ? String(entry.motorista_nome) : null);
  const nome = !nomeRaw || nomeRaw === "Desconhecido" ? "Sem condutor vinculado" : nomeRaw;
  const id = motorista?.id ? String(motorista.id) : (entry.motorista_id ? String(entry.motorista_id) : null);
  return { nome, id };
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

    type Job = { vehicle: { adesao_id: string | null; placa: string }; day: string };
    const jobs: Job[] = [];
    for (const vehicle of vehicles) {
      for (const day of days) jobs.push({ vehicle: vehicle as Job["vehicle"], day });
    }

    const CONCURRENCY = 6;
    const processJob = async ({ vehicle, day }: Job) => {
      try {
        // Busca as 3 fontes em paralelo
        const [entries, eventos, resumo] = await Promise.all([
          fetchLogMotorista(rotaToken, vehicle.adesao_id!, day),
          fetchDirigibilidade(rotaToken, vehicle.adesao_id!, day),
          fetchResumoDia(rotaToken, vehicle.adesao_id!, day),
        ]);

        if (entries.length === 0 && eventos.length === 0) {
          return;
        }

        // ===== LIMPA dados antigos do dia/veículo (idempotente) =====
        await Promise.all([
          supabase.from("daily_vehicle_km").delete().eq("adesao_id", vehicle.adesao_id!).eq("data", day),
          supabase.from("vehicle_telemetry_events").delete().eq("adesao_id", vehicle.adesao_id!).eq("data", day),
        ]);

        // ===== 1) GRAVA EVENTOS BRUTOS DE TELEMETRIA =====
        // Cada evento de /dirigibilidade vira 1 linha em vehicle_telemetry_events.
        // O motorista vem DENTRO de cada evento (campo `motorista`).
        // Eventos sem motorista => "Sem condutor vinculado".
        const eventRows = eventos.map((ev) => {
          const evMs = getEventMs(ev);
          const { type, raw: rawType } = extractEventType(ev);
          const { nome: motoristaNome, id: motoristaId } = getMotoristaFromEntry(ev);
          const endereco = ev.endereco ? String(ev.endereco) : null;
          const velocidade = extractNumber(ev, ["velocidade", "vel", "velocidade_maxima", "vel_max", "speed"]);
          const duracao = extractNumber(ev, ["tempo_evento", "duracao", "tempo", "duration"]);
          const externalId = ev.id ? String(ev.id) : (ev._id ? String(ev._id) : null);
          return {
            adesao_id: vehicle.adesao_id!,
            placa: vehicle.placa,
            data: day,
            event_at: evMs ? new Date(evMs).toISOString() : new Date(`${day}T00:00:00Z`).toISOString(),
            event_type: type,
            event_type_raw: rawType,
            motorista_id: motoristaId,
            motorista_nome: motoristaNome,
            endereco,
            velocidade,
            duracao_segundos: duracao,
            external_id: externalId,
            raw: ev,
            synced_at: new Date().toISOString(),
          };
        });

        if (eventRows.length > 0) {
          const CHUNK = 200;
          for (let i = 0; i < eventRows.length; i += CHUNK) {
            const slice = eventRows.slice(i, i + CHUNK);
            const { error: evErr } = await supabase
              .from("vehicle_telemetry_events")
              .insert(slice);
            if (evErr) {
              console.warn(`[telemetry-events] insert failed adesao=${vehicle.adesao_id} day=${day}:`, evErr.message);
            }
          }
        }

        // ===== 2) AGREGA TELEMETRIAS POR MOTORISTA (a partir dos eventos brutos) =====
        // Conta eventos por motorista — independente de log_motorista.
        const telPorMotorista = new Map<string, number>();
        for (const ev of eventos) {
          const { nome } = getMotoristaFromEntry(ev);
          telPorMotorista.set(nome, (telPorMotorista.get(nome) ?? 0) + 1);
        }

        // ===== 3) GRAVA SESSÕES DO log_motorista (KM rodado por motorista) =====
        // Cada entrada do log_motorista vira 1 linha em daily_vehicle_km.
        // KM = km_percorrido da própria entrada.
        // Telemetrias = total do motorista naquele dia/veículo (ratada igualmente entre sessões do mesmo motorista).

        // Conta sessões por motorista para distribuir telemetrias
        const sessoesPorMotorista = new Map<string, number>();
        for (const entry of entries as Record<string, unknown>[]) {
          const { nome } = getMotoristaFromEntry(entry);
          sessoesPorMotorista.set(nome, (sessoesPorMotorista.get(nome) ?? 0) + 1);
        }

        // Distribui telemetrias entre sessões do mesmo motorista (resto vai pra primeira)
        const telDistribuidas = new Map<string, { porSessao: number; resto: number }>();
        telPorMotorista.forEach((total, nome) => {
          const nSessoes = sessoesPorMotorista.get(nome) ?? 0;
          if (nSessoes === 0) {
            telDistribuidas.set(nome, { porSessao: 0, resto: total });
          } else {
            const porSessao = Math.floor(total / nSessoes);
            const resto = total - porSessao * nSessoes;
            telDistribuidas.set(nome, { porSessao, resto });
          }
        });

        // Velocidade máxima vai pra sessão de maior KM (do dono do veículo no dia)
        let donaVelMax: { nome: string; hr: string } | null = null;
        let maiorKm = -1;

        const sessionRows: Record<string, unknown>[] = [];
        for (const entry of entries as Record<string, unknown>[]) {
          const { nome, id } = getMotoristaFromEntry(entry);
          const km = extractKm(entry);
          const placa = (entry.placa as string) ?? vehicle.placa;
          const hrVinculo =
            (entry.hr_vinculo as string) ??
            (entry.horario_vinculo as string) ??
            (entry.dt_inicio as string) ??
            (entry.hora_inicio as string) ??
            new Date().toISOString();

          // Distribui telemetrias do motorista
          const dist = telDistribuidas.get(nome) ?? { porSessao: 0, resto: 0 };
          let telSessao = dist.porSessao;
          if (dist.resto > 0) {
            telSessao += 1;
            telDistribuidas.set(nome, { porSessao: dist.porSessao, resto: dist.resto - 1 });
          }

          if (km > maiorKm) {
            maiorKm = km;
            donaVelMax = { nome, hr: hrVinculo };
          }

          sessionRows.push({
            adesao_id: vehicle.adesao_id!,
            placa,
            data: day,
            motorista_nome: nome,
            motorista_id: id,
            km_percorrido: km,
            tempo_deslocamento: (entry.tempo_deslocamento as string) ?? null,
            tipo_vinculo:
              (entry.tipo_vinculo as string) ??
              ((entry.motorista as Record<string, unknown>)?.tipo_vinculo as string) ??
              null,
            hr_vinculo: hrVinculo,
            telemetrias: telSessao,
            velocidade_maxima: 0,
            excessos_velocidade: 0,
            synced_at: new Date().toISOString(),
          });
        }

        // Atribui pico de velocidade do dia à sessão de maior KM
        if (donaVelMax && resumo.velocidadeMaxima > 0) {
          const target = sessionRows.find(
            (r) => r.motorista_nome === donaVelMax!.nome && r.hr_vinculo === donaVelMax!.hr
          );
          if (target) {
            target.velocidade_maxima = resumo.velocidadeMaxima;
            target.excessos_velocidade = resumo.velocidadeMaxima > limiteVelocidade ? 1 : 0;
          }
        }

        // ===== 4) Telemetrias órfãs (motorista existe nos eventos mas NÃO tem sessão no log_motorista) =====
        // Grava como linha extra "Sem condutor vinculado" ou com o nome do motorista mas KM=0.
        telPorMotorista.forEach((total, nome) => {
          const nSessoes = sessoesPorMotorista.get(nome) ?? 0;
          if (nSessoes === 0 && total > 0) {
            sessionRows.push({
              adesao_id: vehicle.adesao_id!,
              placa: vehicle.placa,
              data: day,
              motorista_nome: nome,
              motorista_id: null,
              km_percorrido: 0,
              hr_vinculo: `00:00:00-${nome}`,
              telemetrias: total,
              velocidade_maxima: 0,
              excessos_velocidade: 0,
              synced_at: new Date().toISOString(),
            });
          }
        });

        // ===== 5) INSERT em batch =====
        if (sessionRows.length > 0) {
          const { error } = await supabase.from("daily_vehicle_km").insert(sessionRows);
          if (!error) {
            totalSynced += sessionRows.length;
          } else {
            console.warn(`[sync] Insert failed adesao=${vehicle.adesao_id} day=${day}:`, error.message);
            totalErrors++;
          }
        }

        console.log(`[sync] adesao=${vehicle.adesao_id} day=${day} sessoes=${entries.length} eventos=${eventos.length} velMax=${resumo.velocidadeMaxima}`);
      } catch (err) {
        console.warn(`[sync-daily-km] Failed: vehicle=${vehicle.adesao_id} day=${day}:`, (err as Error).message);
        totalErrors++;
      }
    };

    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const batch = jobs.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processJob));
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
