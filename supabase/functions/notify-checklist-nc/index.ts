import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase credentials");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const {
      event_type, // "nc" (default) | "audit_alert"
      checklist_id,
      placa,
      modelo,
      tecnico,
      data,
      resultado,
      itens_problema,
      fotos_problema,
      troca_oleo_vencida,
      observacoes,
      avaria_descricao,
      // Campos extras para audit_alert
      audit_events,         // array de { categoria, label, status, motivo, severity, photo_url, model_used, confidence }
      checklist_url,
      veiculo_id,
      condutor,
      km_painel_nao_confirmado,
    } = body;

    // Get only ADMIN users
    const { data: adminRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (rolesError) {
      console.error("Error fetching admin roles:", rolesError);
      throw new Error("Failed to fetch admin roles");
    }
    const adminUserIds = new Set((adminRoles ?? []).map((r: any) => r.user_id));

    const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) {
      console.error("Error listing users:", usersError);
      throw new Error("Failed to list users");
    }

    const emails = usersData.users
      .filter((u: any) => adminUserIds.has(u.id))
      .map((u: any) => u.email)
      .filter((e: string | undefined) => !!e);

    if (emails.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No users to notify" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build email HTML
    // Format readable values
    const formatValor = (v: string) => {
      const map: Record<string, string> = {
        "nao_conforme": "NÃO CONFORME", "nao": "NÃO", "sim": "SIM",
        "ruim": "RUIM", "desgastado": "DESGASTADO", "vazio": "VAZIO",
        "baixo": "BAIXO", "sujo": "SUJO", "quebrado": "QUEBRADO",
      };
      return map[v] || v.toUpperCase();
    };

    const itensHtml = (itens_problema || [])
      .map((i: any) => {
        const obs = i.observacao ? `<br><span style="font-weight:400;color:#666;font-size:13px;">↳ ${i.observacao}</span>` : "";
        return `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.label}</td><td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;">${formatValor(i.valor)}${obs}</td></tr>`;
      })
      .join("");

    const fotosHtml = (fotos_problema || [])
      .map((f: any) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">📷 ${f.categoria}</td><td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;">${f.tipo === "reprovada" ? "Reprovada pela IA" : "Forçada pelo técnico"} — ${f.motivo}</td></tr>`)
      .join("");

    const oleoHtml = troca_oleo_vencida
      ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;">🛢️ Troca de Óleo</td><td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;">VENCIDA</td></tr>`
      : "";

    const isAudit = event_type === "audit_alert";

    // ============= AUDITORIA DE IA =============
    // Renderiza um template diferente quando o evento for de auditoria
    // (foto forçada, IA pendente no submit, erro de IA, KM não confirmado).
    const severityColor = (s: string) =>
      s === "critical" ? "#b91c1c" : s === "warning" ? "#b45309" : "#1e40af";
    const statusLabel = (st: string) => {
      const map: Record<string, string> = {
        forced: "Forçada pelo técnico",
        pending_at_submit: "IA pendente no envio",
        ai_error: "Erro de validação IA",
        invalid: "Reprovada pela IA",
      };
      return map[st] || st;
    };

    const auditEventsHtml = isAudit && Array.isArray(audit_events)
      ? audit_events
          .map(
            (e: any) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">
            <strong>${e.label || e.categoria}</strong><br>
            <span style="color:#666;font-size:12px;">${e.categoria}</span>
            ${e.photo_url ? `<br><a href="${e.photo_url}" style="color:#2563eb;font-size:12px;">Ver foto</a>` : ""}
          </td>
          <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">
            <span style="display:inline-block;padding:3px 8px;border-radius:4px;color:white;background:${severityColor(e.severity || "warning")};font-size:11px;font-weight:600;">${(e.severity || "warning").toUpperCase()}</span><br>
            <strong style="color:${severityColor(e.severity || "warning")};">${statusLabel(e.status)}</strong>
            ${e.motivo ? `<br><span style="color:#444;font-size:13px;">${e.motivo}</span>` : ""}
            ${e.model_used ? `<br><span style="color:#999;font-size:11px;">modelo: ${e.model_used}${typeof e.confidence === "number" ? ` · conf: ${(e.confidence * 100).toFixed(0)}%` : ""}</span>` : ""}
          </td>
        </tr>`,
          )
          .join("")
      : "";

    const subject = isAudit
      ? `🔍 Alerta de validação IA no checklist — ${placa} — ${data}`
      : `⚠️ NC Checklist — ${placa} — ${data}`;

    const html = isAudit ? `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f5;">
  <div style="max-width:640px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#b45309;color:white;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:20px;">🔍 Alerta de Validação IA</h1>
      <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Checklist Pré-Operação · trilha de auditoria</p>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:6px;color:#666;width:140px;">Veículo:</td><td style="padding:6px;font-weight:600;">${placa} — ${modelo}</td></tr>
        <tr><td style="padding:6px;color:#666;">Condutor:</td><td style="padding:6px;">${condutor || "—"}</td></tr>
        <tr><td style="padding:6px;color:#666;">Técnico que salvou:</td><td style="padding:6px;font-weight:600;">${tecnico}</td></tr>
        <tr><td style="padding:6px;color:#666;">Data/Hora:</td><td style="padding:6px;">${data}</td></tr>
        <tr><td style="padding:6px;color:#666;">Resultado operacional:</td><td style="padding:6px;">${resultado}</td></tr>
        ${km_painel_nao_confirmado ? `<tr><td style="padding:6px;color:#b91c1c;">⚠️ Painel:</td><td style="padding:6px;color:#b91c1c;font-weight:600;">KM do hodômetro NÃO confirmado pela IA — verificar valor manual</td></tr>` : ""}
      </table>

      ${auditEventsHtml ? `
      <h2 style="font-size:16px;margin:20px 0 10px;color:#333;">Eventos de auditoria (${audit_events.length})</h2>
      <table style="width:100%;border-collapse:collapse;background:#fefce8;border-radius:8px;">
        <thead><tr><th style="padding:10px;text-align:left;border-bottom:2px solid #fde68a;color:#854d0e;">Categoria</th><th style="padding:10px;text-align:left;border-bottom:2px solid #fde68a;color:#854d0e;">Status / Motivo</th></tr></thead>
        <tbody>${auditEventsHtml}</tbody>
      </table>` : ""}

      ${observacoes ? `<div style="margin-top:16px;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b;border-radius:4px;"><strong>Observações:</strong> ${observacoes}</div>` : ""}

      <div style="margin-top:24px;padding:16px;background:#f0f9ff;border-radius:8px;">
        <p style="margin:0 0 8px;color:#1e40af;font-size:14px;"><strong>O que fazer:</strong></p>
        <ul style="margin:0;padding-left:20px;color:#1e3a8a;font-size:13px;">
          <li>Conferir as fotos forçadas/pendentes acima.</li>
          <li>Validar com o técnico responsável caso recorrente.</li>
          <li>Se necessário, reprocessar a foto na tela do checklist.</li>
        </ul>
        ${checklist_url ? `<p style="margin:12px 0 0;text-align:center;"><a href="${checklist_url}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:600;">Abrir checklist</a></p>` : ""}
      </div>
    </div>
    <div style="padding:16px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;">
      Tech Fleet Check — Trilha de auditoria de IA
    </div>
  </div>
</body>
</html>` : `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f5;">
  <div style="max-width:600px;margin:20px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#dc2626;color:white;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:20px;">⚠️ Alerta de Não Conformidade</h1>
      <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Checklist Pré-Operação</p>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:8px;color:#666;width:120px;">Veículo:</td><td style="padding:8px;font-weight:600;">${placa} — ${modelo}</td></tr>
        <tr><td style="padding:8px;color:#666;">Técnico:</td><td style="padding:8px;font-weight:600;">${tecnico}</td></tr>
        <tr><td style="padding:8px;color:#666;">Data/Hora:</td><td style="padding:8px;">${data}</td></tr>
        <tr><td style="padding:8px;color:#666;">Resultado:</td><td style="padding:8px;font-weight:600;color:#dc2626;">${resultado}</td></tr>
      </table>
      
      ${(itensHtml || fotosHtml || oleoHtml) ? `
      <h2 style="font-size:16px;margin:24px 0 12px;color:#333;">Itens com Problema</h2>
      <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;">
        <thead><tr><th style="padding:10px;text-align:left;border-bottom:2px solid #fecaca;color:#991b1b;">Item</th><th style="padding:10px;text-align:left;border-bottom:2px solid #fecaca;color:#991b1b;">Status</th></tr></thead>
        <tbody>${itensHtml}${fotosHtml}${oleoHtml}</tbody>
      </table>` : ""}

      ${avaria_descricao ? `<div style="margin-top:16px;padding:12px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;"><strong>🔍 Descrição da Avaria:</strong><br>${avaria_descricao}</div>` : ""}

      ${observacoes ? `<div style="margin-top:16px;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b;border-radius:4px;"><strong>Observações:</strong> ${observacoes}</div>` : ""}
      
      <div style="margin-top:24px;padding:16px;background:#f0f9ff;border-radius:8px;text-align:center;">
        <p style="margin:0;color:#1e40af;font-size:14px;">Um chamado de manutenção foi criado automaticamente no sistema.</p>
      </div>
    </div>
    <div style="padding:16px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;">
      Tech Fleet Check — Sistema de Gestão de Frota
    </div>
  </div>
</body>
</html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log(`[NOTIFY-NC] RESEND_API_KEY not configured. Skipping email for checklist ${checklist_id}`);
      // Log as failed
      for (const email of emails) {
        await supabase.from("email_send_log").insert({
          checklist_id,
          recipient_email: email,
          subject,
          status: "failed",
          error_message: "RESEND_API_KEY não configurada",
          metadata: { placa, modelo, tecnico, resultado },
        });
      }
      return new Response(JSON.stringify({ success: true, message: "No email service configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via Resend with logging
    const results = [];
    for (const email of emails) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Tech Fleet Check <alertas@wedocorp.com>",
            to: [email],
            subject,
            html,
          }),
        });

        const resBody = await res.json();

        if (!res.ok) {
          console.error(`[NOTIFY-NC] Failed to send to ${email}:`, resBody);
          await supabase.from("email_send_log").insert({
            checklist_id,
            recipient_email: email,
            subject,
            status: "failed",
            error_message: JSON.stringify(resBody),
            metadata: { placa, modelo, tecnico, resultado },
          });
          results.push({ email, status: "failed", error: resBody });
        } else {
          console.log(`[NOTIFY-NC] Sent to ${email}:`, resBody);
          await supabase.from("email_send_log").insert({
            checklist_id,
            recipient_email: email,
            subject,
            status: "sent",
            resend_id: resBody.id || null,
            metadata: { placa, modelo, tecnico, resultado },
          });
          results.push({ email, status: "sent", resend_id: resBody.id });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[NOTIFY-NC] Error sending to ${email}:`, err);
        await supabase.from("email_send_log").insert({
          checklist_id,
          recipient_email: email,
          subject,
          status: "failed",
          error_message: errMsg,
          metadata: { placa, modelo, tecnico, resultado },
        });
        results.push({ email, status: "failed", error: errMsg });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    console.log(`[NOTIFY-NC] Total: ${results.length}, Sent: ${sent}, Failed: ${failed}`);

    return new Response(
      JSON.stringify({ success: true, emails_sent: sent, emails_failed: failed, details: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in notify-checklist-nc:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
