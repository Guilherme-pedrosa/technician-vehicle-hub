import { supabase } from "@/integrations/supabase/client";

const FUNCTION_NAME = "rotaexata-proxy";

type RotaExataEnvelope<T> = T | { data: T };

export type RotaExataAdesaoResponse = {
  id: number;
  placa: string;
  [key: string]: unknown;
};

export type RotaExataPosicaoResponse = {
  adesao_id: number;
  placa?: string;
  latitude: number;
  longitude: number;
  velocidade: number;
  ignicao: boolean;
  data_posicao: string;
  endereco?: string;
  odometro?: number;
  direcao?: number;
  motorista_id?: number | null;
  motorista_key?: string | null;
  [key: string]: unknown;
};

export type RotaExataUsuarioResponse = {
  id: number;
  nome: string;
  [key: string]: unknown;
};

export type RotaExataChecklistResponse = {
  id: number;
  [key: string]: unknown;
};

type RawRotaExataPosicao = {
  posicao?: Record<string, unknown>;
  adesao_id?: number | string;
  placa?: string;
  latitude?: number;
  longitude?: number;
  velocidade?: number;
  ignicao?: boolean | number;
  data_posicao?: string;
  dt_posicao?: string;
  endereco?: string;
  odometro?: number;
  odometro_original?: number;
  odometro_gps?: number;
  direcao?: number;
  motorista_id?: number | null;
  motorista_key?: string | null;
  adesao?: {
    id?: number | string;
    vei_placa?: string;
  };
  [key: string]: unknown;
};

function unwrapRotaExataResponse<T>(payload: RotaExataEnvelope<T>): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data as T;
  }

  return payload as T;
}

function parseCostWhere(where?: string): Record<string, unknown> | null {
  if (!where) return null;
  try {
    const parsed = JSON.parse(where);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getCostDateRange(whereObj: Record<string, unknown> | null) {
  const raw = whereObj?.dt_lancamento;
  if (!raw || typeof raw !== "object") return null;
  const range = raw as Record<string, unknown>;
  const gte = typeof range.$gte === "string" ? range.$gte : undefined;
  const lte = typeof range.$lte === "string" ? range.$lte : undefined;
  return gte || lte ? { $gte: gte, $lte: lte } : null;
}

function buildCostWhereForDateField(base: Record<string, unknown>, field: string, range: { $gte?: string; $lte?: string }) {
  const next = { ...base };
  delete next.dt_lancamento;
  next[field] = range;
  return JSON.stringify(next);
}

function costMatchesOriginalWhere(item: Record<string, unknown>, whereObj: Record<string, unknown> | null) {
  if (!whereObj) return true;
  const range = getCostDateRange(whereObj);
  if (range) {
    const dateValue = typeof item.dt_lancamento === "string" ? item.dt_lancamento : "";
    const time = Date.parse(dateValue);
    if (!Number.isFinite(time)) return false;
    if (range.$gte && time < Date.parse(range.$gte)) return false;
    if (range.$lte && time > Date.parse(range.$lte)) return false;
  }

  if (typeof whereObj.tipo_custo_nome === "string") {
    const tipo = item.tipo_custo && typeof item.tipo_custo === "object"
      ? String((item.tipo_custo as Record<string, unknown>).nome ?? "")
      : String(item.tipo_custo_nome ?? "");
    if (tipo !== whereObj.tipo_custo_nome) return false;
  }

  return true;
}

function normalizePosicao(item: RawRotaExataPosicao): RotaExataPosicaoResponse {
  const posicao = ((item.posicao as Record<string, unknown> | undefined) ?? item) as RawRotaExataPosicao;
  const ignicao = posicao.ignicao;
  const adesaoId = Number(posicao.adesao_id ?? posicao.adesao?.id ?? item.adesao_id ?? 0);

  return {
    ...posicao,
    adesao_id: Number.isFinite(adesaoId) ? adesaoId : 0,
    placa: posicao.placa ?? posicao.adesao?.vei_placa ?? item.placa,
    latitude: Number(posicao.latitude ?? 0),
    longitude: Number(posicao.longitude ?? 0),
    velocidade: Number(posicao.velocidade ?? 0),
    ignicao: ignicao === true || ignicao === 1,
    data_posicao: String(posicao.data_posicao ?? posicao.dt_posicao ?? ""),
    endereco: typeof posicao.endereco === "string" ? posicao.endereco : undefined,
    odometro: Number(posicao.odometro ?? posicao.odometro_original ?? posicao.odometro_gps ?? 0),
    direcao: typeof posicao.direcao === "number" ? posicao.direcao : undefined,
    motorista_id: posicao.motorista_id ?? item.motorista_id ?? null,
    motorista_key: posicao.motorista_key ?? item.motorista_key ?? null,
  };
}

async function rotaExataFetch<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  params?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<T> {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/${FUNCTION_NAME}`;

  const queryParams = new URLSearchParams({ path, ...params });
  const url = `${baseUrl}?${queryParams.toString()}`;

  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  if (!token) {
    throw new Error("Usuário não autenticado");
  }

  const fetchOptions: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  };

  if (body && (method === "POST" || method === "PUT")) {
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);
  if (!res.ok) {
    const errorBody = await res.text();
    // 404 from RotaExata means "no data found" — not an error, return empty
    if (res.status === 404) {
      return [] as unknown as T;
    }
    throw new Error(`Rota Exata API error [${res.status}]: ${errorBody}`);
  }

  return res.json();
}

// ===========================
// API DE RASTREAMENTO
// ===========================

export async function getAdesoes(where?: string): Promise<RotaExataAdesaoResponse[]> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<RotaExataAdesaoResponse[]>>("/adesoes", "GET", params);
  return unwrapRotaExataResponse(response);
}

export async function getAdesao(id: string): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/adesoes/${id}`);
  return unwrapRotaExataResponse(response);
}

export async function getUltimaPosicaoTodos(): Promise<RotaExataPosicaoResponse[]> {
  const response = await rotaExataFetch<RotaExataEnvelope<RawRotaExataPosicao[]>>("/ultima-posicao/todos");
  const items = unwrapRotaExataResponse(response);
  return Array.isArray(items) ? items.map(normalizePosicao) : [];
}

export async function getUltimaPosicao(adesaoId: string): Promise<RotaExataPosicaoResponse> {
  const response = await rotaExataFetch<RotaExataEnvelope<RawRotaExataPosicao | RawRotaExataPosicao[]>>(`/ultima-posicao/${adesaoId}`);
  const item = unwrapRotaExataResponse(response);
  return Array.isArray(item) ? normalizePosicao(item[0] ?? {}) : normalizePosicao(item ?? {});
}

export async function getPosicoes(adesaoId: string, data: string): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/posicoes/${adesaoId}/${data}`);
  return unwrapRotaExataResponse(response);
}

export async function getAtivar(adesaoId: string, data: string): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/ativar/${adesaoId}/${data}`);
  return unwrapRotaExataResponse(response);
}

