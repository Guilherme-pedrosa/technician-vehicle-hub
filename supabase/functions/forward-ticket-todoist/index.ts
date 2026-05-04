import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXTERNAL_ENDPOINT =
  "https://scgcbifmcvazmalqqpju.supabase.co/functions/v1/external-create-task";

const PRIORITY_MAP: Record<string, string> = {
  critica: "p1",
  alta: "p2",
  media: "p3",
  média: "p3",
  baixa: "p4",
};

const STATUS_MAP: Record<string, string> = {
  aberto: "todo",
  em_andamento: "in_progress",
  aguardando_peca: "in_progress",
  concluido: "done",
  cancelado: "cancelled",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("FROTA") || Deno.env.get("FROTA_EXTERNAL_API_KEY");
    if (!apiKey) {
      console.error("[forward-ticket] FROTA secret not configured");
      return json({ error: "External API key not configured" }, 500);
    }

    const body = await req.json();
    const { titulo, descricao, prioridade, placa, modelo, tipo, ticket_id, status: ticketStatus } = body;

    if (!titulo) {
      return json({ error: "titulo is required" }, 400);
    }

    // Build description with vehicle info
    const parts: string[] = [];
    if (placa) parts.push(`Veículo: ${placa}${modelo ? ` (${modelo})` : ""}`);
    if (tipo) parts.push(`Tipo: ${tipo}`);
    if (descricao) parts.push(descricao);
    const fullDescription = parts.join("\n") || undefined;

    const priority = PRIORITY_MAP[prioridade?.toLowerCase()] ?? "p3";
    const externalRef = ticket_id ? `fleetdesk-${ticket_id}` : null;
    const mappedStatus = ticketStatus ? (STATUS_MAP[ticketStatus.toLowerCase()] || "todo") : undefined;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const subtasks: Record<string, unknown>[] = [];
    if (ticket_id) {
      const { data: actions, error: actionsErr } = await supabase
        .from("ticket_actions")
        .select("id, descricao, concluida, prazo, sort_order")
        .eq("ticket_id", ticket_id)
        .order("sort_order", { ascending: true });

      if (actionsErr) {
        console.warn("[forward-ticket] Failed to fetch ticket actions:", actionsErr);
      }

      for (const action of actions ?? []) {
        const subtask: Record<string, unknown> = {
          title: action.descricao,
          external_ref: `fleetdesk-action-${action.id}`,
          priority: "p4",
        };

        if (action.prazo) {
          subtask.due_at = new Date(action.prazo + "T12:00:00Z").toISOString();
        }

        if (action.concluida) {
          subtask.status = "done";
          subtask.completed_at = new Date().toISOString();
        }

        subtasks.push(subtask);
      }
    }

    console.log(`[forward-ticket] Forwarding: "${titulo}" priority=${priority} ref=${externalRef} status=${mappedStatus} subtasks=${subtasks.length}`);

    const taskPayload: Record<string, unknown> = {
      title: `[Frota] ${titulo}`,
      description: fullDescription,
      priority,
      due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      external_ref: externalRef,
      external_source: "fleetdesk",
      subtasks,
    };
    if (mappedStatus) {
      taskPayload.status = mappedStatus;
      if (mappedStatus === "done") {
        taskPayload.completed_at = new Date().toISOString();
      }
    }

    const res = await fetch(EXTERNAL_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "x-sync-source": "fleetdesk",
      },
      body: JSON.stringify(taskPayload),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("[forward-ticket] External API error:", res.status, result);
      return json({ error: "External API error", detail: result }, 502);
    }

    console.log("[forward-ticket] Success:", result);
    const parentTaskId = result.id;

    // Save external refs back to maintenance_tickets
    if (ticket_id && parentTaskId) {
      const { error: updateErr } = await supabase
        .from("maintenance_tickets")
        .update({
          external_ref: externalRef,
          external_task_id: parentTaskId,
          external_synced_at: new Date().toISOString(),
          last_sync_source: "forward-ticket",
        })
        .eq("id", ticket_id);
      if (updateErr) {
        console.warn("[forward-ticket] Failed to save external refs:", updateErr);
      }
    }

    return json({ ok: true, external_task: result });
  } catch (err) {
    console.error("[forward-ticket] Error:", err);
    return json({ error: err.message }, 500);
  }
});
