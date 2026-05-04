import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTERNAL_ENDPOINT =
  "https://scgcbifmcvazmalqqpju.supabase.co/functions/v1/external-create-task";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("FROTA") || Deno.env.get("FROTA_EXTERNAL_API_KEY");
    if (!apiKey) return json({ error: "FROTA not set" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get tickets that have external_task_id (parent already synced)
    const { data: tickets, error } = await supabase
      .from("maintenance_tickets")
      .select("id, external_task_id, external_ref")
      .not("external_task_id", "is", null)
      .order("created_at", { ascending: true });

    if (error) return json({ error: error.message }, 500);
    if (!tickets?.length) return json({ ok: true, message: "No tickets", count: 0 });

    console.log(`[bulk-subtasks] Found ${tickets.length} tickets with external_task_id`);

    let totalActions = 0, synced = 0, failed = 0;

    for (const t of tickets) {
      const { data: actions } = await supabase
        .from("ticket_actions")
        .select("id, descricao, concluida, prazo, sort_order")
        .eq("ticket_id", t.id)
        .order("sort_order", { ascending: true });

      if (!actions || actions.length === 0) continue;

      totalActions += actions.length;
      console.log(`[bulk-subtasks] Ticket ${t.id}: ${actions.length} actions`);

      for (const action of actions) {
        const subRef = `fleetdesk-action-${action.id}`;
        const payload: Record<string, unknown> = {
          title: action.descricao,
          parent_id: t.external_task_id,
          external_ref: subRef,
          external_source: "fleetdesk",
          priority: "p4",
        };

        if (action.prazo) {
          payload.due_at = new Date(action.prazo + "T12:00:00Z").toISOString();
        }
        if (action.concluida) {
          payload.status = "done";
          payload.completed_at = new Date().toISOString();
        }

        try {
          const res = await fetch(EXTERNAL_ENDPOINT, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
              "x-sync-source": "fleetdesk",
            },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            synced++;
          } else {
            failed++;
            const err = await res.json().catch(() => ({}));
            console.warn(`[bulk-subtasks] Action ${action.id} failed:`, err);
          }
        } catch (e) {
          failed++;
          console.warn(`[bulk-subtasks] Action ${action.id} error:`, e);
        }

        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`[bulk-subtasks] Done: ${synced} synced, ${failed} failed of ${totalActions} total`);
    return json({ ok: true, totalActions, synced, failed });
  } catch (err) {
    console.error("[bulk-subtasks] Error:", err);
    return json({ error: err.message }, 500);
  }
});
