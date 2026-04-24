// =====================================================
// sync-daily-km — sync de telemetrias e KM por motorista
// =====================================================
// FONTES DE DADOS (Swagger oficial RotaExata):
//   - GET /relatorios/rastreamento/log_motorista     => FONTE DE VERDADE para
//     vínculo motorista<->veículo (janelas) e KM rodado por sessão.
//   - GET /relatorios/rastreamento/dirigibilidade    => Eventos brutos de
//     telemetria (aceleração=1, freada=2, colisão=3, curva=4). NÃO existe 5.
//
// VELOCIDADE/EXCESSOS: NÃO sincronizamos aqui. /resumo-dia conta no máximo 1
// excesso/dia/veículo e atribui ao motorista de maior KM — não bate com a
// planilha oficial. A fonte certa é /ocorrencias_simples_analitico (a validar)
// e ficará em uma sincronização separada (vehicle_speed_violations).
//
// CONTRATO da API: cada chamada é (1 adesao_id, 1 dia). Não há range/paginação.
// 404 e 400 "Positions to specified search not found" = dia sem posições
// (veículo parado/desligado). Tratados como sucesso com array vazio.
//
// MODOS:
//   - strict (default p/ backfill/validação): aborta tudo no primeiro par
//     que falhar após 3 retries. NÃO grava nada no banco. Retorna 5xx com
//     a lista de failed_pairs.
//   - resilient (p/ sync diário em produção): continua processando, grava o
//     que conseguir, retorna 207 com failed_pairs.
//
// DRY_RUN: quando body.dry_run === true, executa todas as chamadas mas NÃO
// persiste nada. Retorna resumo agregado por motorista para validação cruzada
// com a planilha oficial antes de commit.
//
// ATOMICIDADE: persistência usa a RPC `sync_replace_day_telemetry` que faz
// delete + insert dentro de uma única transação por (adesao, dia).
//
// CONCORRÊNCIA: pool fixo de 5 requisições simultâneas.
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

      lastError = await res.text().catch(() => "");

      // 400 com "Positions to specified search not found" = veículo parado/sem posições
      // no dia. É resposta esperada da RotaExata, NÃO é erro real. Trata como vazio.
      // Mesmo padrão do painel oficial (linha em branco no relatório).
      if (res.status === 400 && /positions to specified search not found/i.test(lastError)) {
        return { ok: true, data: parser([]), status: 400 };
      }

      const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (!retryable) {
        return { ok: false, status: res.status, error: lastError.slice(0, 300), attempts: attempt + 1 };
      }
    } catch (err) {
      clearTimeout(timer);
      lastStatus = 0;
      lastError = err instanceof Error ? err.message : String(err);
    }

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
// IMPORTANTE: o painel oficial passa SEMPRE a lista de motoristas ativos da empresa
// (`motoristas: [...ids]`) tanto em /dirigibilidade quanto em /log_motorista.
// Eventos/sessões com motorista_id fora dessa lista NÃO aparecem no painel.
// Sem esse filtro, o sync trazia +52 eventos "fantasmas" no mês (motoristas
// antigos/desativados, terceiros, visitantes). Validado contra o XHR real.
function urlLogMotorista(adesao: string, day: string, motoristaIds: number[]): string {
  const where: Record<string, unknown> = { adesao_id: Number(adesao), data: day };
  if (motoristaIds.length > 0) where.motoristas = motoristaIds;
  return `${ROTAEXATA_API}/relatorios/rastreamento/log_motorista?where=${encodeURIComponent(JSON.stringify(where))}`;
}

function urlDirigibilidade(adesao: string, day: string, eventos: number[], motoristaIds: number[]): string {
  // Eventos suportados oficialmente: 1=Aceleração, 2=Freada, 3=Colisão, 4=Curva.
  // Default [1,2,3,4]; o painel oficial usa [1,2,4] (sem colisão) — passe via body.eventos.
  const where: Record<string, unknown> = { adesao_id: Number(adesao), data: day, eventos };
  if (motoristaIds.length > 0) where.motoristas = motoristaIds;
  return `${ROTAEXATA_API}/relatorios/rastreamento/dirigibilidade?where=${encodeURIComponent(JSON.stringify(where))}`;
}

