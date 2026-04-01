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

export async function getRelatorioKmRodado(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  // Rota Exata expects report params as POST body
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(
    "/relatorios/rastreamento/kmrodado",
    "POST",
    undefined,
    { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim }
  );
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioDirigibilidade(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/dirigibilidade", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioDeslocamento(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/deslocamento", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioJornadaAnalitico(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/jornada_trabalho_analitico", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioJornadaSumarizado(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/jornada_trabalho_sumarizado", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioUsoIndevido(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/uso_indevido", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioParadasPassagens(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/paradas_passagens", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioLogMotorista(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/log_motorista", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

export async function getRelatorioRuaPorRua(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}): Promise<unknown> {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/ruaPorRua", "POST", undefined, { adesao_id: Number(params.adesao_id), data_inicio: params.data_inicio, data_fim: params.data_fim });
  return unwrapRotaExataResponse(response);
}

// ===========================
// MÓDULOS - GESTÃO
// ===========================

export async function getCustos(where?: string): Promise<unknown> {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/custos", "GET", params);
  return unwrapRotaExataResponse(response);
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
  const params: Record<string, string> = { quantidade: "1000" };
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<RotaExataUsuarioResponse[]>>("/usuarios", "GET", params);
  return unwrapRotaExataResponse(response);
}
