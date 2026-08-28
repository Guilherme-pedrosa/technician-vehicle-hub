import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Segurança: escape de HTML em TUDO que vem do cliente ──
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** URL segura para href/src: só http(s), já escapada. */
function escUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  return esc(raw);
}

const MAX_BODY_BYTES = 256_000;
const MAX_AUDIT_EVENTS = 60;

// Rate limit por chamador (janela em memória do isolate)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const rateBuckets = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(key, hits);
  return hits.length > RATE_MAX;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase credentials");
    }

    // ── AUTENTICAÇÃO: JWT de usuário OU chave de serviço interna ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const callbackKey = req.headers.get("x-fleetdesk-key") ?? "";
    const internalKey = Deno.env.get("FLEETDESK_CALLBACK_KEY") ?? "";
    let callerId: string | null = null;

    if (internalKey && callbackKey && callbackKey === internalKey) {
      callerId = "internal";
    } else if (authHeader.startsWith("Bearer ") && SUPABASE_ANON_KEY) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = user.id;
    } else {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (rateLimited(callerId)) {
      return new Response(JSON.stringify({ error: "Too many notification requests" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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
      pendencias,
      dedupe_key,
    } = body;

    const pendenciasSafe: string[] = Array.isArray(pendencias)
      ? pendencias.slice(0, 60).map((p: unknown) => String(p))
      : [];

    // ── AUTORIZAÇÃO: usuário só notifica checklist próprio (ou é admin) ──
    if (callerId !== "internal") {
      if (!checklist_id || typeof checklist_id !== "string") {
        return new Response(JSON.stringify({ success: false, error: "checklist_id obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdminRow } = await supabase
        .from("user_roles").select("user_id").eq("user_id", callerId).eq("role", "admin").maybeSingle();
      if (!isAdminRow) {
        const { data: checklistRow } = await supabase
          .from("vehicle_checklists").select("created_by").eq("id", checklist_id).maybeSingle();
        if (!checklistRow || checklistRow.created_by !== callerId) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

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
        const obs = i.observacao ? `<br><span style="font-weight:400;color:#666;font-size:13px;">↳ ${esc(i.observacao)}</span>` : "";
        return `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${esc(i.label)}</td><td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;">${esc(formatValor(String(i.valor ?? "")))}${obs}</td></tr>`;
      })
      .join("");

    const fotosHtml = (fotos_problema || [])
      .map((f: any) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">📷 ${esc(f.categoria)}</td><td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;">${f.tipo === "reprovada" ? "Reprovada pela IA" : "Forçada pelo técnico"} — ${esc(f.motivo)}</td></tr>`)
      .join("");

    const oleoHtml = troca_oleo_vencida
      ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;">🛢️ Troca de Óleo</td><td style="padding:8px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;">VENCIDA</td></tr>`
      : "";

    const pendenciasHtml = pendenciasSafe.length > 0
      ? `<div style="margin-top:16px;padding:12px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;">
           <strong>Pendências de preenchimento (${pendenciasSafe.length}) — checklist salvo assim mesmo:</strong>
           <ul style="margin:8px 0 0;padding-left:20px;color:#78350f;font-size:13px;">
             ${pendenciasSafe.map((p) => `<li>${esc(p)}</li>`).join("")}
           </ul>
         </div>`
      : "";

    const isAudit = event_type === "audit_alert";
    const auditEventsSafe = Array.isArray(audit_events) ? audit_events.slice(0, MAX_AUDIT_EVENTS) : [];

    // ── DEDUPLICAÇÃO: mesmo alerta não é enviado duas vezes ──
    const dedupeKey = typeof dedupe_key === "string" && dedupe_key.length > 0
      ? dedupe_key.slice(0, 200)
      : `${isAudit ? "audit" : "nc"}|${checklist_id ?? "sem-checklist"}`;
    if (checklist_id) {
      const { data: alreadySent } = await supabase
        .from("email_send_log")
        .select("id")
        .like("dedupe_key", `${dedupeKey}|%`)
        .in("status", ["sent", "pending"])
        .limit(1);
      if (alreadySent && alreadySent.length > 0) {
        console.log(`[NOTIFY-NC] Ignorado por deduplicação: ${dedupeKey}`);
        return new Response(JSON.stringify({ success: true, deduplicated: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    const auditEventsHtml = isAudit && auditEventsSafe.length > 0
      ? auditEventsSafe
          .map(
            (e: any) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">
            <strong>${esc(e.label || e.categoria)}</strong><br>
            <span style="color:#666;font-size:12px;">${esc(e.categoria)}</span>
            ${escUrl(e.photo_url) ? `<br><a href="${escUrl(e.photo_url)}" style="color:#2563eb;font-size:12px;">Ver foto</a>` : ""}
          </td>
          <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">
            <span style="display:inline-block;padding:3px 8px;border-radius:4px;color:white;background:${severityColor(e.severity || "warning")};font-size:11px;font-weight:600;">${(e.severity || "warning").toUpperCase()}</span><br>
            <strong style="color:${severityColor(e.severity || "warning")};">${statusLabel(e.status)}</strong>
            ${e.motivo ? `<br><span style="color:#444;font-size:13px;">${esc(e.motivo)}</span>` : ""}
            ${e.reason ? `<br><span style="color:#666;font-size:12px;">IA: ${esc(e.reason)}</span>` : ""}
            ${e.model_used ? `<br><span style="color:#999;font-size:11px;">modelo: ${esc(e.model_used)}${e.prompt_version ? ` · prompt ${esc(e.prompt_version)}` : ""}${typeof e.confidence === "number" ? ` · conf: ${(e.confidence * 100).toFixed(0)}%` : ""}</span>` : ""}
          </td>
        </tr>`,
          )
          .join("")
      : "";

    const subject = isAudit
      ? `🔍 Alerta de validação IA no checklist — ${String(placa ?? "")} — ${String(data ?? "")}`
      : `⚠️ NC Checklist — ${String(placa ?? "")} — ${String(data ?? "")}`;

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
        <tr><td style="padding:6px;color:#666;width:140px;">Veículo:</td><td style="padding:6px;font-weight:600;">${esc(placa)} — ${esc(modelo)}</td></tr>
        <tr><td style="padding:6px;color:#666;">Condutor:</td><td style="padding:6px;">${esc(condutor || "—")}</td></tr>
        <tr><td style="padding:6px;color:#666;">Técnico que salvou:</td><td style="padding:6px;font-weight:600;">${esc(tecnico)}</td></tr>
        <tr><td style="padding:6px;color:#666;">Data/Hora:</td><td style="padding:6px;">${esc(data)}</td></tr>
        <tr><td style="padding:6px;color:#666;">Resultado operacional:</td><td style="padding:6px;">${esc(resultado)}</td></tr>
        ${km_painel_nao_confirmado ? `<tr><td style="padding:6px;color:#b91c1c;">⚠️ Painel:</td><td style="padding:6px;color:#b91c1c;font-weight:600;">KM do hodômetro NÃO confirmado pela IA — verificar valor manual</td></tr>` : ""}
      </table>

      ${auditEventsHtml ? `
      <h2 style="font-size:16px;margin:20px 0 10px;color:#333;">Eventos de auditoria (${auditEventsSafe.length})</h2>
      <table style="width:100%;border-collapse:collapse;background:#fefce8;border-radius:8px;">
        <thead><tr><th style="padding:10px;text-align:left;border-bottom:2px solid #fde68a;color:#854d0e;">Categoria</th><th style="padding:10px;text-align:left;border-bottom:2px solid #fde68a;color:#854d0e;">Status / Motivo</th></tr></thead>
        <tbody>${auditEventsHtml}</tbody>
      </table>` : ""}

      ${pendenciasHtml}
      ${observacoes ? `<div style="margin-top:16px;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b;border-radius:4px;"><strong>Observações:</strong> ${esc(observacoes)}</div>` : ""}

      <div style="margin-top:24px;padding:16px;background:#f0f9ff;border-radius:8px;">
        <p style="margin:0 0 8px;color:#1e40af;font-size:14px;"><strong>O que fazer:</strong></p>
        <ul style="margin:0;padding-left:20px;color:#1e3a8a;font-size:13px;">
          <li>Conferir as fotos forçadas/pendentes acima.</li>
          <li>Validar com o técnico responsável caso recorrente.</li>
          <li>Se necessário, reprocessar a foto na tela do checklist.</li>
        </ul>
        ${escUrl(checklist_url) ? `<p style="margin:12px 0 0;text-align:center;"><a href="${escUrl(checklist_url)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:600;">Abrir checklist</a></p>` : ""}
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
        <tr><td style="padding:8px;color:#666;width:120px;">Veículo:</td><td style="padding:8px;font-weight:600;">${esc(placa)} — ${esc(modelo)}</td></tr>
        <tr><td style="padding:8px;color:#666;">Técnico:</td><td style="padding:8px;font-weight:600;">${esc(tecnico)}</td></tr>
        <tr><td style="padding:8px;color:#666;">Data/Hora:</td><td style="padding:8px;">${esc(data)}</td></tr>
        <tr><td style="padding:8px;color:#666;">Resultado:</td><td style="padding:8px;font-weight:600;color:#dc2626;">${esc(resultado)}</td></tr>
      </table>
      
      ${(itensHtml || fotosHtml || oleoHtml) ? `
      <h2 style="font-size:16px;margin:24px 0 12px;color:#333;">Itens com Problema</h2>
      <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;">
        <thead><tr><th style="padding:10px;text-align:left;border-bottom:2px solid #fecaca;color:#991b1b;">Item</th><th style="padding:10px;text-align:left;border-bottom:2px solid #fecaca;color:#991b1b;">Status</th></tr></thead>
        <tbody>${itensHtml}${fotosHtml}${oleoHtml}</tbody>
      </table>` : ""}

      ${avaria_descricao ? `<div style="margin-top:16px;padding:12px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;"><strong>🔍 Descrição da Avaria:</strong><br>${esc(avaria_descricao)}</div>` : ""}

      ${pendenciasHtml}
      ${observacoes ? `<div style="margin-top:16px;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b;border-radius:4px;"><strong>Observações:</strong> ${esc(observacoes)}</div>` : ""}
      
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
          dedupe_key: `${dedupeKey}|${email}`,
          error_message: "RESEND_API_KEY não configurada",
          metadata: { placa, modelo, tecnico, resultado },
        });
      }
      return new Response(JSON.stringify({ success: false, error: "RESEND_API_KEY não configurada" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── RESERVA ATÔMICA POR DESTINATÁRIO, ANTES de chamar o Resend ──
    // A chave única (evento + checklist + destinatário) garante que duas
    // execuções concorrentes nunca enviem o mesmo e-mail duas vezes.
    const results: Array<{ email: string; status: string; resend_id?: string; error?: unknown }> = [];
    for (const email of emails) {
      const recipientKey = `${dedupeKey}|${email}`;
      const { data: reserved, error: reserveError } = await supabase
        .from("email_send_log")
        .insert({
          checklist_id,
          recipient_email: email,
          subject,
          status: "pending",
          dedupe_key: recipientKey,
          metadata: { placa, modelo, tecnico, resultado, event_type: isAudit ? "audit_alert" : "nc" },
        })
        .select("id")
        .maybeSingle();

      if (reserveError || !reserved?.id) {
        // 23505 = já reservado/enviado por outra execução → idempotente.
        console.log(`[NOTIFY-NC] Reserva não obtida para ${email}: ${reserveError?.code ?? "sem id"}`);
        results.push({ email, status: "deduplicated" });
        continue;
      }

      const logId = reserved.id;
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
          await supabase.from("email_send_log")
            .update({ status: "failed", error_message: JSON.stringify(resBody) })
            .eq("id", logId);
          results.push({ email, status: "failed", error: resBody });
        } else {
          console.log(`[NOTIFY-NC] Sent to ${email}`);
          await supabase.from("email_send_log")
            .update({ status: "sent", resend_id: resBody.id || null })
            .eq("id", logId);
          results.push({ email, status: "sent", resend_id: resBody.id });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[NOTIFY-NC] Error sending to ${email}:`, err);
        await supabase.from("email_send_log")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", logId);
        results.push({ email, status: "failed", error: errMsg });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const deduplicated = results.filter((r) => r.status === "deduplicated").length;
    console.log(`[NOTIFY-NC] Total: ${results.length}, Sent: ${sent}, Failed: ${failed}, Dedup: ${deduplicated}`);

    // Sem sucesso falso: qualquer falha devolve não-2xx para o frontend
    // registrar pendência.
    if (failed > 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Falha ao enviar parte dos e-mails", emails_sent: sent, emails_failed: failed, details: results }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, emails_sent: sent, emails_failed: failed, deduplicated, details: results }),
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
