import { supabase } from "@/integrations/supabase/client";

const FUNCTION_NAME = "rotaexata-proxy";

async function callRotaExata(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  params?: Record<string, string>,
  body?: Record<string, unknown>
) {
  const queryParams = new URLSearchParams({ path, ...params });

  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    method,
    body: method === "POST" || method === "PUT" ? body : undefined,
    headers: {
      "Content-Type": "application/json",
    },
    // Pass query params via the URL
  });

  // supabase.functions.invoke doesn't support query params natively,
  // so we use a direct fetch instead
  return data;
}

// Direct fetch approach for query param support
async function rotaExataFetch(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  params?: Record<string, string>,
  body?: Record<string, unknown>
) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
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
  return rotaExataFetch("/adesoes", "GET", params);
}

/** Retorna uma adesão específica */
export async function getAdesao(id: string) {
  return rotaExataFetch(`/adesoes/${id}`);
}

/** Retorna a última posição de todos os veículos */
export async function getUltimaPosicaoTodos() {
  return rotaExataFetch("/ultima-posicao/todos");
}

/** Retorna a última posição de um veículo */
export async function getUltimaPosicao(adesaoId: string) {
  return rotaExataFetch(`/ultima-posicao/${adesaoId}`);
}

/** Retorna todas as posições de um veículo no dia */
export async function getPosicoes(adesaoId: string, data: string) {
  return rotaExataFetch(`/posicoes/${adesaoId}/${data}`);
}

/** Retorna posições tratadas de um veículo no dia */
export async function getAtivar(adesaoId: string, data: string) {
  return rotaExataFetch(`/ativar/${adesaoId}/${data}`);
}

/** Retorna resumo do dia de um veículo */
export async function getResumoDia(adesaoId: string, data: string) {
  return rotaExataFetch(`/resumo-dia/${adesaoId}/${data}`);
}

/** Retorna dados do odômetro */
export async function getOdometro(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/odometro", "GET", params);
}

/** Atualiza o odômetro */
export async function updateOdometro(body: { adesao_id: number; odometro: number }) {
  return rotaExataFetch("/odometro", "POST", undefined, body);
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
  return rotaExataFetch("/comando", "POST", undefined, body);
}

/** Retorna comandos enviados */
export async function getComandosEnviados(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/comandos-enviados", "GET", params);
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
  return rotaExataFetch("/relatorios/rastreamento/kmrodado", "GET", params);
}

/** Relatório de dirigibilidade (freada brusca, curva, etc) */
export async function getRelatorioDirigibilidade(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/dirigibilidade", "GET", params);
}

/** Relatório de deslocamento ponto a ponto */
export async function getRelatorioDeslocamento(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/deslocamento", "GET", params);
}

/** Relatório de jornada de trabalho analítico */
export async function getRelatorioJornadaAnalitico(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/jornada_trabalho_analitico", "GET", params);
}

/** Relatório de jornada de trabalho sumarizado */
export async function getRelatorioJornadaSumarizado(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/jornada_trabalho_sumarizado", "GET", params);
}

/** Relatório de uso indevido */
export async function getRelatorioUsoIndevido(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/uso_indevido", "GET", params);
}

/** Relatório de paradas e passagens */
export async function getRelatorioParadasPassagens(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/paradas_passagens", "GET", params);
}

/** Relatório de log de motorista */
export async function getRelatorioLogMotorista(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/log_motorista", "GET", params);
}

/** Relatório rua por rua */
export async function getRelatorioRuaPorRua(params: {
  adesao_id: string;
  data_inicio: string;
  data_fim: string;
}) {
  return rotaExataFetch("/relatorios/rastreamento/ruaPorRua", "GET", params);
}

// ===========================
// CERCAS
// ===========================

export async function getCercas(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/cercas", "GET", params);
}

// ===========================
// MÓDULOS - GESTÃO
// ===========================

/** Retorna custos registrados */
export async function getCustos(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/custos", "GET", params);
}

/** Retorna multas registradas */
export async function getMultas(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/multas", "GET", params);
}

// ===========================
// MÓDULOS - AUTOMAÇÃO
// ===========================

/** Retorna respostas de formulários */
export async function getRespostas(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/respostas", "GET", params);
}

// ===========================
// DESTINOS
// ===========================

export async function getDestinos(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/destinos", "GET", params);
}

export async function getDestinosProximos(lat: number, long: number, raio: number) {
  return rotaExataFetch(`/destinos-proximos/${lat}/${long}/${raio}`);
}

// ===========================
// USUÁRIOS (Motoristas no Rota Exata)
// ===========================

export async function getUsuariosRotaExata(where?: string) {
  const params: Record<string, string> = {};
  if (where) params.where = where;
  return rotaExataFetch("/usuarios", "GET", params);
}
