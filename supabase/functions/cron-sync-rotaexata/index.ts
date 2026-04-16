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

    // ====================================================================
    // Auto-abertura de chamado: veículos com >30km no dia SEM checklist
    // Excluídos: DIW9D20 (Saveiro G4), IXO3G66, OHW9F00
    // ====================================================================
    try {
      const EXCLUDED_PLACAS = new Set(["DIW9D20", "IXO3G66", "OHW9F00"]);
      const KM_THRESHOLD = 30;

      // KM total por veículo no dia
      const { data: kmRows } = await supabase
        .from("daily_vehicle_km")
        .select("placa, km_percorrido")
        .eq("data", today);

      const kmByPlaca = new Map<string, number>();
      for (const row of kmRows ?? []) {
        const p = String(row.placa);
        if (EXCLUDED_PLACAS.has(p)) continue;
        kmByPlaca.set(p, (kmByPlaca.get(p) ?? 0) + Number(row.km_percorrido ?? 0));
      }

      // Placas com checklist hoje
      const { data: checklistsHoje } = await supabase
        .from("vehicle_checklists")
        .select("vehicle_id, vehicles!inner(placa)")
        .eq("checklist_date", today);

      const placasComChecklist = new Set<string>(
        (checklistsHoje ?? []).map((c: any) => c.vehicles?.placa).filter(Boolean)
      );

      // Veículos candidatos
      const placasSemChecklist = [...kmByPlaca.entries()]
        .filter(([placa, km]) => km > KM_THRESHOLD && !placasComChecklist.has(placa));

      if (placasSemChecklist.length > 0) {
        // Buscar vehicle_id para cada placa
        const placasList = placasSemChecklist.map(([p]) => p);
        const { data: vehiclesData } = await supabase
          .from("vehicles")
          .select("id, placa, modelo")
          .in("placa", placasList);

        // Buscar admin para created_by
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin")
          .limit(1);
        const createdBy = admins?.[0]?.user_id;

        if (createdBy) {
          for (const v of vehiclesData ?? []) {
            const km = kmByPlaca.get(v.placa) ?? 0;

            // Evitar duplicar: se já existe ticket aberto hoje p/ esse veículo c/ esse motivo
            const { data: existing } = await supabase
              .from("maintenance_tickets")
              .select("id")
              .eq("vehicle_id", v.id)
              .eq("tipo", "nao_conformidade")
              .gte("created_at", `${today}T00:00:00`)
              .ilike("titulo", "%sem checklist%")
              .limit(1);

            if (existing && existing.length > 0) continue;

            const titulo = `Veículo rodou ${km.toFixed(0)}km sem checklist — ${v.placa}`;
            const descricao = `O veículo ${v.placa} (${v.modelo}) registrou ${km.toFixed(1)}km de deslocamento em ${today} sem que o checklist pré-operação tenha sido preenchido.`;

            const { data: novoTicket, error: insertErr } = await supabase
              .from("maintenance_tickets")
              .insert({
                vehicle_id: v.id,
                titulo,
                descricao,
                tipo: "nao_conformidade",
                prioridade: "alta",
                status: "aberto",
                created_by: createdBy,
              })
              .select("id")
              .single();

            if (insertErr) {
              console.warn(`[cron-sync] Falha ao criar ticket para ${v.placa}:`, insertErr.message);
              continue;
            }

            console.log(`[cron-sync] Ticket criado para ${v.placa}: ${km.toFixed(1)}km sem checklist`);

            // Disparar e-mail aos admins
            try {
              await supabase.functions.invoke("notify-checklist-nc", {
                body: {
                  checklist_id: novoTicket?.id ?? null,
                  placa: v.placa,
                  modelo: v.modelo,
                  tecnico: "— (sem checklist registrado)",
                  data: today,
                  resultado: `KM SEM CHECKLIST (${km.toFixed(1)}km)`,
                  itens_problema: [
                    { label: "Checklist Pré-Operação", valor: "nao_conforme", observacao: `Veículo rodou ${km.toFixed(1)}km sem checklist preenchido.` },
                  ],
                  fotos_problema: [],
                  troca_oleo_vencida: false,
                  observacoes: `Detectado automaticamente pela rotina de sincronização (limite ${KM_THRESHOLD}km).`,
                },
              });
            } catch (mailErr) {
              console.warn(`[cron-sync] Falha ao enviar e-mail para ${v.placa}:`, (mailErr as Error).message);
            }
          }
        } else {
          console.warn("[cron-sync] Nenhum admin encontrado para criar tickets automáticos.");
        }
      }
    } catch (autoErr) {
      console.warn("[cron-sync] Erro na rotina de auto-abertura:", (autoErr as Error).message);
    }

    // Also sync vehicle positions (update km_atual)
    try {
      const posRes = await fetch(`${ROTAEXATA_API}/ultima-posicao/todos`, {
        headers: { "Content-Type": "application/json", Authorization: rotaToken },
      });
      if (posRes.ok) {
        const posData = await posRes.json();
        const items = Array.isArray(posData) ? posData : (posData?.data ?? []);
        for (const item of items) {
          const pos = item?.posicao;
          if (!pos?.adesao_id) continue;
          const adesaoId = String(pos.adesao_id);
          const odometro = pos.odometro_original ?? pos.odometro_gps ?? 0;
          const newKm = Math.round(Number(odometro) / 1000);
          if (newKm > 0) {
            await supabase.from("vehicles").update({ km_atual: newKm }).eq("adesao_id", adesaoId);
          }
        }
        console.log(`[cron-sync] Vehicle positions updated`);
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
