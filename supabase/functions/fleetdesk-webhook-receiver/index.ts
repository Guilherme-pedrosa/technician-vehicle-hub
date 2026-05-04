import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-callback-key",
};

/**
 * fleetdesk-webhook-receiver
 * Receives callbacks from TaskFlow when a task changes status.
 * Authenticates via x-callback-key header == FLEETDESK_CALLBACK_KEY secret.
 * Updates maintenance_tickets matching the external_ref.
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
    // Auth via shared secret
    const callbackKey = Deno.env.get("FLEETDESK_CALLBACK_KEY");
    if (!callbackKey) {
      console.error("[webhook-receiver] FLEETDESK_CALLBACK_KEY not set");
      return json({ error: "Server misconfigured" }, 500);
    }

    const incomingKey = req.headers.get("x-callback-key");
    if (incomingKey !== callbackKey) {
      console.warn("[webhook-receiver] Invalid callback key");
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { external_ref, status: taskStatus, completed_at, title, description, priority, due_at, assignee, labels, updated_at } = body;

    if (!external_ref) {
      return json({ error: "external_ref is required" }, 400);
    }

    console.log(`[webhook-receiver] Received callback for ref=${external_ref} status=${taskStatus}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Map TaskFlow status back to maintenance_tickets status
    const STATUS_MAP: Record<string, string> = {
      done: "concluido",
      completed: "concluido",
      in_progress: "em_andamento",
      todo: "aberto",
      cancelled: "cancelado",
    };

    const updates: Record<string, unknown> = {
      external_synced_at: new Date().toISOString(),
      last_sync_source: "taskflow-callback",
    };

    if (taskStatus) {
      const mapped = STATUS_MAP[taskStatus.toLowerCase()];
      if (mapped) {
        updates.status = mapped;
        if (mapped === "concluido" && completed_at) {
          updates.completed_at = completed_at;
        }
      }
    }

    const { data, error } = await supabase
      .from("maintenance_tickets")
      .update(updates)
      .eq("external_ref", external_ref)
      .select("id, status, external_ref")
      .maybeSingle();

    if (error) {
      console.error("[webhook-receiver] DB error:", error);
      return json({ error: "Database error", detail: error.message }, 500);
    }

    if (!data) {
      console.warn(`[webhook-receiver] No ticket found for ref=${external_ref}`);
      return json({ ok: false, message: "No matching ticket" }, 404);
    }

    console.log(`[webhook-receiver] Updated ticket ${data.id} -> ${data.status}`);
    return json({ ok: true, ticket_id: data.id, status: data.status });
  } catch (err) {
    console.error("[webhook-receiver] Error:", err);
    return json({ error: err.message }, 500);
  }
});