// Busca a lista de motoristas ATIVOS da empresa (campo `motorista===1` em /usuarios).
// Replica exatamente o filtro que o painel oficial aplica.
async function fetchActiveDriverIds(token: string): Promise<number[]> {
  const url = `${ROTAEXATA_API}/usuarios?limit=500&offset=0`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", Authorization: token },
  });
  if (!res.ok) {
    throw new Error(`fetchActiveDriverIds failed [${res.status}]: ${await res.text().catch(() => "")}`);
  }
  const json = await res.json();
  const arr: Record<string, unknown>[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: Record<string, unknown>[] }).data
      : [];
  const ids = arr
    .filter((u) => Number(u.motorista) === 1)
    .map((u) => Number(u.id))
    .filter((n) => Number.isInteger(n) && n > 0);
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

const parseList = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: Record<string, unknown>[] }).data;
  }
  return [];
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

// Chave determinística do evento (id externo da RotaExata ou synthetic).
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
type JobInput = { adesao_id: string; placa: string; day: string; eventos: number[]; motoristaIds: number[] };
type FailedPair = { adesao_id: string; placa: string; day: string; endpoint: string; status: number; error: string; attempts: number };
type EmptyDay = { adesao_id: string; placa: string; day: string; endpoint: string };
type JobOutput = {
  adesao_id: string;
  placa: string;
  day: string;
  ok: boolean;
  failed?: FailedPair[];
  empty?: EmptyDay[];
  // dados a serem persistidos quando ok=true
  events: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
};