export async function getResumoDia(adesaoId: string, data: string): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/resumo-dia/${adesaoId}/${data}`);
  return unwrapRotaExataResponse(response);
}

export async function getOdometro(where?: string): Promise<unknown> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/odometro", "GET", params);
  return unwrapRotaExataResponse(response);
}

export async function updateOdometro(body: { adesao_id: number; odometro_adesao: number }): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/odometro", "POST", undefined, body);
  return unwrapRotaExataResponse(response);
}

// ===========================
// COMANDOS
// ===========================

export async function enviarComando(body: {
  adesao_id: number;
  comando: "bloqueio" | "desbloqueio";
  expirar: number;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/comando", "POST", undefined, body);
  return unwrapRotaExataResponse(response);
}

export async function getComandosEnviados(where?: string): Promise<unknown> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/comandos-enviados", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// RELATÓRIOS DE RASTREAMENTO
// ===========================

// Helper: all RotaExata reports use GET with ?where=JSON
async function fetchRelatorio(endpoint: string, adesaoId: string, data: string, extra?: Record<string, unknown>): Promise<unknown> {
  const where = JSON.stringify({ adesao_id: Number(adesaoId), data, ...extra });
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(
    `/relatorios/rastreamento/${endpoint}`,
    "GET",
    { where }
  );
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioKmRodado(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("kmrodado", params.adesao_id, params.data);
}

export async function getRelatorioDirigibilidade(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("dirigibilidade", params.adesao_id, params.data);
}

export async function getRelatorioDeslocamento(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("deslocamento", params.adesao_id, params.data);
}

export async function getRelatorioJornadaAnalitico(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("jornada_trabalho_analitico", params.adesao_id, params.data);
}

export async function getRelatorioJornadaSumarizado(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("jornada_trabalho_sumarizado", params.adesao_id, params.data);
}

export async function getRelatorioUsoIndevido(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("uso_indevido", params.adesao_id, params.data);
}

export async function getRelatorioParadasPassagens(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("paradas_passagens", params.adesao_id, params.data);
}

export async function getRelatorioLogMotorista(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("log_motorista", params.adesao_id, params.data, { horario: "00:00-23:59" });
}

export async function getRelatorioRuaPorRua(params: {
  adesao_id: string;
  data: string;
}): Promise<unknown> {
  return fetchRelatorio("ruaPorRua", params.adesao_id, params.data);
}

// ===========================
// MÓDULOS - GESTÃO
// ===========================

export async function getCustos(where?: string): Promise<unknown> {
  // Pagina sem limite efetivo — Rota Exata corta em 500 por chamada por padrão.
  // Períodos longos (>3 meses) ou alta movimentação ultrapassam isso e
  // perdíamos abastecimentos silenciosamente, fazendo o total divergir do painel.
  const PAGE_SIZE = 500;
  const byId = new Map<string, unknown>();
  const addItems = (items: unknown[], shouldFilter = false, whereObj: Record<string, unknown> | null = null) => {
    items.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      if (shouldFilter && !costMatchesOriginalWhere(item as Record<string, unknown>, whereObj)) return;
      const id = String((item as Record<string, unknown>)._id ?? `fallback-${byId.size}-${index}`);
      byId.set(id, item);
    });
  };

  const fetchPages = async (queryWhere?: string, maxPages = 50) => {
    const collected: unknown[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const params: Record<string, string> = {
        limit: String(PAGE_SIZE),
        page: String(page),
        fields: '["*"]',
      };
      if (queryWhere) params.where = queryWhere;
      const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/custos", "GET", params);
      const data = unwrapRotaExataResponse(response);
      const items = Array.isArray(data) ? data : [];
      collected.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return collected;
  };

  const parsedWhere = parseCostWhere(where);
  const dateRange = getCostDateRange(parsedWhere);

  // Roda primária + fallbacks (created/updated) + recentes em paralelo.
  // Antes era sequencial, custando ~3-4× mais latência por carregamento.
  const tasks: Array<Promise<{ items: unknown[]; filter: boolean }>> = [
    fetchPages(where).then((items) => ({ items, filter: false })),
  ];

  if (parsedWhere && dateRange) {
    tasks.push(
      fetchPages(buildCostWhereForDateField(parsedWhere, "created", dateRange))
        .then((items) => ({ items, filter: true }))
        .catch((error) => {
          console.warn("Rota Exata custos fallback created ignorado:", error);
          return { items: [], filter: true };
        }),
      fetchPages(buildCostWhereForDateField(parsedWhere, "updated", dateRange))
        .then((items) => ({ items, filter: true }))
        .catch((error) => {
          console.warn("Rota Exata custos fallback updated ignorado:", error);
          return { items: [], filter: true };
        }),
      fetchPages(undefined, 1)
        .then((items) => ({ items, filter: true }))
        .catch((error) => {
          console.warn("Rota Exata custos recentes ignorado:", error);
          return { items: [], filter: true };
        }),
    );
  }

  const results = await Promise.all(tasks);
  for (const { items, filter } of results) {
    addItems(items, filter, parsedWhere);
  }

  return Array.from(byId.values());
}

export async function getMultas(where?: string): Promise<unknown> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/multas", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// MÓDULOS - AUTOMAÇÃO
// ===========================

export async function getRespostas(where?: string): Promise<RotaExataChecklistResponse[]> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<RotaExataChecklistResponse[]>>("/respostas", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// DESTINOS
// ===========================

export async function getDestinos(where?: string): Promise<unknown> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/destinos", "GET", params);
  return unwrapRotaExataResponse(response);
}

export async function getDestinosProximos(lat: number, long: number, raio: number): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/destinos-proximos/${lat}/${long}/${raio}`);
  return unwrapRotaExataResponse(response);
}

// ===========================
// USUÁRIOS (Motoristas no Rota Exata)
// ===========================

export async function getUsuariosRotaExata(where?: string): Promise<RotaExataUsuarioResponse[]> {
  const params: Record<string, string> = { limit: "1000" };
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<RotaExataUsuarioResponse[]>>("/usuarios", "GET", params);
  return unwrapRotaExataResponse(response);
}
