// Edge function: scan-km-divergence
// Roda 1x/dia (10:30 BRT via pg_cron) e também sob demanda.
// Para cada checklist do dia atual, recalcula a divergência entre o KM lido na
// foto do painel (já extraído pela IA) e o km_atual cadastrado do veículo.
// Se divergente (>5000 km) e o veículo NÃO tem ticket aberto de KM divergente,
// cria um chamado de não-conformidade (prioridade alta).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const KM_PAINEL_DIVERGENCE_THRESHOLD = 5000;

function extractKmLidoPainel(detalhes: any): number | null {
  if (!detalhes || typeof detalhes !== "object") return null;
  const direct = detalhes.km_lido_painel;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const legacy = detalhes?.km_painel?.lido;
  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
    return legacy;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Janela: hoje 00:00 (BRT = UTC-3) até agora
    const now = new Date();
    const brtOffsetMs = 3 * 60 * 60 * 1000;
    const brtNow = new Date(now.getTime() - brtOffsetMs);
    const todayBrt = brtNow.toISOString().slice(0, 10);

    // 1. Buscar checklists de hoje com veículo
    const { data: checklists, error: errCl } = await supabase
      .from("vehicle_checklists")
      .select("id, vehicle_id, detalhes, created_at, driver_id, vehicles(id, placa, modelo, km_atual)")
      .eq("checklist_date", todayBrt);

    if (errCl) throw errCl;

    // 2. Buscar admin para usar como created_by dos tickets
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .single();
    const adminUserId = adminRole?.user_id;
    if (!adminUserId) {
      throw new Error("Nenhum admin encontrado para criar tickets");
    }

    // 3. Tickets abertos de KM divergente (dedup por veículo)
    const { data: ticketsAbertos } = await supabase
      .from("maintenance_tickets")
      .select("vehicle_id")
      .in("status", ["aberto", "em_andamento", "aguardando_peca"])
      .ilike("titulo", "%KM divergente%");

    const veiculosComTicketAberto = new Set(
      (ticketsAbertos ?? []).map((t: any) => t.vehicle_id),
    );

    let scanned = 0;
    let divergentes = 0;
    let ticketsCriados = 0;
    const ticketsCriadosDetalhe: any[] = [];

    for (const cl of checklists ?? []) {
      scanned++;
      const lido = extractKmLidoPainel(cl.detalhes);
      if (lido === null) continue;
      const veiculo: any = cl.vehicles;
      if (!veiculo) continue;
      const esperado = typeof veiculo.km_atual === "number" ? veiculo.km_atual : 0;
      const diferenca = lido - esperado;
      if (Math.abs(diferenca) <= KM_PAINEL_DIVERGENCE_THRESHOLD) continue;

      divergentes++;

      // Dedup: 1 ticket por veículo enquanto divergência persistir
      if (veiculosComTicketAberto.has(cl.vehicle_id)) continue;

      const titulo = `KM divergente — ${veiculo.placa}`;
      const descricao =
        `Divergência detectada no checklist do dia ${todayBrt}.\n\n` +
        `• KM lido na foto do painel: ${lido.toLocaleString("pt-BR")} km\n` +
        `• KM cadastrado (Rota Exata): ${esperado.toLocaleString("pt-BR")} km\n` +
        `• Diferença: ${diferenca > 0 ? "+" : ""}${diferenca.toLocaleString("pt-BR")} km\n\n` +
        `Verificar se o cadastro do veículo está correto ou se houve erro de leitura/uso indevido.\n` +
        `Checklist de origem: ${cl.id}`;

      const { error: errIns } = await supabase
        .from("maintenance_tickets")
        .insert({
          vehicle_id: cl.vehicle_id,
          driver_id: cl.driver_id,
          titulo,
          descricao,
          tipo: "nao_conformidade",
          prioridade: "alta",
          status: "aberto",
          created_by: adminUserId,
        });

      if (errIns) {
        console.error("Erro criando ticket:", errIns);
        continue;
      }

      veiculosComTicketAberto.add(cl.vehicle_id);
      ticketsCriados++;
      ticketsCriadosDetalhe.push({ placa: veiculo.placa, lido, esperado, diferenca });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        date: todayBrt,
        scanned,
        divergentes,
        ticketsCriados,
        ticketsCriadosDetalhe,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("scan-km-divergence error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
