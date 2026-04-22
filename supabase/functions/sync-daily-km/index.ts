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
  // Mesmo padrão usado em src/services/rotaexata.ts: where = { adesao_id, data } apenas.
  const where = JSON.stringify({ adesao_id: Number(adesaoId), data });
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
  // A API exige `eventos` como array de IDs numéricos: 1=Freada, 2=Aceleração, 3=Curva, 4, 5
  // Strings (ex.: "freada_brusca") retornam HTTP 200 com [] vazio.
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
    if (!res.ok) {
      const bodyTxt = await res.text().catch(() => "");
      console.warn(`[dirigibilidade] adesao=${adesaoId} data=${data} status=${res.status} body=${bodyTxt.substring(0, 200)}`);
      return [];
    }
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json?.data && Array.isArray(json.data) ? json.data : []);
    return arr as Record<string, unknown>[];
  } catch (err) {
    console.warn(`[dirigibilidade] adesao=${adesaoId} data=${data} exception:`, (err as Error).message);
    return [];
  }
}

/** Normaliza o tipo do evento bruto (Freada Brusca, Aceleração Brusca, Curva Brusca, ...) */
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

/** Extrai o tipo do evento de um payload do /dirigibilidade */
function extractEventType(ev: Record<string, unknown>): { type: string; raw: string } {
  const candidates = [
    ev.evento, ev.tipo_evento, ev.tipo, ev.descricao,
    ev.event, ev.event_type, ev.nome, ev.titulo,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return normalizeEventType(c);
  }
  return { type: "outro", raw: "" };
}

