// =====================================================
// sync-daily-km — sync de telemetrias e KM por motorista
// =====================================================
// FONTES DE DADOS (Swagger oficial RotaExata):
//   - GET /relatorios/rastreamento/log_motorista     => FONTE DE VERDADE para
//     vínculo motorista<->veículo (janelas) e KM rodado por sessão.
//   - GET /relatorios/rastreamento/dirigibilidade    => Eventos brutos de
//     telemetria (aceleração=1, freada=2, colisão=3, curva=4). NÃO existe 5.
//   - GET /resumo-dia/{adesao}/{data}                => Velocidade máxima.
//
// CONTRATO da API: cada chamada é (1 adesao_id, 1 dia). Não há range/paginação.
//
// MODOS:
//   - strict (default p/ backfill/validação): aborta tudo no primeiro par
//     que falhar após 3 retries. NÃO grava nada no banco. Retorna 5xx com
//     a lista de failed_pairs.
//   - resilient (p/ sync diário em produção): continua processando, grava o
//     que conseguir, retorna 207 com failed_pairs.
//
// CONCORRÊNCIA: pool fixo de 5 requisições simultâneas (cada job dispara 3
// chamadas em paralelo, então ficamos em ~15 conexões reais).
// RETRY: exponencial em 429/5xx/timeout: 500ms, 1500ms, 4000ms.
// =====================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildDriverWindows,
  resolveDriverForTelemetry,
  type DriverWindow,
} from "../_shared/driver-resolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ROTAEXATA_API = "https://api.rotaexata.com.br";
const FETCH_TIMEOUT_MS = 25_000;
const RETRY_DELAYS_MS = [500, 1500, 4000]; // 3 tentativas
const POOL_SIZE = 5;

