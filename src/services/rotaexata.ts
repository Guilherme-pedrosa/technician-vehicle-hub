import { supabase } from "@/integrations/supabase/client";

const FUNCTION_NAME = "rotaexata-proxy";

type RotaExataEnvelope<T> = T | { data: T };

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

function normalizePosicao(item: RawRotaExataPosicao) {
  const posicao = ((item.posicao as Record<string, unknown> | undefined) ?? item) as RawRotaExataPosicao;
  const ignicao = posicao.ignicao;

  return {
    ...posicao,
    adesao_id: posicao.adesao_id ?? posicao.adesao?.id ?? item.adesao_id,
    placa: posicao.placa ?? posicao.adesao?.vei_placa ?? item.placa,
    latitude: Number(posicao.latitude ?? 0),
    longitude: Number(posicao.longitude ?? 0),
    velocidade: Number(posicao.velocidade ?? 0),
    ignicao: ignicao === true || ignicao === 1,
    data_posicao: String(posicao.data_posicao ?? posicao.dt_posicao ?? ""),
    endereco: typeof posicao.endereco === "string" ? posicao.endereco : undefined,
    odometro: Number(posicao.odometro ?? posicao.odometro_original ?? posicao.odometro_gps ?? 0),
    direcao: typeof posicao.direcao === "number" ? posicao.direcao : undefined,
  };
}

// Direct fetch approach for query param support
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

/** Retorna todas as adesões (veículos rastreados) */
export async function getAdesoes(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown[]>>("/adesoes", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Retorna uma adesão específica */
export async function getAdesao(id: string) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/adesoes/${id}`);
  return unwrapRotaExataResponse(response);
}

/** Retorna a última posição de todos os veículos */
export async function getUltimaPosicaoTodos() {
  const response = await rotaExataFetch<RotaExataEnvelope<RawRotaExataPosicao[]>>("/ultima-posicao/todos");
  const items = unwrapRotaExataResponse(response);
  return Array.isArray(items) ? items.map(normalizePosicao) : [];
}

/** Retorna a última posição de um veículo */
export async function getUltimaPosicao(adesaoId: string) {
  const response = await rotaExataFetch<RotaExataEnvelope<RawRotaExataPosicao | RawRotaExataPosicao[]>>(`/ultima-posicao/${adesaoId}`);
  const item = unwrapRotaExataResponse(response);
  return Array.isArray(item) ? normalizePosicao(item[0] ?? {}) : normalizePosicao(item ?? {});
}

/** Retorna todas as posições de um veículo no dia */
export async function getPosicoes(adesaoId: string, data: string) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/posicoes/${adesaoId}/${data}`);
  return unwrapRotaExataResponse(response);
}

/** Retorna posições tratadas de um veículo no dia */
export async function getAtivar(adesaoId: string, data: string) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/ativar/${adesaoId}/${data}`);
  return unwrapRotaExataResponse(response);
}

/** Retorna resumo do dia de um veículo */
export async function getResumoDia(adesaoId: string, data: string) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/resumo-dia/${adesaoId}/${data}`);
  return unwrapRotaExataResponse(response);
}

/** Retorna dados do odômetro */
export async function getOdometro(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/odometro", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Atualiza o odômetro */
export async function updateOdometro(body: { adesao_id: number; odometro: number }) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/odometro", "POST", undefined, body);
  return unwrapRotaExataResponse(response);
}

// ===========================
// COMANDOS
// ===========================

/** Envia comando para veículo (bloqueio/desbloqueio) */
export async function enviarComando(body: {
  adesao_id: number;
  comando: "bloqueio" | "desbloqueio";
  expirar: number;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/comando", "POST", undefined, body);
  return unwrapRotaExataResponse(response);
}

/** Retorna comandos enviados */
export async function getComandosEnviados(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/comandos-enviados", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// RELATÓRIOS DE RASTREAMENTO
// ===========================

/** Relatório de KM rodado */
export async function getRelatorioKmRodado(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/kmrodado", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de dirigibilidade (freada brusca, curva, etc) */
export async function getRelatorioDirigibilidade(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/dirigibilidade", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de deslocamento ponto a ponto */
export async function getRelatorioDeslocamento(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/deslocamento", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de jornada de trabalho analítico */
export async function getRelatorioJornadaAnalitico(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/jornada_trabalho_analitico", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de jornada de trabalho sumarizado */
export async function getRelatorioJornadaSumarizado(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/jornada_trabalho_sumarizado", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de uso indevido */
export async function getRelatorioUsoIndevido(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/uso_indevido", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de paradas e passagens */
export async function getRelatorioParadasPassagens(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/paradas_passagens", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório de log de motorista */
export async function getRelatorioLogMotorista(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/log_motorista", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Relatório rua por rua */
export async function getRelatorioRuaPorRua(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/relatorios/rastreamento/ruaPorRua", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// CERCAS
// ===========================

export async function getCercas(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/cercas", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// MÓDULOS - GESTÃO
// ===========================

/** Retorna custos registrados */
export async function getCustos(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/custos", "GET", params);
  return unwrapRotaExataResponse(response);
}

/** Retorna multas registradas */
export async function getMultas(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/multas", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// MÓDULOS - AUTOMAÇÃO
// ===========================

/** Retorna respostas de formulários */
export async function getRespostas(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/respostas", "GET", params);
  return unwrapRotaExataResponse(response);
}

// ===========================
// DESTINOS
// ===========================

export async function getDestinos(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>("/destinos", "GET", params);
  return unwrapRotaExataResponse(response);
}

export async function getDestinosProximos(lat: number, long: number, raio: number) {
  const response = await rotaExataFetch<RotaExataEnvelope<unknown>>(`/destinos-proximos/${lat}/${long}/${raio}`);
  return unwrapRotaExataResponse(response);
}

// ===========================
// USUÁRIOS (Motoristas no Rota Exata)
// ===========================

export async function getUsuariosRotaExata(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  const response = await rotaExataFetch<RotaExataEnvelope<unknown[]>>("/usuarios", "GET", params);
  return unwrapRotaExataResponse(response);
}
