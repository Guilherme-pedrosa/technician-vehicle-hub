import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * scan-km-sem-checklist — Varre veículos que rodaram >threshold km HOJE
 * sem ter checklist preenchido. Abre 1 chamado de não-conformidade por
 * veículo (deduplicado no dia) e dispara e-mail aos admins.
 *
 * Disparado:
 *  - Diariamente às 10:30 (Brasília) via pg_cron
 *  - Sob demanda pelo botão no Dashboard (admin)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXCLUDED_PLACAS = new Set(["DIW9D20", "IXO3G66", "OHW9F00"]);
const KM_THRESHOLD = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Hoje em horário Brasília (UTC-3)
    const now = new Date();
    const brasiliaOffset = -3 * 60;
    const brasiliaTime = new Date(now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000);
    const today = brasiliaTime.toISOString().split("T")[0];

    console.log(`[scan-km-sem-checklist] Iniciando para ${today}`);

    // KM total por placa hoje + motorista que mais rodou
    const { data: kmRows } = await supabase
      .from("daily_vehicle_km")
      .select("placa, km_percorrido, motorista_nome")
      .eq("data", today);

    const kmByPlaca = new Map<string, number>();
    // placa -> Map<motorista_nome, km_acumulado>
    const motoristasPorPlaca = new Map<string, Map<string, number>>();
    for (const row of kmRows ?? []) {
      const p = String(row.placa);
      if (EXCLUDED_PLACAS.has(p)) continue;
      const km = Number(row.km_percorrido ?? 0);
      kmByPlaca.set(p, (kmByPlaca.get(p) ?? 0) + km);

      const nome = String(row.motorista_nome ?? "").trim();
      if (nome && nome.toLowerCase() !== "desconhecido") {
        if (!motoristasPorPlaca.has(p)) motoristasPorPlaca.set(p, new Map());
        const m = motoristasPorPlaca.get(p)!;
        m.set(nome, (m.get(nome) ?? 0) + km);
      }
    }

    // Para cada placa, escolhe o motorista que mais rodou no dia
    const motoristaPrincipalPorPlaca = new Map<string, string>();
    for (const [placa, motMap] of motoristasPorPlaca.entries()) {
      const top = [...motMap.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) motoristaPrincipalPorPlaca.set(placa, top[0]);
    }

    // Placas com checklist hoje
    const { data: checklistsHoje } = await supabase
      .from("vehicle_checklists")
      .select("vehicle_id, vehicles!inner(placa)")
      .eq("checklist_date", today);

    const placasComChecklist = new Set<string>(
      (checklistsHoje ?? []).map((c: any) => c.vehicles?.placa).filter(Boolean)
    );

    const placasSemChecklist = [...kmByPlaca.entries()]
      .filter(([placa, km]) => km > KM_THRESHOLD && !placasComChecklist.has(placa));

    if (placasSemChecklist.length === 0) {
      console.log("[scan-km-sem-checklist] Nenhuma divergência encontrada");
      return new Response(JSON.stringify({ created: 0, checked: kmByPlaca.size, date: today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const placasList = placasSemChecklist.map(([p]) => p);
    const { data: vehiclesData } = await supabase
      .from("vehicles")
      .select("id, placa, modelo")
      .in("placa", placasList);

    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1);
    const createdBy = admins?.[0]?.user_id;

    if (!createdBy) {
      console.warn("[scan-km-sem-checklist] Nenhum admin encontrado");
      return new Response(JSON.stringify({ error: "no_admin", checked: kmByPlaca.size }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let createdCount = 0;
    const ticketsCriados: { placa: string; km: number; ticket_id: string }[] = [];

    for (const v of vehiclesData ?? []) {
      const km = kmByPlaca.get(v.placa) ?? 0;

      // Deduplicação: já existe ticket aberto hoje p/ esse veículo c/ esse motivo?
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
        console.warn(`[scan-km-sem-checklist] Erro ticket ${v.placa}:`, insertErr.message);
        continue;
      }

      createdCount++;
      ticketsCriados.push({ placa: v.placa, km, ticket_id: novoTicket?.id ?? "" });
      console.log(`[scan-km-sem-checklist] Ticket criado: ${v.placa} (${km.toFixed(1)}km)`);

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
            observacoes: `Detectado pela rotina diária às 10:30 (limite ${KM_THRESHOLD}km).`,
          },
        });
      } catch (mailErr) {
        console.warn(`[scan-km-sem-checklist] Erro e-mail ${v.placa}:`, (mailErr as Error).message);
      }
    }

    const result = { created: createdCount, checked: kmByPlaca.size, tickets: ticketsCriados, date: today };
    console.log(`[scan-km-sem-checklist] Done:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[scan-km-sem-checklist] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