// ---------- Auth ----------
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const email = Deno.env.get("ROTAEXATA_EMAIL");
  const password = Deno.env.get("ROTAEXATA_PASSWORD");
  if (!email || !password) throw new Error("ROTAEXATA credentials missing");

  const res = await fetch(`${ROTAEXATA_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  const token = data.token || data.access_token || data.authorization;
  if (!token) throw new Error("No token in login response");
  cachedToken = token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

// ---------- Fetch com retry/backoff ----------
type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string; attempts: number };

async function fetchWithRetry<T>(
  url: string,
  token: string,
  parser: (raw: unknown) => T,
): Promise<FetchResult<T>> {
  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", Authorization: token },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;

      // 404 = "sem dados" => trata como sucesso vazio (contrato RotaExata)
      if (res.status === 404) {
        return { ok: true, data: parser([]), status: 404 };
      }

      // 200-299 => sucesso
      if (res.ok) {
        const json = await res.json();
        return { ok: true, data: parser(json), status: res.status };
      }

      // 429/5xx => retryable
      const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      lastError = await res.text().catch(() => "");
      if (!retryable) {
        return { ok: false, status: res.status, error: lastError.slice(0, 300), attempts: attempt + 1 };
      }
    } catch (err) {
      clearTimeout(timer);
      lastStatus = 0;
      lastError = err instanceof Error ? err.message : String(err);
      // timeout / network => retryable
    }

    // Não foi a última tentativa => aguarda backoff
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError || "all retries exhausted",
    attempts: RETRY_DELAYS_MS.length + 1,
  };
}

// ---------- Endpoints ----------
function urlLogMotorista(adesao: string, day: string): string {
  const where = JSON.stringify({ adesao_id: Number(adesao), data: day });
  return `${ROTAEXATA_API}/relatorios/rastreamento/log_motorista?where=${encodeURIComponent(where)}`;
}

function urlDirigibilidade(adesao: string, day: string): string {
  // Eventos suportados oficialmente: 1=Aceleração, 2=Freada, 3=Colisão, 4=Curva.
  // Valor 5 NÃO existe e era a causa de o dia 06/03 vir com totais errados.
  const where = JSON.stringify({ adesao_id: Number(adesao), data: day, eventos: [1, 2, 3, 4] });
  return `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(where)}`;
}

function urlResumoDia(adesao: string, day: string): string {
  return `${ROTAEXATA_API}/resumo-dia/${adesao}/${day}`;
}

const parseList = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: Record<string, unknown>[] }).data;
  }
  return [];
};

const parseResumo = (raw: unknown): { velocidadeMaxima: number } => {
  if (!raw || typeof raw !== "object") return { velocidadeMaxima: 0 };
  const r = raw as Record<string, unknown>;
  const basico = (r.basico ?? (r.data as Record<string, unknown>)?.basico ?? r) as Record<string, unknown>;
  const vel = (basico?.velocidade as Record<string, unknown> | undefined);
  const v = Number(
    vel?.maxima ?? basico?.velocidade_maxima ?? basico?.vel_maxima ?? 0,
  ) || 0;
  return { velocidadeMaxima: v };
};

// ---------- Helpers de evento ----------
function parseDateMs(s: unknown): number {
  if (!s) return 0;
  const str = String(s).trim();
  const iso = Date.parse(str);
  if (!isNaN(iso)) return iso;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const m2 = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m2) return Date.UTC(+m2[3], +m2[2] - 1, +m2[1], +m2[4], +m2[5], +m2[6]);
  return 0;
}

function getEventMs(ev: Record<string, unknown>): number {
  return parseDateMs(
    ev.data_evento ?? ev.dt_evento ?? ev.data_horario ?? ev.dt_horario ??
      ev.horario ?? ev.data ?? ev.dt ?? ev.timestamp,
  );
}

function normalizeEventType(raw: unknown): { type: string; raw: string } {
  const original = String(raw ?? "").trim();
  const lower = original.toLowerCase();
  if (lower.includes("freada") || lower.includes("frenagem") || lower.includes("brake")) {
    return { type: "freada", raw: original };
  }
  if (lower.includes("acelera")) return { type: "aceleracao", raw: original };
  if (lower.includes("curva") || lower.includes("corner")) {
    return { type: "curva", raw: original };
  }
  if (lower.includes("colis")) return { type: "colisao", raw: original };
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

function extractKm(entry: Record<string, unknown>): number {
  for (const field of ["km_percorrido", "kmPercorrido", "km", "km_rodado", "km_total", "distancia"]) {
    const val = entry[field];
    if (val == null) continue;
    const num = parseFloat(String(val).replace(",", "."));
    if (!isNaN(num) && num > 0) return num;
  }
  return 0;
}

// Chave determinística do evento. Prioriza id externo da RotaExata; se ausente,
// monta uma chave composta estável (placa+timestamp+tipo+endereço+duração) para
// que o índice UNIQUE em external_id evite duplicatas em re-syncs.
function buildExternalId(ev: Record<string, unknown>, placa: string, day: string): string {
  if (ev.id != null) return `re:${ev.id}`;
  if ((ev as { _id?: unknown })._id != null) return `re:${(ev as { _id: unknown })._id}`;
  const ts = getEventMs(ev) || Date.parse(`${day}T00:00:00Z`);
  const { raw } = extractEventType(ev);
  const dur = extractNumber(ev, ["tempo_evento", "duracao", "tempo", "duration"]) ?? "";
  const end = ev.endereco ? String(ev.endereco) : "";
  return `synth:${placa}|${ts}|${raw}|${dur}|${end}`;
}

// ---------- Pool de concorrência ----------
async function runPool<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(size, items.length); i++) {
    runners.push((async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx]);
      }
    })());
  }
  await Promise.all(runners);
  return results;
}

// ---------- Job result ----------
type JobInput = { adesao_id: string; placa: string; day: string };
type FailedPair = { adesao_id: string; placa: string; day: string; endpoint: string; status: number; error: string; attempts: number };
type JobOutput = {
  adesao_id: string;
  placa: string;
  day: string;
  ok: boolean;
  failed?: FailedPair[];
  // dados a serem persistidos quando ok=true
  events: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
};

async function processJob(
  job: JobInput,
  token: string,
  limiteVelocidade: number,
): Promise<JobOutput> {
  const fails: FailedPair[] = [];

  const [logRes, dirRes, resumoRes] = await Promise.all([
    fetchWithRetry(urlLogMotorista(job.adesao_id, job.day), token, parseList),
    fetchWithRetry(urlDirigibilidade(job.adesao_id, job.day), token, parseList),
    fetchWithRetry(urlResumoDia(job.adesao_id, job.day), token, parseResumo),
  ]);

  if (!logRes.ok) {
    fails.push({ ...job, endpoint: "log_motorista", status: logRes.status, error: logRes.error, attempts: logRes.attempts });
  }
  if (!dirRes.ok) {
    fails.push({ ...job, endpoint: "dirigibilidade", status: dirRes.status, error: dirRes.error, attempts: dirRes.attempts });
  }
  if (!resumoRes.ok) {
    fails.push({ ...job, endpoint: "resumo-dia", status: resumoRes.status, error: resumoRes.error, attempts: resumoRes.attempts });
  }

  if (fails.length > 0) {
    return { ...job, ok: false, failed: fails, events: [], sessions: [] };
  }

  const entries = (logRes as { ok: true; data: Record<string, unknown>[] }).data;
  const eventos = (dirRes as { ok: true; data: Record<string, unknown>[] }).data;
  const resumo = (resumoRes as { ok: true; data: { velocidadeMaxima: number } }).data;

  // 1) Constrói janelas de motorista a partir do log_motorista
  const windows: DriverWindow[] = buildDriverWindows(entries, job.adesao_id, job.day, parseDateMs);

  // 2) Resolve motorista para CADA evento usando as janelas
  const eventRows = eventos.map((ev) => {
    const evMs = getEventMs(ev);
    const { type, raw: rawType } = extractEventType(ev);
    const fallbackMot = (ev.motorista as Record<string, unknown> | undefined);
    const resolved = resolveDriverForTelemetry(
      { adesao_id: job.adesao_id, timestamp_ms: evMs },
      windows,
      {
        driver_id: fallbackMot?.id ? String(fallbackMot.id) : null,
        driver_name: fallbackMot?.nome ? String(fallbackMot.nome) : null,
      },
    );
    return {
      adesao_id: job.adesao_id,
      placa: job.placa,
      data: job.day,
      event_at: evMs ? new Date(evMs).toISOString() : `${job.day}T00:00:00Z`,
      event_type: type,
      event_type_raw: rawType,
      motorista_id: resolved.driver_id,
      motorista_nome: resolved.driver_name,
      endereco: ev.endereco ? String(ev.endereco) : null,
      velocidade: extractNumber(ev, ["velocidade", "vel", "velocidade_maxima", "vel_max", "speed"]),
      duracao_segundos: extractNumber(ev, ["tempo_evento", "duracao", "tempo", "duration"]),
      external_id: buildExternalId(ev, job.placa, job.day),
      raw: ev,
      synced_at: new Date().toISOString(),
    };
  });

  // 3) Sessões de KM (1 linha por entry do log_motorista)
  // Telemetrias por sessão = eventos cujo motorista resolvido bate com o motorista da sessão
  const telPorMotorista = new Map<string, number>();
  for (const r of eventRows) {
    telPorMotorista.set(r.motorista_nome, (telPorMotorista.get(r.motorista_nome) ?? 0) + 1);
  }
  const sessoesPorMotorista = new Map<string, number>();
  for (const entry of entries) {
    const motorista = entry.motorista as Record<string, unknown> | undefined;
    const nomeRaw = motorista?.nome ? String(motorista.nome) : "";
    const nome = nomeRaw && nomeRaw !== "Desconhecido" ? nomeRaw : "Sem condutor vinculado";
    sessoesPorMotorista.set(nome, (sessoesPorMotorista.get(nome) ?? 0) + 1);
  }

  // Distribui telemetrias entre as sessões do mesmo motorista
  const telDistribuidas = new Map<string, { porSessao: number; resto: number }>();
  telPorMotorista.forEach((total, nome) => {
    const n = sessoesPorMotorista.get(nome) ?? 0;
    if (n === 0) telDistribuidas.set(nome, { porSessao: 0, resto: total });
    else {
      const porSessao = Math.floor(total / n);
      const resto = total - porSessao * n;
      telDistribuidas.set(nome, { porSessao, resto });
    }
  });

  let donaVelMax: { nome: string; hr: string } | null = null;
  let maiorKm = -1;
  const sessionRows: Record<string, unknown>[] = [];

  for (const entry of entries) {
    const motorista = entry.motorista as Record<string, unknown> | undefined;
    const nomeRaw = motorista?.nome ? String(motorista.nome) : "";
    const nome = nomeRaw && nomeRaw !== "Desconhecido" ? nomeRaw : "Sem condutor vinculado";
    const id = motorista?.id
      ? String(motorista.id)
      : entry.motorista_id ? String(entry.motorista_id) : null;
    const km = extractKm(entry);
    const placa = (entry.placa as string) ?? job.placa;
    const hrVinculo = (entry.hr_vinculo as string) ??
      (entry.horario_vinculo as string) ??
      (entry.dt_inicio as string) ??
      (entry.hora_inicio as string) ??
      new Date().toISOString();

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
      adesao_id: job.adesao_id,
      placa,
      data: job.day,
      motorista_nome: nome,
      motorista_id: id,
      km_percorrido: km,
      tempo_deslocamento: (entry.tempo_deslocamento as string) ?? null,
      tipo_vinculo: (entry.tipo_vinculo as string) ??
        ((entry.motorista as Record<string, unknown>)?.tipo_vinculo as string) ?? null,
      hr_vinculo: hrVinculo,
      telemetrias: telSessao,
      velocidade_maxima: 0,
      excessos_velocidade: 0,
      synced_at: new Date().toISOString(),
    });
  }

  if (donaVelMax && resumo.velocidadeMaxima > 0) {
    const target = sessionRows.find(
      (r) => r.motorista_nome === donaVelMax!.nome && r.hr_vinculo === donaVelMax!.hr,
    );
    if (target) {
      target.velocidade_maxima = resumo.velocidadeMaxima;
      target.excessos_velocidade = resumo.velocidadeMaxima > limiteVelocidade ? 1 : 0;
    }
  }

  // Telemetrias órfãs: motoristas que aparecem em eventos mas sem sessão no log_motorista
  telPorMotorista.forEach((total, nome) => {
    const n = sessoesPorMotorista.get(nome) ?? 0;
    if (n === 0 && total > 0) {
      sessionRows.push({
        adesao_id: job.adesao_id,
        placa: job.placa,
        data: job.day,
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

  return { ...job, ok: true, events: eventRows, sessions: sessionRows };
}

// ---------- Servidor ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sbAuth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await sbAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { start_date, end_date } = body;
    const mode: "strict" | "resilient" = body.mode === "resilient" ? "resilient" : "strict";

    if (!start_date || !end_date) {
      return new Response(JSON.stringify({ error: "start_date and end_date required (YYYY-MM-DD)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let limiteVelocidade = 120;
    try {
      const { data: setting } = await supabase
        .from("app_settings").select("value").eq("key", "limite_velocidade_kmh").single();
      if (setting?.value) limiteVelocidade = Number(setting.value) || 120;
    } catch { /* default */ }

    const { data: vehicles } = await supabase
      .from("vehicles").select("adesao_id, placa").not("adesao_id", "is", null);
    if (!vehicles?.length) {
      return new Response(JSON.stringify({ mode, synced: 0, message: "No vehicles" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Monta lista de dias
    const days: string[] = [];
    const d = new Date(start_date + "T00:00:00Z");
    const endD = new Date(end_date + "T00:00:00Z");
    while (d <= endD) {
      days.push(d.toISOString().split("T")[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const jobs: JobInput[] = [];
    for (const v of vehicles) {
      for (const day of days) {
        jobs.push({ adesao_id: v.adesao_id!, placa: v.placa, day });
      }
    }

    const token = await getToken();

    console.log(`[sync-daily-km] mode=${mode} jobs=${jobs.length} (${vehicles.length} veículos × ${days.length} dias)`);

    // Roda todos os jobs em pool
    const results = await runPool(jobs, POOL_SIZE, (j) => processJob(j, token, limiteVelocidade));

    const failed_pairs: FailedPair[] = [];
    let ok = 0, failed = 0;
    for (const r of results) {
      if (r.ok) ok++;
      else { failed++; if (r.failed) failed_pairs.push(...r.failed); }
    }

    const stats = {
      mode,
      total_jobs: jobs.length,
      ok,
      failed,
      total_attempts: jobs.length * 3, // 3 endpoints por job
      failed_pairs,
    };

    console.log(`[sync-daily-km] result mode=${mode} ok=${ok} failed=${failed} failures=${failed_pairs.length}`);
    if (failed_pairs.length > 0) {
      console.log(`[sync-daily-km] failed pairs sample:`, JSON.stringify(failed_pairs.slice(0, 5)));
    }

    // STRICT: tudo ou nada — não grava se houve qualquer falha
    if (mode === "strict" && failed > 0) {
      return new Response(JSON.stringify({
        ...stats,
        aborted: true,
        reason: "strict mode: at least one (adesao,day) failed after retries — no data persisted",
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persistência: só persiste o que foi ok. Em strict, só chega aqui se 100% ok.
    const okResults = results.filter((r) => r.ok);

    // Limpa janela alvo (idempotência)
    if (okResults.length > 0) {
      // Um único delete por veículo/dia processado com sucesso
      const cleanups = okResults.map((r) =>
        Promise.all([
          supabase.from("daily_vehicle_km").delete().eq("adesao_id", r.adesao_id).eq("data", r.day),
          supabase.from("vehicle_telemetry_events").delete().eq("adesao_id", r.adesao_id).eq("data", r.day),
        ])
      );
      // Em lotes de 20 para não estourar conexões
      for (let i = 0; i < cleanups.length; i += 20) {
        await Promise.all(cleanups.slice(i, i + 20));
      }
    }

    // Insere eventos (em chunks) usando upsert por external_id (idempotente)
    const allEvents = okResults.flatMap((r) => r.events);
    let insertedEvents = 0;
    if (allEvents.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < allEvents.length; i += CHUNK) {
        const slice = allEvents.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("vehicle_telemetry_events")
          .upsert(slice, { onConflict: "external_id", ignoreDuplicates: false });
        if (error) {
          console.warn(`[telemetry-events] upsert failed:`, error.message);
        } else {
          insertedEvents += slice.length;
        }
      }
    }

    // Insere sessões
    const allSessions = okResults.flatMap((r) => r.sessions);
    let insertedSessions = 0;
    if (allSessions.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < allSessions.length; i += CHUNK) {
        const slice = allSessions.slice(i, i + CHUNK);
        const { error } = await supabase.from("daily_vehicle_km").insert(slice);
        if (error) console.warn(`[daily_vehicle_km] insert failed:`, error.message);
        else insertedSessions += slice.length;
      }
    }

    const status = mode === "resilient" && failed > 0 ? 207 : 200;
    return new Response(JSON.stringify({
      ...stats,
      inserted_events: insertedEvents,
      inserted_sessions: insertedSessions,
      vehicles: vehicles.length,
      days: days.length,
    }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sync-daily-km] fatal:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
