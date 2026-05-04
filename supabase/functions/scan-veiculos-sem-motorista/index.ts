import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * scan-veiculos-sem-motorista — Detecta veículos com movimentação (km > 0)
 * mas sem motorista vinculado no dia. Envia e-mail aos admins.
 *
 * Disparado automaticamente após cada sync horário (cron-sync-rotaexata)
 * e sob demanda via chamada direta.
 *
 * Deduplicação: envia no máximo 1 alerta por veículo por dia (via email_send_log).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXCLUDED_PLACAS = new Set(["DIW9D20", "IXO3G66", "OHW9F00"]);
const KM_THRESHOLD = 5; // km mínimo para considerar "rodou"

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Hoje em Brasília (UTC-3)
    const now = new Date();
    const brasiliaOffset = -3 * 60;
    const brasiliaTime = new Date(now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000);
    const today = brasiliaTime.toISOString().split("T")[0];
    const horaAtual = brasiliaTime.toTimeString().slice(0, 5);

    console.log(`[scan-sem-motorista] Iniciando para ${today} às ${horaAtual}`);

    // Busca sessões do dia com motorista desconhecido/sem vínculo
    const { data: kmRows } = await supabase
      .from("daily_vehicle_km")
      .select("placa, km_percorrido, motorista_nome, motorista_id")
      .eq("data", today);

    // Agrupa KM por placa para sessões sem motorista
    const semMotoristaPorPlaca = new Map<string, number>();
    const totalKmPorPlaca = new Map<string, number>();

    for (const row of kmRows ?? []) {
      const placa = String(row.placa);
      if (EXCLUDED_PLACAS.has(placa)) continue;

      const km = Number(row.km_percorrido ?? 0);
      totalKmPorPlaca.set(placa, (totalKmPorPlaca.get(placa) ?? 0) + km);

      const nome = String(row.motorista_nome ?? "").trim().toLowerCase();
      const semMotorista =
        !row.motorista_id ||
        !nome ||
        nome === "desconhecido" ||
        nome === "sem condutor vinculado";

      if (semMotorista && km > 0) {
        semMotoristaPorPlaca.set(placa, (semMotoristaPorPlaca.get(placa) ?? 0) + km);
      }
    }

    // Filtra apenas placas com KM significativo sem motorista
    const placasAlerta = [...semMotoristaPorPlaca.entries()]
      .filter(([_, km]) => km >= KM_THRESHOLD)
      .map(([placa, kmSemMotorista]) => ({
        placa,
        kmSemMotorista,
        kmTotal: totalKmPorPlaca.get(placa) ?? 0,
      }));

    if (placasAlerta.length === 0) {
      console.log("[scan-sem-motorista] Nenhum veículo sem motorista detectado");
      return new Response(JSON.stringify({ alerted: 0, checked: totalKmPorPlaca.size, date: today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicação: checa se já enviamos alerta hoje para essas placas
    const { data: logsHoje } = await supabase
      .from("email_send_log")
      .select("subject")
      .gte("created_at", `${today}T00:00:00`)
      .eq("status", "sent")
      .ilike("subject", "%sem motorista vinculado%");

    const placasJaAlertadas = new Set<string>();
    for (const log of logsHoje ?? []) {
      // Extrai placa do subject: "... — ABC1D23"
      const match = log.subject?.match(/— ([A-Z0-9]{7})/);
      if (match) placasJaAlertadas.add(match[1]);
    }

    const placasNovas = placasAlerta.filter((p) => !placasJaAlertadas.has(p.placa));

    if (placasNovas.length === 0) {
      console.log("[scan-sem-motorista] Todos veículos já alertados hoje");
      return new Response(JSON.stringify({ alerted: 0, already_alerted: placasAlerta.length, date: today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Busca dados dos veículos
    const { data: vehiclesData } = await supabase
      .from("vehicles")
      .select("id, placa, modelo")
      .in("placa", placasNovas.map((p) => p.placa));

    const veiculoMap = new Map<string, { id: string; modelo: string }>();
    for (const v of vehiclesData ?? []) {
      veiculoMap.set(v.placa, { id: v.id, modelo: v.modelo });
    }

    // Busca e-mails dos admins
    const { data: adminRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    const adminIds = (adminRoles ?? []).map((r: any) => r.user_id);
    if (adminIds.length === 0) {
      console.warn("[scan-sem-motorista] Nenhum admin encontrado");
      return new Response(JSON.stringify({ error: "no_admin" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id")
      .in("user_id", adminIds);

    // Busca e-mails do auth
    const adminEmails: string[] = [];
    for (const adminId of adminIds) {
      const { data: userData } = await supabase.auth.admin.getUserById(adminId);
      if (userData?.user?.email) {
        adminEmails.push(userData.user.email);
      }
    }

    if (adminEmails.length === 0 || !resendApiKey) {
      console.warn("[scan-sem-motorista] Sem e-mails admin ou RESEND_API_KEY não configurada");
      return new Response(JSON.stringify({ error: "no_email_config" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let alertedCount = 0;

    for (const alerta of placasNovas) {
      const veiculo = veiculoMap.get(alerta.placa);
      const modelo = veiculo?.modelo ?? "—";

      const subject = `⚠️ Veículo rodando sem motorista vinculado — ${alerta.placa}`;
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #f59e0b; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">⚠️ Veículo sem motorista vinculado</h2>
          </div>
          <div style="background: #fffbeb; padding: 24px; border: 1px solid #fcd34d; border-top: none; border-radius: 0 0 8px 8px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #92400e; width: 140px;">Veículo:</td>
                <td style="padding: 8px 0; color: #78350f;">${alerta.placa} — ${modelo}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #92400e;">Data:</td>
                <td style="padding: 8px 0; color: #78350f;">${today}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #92400e;">KM sem motorista:</td>
                <td style="padding: 8px 0; color: #78350f; font-size: 18px; font-weight: bold;">${alerta.kmSemMotorista.toFixed(1)} km</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #92400e;">KM total no dia:</td>
                <td style="padding: 8px 0; color: #78350f;">${alerta.kmTotal.toFixed(1)} km</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #92400e;">Hora detecção:</td>
                <td style="padding: 8px 0; color: #78350f;">${horaAtual}</td>
              </tr>
            </table>
            <p style="color: #92400e; margin: 16px 0 0; font-size: 14px; line-height: 1.5;">
              Este veículo está registrando deslocamento sem nenhum motorista vinculado no sistema.
              Verifique o vínculo do condutor no Rota Exata para corrigir.
            </p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
            Alerta automático — Sistema de Frotas
          </p>
        </div>
      `;

      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: "Frotas <alertas@techfrota.com.br>",
            to: adminEmails,
            subject,
            html: htmlBody,
          }),
        });

        const emailResult = await emailRes.json();

        // Log no email_send_log
        await supabase.from("email_send_log").insert({
          recipient_email: adminEmails.join(", "),
          subject,
          status: emailRes.ok ? "sent" : "failed",
          error_message: emailRes.ok ? null : JSON.stringify(emailResult),
          metadata: { type: "sem_motorista", placa: alerta.placa, km: alerta.kmSemMotorista },
        });

        if (emailRes.ok) {
          alertedCount++;
          console.log(`[scan-sem-motorista] Alerta enviado: ${alerta.placa} (${alerta.kmSemMotorista.toFixed(1)}km sem motorista)`);
        } else {
          console.warn(`[scan-sem-motorista] Erro e-mail ${alerta.placa}:`, emailResult);
        }
      } catch (emailErr) {
        console.warn(`[scan-sem-motorista] Erro enviando e-mail ${alerta.placa}:`, (emailErr as Error).message);
      }
    }

    const result = { alerted: alertedCount, checked: totalKmPorPlaca.size, date: today };
    console.log(`[scan-sem-motorista] Done:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[scan-sem-motorista] Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
