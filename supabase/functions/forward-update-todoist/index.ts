import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXTERNAL_ENDPOINT =
  "https://scgcbifmcvazmalqqpju.supabase.co/functions/v1/external-update-task";

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
  concluido: "done",
  cancelado: "cancelled",
};

/**
 * forward-update-todoist
 * Called when a maintenance_ticket is updated in FleetDesk.
 * Forwards the update to TaskFlow's external-update-task endpoint.
 */
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
      console.error("[forward-update] FROTA secret not configured");
      return json({ error: "External API key not configured" }, 500);
    }

    const body = await req.json();
    const { ticket_id, external_ref, status: ticketStatus, titulo, descricao, prioridade, placa, modelo } = body;

    if (!external_ref) {
      return json({ error: "external_ref is required" }, 400);
    }

    const payload: Record<string, unknown> = {
      external_ref,
      external_source: "fleetdesk",
    };

    if (ticketStatus) {
      payload.status = STATUS_MAP[ticketStatus.toLowerCase()] || ticketStatus;
      if (ticketStatus === "concluido") {
        payload.completed_at = new Date().toISOString();
      }
    }
    if (titulo) payload.title = `[Frota] ${titulo}`;
    if (prioridade) payload.priority = PRIORITY_MAP[prioridade.toLowerCase()] || "p3";

    // Build description
    if (descricao || placa) {
      const parts: string[] = [];
      if (placa) parts.push(`Veículo: ${placa}${modelo ? ` (${modelo})` : ""}`);
      if (descricao) parts.push(descricao);
      payload.description = parts.join("\n");
    }

    console.log(`[forward-update] Sending update for ref=${external_ref} status=${payload.status}`);

    const res = await fetch(EXTERNAL_ENDPOINT, {
      method: "PUT",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        "x-sync-source": "fleetdesk",
      },
      body: JSON.stringify(payload),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("[forward-update] External API error:", res.status, result);
      return json({ error: "External API error", detail: result }, 502);
    }

    console.log("[forward-update] Success:", result);
    return json({ ok: true, external_task: result });
  } catch (err) {
    console.error("[forward-update] Error:", err);
    return json({ error: err.message }, 500);
  }
});
