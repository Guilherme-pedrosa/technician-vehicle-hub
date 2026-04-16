// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE = "https://api.auvo.com.br/v2";

type AuvoExpense = {
  id: number;
  description?: string;
  userToId?: number;
  userToName?: string;
  typeId?: number;
  typeName?: string;
  date?: string;
  expenseDate?: string;
  attachmentUrl?: string;
  amount?: number;
  creationDate?: string;
};

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Auvo login failed [${res.status}]: ${text}`);
  // API returns either { result: {...} } or "result": {...} pattern. Try both.
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = JSON.parse(`{${text}}`);
  }
  const token = parsed?.result?.accessToken ?? parsed?.accessToken;
  if (!token) throw new Error(`Auvo login: no accessToken in response: ${text.slice(0, 200)}`);
  return token;
}

async function fetchExpensesPage(
  token: string,
  page: number,
  pageSize: number,
  startDate: string,
  endDate: string,
): Promise<{ items: AuvoExpense[]; totalItems: number }> {
  const paramFilter = JSON.stringify({ startDate, endDate });
  const url = `${AUVO_BASE}/expenses/?paramFilter=${encodeURIComponent(paramFilter)}&page=${page}&pageSize=${pageSize}&order=desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Auvo /expenses failed [${res.status}]: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text);
  const result = parsed?.result ?? parsed;
  const items = (result?.entityList ?? []) as AuvoExpense[];
  const totalItems = Number(result?.pagedSearchReturnData?.totalItems ?? items.length);
  return { items, totalItems };
}

type Vehicle = { id: string; placa: string; modelo: string };
type Alias = { vehicle_id: string; keyword: string; priority: number };

function buildKeywordIndex(vehicles: Vehicle[], aliases: Alias[]) {
  // Returns array of { keyword, vehicle_id, priority } sorted by length desc / priority desc
  const map: Array<{ keyword: string; vehicle_id: string; priority: number }> = [];

  // 1) plates from vehicles (highest priority)
  vehicles.forEach((v) => {
    if (v.placa) map.push({ keyword: v.placa.toUpperCase(), vehicle_id: v.id, priority: 1000 });
  });
  // 2) custom aliases
  aliases.forEach((a) => {
    if (a.keyword) map.push({ keyword: a.keyword.toUpperCase(), vehicle_id: a.vehicle_id, priority: a.priority ?? 0 });
  });
  // sort longest keyword first to avoid partial matches stealing
  map.sort((a, b) => b.keyword.length - a.keyword.length || b.priority - a.priority);
  return map;
}

function normalizePlate(s: string) {
  return s.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function parseVehicle(
  description: string,
  index: Array<{ keyword: string; vehicle_id: string; priority: number }>,
): { vehicle_id: string | null; keyword: string | null } {
  if (!description) return { vehicle_id: null, keyword: null };
  const upper = description.toUpperCase();
  const compact = normalizePlate(description);
  for (const entry of index) {
    const kwCompact = normalizePlate(entry.keyword);
    // Check both raw substring and plate-style compact match
    if (upper.includes(entry.keyword) || (kwCompact.length >= 6 && compact.includes(kwCompact))) {
      return { vehicle_id: entry.vehicle_id, keyword: entry.keyword };
    }
  }
  return { vehicle_id: null, keyword: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const AUVO_API_KEY = Deno.env.get("AUVO_API_KEY");
    const AUVO_USER_TOKEN = Deno.env.get("AUVO_USER_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!AUVO_API_KEY || !AUVO_USER_TOKEN) {
      return new Response(
        JSON.stringify({ error: "AUVO_API_KEY/AUVO_USER_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ error: "Supabase env missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const today = new Date();
    const defaultStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const startDate: string = body.startDate ?? defaultStart.toISOString().slice(0, 10);
    const endDate: string = body.endDate ?? today.toISOString().slice(0, 10);
    const dryRun: boolean = !!body.dryRun;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Load vehicles + aliases for parser
    const [{ data: vehicles }, { data: aliases }] = await Promise.all([
      supabase.from("vehicles").select("id, placa, modelo"),
      supabase.from("vehicle_aliases").select("vehicle_id, keyword, priority").eq("active", true),
    ]);

    const index = buildKeywordIndex(
      (vehicles ?? []) as Vehicle[],
      (aliases ?? []) as Alias[],
    );

    // Login
    const token = await auvoLogin(AUVO_API_KEY, AUVO_USER_TOKEN);

    // Paginate
    const pageSize = 100;
    let page = 1;
    let totalItems = Infinity;
    const all: AuvoExpense[] = [];
    while (all.length < totalItems) {
      const { items, totalItems: t } = await fetchExpensesPage(token, page, pageSize, startDate, endDate);
      totalItems = t;
      if (!items.length) break;
      all.push(...items);
      if (items.length < pageSize) break;
      page += 1;
      if (page > 200) break; // safety
    }

    // Build rows
    const rows = all.map((e) => {
      const date = (e.expenseDate ?? e.date ?? "").slice(0, 10);
      const description = e.description ?? "";
      const { vehicle_id, keyword } = parseVehicle(description, index);
      return {
        auvo_id: e.id,
        description,
        amount: Number(e.amount ?? 0),
        expense_date: date || new Date().toISOString().slice(0, 10),
        type_id: e.typeId ?? null,
        type_name: e.typeName ?? null,
        user_to_id: e.userToId ?? null,
        user_to_name: e.userToName ?? null,
        attachment_url: e.attachmentUrl || null,
        vehicle_id,
        parse_status: vehicle_id ? "matched" : "unmatched",
        parsed_keyword: keyword,
        raw_payload: e as unknown as Record<string, unknown>,
        synced_at: new Date().toISOString(),
      };
    });

    let upserted = 0;
    if (!dryRun && rows.length) {
      // chunked upsert
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("auvo_expenses")
          .upsert(chunk, { onConflict: "auvo_id" });
        if (error) throw new Error(`Upsert failed: ${error.message}`);
        upserted += chunk.length;
      }
    }

    const matched = rows.filter((r) => r.parse_status === "matched").length;
    return new Response(
      JSON.stringify({
        success: true,
        startDate,
        endDate,
        fetched: rows.length,
        upserted,
        matched,
        unmatched: rows.length - matched,
        sample: rows.slice(0, 3),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sync-auvo-expenses error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
