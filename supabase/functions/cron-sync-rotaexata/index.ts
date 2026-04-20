import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * cron-sync-rotaexata — Called every hour by pg_cron.
 * Syncs today's KM data (and optionally vehicles/drivers) from RotaExata.
 * No user auth required — uses service role key internally.
 * Protected by matching the anon key in the Authorization header (sent by pg_cron).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROTAEXATA_API = "https://api.rotaexata.com.br";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const email = Deno.env.get("ROTAEXATA_EMAIL");
  const password = Deno.env.get("ROTAEXATA_PASSWORD");
  if (!email || !password) throw new Error("ROTAEXATA credentials not configured");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${ROTAEXATA_API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 502 || res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
        continue;
      }
      if (!res.ok) throw new Error(`Login failed: ${res.status}`);
      const data = await res.json();
      cachedToken = data.token || data.access_token || data.authorization;
      if (!cachedToken) throw new Error("No token in response");
      tokenExpiry = Date.now() + 50 * 60 * 1000;
      return cachedToken;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error("Login failed after retries");
}

async function fetchLogMotorista(token: string, adesaoId: string, data: string): Promise<unknown[]> {
  const where = JSON.stringify({ adesao_id: Number(adesaoId), data, horario: "00:00-23:59" });
  const url = `${ROTAEXATA_API}/relatorios/rastreamento/log_motorista?where=${encodeURIComponent(where)}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", Authorization: token },
  });
  if (!res.ok) return [];
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (json?.data && Array.isArray(json.data)) return json.data;
  return [];
}

async function fetchResumoDia(token: string, adesaoId: string | number, data: string) {
  const url = `${ROTAEXATA_API}/resumo-dia/${adesaoId}/${data}`;
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: token },
    });
    if (!res.ok) return { telemetrias: 0, velocidadeMaxima: 0 };
    const json = await res.json();
    const basico = json?.basico ?? json?.data?.basico ?? json;
    const telemetrias = Number(
      basico?.telemetria?.quantidade ?? basico?.telemetrias ?? basico?.telemetria ?? json?.telemetria?.quantidade ?? json?.rowCount ?? 0
    ) || 0;
    const velocidadeMaxima = Number(
      basico?.velocidade?.maxima ?? basico?.velocidade_maxima ?? basico?.vel_maxima ?? json?.velocidade?.maxima ?? 0
    ) || 0;
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

/**
 * Extrai o odômetro do RASTREADOR (GPS) em km da posição.
 * Esse valor SOZINHO não reflete o KM real do veículo — é só a distância
 * percorrida pelo rastreador desde a instalação. Use combineKmAtual().
 */
function extractRastreadorKm(pos: Record<string, unknown>): number {
  const odometro = pos.odometro_original ?? pos.odometro_gps ?? pos.odometro ?? 0;
  return Math.round(Number(odometro) / 1000);
}

/**
 * Busca a última correção manual de odômetro (`/odometro`) por adesão.
 * O endpoint retorna todo o histórico — pegamos o registro mais recente
 * (maior `created`) por adesao_id.
 */
async function fetchUltimasCorrecoesOdometro(
  token: string,
  adesoesIds: string[]
): Promise<Map<string, { adesaoKm: number; rastreadorKm: number }>> {
  const result = new Map<string, { adesaoKm: number; rastreadorKm: number }>();
  // Busca em lotes para não sobrecarregar
  for (const adesaoId of adesoesIds) {
    try {
      const where = encodeURIComponent(JSON.stringify({ adesao_id: Number(adesaoId) }));
      const url = `${ROTAEXATA_API}/odometro?where=${where}&limit=1000`;
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", Authorization: token },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const items: Array<Record<string, unknown>> = Array.isArray(json) ? json : (json?.data ?? []);
      if (!items.length) continue;
      // Pega o registro com maior `created`
      let latest: Record<string, unknown> | null = null;
      let latestTs = 0;
      for (const item of items) {
        const ts = new Date(String(item.created ?? item.updated ?? 0)).getTime();
        if (ts > latestTs) {
          latestTs = ts;
          latest = item;
        }
      }
      if (!latest) continue;
      const adesaoKm = Math.round(Number(latest.odometro_adesao ?? 0) / 1000);
      const rastreadorKm = Math.round(Number(latest.odometro_rastreador ?? 0) / 1000);
      if (adesaoKm > 0) {
        result.set(adesaoId, { adesaoKm, rastreadorKm });
      }
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return result;
}

/**
 * Calcula o KM REAL do veículo combinando:
 *   última correção manual (odometro_adesao) + delta percorrido pelo
 *   rastreador desde aquela correção.
 * Espelha o cálculo exibido no painel do Rota Exata.
 */
function combineKmAtual(
  rastreadorAtualKm: number,
  correcao: { adesaoKm: number; rastreadorKm: number } | undefined
): number {
  if (!correcao || correcao.adesaoKm <= 0) return rastreadorAtualKm;
  const delta = Math.max(0, rastreadorAtualKm - correcao.rastreadorKm);
  return correcao.adesaoKm + delta;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Today's date in Brasilia timezone (UTC-3)
    const now = new Date();
    const brasiliaOffset = -3 * 60;
    const brasiliaTime = new Date(now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000);
    const today = brasiliaTime.toISOString().split("T")[0];

    console.log(`[cron-sync] Starting hourly sync for ${today}`);

    // Get speed limit
    let limiteVelocidade = 120;
    try {
      const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "limite_velocidade_kmh").single();
      if (setting?.value) limiteVelocidade = Number(setting.value) || 120;
    } catch { /* default */ }

    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("adesao_id, placa")
      .not("adesao_id", "is", null);

    if (!vehicles?.length) {
      console.log("[cron-sync] No vehicles found");
      return new Response(JSON.stringify({ synced: 0, message: "No vehicles" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rotaToken = await getToken();
    let totalSynced = 0;
    let totalErrors = 0;

    for (const vehicle of vehicles) {
      try {
        const entries = await fetchLogMotorista(rotaToken, vehicle.adesao_id!, today);
        const resumo = await fetchResumoDia(rotaToken, vehicle.adesao_id!, today);

        if (entries.length === 0 && resumo.telemetrias === 0) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }

        const excessos = resumo.velocidadeMaxima > limiteVelocidade ? 1 : 0;

        if (entries.length > 0) {
          const totalKmDay = (entries as Record<string, unknown>[]).reduce((sum, e) => sum + extractKm(e), 0);

          for (const entry of entries as Record<string, unknown>[]) {
            const km = extractKm(entry);
            if (km <= 0) continue;

            const motorista = entry.motorista as Record<string, unknown> | undefined;
            const motoristaNome = motorista?.nome && motorista.nome !== "Desconhecido"
              ? String(motorista.nome) : "Sem condutor vinculado";
            const motoristaId = motorista?.id ? String(motorista.id) : null;
            const placa = (entry.placa as string) ?? vehicle.placa;
            const hrVinculo = (entry.hr_vinculo as string) ?? (entry.horario_vinculo as string) ??
              (entry.dt_inicio as string) ?? (entry.hora_inicio as string) ?? new Date().toISOString();

            const kmShare = totalKmDay > 0 ? km / totalKmDay : 1 / entries.length;
            const telemetriasSession = Math.round(resumo.telemetrias * kmShare);

            const { error } = await supabase.from("daily_vehicle_km").upsert(
              {
                adesao_id: vehicle.adesao_id!,
                placa,
                data: today,
                motorista_nome: motoristaNome,
                motorista_id: motoristaId,
                km_percorrido: km,
                tempo_deslocamento: (entry.tempo_deslocamento as string) ?? null,
                tipo_vinculo: (entry.tipo_vinculo as string) ?? ((motorista as Record<string, unknown>)?.tipo_vinculo as string) ?? null,
                hr_vinculo: hrVinculo,
                telemetrias: telemetriasSession,
                velocidade_maxima: resumo.velocidadeMaxima,
                excessos_velocidade: excessos,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "adesao_id,data,motorista_nome,hr_vinculo", ignoreDuplicates: false }
            );
            if (!error) totalSynced++;
            else totalErrors++;
          }
        } else if (resumo.telemetrias > 0) {
          const { error } = await supabase.from("daily_vehicle_km").upsert(
            {
              adesao_id: vehicle.adesao_id!,
              placa: vehicle.placa,
              data: today,
              motorista_nome: "Sem condutor vinculado",
              motorista_id: null,
              km_percorrido: 0,
              hr_vinculo: "00:00:00",
              telemetrias: resumo.telemetrias,
              velocidade_maxima: resumo.velocidadeMaxima,
              excessos_velocidade: excessos,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "adesao_id,data,motorista_nome,hr_vinculo", ignoreDuplicates: false }
          );
          if (!error) totalSynced++;
          else totalErrors++;
        }

        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        console.warn(`[cron-sync] vehicle=${vehicle.adesao_id} error:`, (err as Error).message);
        totalErrors++;
      }
    }

    // Auto-abertura de chamado por KM sem checklist foi movida para a função
    // dedicada `scan-km-sem-checklist`, agendada 1x/dia às 10:30 (Brasília)
    // e disponível sob demanda no Dashboard (admin).

    // Also sync vehicle positions (update km_atual)
    // PROTEÇÃO: nunca diminuir o KM cadastrado e nunca aceitar um KM > 5000 km
    // menor que o atual (sinal de que o Rota Exata está com odômetro
    // dessincronizado e o admin já corrigiu manualmente).
    try {
      const posRes = await fetch(`${ROTAEXATA_API}/ultima-posicao/todos`, {
        headers: { "Content-Type": "application/json", Authorization: rotaToken },
      });
      if (posRes.ok) {
        const posData = await posRes.json();
        const items = Array.isArray(posData) ? posData : (posData?.data ?? []);

        // Carrega KM atual de todos os veículos pra comparar antes de atualizar
        const { data: vehiclesKm } = await supabase
          .from("vehicles")
          .select("adesao_id, km_atual, placa")
          .not("adesao_id", "is", null);
        const kmAtualMap = new Map<string, { km: number; placa: string }>();
        for (const v of vehiclesKm ?? []) {
          if (v.adesao_id) kmAtualMap.set(String(v.adesao_id), { km: v.km_atual ?? 0, placa: v.placa });
        }

        const REGRESSION_THRESHOLD = 5000;
        let updated = 0;
        let skippedRegression = 0;
        for (const item of items) {
          const pos = item?.posicao;
          if (!pos?.adesao_id) continue;
          const adesaoId = String(pos.adesao_id);
          const newKm = extractOdometerKm(pos);
          if (newKm <= 0) continue;

          const current = kmAtualMap.get(adesaoId);
          if (current) {
            // Nunca regredir o KM cadastrado
            if (newKm < current.km) {
              const diff = current.km - newKm;
              if (diff > REGRESSION_THRESHOLD) {
                console.warn(`[cron-sync] Ignorando regressão grande de KM para ${current.placa}: cadastro=${current.km}, RotaExata=${newKm} (diff=${diff}km). Provavelmente o Rota Exata está dessincronizado e o admin corrigiu manualmente.`);
                skippedRegression++;
                continue;
              }
              // Regressão pequena (<5000km) também é ignorada — KM só sobe
              continue;
            }
          }

          await supabase.from("vehicles").update({ km_atual: newKm }).eq("adesao_id", adesaoId);
          updated++;
        }
        console.log(`[cron-sync] Vehicle positions updated: ${updated}, regressões ignoradas: ${skippedRegression}`);
      }
    } catch (err) {
      console.warn("[cron-sync] Position sync error:", (err as Error).message);
    }

    const result = { synced: totalSynced, errors: totalErrors, vehicles: vehicles.length, date: today };
    console.log(`[cron-sync] Done:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[cron-sync] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