async function processJob(
  job: JobInput,
  token: string,
): Promise<JobOutput> {
  const fails: FailedPair[] = [];
  const empty: EmptyDay[] = [];

  const [logRes, dirRes] = await Promise.all([
    fetchWithRetry(urlLogMotorista(job.adesao_id, job.day, job.motoristaIds), token, parseList),
    fetchWithRetry(urlDirigibilidade(job.adesao_id, job.day, job.eventos, job.motoristaIds), token, parseList),
  ]);

  if (!logRes.ok) {
    fails.push({ ...job, endpoint: "log_motorista", status: logRes.status, error: logRes.error, attempts: logRes.attempts });
  } else if (logRes.status === 400 || logRes.status === 404) {
    // Sucesso vazio "legítimo" (dia sem posições) — visibilidade separada.
    empty.push({ adesao_id: job.adesao_id, placa: job.placa, day: job.day, endpoint: "log_motorista" });
  }
  if (!dirRes.ok) {
    fails.push({ ...job, endpoint: "dirigibilidade", status: dirRes.status, error: dirRes.error, attempts: dirRes.attempts });
  } else if (dirRes.status === 400 || dirRes.status === 404) {
    empty.push({ adesao_id: job.adesao_id, placa: job.placa, day: job.day, endpoint: "dirigibilidade" });
  }

  if (fails.length > 0) {
    return { ...job, ok: false, failed: fails, empty, events: [], sessions: [] };
  }

  const entries = (logRes as { ok: true; data: Record<string, unknown>[] }).data;
  const eventosRaw = (dirRes as { ok: true; data: Record<string, unknown>[] }).data;

  // FILTRO MOTORISTAS ATIVOS: replica exatamente o painel oficial.
  // Mesmo passando `motoristas: [...]` na query, a API às vezes ainda devolve
  // eventos de motoristas fora da lista — descarta no client.
  // Eventos com motorista_id ausente passam (serão resolvidos pela janela).
  const activeSet = new Set<number>(job.motoristaIds);
  const eventos = job.motoristaIds.length === 0
    ? eventosRaw
    : eventosRaw.filter((ev) => {
        const m = ev.motorista as Record<string, unknown> | undefined;
        const idRaw = m?.id ?? ev.motorista_id;
        if (idRaw == null || idRaw === "") return true; // sem id → tenta janela
        const idNum = Number(idRaw);
        if (!Number.isInteger(idNum)) return true;
        return activeSet.has(idNum);
      });

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

  // 3) Sessões de KM (1 linha por entry do log_motorista, sem distribuição artificial de telemetria)
  // A coluna `telemetrias` aqui fica 0; o dashboard conta direto em vehicle_telemetry_events.
  const sessionRows: Record<string, unknown>[] = entries.map((entry) => {
    const motorista = entry.motorista as Record<string, unknown> | undefined;
    const nomeRaw = motorista?.nome ? String(motorista.nome) : "";
    const nome = nomeRaw && nomeRaw !== "Desconhecido" ? nomeRaw : "Desconhecido";
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

    return {
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
      telemetrias: 0,            // não distribuímos artificialmente
      velocidade_maxima: 0,      // não é fonte certa — tabela dedicada virá depois
      excessos_velocidade: 0,
      synced_at: new Date().toISOString(),
    };
  });

  return { ...job, ok: true, empty, events: eventRows, sessions: sessionRows };
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
    const dryRun: boolean = body.dry_run === true;

    // ============================================================
    // GUARD: TELEMETRY_WRITES_FROZEN
    // Quando "true", bloqueia toda escrita em vehicle_telemetry_events
    // e daily_vehicle_km. Permite apenas execuções dry_run (somente leitura).
    // Use para congelar a tabela durante backfill/auditoria/migração.
    // ============================================================
    const writesFrozen = (Deno.env.get("TELEMETRY_WRITES_FROZEN") ?? "").toLowerCase() === "true";
    if (writesFrozen && !dryRun) {
      console.warn("[sync-daily-km] BLOCKED: TELEMETRY_WRITES_FROZEN=true; rejecting non-dry-run call");
      return new Response(JSON.stringify({
        error: "telemetry_writes_frozen",
        message: "Escritas em vehicle_telemetry_events estão congeladas (TELEMETRY_WRITES_FROZEN=true). Use dry_run=true para validar sem persistir.",
        frozen: true,
      }), {
        status: 423, // Locked
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filtro de eventos opcional. Default [1,2,3,4]; o painel oficial usa [1,2,4].
    // Aceita Array<number> ou Array<string>; valida contra o conjunto suportado.
    const ALLOWED_EVENTS: number[] = [1, 2, 3, 4];
    let eventos: number[] = [1, 2, 3, 4];
    if (Array.isArray(body.eventos)) {
      const parsed: number[] = (body.eventos as unknown[])
        .map((x) => Number(x))
        .filter((n): n is number => Number.isInteger(n) && ALLOWED_EVENTS.includes(n));
      if (parsed.length > 0) {
        eventos = Array.from(new Set<number>(parsed)).sort((a, b) => a - b);
      }
    }

    if (!start_date || !end_date) {
      return new Response(JSON.stringify({ error: "start_date and end_date required (YYYY-MM-DD)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: vehicles } = await supabase
      .from("vehicles").select("adesao_id, placa").not("adesao_id", "is", null);
    if (!vehicles?.length) {
      return new Response(JSON.stringify({ mode, dry_run: dryRun, synced: 0, message: "No vehicles" }), {
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

    const token = await getToken();

    // Lista oficial de motoristas ATIVOS (campo `motorista===1` em /usuarios).
    // Replicada exatamente do filtro do painel — eventos fora dessa lista são
    // ignorados (motoristas antigos/desativados, terceiros, visitantes).
    // Por padrão SEMPRE aplica o filtro; pode ser desligado com use_active_drivers_filter:false.
    const useActiveFilter = body.use_active_drivers_filter !== false;
    let motoristaIds: number[] = [];
    if (useActiveFilter) {
      try {
        motoristaIds = await fetchActiveDriverIds(token);
        console.log(`[sync-daily-km] motoristas ativos=${motoristaIds.length} ids=[${motoristaIds.slice(0, 8).join(",")}...]`);
      } catch (e) {
        console.warn(`[sync-daily-km] fetchActiveDriverIds falhou — seguindo sem filtro:`, (e as Error).message);
      }
    }

    const jobs: JobInput[] = [];
    for (const v of vehicles) {
      for (const day of days) {
        jobs.push({ adesao_id: v.adesao_id!, placa: v.placa, day, eventos, motoristaIds });
      }
    }

    console.log(`[sync-daily-km] mode=${mode} dry_run=${dryRun} eventos=[${eventos.join(",")}] motoristas_ativos=${motoristaIds.length} jobs=${jobs.length} (${vehicles.length} veículos × ${days.length} dias)`);

    const results = await runPool(jobs, POOL_SIZE, (j) => processJob(j, token));

    const failed_pairs: FailedPair[] = [];
    const empty_days: EmptyDay[] = [];
    let ok = 0, failed = 0;
    for (const r of results) {
      if (r.ok) ok++;
      else { failed++; if (r.failed) failed_pairs.push(...r.failed); }
      if (r.empty?.length) empty_days.push(...r.empty);
    }

    const stats = {
      mode,
      dry_run: dryRun,
      eventos,
      motoristas_ativos_count: motoristaIds.length,
      total_jobs: jobs.length,
      ok,
      failed,
      total_attempts: jobs.length * 2, // 2 endpoints por job
      failed_pairs,
      empty_days_count: empty_days.length,
      empty_days,
    };

    console.log(`[sync-daily-km] result mode=${mode} dry_run=${dryRun} ok=${ok} failed=${failed} failures=${failed_pairs.length} empty_days=${empty_days.length}`);
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

    const okResults = results.filter((r) => r.ok);

    // Resumo agregado por motorista (sempre incluso — usado no dry_run e como amostra no real)
    type DriverAgg = { km: number; telemetrias: number; placas: Set<string> };
    const porMotorista = new Map<string, DriverAgg>();
    for (const r of okResults) {
      for (const s of r.sessions) {
        const nome = String(s.motorista_nome);
        const km = Number(s.km_percorrido) || 0;
        if (!porMotorista.has(nome)) porMotorista.set(nome, { km: 0, telemetrias: 0, placas: new Set() });
        const a = porMotorista.get(nome)!;
        a.km += km;
        a.placas.add(String(s.placa));
      }
      for (const e of r.events) {
        const nome = String(e.motorista_nome);
        if (!porMotorista.has(nome)) porMotorista.set(nome, { km: 0, telemetrias: 0, placas: new Set() });
        const a = porMotorista.get(nome)!;
        a.telemetrias += 1;
        a.placas.add(String(e.placa));
      }
    }
    const summary = Array.from(porMotorista.entries())
      .map(([nome, a]) => ({
        nome,
        km_rodado: Math.round(a.km * 100) / 100,
        telemetrias: a.telemetrias,
        placas: Array.from(a.placas),
      }))
      .sort((a, b) => b.km_rodado - a.km_rodado || b.telemetrias - a.telemetrias);

    const totals = {
      events: okResults.reduce((s, r) => s + r.events.length, 0),
      sessions: okResults.reduce((s, r) => s + r.sessions.length, 0),
      drivers: porMotorista.size,
    };

    // DRY-RUN: não persiste, retorna resumo.
    // Loga o resumo completo nos logs da edge function — o tool curl pode cortar
    // a resposta HTTP por timeout, mas os logs persistem e ficam consultáveis.
    if (dryRun) {
      console.log(`[sync-daily-km] DRY_RUN totals:`, JSON.stringify(totals));
      console.log(`[sync-daily-km] DRY_RUN por_motorista:`, JSON.stringify(summary));
      console.log(`[sync-daily-km] DRY_RUN empty_days_count=${empty_days.length}`);
      return new Response(JSON.stringify({
        ...stats,
        totals,
        por_motorista: summary,
      }), {
        status: failed > 0 ? 207 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FREEZE GUARD (manutenção): bloqueia escrita quando TELEMETRY_WRITES_FROZEN está setado para algo truthy
    const freezeRaw = Deno.env.get("TELEMETRY_WRITES_FROZEN");
    console.log(`[sync-daily-km] freeze check: raw=${JSON.stringify(freezeRaw)} type=${typeof freezeRaw}`);
    const freezeNorm = (freezeRaw ?? "").trim().toLowerCase();
    const isFrozen = freezeNorm === "1" || freezeNorm === "true" || freezeNorm === "yes" || freezeNorm === "on";
    if (isFrozen) {
      console.warn(`[sync-daily-km] writes frozen for maintenance — skipping persistence (value=${JSON.stringify(freezeRaw)})`);
      return new Response(JSON.stringify({
        ...stats,
        totals,
        ok: false,
        reason: "writes_frozen_for_maintenance",
        freeze_value: freezeRaw,
      }), {
        status: 423,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persistência ATÔMICA via RPC: 1 chamada por (adesao,dia) — delete+insert em transação.
    // Roda em pool para não estourar conexões.
    let insertedEvents = 0;
    let insertedSessions = 0;
    const persistFails: { adesao_id: string; day: string; error: string }[] = [];

    await runPool(okResults, 8, async (r) => {
      const { data, error } = await supabase.rpc("sync_replace_day_telemetry", {
        p_adesao_id: r.adesao_id,
        p_data: r.day,
        p_events: r.events,
        p_sessions: r.sessions,
      });
      if (error) {
        persistFails.push({ adesao_id: r.adesao_id, day: r.day, error: error.message });
        return;
      }
      const d = data as { inserted_events?: number; inserted_sessions?: number } | null;
      insertedEvents += d?.inserted_events ?? 0;
      insertedSessions += d?.inserted_sessions ?? 0;
    });

    if (persistFails.length > 0) {
      console.warn(`[sync-daily-km] persist failures:`, JSON.stringify(persistFails.slice(0, 5)));
    }

    const status = (mode === "resilient" && (failed > 0 || persistFails.length > 0)) ? 207 : 200;
    return new Response(JSON.stringify({
      ...stats,
      totals,
      inserted_events: insertedEvents,
      inserted_sessions: insertedSessions,
      persist_failures: persistFails,
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
