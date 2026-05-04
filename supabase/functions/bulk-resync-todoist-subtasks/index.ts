import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const url = new URL(req.url);
    const ticketId = url.searchParams.get("ticket_id");
    const limit = Number(url.searchParams.get("limit") ?? "10");
    const offset = Number(url.searchParams.get("offset") ?? "0");

    let query = admin
      .from("maintenance_tickets")
      .select("id, titulo, descricao, prioridade, tipo, status, vehicles(placa, modelo)")
      .not("external_ref", "is", null)
      .order("created_at", { ascending: true });

    if (ticketId) {
      query = query.eq("id", ticketId);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: tickets, error } = await query;

    if (error) return json({ error: error.message }, 500);

    let processed = 0;
    let skipped = 0;
    const failures: Array<{ ticket_id: string; error: unknown }> = [];

    for (const ticket of tickets ?? []) {
      const { count } = await admin
        .from("ticket_actions")
        .select("id", { count: "exact", head: true })
        .eq("ticket_id", ticket.id);

      if (!count) {
        skipped++;
        continue;
      }

      const vehicle = Array.isArray(ticket.vehicles) ? ticket.vehicles[0] : ticket.vehicles;
      const res = await fetch(`${supabaseUrl}/functions/v1/forward-ticket-todoist`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticket_id: ticket.id,
          titulo: ticket.titulo,
          descricao: ticket.descricao,
          prioridade: ticket.prioridade,
          placa: vehicle?.placa,
          modelo: vehicle?.modelo,
          tipo: ticket.tipo,
          status: ticket.status,
        }),
      });

      if (res.ok) {
        processed++;
      } else {
        failures.push({ ticket_id: ticket.id, error: await res.json().catch(() => res.statusText) });
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    return json({ ok: true, processed, skipped, failures, limit, offset, ticket_id: ticketId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});