/** Extrai número (velocidade, duração) de candidatos */
function extractNumber(ev: Record<string, unknown>, fields: string[]): number | null {
  for (const f of fields) {
    const v = ev[f];
    if (v == null) continue;
    const n = parseFloat(String(v).replace(",", "."));
    if (!isNaN(n)) return n;
  }
  return null;
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

    // Build list of all (vehicle, day) jobs and process in parallel batches
    type Job = { vehicle: { adesao_id: string | null; placa: string }; day: string };
    const jobs: Job[] = [];
    for (const vehicle of vehicles) {
      for (const day of days) jobs.push({ vehicle: vehicle as Job["vehicle"], day });
    }

    const CONCURRENCY = 6;
    const processJob = async ({ vehicle, day }: Job) => {
        try {
          // Run all 3 API calls in parallel for this vehicle/day
          const [entries, resumo, eventos] = await Promise.all([
            fetchLogMotorista(rotaToken, vehicle.adesao_id!, day),
            fetchResumoDia(rotaToken, vehicle.adesao_id!, day),
            fetchDirigibilidade(rotaToken, vehicle.adesao_id!, day),
          ]);

          if (entries.length === 0 && resumo.telemetrias === 0 && eventos.length === 0) {
            return;
          }

          if (eventos.length > 0) {
            console.log(`[dirigibilidade RAW] adesao=${vehicle.adesao_id} day=${day} count=${eventos.length} keys=${Object.keys(eventos[0]).join(",")} sample=${JSON.stringify(eventos[0]).substring(0, 600)}`);
          }

          // ===== GRAVA EVENTOS BRUTOS NA TABELA vehicle_telemetry_events =====
          // 1 linha por evento — fonte de verdade pro dashboard de telemetrias.
          if (eventos.length > 0) {
            const eventRows = eventos
              .map((ev) => {
                const evMs = getEventMs(ev);
                if (!evMs) return null;
                const { type, raw: rawType } = extractEventType(ev);
                const motorista = (ev.motorista as Record<string, unknown> | undefined) ?? null;
                const motoristaNomeRaw = motorista?.nome
                  ? String(motorista.nome)
                  : (ev.motorista_nome ? String(ev.motorista_nome) : null);
                const motoristaNome = !motoristaNomeRaw || motoristaNomeRaw === "Desconhecido"
                  ? "Sem condutor vinculado"
                  : motoristaNomeRaw;
                const motoristaId = motorista?.id
                  ? String(motorista.id)
                  : (ev.motorista_id ? String(ev.motorista_id) : null);
                const endereco = ev.endereco ? String(ev.endereco) : null;
                const velocidade = extractNumber(ev, ["velocidade", "vel", "velocidade_maxima", "vel_max", "speed"]);
                const duracao = extractNumber(ev, ["tempo_evento", "duracao", "tempo", "duration"]);
                const externalId = ev.id ? String(ev.id) : (ev._id ? String(ev._id) : null);
                return {
                  adesao_id: vehicle.adesao_id!,
                  placa: vehicle.placa,
                  data: day,
                  event_at: new Date(evMs).toISOString(),
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
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);

            if (eventRows.length > 0) {
              const { error: deleteError } = await supabase
                .from("vehicle_telemetry_events")
                .delete()
                .eq("adesao_id", vehicle.adesao_id!)
                .eq("data", day);

              if (deleteError) {
                console.warn(`[telemetry-events] delete failed adesao=${vehicle.adesao_id} day=${day}:`, deleteError.message);
              }

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
              console.log(`[telemetry-events] adesao=${vehicle.adesao_id} day=${day} gravados=${eventRows.length}`);
            }
          }

          // Build session list with parsed time ranges and driver info
          // velocidade_maxima e excessos_velocidade serão atribuídos POR SESSÃO,
          // não replicados do dia inteiro do veículo.
          type Session = {
            entry: Record<string, unknown>;
            motoristaNome: string;
            motoristaId: string | null;
            startMs: number;
            endMs: number;
            telemetrias: number;
            velocidadeMaxima: number;
            excessosVelocidade: number;
          };

          const sessions: Session[] = [];
          for (const entry of entries as Record<string, unknown>[]) {
            const motorista = entry.motorista as Record<string, unknown> | undefined;
            const motoristaNome =
              motorista?.nome && motorista.nome !== "Desconhecido"
                ? String(motorista.nome)
                : "Sem condutor vinculado";
            const motoristaId = motorista?.id ? String(motorista.id) : null;
            const { start, end } = getSessionRangeMs(entry);
            sessions.push({
              entry,
              motoristaNome,
              motoristaId,
              startMs: start,
              endMs: end,
              telemetrias: 0,
              velocidadeMaxima: 0,
              excessosVelocidade: 0,
            });
          }
          // Sort sessions by start time for nearest-match fallback
          sessions.sort((a, b) => a.startMs - b.startMs);

          // Telemetry attribution strategy:
          // 1) PREFER /dirigibilidade with timestamps when available (most precise)
          // 2) FALLBACK to /resumo-dia total telemetry count, prorated by KM per session
          let unattributedEvents = 0;

          if (eventos.length > 0) {
            // Strategy 1: precise per-event timestamp matching
            for (const ev of eventos) {
              const evMs = getEventMs(ev);
              if (!evMs) {
                unattributedEvents++;
                continue;
              }
              let matched = sessions.find((s) => evMs >= s.startMs && evMs <= s.endMs);
              if (!matched && sessions.length > 0) {
                let best: Session | null = null;
                let bestDelta = Infinity;
                for (const s of sessions) {
                  const delta = Math.min(Math.abs(evMs - s.startMs), Math.abs(evMs - s.endMs));
                  if (delta < bestDelta) {
                    bestDelta = delta;
                    best = s;
                  }
                }
                if (best && bestDelta <= 2 * 60 * 60 * 1000) matched = best;
              }
              if (matched) matched.telemetrias++;
              else unattributedEvents++;
            }
          } else if (resumo.telemetrias > 0 && sessions.length > 0) {
            // Strategy 2: prorate /resumo-dia total by KM per session
            const totalKm = sessions.reduce((sum, s) => sum + extractKm(s.entry), 0);
            if (totalKm > 0) {
              // Distribute floor(total * km_session / totalKm) to each session
              let distributed = 0;
              const shares = sessions.map((s) => {
                const share = Math.floor((resumo.telemetrias * extractKm(s.entry)) / totalKm);
                distributed += share;
                return share;
              });
              // Distribute remainder to sessions with highest fractional part
              let remainder = resumo.telemetrias - distributed;
              const fractionals = sessions.map((s, i) => ({
                i,
                frac: ((resumo.telemetrias * extractKm(s.entry)) / totalKm) - shares[i],
              }));
              fractionals.sort((a, b) => b.frac - a.frac);
              for (const f of fractionals) {
                if (remainder <= 0) break;
                shares[f.i]++;
                remainder--;
              }
              sessions.forEach((s, i) => { s.telemetrias = shares[i]; });
            } else {
              // No KM data → split equally
              const base = Math.floor(resumo.telemetrias / sessions.length);
              let remainder = resumo.telemetrias - base * sessions.length;
              sessions.forEach((s) => {
                s.telemetrias = base + (remainder > 0 ? 1 : 0);
                if (remainder > 0) remainder--;
              });
            }
          }

          // ===== Atribuição de VELOCIDADE MÁXIMA e EXCESSOS por sessão =====
          // Estratégia 1: usar timestamps de /dirigibilidade quando há campo velocidade
          // Estratégia 2 (fallback): atribuir o pico do /resumo-dia à sessão de maior KM
          let velAtribuidaPorEvento = false;
          if (eventos.length > 0) {
            for (const ev of eventos) {
              const velCandidates = [
                ev.velocidade, ev.vel, ev.velocidade_maxima, ev.vel_max,
                ev.velocidadeMaxima, ev.speed, ev.velocidade_pico,
                (ev as Record<string, unknown>).valor,
              ];
              let vel = 0;
              for (const v of velCandidates) {
                if (v == null) continue;
                const n = parseFloat(String(v).replace(",", "."));
                if (!isNaN(n) && n > 0) { vel = n; break; }
              }
              if (vel <= 0) continue;

              const evMs = getEventMs(ev);
              if (!evMs) continue;

              let matched = sessions.find((s) => evMs >= s.startMs && evMs <= s.endMs);
              if (!matched && sessions.length > 0) {
                let best: Session | null = null;
                let bestDelta = Infinity;
                for (const s of sessions) {
                  const delta = Math.min(Math.abs(evMs - s.startMs), Math.abs(evMs - s.endMs));
                  if (delta < bestDelta) { bestDelta = delta; best = s; }
                }
                if (best && bestDelta <= 2 * 60 * 60 * 1000) matched = best;
              }
              if (!matched) continue;

              if (vel > matched.velocidadeMaxima) matched.velocidadeMaxima = vel;
              if (vel > limiteVelocidade) matched.excessosVelocidade++;
              velAtribuidaPorEvento = true;
            }
          }

          // Fallback: se nenhum evento trouxe velocidade, usar pico do dia
          // mas atribuir APENAS à sessão com maior KM (provável dona do pico),
          // em vez de replicar para todos os motoristas.
          if (!velAtribuidaPorEvento && resumo.velocidadeMaxima > 0 && sessions.length > 0) {
            let dona: Session | null = null;
            let maiorKm = -1;
            for (const s of sessions) {
              const km = extractKm(s.entry);
              if (km > maiorKm) { maiorKm = km; dona = s; }
            }
            if (dona) {
              dona.velocidadeMaxima = resumo.velocidadeMaxima;
              dona.excessosVelocidade = resumo.velocidadeMaxima > limiteVelocidade ? 1 : 0;
            }
          }

          console.log(`[telemetria-attr] adesao=${vehicle.adesao_id} day=${day} eventos=${eventos.length} resumoTel=${resumo.telemetrias} velPico=${resumo.velocidadeMaxima} sessoes=${sessions.length} naoAtribuidos=${unattributedEvents} velStrategy=${velAtribuidaPorEvento ? 'evento-timestamp' : 'fallback-maior-km'}`);

          if (sessions.length > 0) {
            for (const session of sessions) {
              const km = extractKm(session.entry);
              const placa = (session.entry.placa as string) ?? vehicle.placa;
              const hrVinculo =
                (session.entry.hr_vinculo as string) ??
                (session.entry.horario_vinculo as string) ??
                (session.entry.dt_inicio as string) ??
                (session.entry.hora_inicio as string) ??
                new Date().toISOString();

              const { error } = await supabase.from("daily_vehicle_km").upsert(
                {
                  adesao_id: vehicle.adesao_id!,
                  placa,
                  data: day,
                  motorista_nome: session.motoristaNome,
                  motorista_id: session.motoristaId,
                  km_percorrido: km,
                  tempo_deslocamento: (session.entry.tempo_deslocamento as string) ?? null,
                  tipo_vinculo:
                    (session.entry.tipo_vinculo as string) ??
                    ((session.entry.motorista as Record<string, unknown>)?.tipo_vinculo as string) ??
                    null,
                  hr_vinculo: hrVinculo,
                  telemetrias: session.telemetrias,
                  velocidade_maxima: session.velocidadeMaxima,
                  excessos_velocidade: session.excessosVelocidade,
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

            // Record unattributed events as "Sem condutor vinculado"
            if (unattributedEvents > 0) {
              await supabase.from("daily_vehicle_km").upsert(
                {
                  adesao_id: vehicle.adesao_id!,
                  placa: vehicle.placa,
                  data: day,
                  motorista_nome: "Sem condutor vinculado",
                  motorista_id: null,
                  km_percorrido: 0,
                  hr_vinculo: "00:00:00",
                  telemetrias: unattributedEvents,
                  velocidade_maxima: 0,
                  excessos_velocidade: 0,
                  synced_at: new Date().toISOString(),
                },
                { onConflict: "adesao_id,data,motorista_nome,hr_vinculo", ignoreDuplicates: false }
              );
            }
          } else if (eventos.length > 0 || resumo.telemetrias > 0) {
            // No driver sessions but events occurred → all unattributed
            const { error } = await supabase.from("daily_vehicle_km").upsert(
              {
                adesao_id: vehicle.adesao_id!,
                placa: vehicle.placa,
                data: day,
                motorista_nome: "Sem condutor vinculado",
                motorista_id: null,
                km_percorrido: 0,
                hr_vinculo: "00:00:00",
                telemetrias: eventos.length || resumo.telemetrias,
                velocidade_maxima: resumo.velocidadeMaxima,
                excessos_velocidade: resumo.velocidadeMaxima > limiteVelocidade ? 1 : 0,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "adesao_id,data,motorista_nome,hr_vinculo", ignoreDuplicates: false }
            );
            if (!error) totalSynced++;
            else totalErrors++;
          }
        } catch (err) {
          console.warn(
            `[sync-daily-km] Failed: vehicle=${vehicle.adesao_id} day=${day}:`,
            (err as Error).message
          );
          totalErrors++;
        }
    };

    // Process jobs in parallel batches to fit within edge function timeout
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
