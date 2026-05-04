import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    if (!apiKey) return json({ error: "FROTA not set" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get all tickets without external_ref
    const { data: tickets, error } = await supabase
      .from("maintenance_tickets")
      .select("id, titulo, descricao, prioridade, status, tipo, vehicle_id, vehicles(placa, modelo)")
      .is("external_ref", null)
      .order("created_at", { ascending: true });

    if (error) return json({ error: error.message }, 500);
    if (!tickets?.length) return json({ ok: true, message: "No tickets to sync", count: 0 });

    console.log(`[bulk-sync] Found ${tickets.length} tickets to sync`);

    let success = 0, failed = 0;
    const results: Array<{id: string, ok: boolean, error?: string}> = [];

    for (const t of tickets) {
      const externalRef = `fleetdesk-${t.id}`;
      const vehicle = t.vehicles as any;
      const priority = PRIORITY_MAP[t.prioridade?.toLowerCase()] ?? "p3";
      const mappedStatus = STATUS_MAP[t.status?.toLowerCase()] ?? "todo";

      const parts: string[] = [];
      if (vehicle?.placa) parts.push(`Veículo: ${vehicle.placa}${vehicle?.modelo ? ` (${vehicle.modelo})` : ""}`);
      if (t.tipo) parts.push(`Tipo: ${t.tipo}`);
      if (t.descricao) parts.push(t.descricao);

      const payload: Record<string, unknown> = {
        title: `[Frota] ${t.titulo}`,
        description: parts.join("\n") || undefined,
        priority,
        external_ref: externalRef,
        external_source: "fleetdesk",
        status: mappedStatus,
      };

      if (mappedStatus === "done") {
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

        const result = await res.json().catch(() => ({}));

        if (res.ok && result.ok) {
          // Save refs back
          await supabase
            .from("maintenance_tickets")
            .update({
              external_ref: externalRef,
              external_task_id: result.id || null,
              external_synced_at: new Date().toISOString(),
              last_sync_source: "bulk-sync",
            })
            .eq("id", t.id);

          success++;
          results.push({ id: t.id, ok: true });
        } else {
          failed++;
          results.push({ id: t.id, ok: false, error: JSON.stringify(result) });
        }
      } catch (e) {
        failed++;
        results.push({ id: t.id, ok: false, error: e.message });
      }

      // Small delay
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[bulk-sync] Done: ${success} ok, ${failed} failed`);
    return json({ ok: true, total: tickets.length, success, failed, results });
  } catch (err) {
    console.error("[bulk-sync] Error:", err);
    return json({ error: err.message }, 500);
  }
});
