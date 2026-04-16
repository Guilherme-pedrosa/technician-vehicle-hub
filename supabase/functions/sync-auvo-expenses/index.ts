// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE = "https://api.auvo.com.br/v2";
const EXCLUDED_PLATES = new Set(["DIW9D20", "IXO3G66", "OHW9F00"]);
const MODEL_STOPWORDS = new Set([
  "FLEX",
  "MT",
  "AT",
  "LS",
  "LT",
  "LTZ",
  "JOY",
  "JOYE",
  "SD",
  "XS",
  "X",
  "CE",
  "CD",
  "CH",
  "A",
  "PRATA",
  "VERMELHO",
  "TROOP",
  "SPORTLINE",
  "WORKING",
  "SOBERANA",
]);

const RECEIPT_HINT_WORDS = [
  "ABASTECIMENTO",
  "GASOLINA",
  "ETANOL",
  "DIESEL",
  "COMBUSTIVEL",
  "COMBUSTÍVEL",
  "TICKETLOG",
  "TICKET LOG",
  "DESLOCAMENTO",
  "KM",
  "ODOMETRO",
  "ODÔMETRO",
  "PLACA",
];

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

type Vehicle = { id: string; placa: string; modelo: string };
type Alias = { vehicle_id: string; keyword: string; priority: number };
type KeywordEntry = {
  keyword: string;
  keyword_compact: string;
  vehicle_id: string;
  priority: number;
  source: "plate" | "model" | "alias";
};
type ParsedVehicle = {
  vehicle_id: string | null;
  keyword: string | null;
  source: "description" | "attachment" | null;
  matched_by: KeywordEntry["source"] | null;
};

type AttachmentOcr = {
  text: string;
  clues: string[];
  placa?: string | null;
  km?: number | null;
  litros?: number | null;
  valor?: number | null;
  error?: string;
};

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Auvo login failed [${res.status}]: ${text}`);

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

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeCompact(value: string | null | undefined) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, "");
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function getModelAliases(vehicle: Vehicle) {
  const tokens = tokenize(vehicle.modelo);
  const aliases = new Set<string>();

  const primary = tokens.find((token) => token.length >= 4 && !MODEL_STOPWORDS.has(token) && /[A-Z]/.test(token));
  if (primary) aliases.add(primary);

  const full = normalizeText(vehicle.modelo).replace(/\s+/g, " ").trim();
  if (full) aliases.add(full);

  return Array.from(aliases);
}

function addKeyword(
  map: Map<string, KeywordEntry>,
  keyword: string,
  vehicle_id: string,
  priority: number,
  source: KeywordEntry["source"],
) {
  const normalized = normalizeText(keyword);
  const compact = normalizeCompact(keyword);
  if (!normalized || normalized.length < 3) return;

  const current = map.get(normalized);
  if (!current || current.priority < priority) {
    map.set(normalized, {
      keyword: normalized,
      keyword_compact: compact,
      vehicle_id,
      priority,
      source,
    });
  }
}

function buildKeywordIndex(vehicles: Vehicle[], aliases: Alias[]) {
  const activeVehicles = vehicles.filter((vehicle) => !EXCLUDED_PLATES.has(normalizeCompact(vehicle.placa)));
  const entries = new Map<string, KeywordEntry>();

  for (const vehicle of activeVehicles) {
    addKeyword(entries, vehicle.placa, vehicle.id, 1000, "plate");
  }

  for (const alias of aliases) {
    if (activeVehicles.some((vehicle) => vehicle.id === alias.vehicle_id)) {
      addKeyword(entries, alias.keyword, alias.vehicle_id, 900 + (alias.priority ?? 0), "alias");
    }
  }

  const modelAliasOwners = new Map<string, Set<string>>();
  for (const vehicle of activeVehicles) {
    for (const alias of getModelAliases(vehicle)) {
      const key = normalizeText(alias);
      if (!modelAliasOwners.has(key)) modelAliasOwners.set(key, new Set());
      modelAliasOwners.get(key)!.add(vehicle.id);
    }
  }

  for (const vehicle of activeVehicles) {
    for (const alias of getModelAliases(vehicle)) {
      const owners = modelAliasOwners.get(normalizeText(alias));
      if (owners?.size === 1) {
        addKeyword(entries, alias, vehicle.id, 600, "model");
      }
    }
  }

  return Array.from(entries.values()).sort(
    (a, b) => b.keyword.length - a.keyword.length || b.priority - a.priority,
  );
}

function parseVehicleFromText(text: string, index: KeywordEntry[]): ParsedVehicle {
  if (!text) {
    return { vehicle_id: null, keyword: null, source: null, matched_by: null };
  }

  const normalized = normalizeText(text);
  const compact = normalizeCompact(text);

  for (const entry of index) {
    if (
      normalized.includes(entry.keyword) ||
      (entry.keyword_compact.length >= 6 && compact.includes(entry.keyword_compact))
    ) {
      return {
        vehicle_id: entry.vehicle_id,
        keyword: entry.keyword,
        source: null,
        matched_by: entry.source,
      };
    }
  }

  return { vehicle_id: null, keyword: null, source: null, matched_by: null };
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function looksLikeVehicleExpense(expense: AuvoExpense) {
  const haystack = normalizeText(`${expense.typeName ?? ""} ${expense.description ?? ""}`);
  return RECEIPT_HINT_WORDS.some((word) => haystack.includes(normalizeText(word)));
}

function parseJsonObject(content: string) {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object returned by AI");
  return JSON.parse(match[0]);
}

function inferMimeFromBytes(bytes: Uint8Array, fallback = "image/jpeg"): string {
  if (bytes.length >= 4) {
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    // GIF
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    // WEBP: RIFF....WEBP
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return "image/webp";
  }
  return fallback;
}

function inferMimeFromUrl(url: string): string | null {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  return null;
}

async function extractTextFromAttachment(
  imageUrl: string,
  lovableApiKey: string,
): Promise<AttachmentOcr | null> {
  try {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      console.warn(`[OCR] fetch failed [${imageRes.status}] ${imageUrl}`);
      return { text: "", clues: [], placa: null, km: null, litros: null, valor: null, error: `fetch_${imageRes.status}` } as AttachmentOcr;
    }

    const headerType = imageRes.headers.get("content-type") || "";
    const buffer = await imageRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Auvo S3 entrega muitas vezes como "binary/octet-stream" — Gemini rejeita.
    // Detectamos o tipo real por magic bytes (fallback) e por extensão da URL.
    let contentType = headerType.startsWith("image/") ? headerType : (inferMimeFromUrl(imageUrl) ?? inferMimeFromBytes(bytes));
    if (contentType === "image/heic" || contentType === "image/heif") {
      // Gemini não aceita HEIC; força jpeg (alguns devices entregam .heic mas bytes JPEG)
      contentType = inferMimeFromBytes(bytes, "image/jpeg");
    }

    const imageBase64 = toBase64(buffer);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              'Você analisa comprovantes de abastecimento/deslocamento brasileiros (cupom fiscal, NFC-e, ticket TicketLog, recibos manuais).\n\nSua única tarefa: extrair literalmente o que está IMPRESSO ou ESCRITO na imagem. NUNCA invente, NUNCA deduza.\n\nResponda APENAS com um JSON válido neste formato exato:\n{"placa":"AAA0A00 ou AAA0000 (vazio se não visível)","km":123456 (número inteiro do hodômetro/odômetro, null se ausente),"litros":12.34 (número decimal, null se ausente),"valor":123.45 (valor total, null se ausente),"text":"transcrição resumida do que está legível (máx 300 chars)","clues":["pistas adicionais úteis para identificar veículo: modelo, apelido, prefixo"]}\n\nRegras:\n- Placa BR tem 7 caracteres: 3 letras + 4 caracteres (Mercosul tem letra na 5ª posição). Procure perto de "PLACA", "VEICULO", em ticket TicketLog geralmente aparece sozinha em uma linha.\n- KM/Hodômetro: número grande perto de "KM", "ODOMETRO", "HODOMETRO".\n- Se houver dois comprovantes na mesma imagem, priorize a placa que aparecer no ticket de combustível/TicketLog.\n- Se a placa estiver ilegível ou ausente, retorne string vazia "".\n- NUNCA chute uma placa parecida.',
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${contentType};base64,${imageBase64}`,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: "Extraia placa, KM do hodômetro, litros, valor e quaisquer pistas do veículo visíveis no(s) comprovante(s) desta imagem.",
              },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.warn(`[OCR] gemini failed [${aiRes.status}] mime=${contentType} url=${imageUrl} :: ${errText.slice(0, 300)}`);
      return { text: "", clues: [], placa: null, km: null, litros: null, valor: null, error: `gemini_${aiRes.status}: ${errText.slice(0, 200)}` } as AttachmentOcr;
    }

    const data = await aiRes.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = parseJsonObject(content);
    } catch (e) {
      console.warn(`[OCR] parse error url=${imageUrl} content=${content.slice(0, 200)}`);
      return { text: content.slice(0, 300), clues: [], placa: null, km: null, litros: null, valor: null, error: `parse: ${e instanceof Error ? e.message : String(e)}` } as AttachmentOcr;
    }
    const placaRaw = String(parsed?.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const result: AttachmentOcr = {
      text: String(parsed?.text ?? "").trim(),
      clues: Array.isArray(parsed?.clues) ? (parsed.clues as unknown[]).map((item) => String(item)) : [],
      placa: placaRaw && placaRaw.length === 7 ? placaRaw : null,
      km: typeof parsed?.km === "number" ? (parsed.km as number) : null,
      litros: typeof parsed?.litros === "number" ? (parsed.litros as number) : null,
      valor: typeof parsed?.valor === "number" ? (parsed.valor as number) : null,
    };
    console.log(`[OCR] ok placa=${result.placa ?? "-"} km=${result.km ?? "-"} url=${imageUrl}`);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[OCR] exception ${imageUrl}: ${msg}`);
    return { text: "", clues: [], placa: null, km: null, litros: null, valor: null, error: `exception: ${msg}` } as AttachmentOcr;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const AUVO_API_KEY = Deno.env.get("AUVO_API_KEY");
    const AUVO_USER_TOKEN = Deno.env.get("AUVO_USER_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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

    const [{ data: vehicles }, { data: aliases }] = await Promise.all([
      supabase.from("vehicles").select("id, placa, modelo"),
      supabase.from("vehicle_aliases").select("vehicle_id, keyword, priority").eq("active", true),
    ]);

    const index = buildKeywordIndex((vehicles ?? []) as Vehicle[], (aliases ?? []) as Alias[]);
    console.log(`Auvo parser loaded ${index.length} keywords for ${vehicles?.length ?? 0} vehicles`);

    const token = await auvoLogin(AUVO_API_KEY, AUVO_USER_TOKEN);

    const pageSize = 100;
    let page = 1;
    let totalItems = Infinity;
    const all: AuvoExpense[] = [];
    while (all.length < totalItems) {
      const { items, totalItems: total } = await fetchExpensesPage(token, page, pageSize, startDate, endDate);
      totalItems = total;
      if (!items.length) break;
      const deslocamento = items.filter(
        (it) => normalizeText(it.typeName).includes("DESLOCAMENTO"),
      );
      all.push(...deslocamento);
      if (items.length < pageSize) break;
      page += 1;
      if (page > 200) break;
    }

    const baseRows = all.map((expense) => {
      const description = expense.description ?? "";
      const parsedFromDescription = parseVehicleFromText(description, index);

      return {
        expense,
        description,
        date: (expense.expenseDate ?? expense.date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
        vehicle_id: parsedFromDescription.vehicle_id,
        parsed_keyword: parsedFromDescription.keyword,
        parse_status: parsedFromDescription.vehicle_id
          ? `matched_description_${parsedFromDescription.matched_by}`
          : "unmatched",
        raw_payload: expense as Record<string, unknown>,
      };
    });

    const unmatchedForAttachment = baseRows
      .map((row, index) => ({ ...row, rowIndex: index }))
      .filter((row) => !row.vehicle_id && row.expense.attachmentUrl);

    if (LOVABLE_API_KEY && unmatchedForAttachment.length) {
      // Mapa placa->vehicle_id para match direto
      const placaToVehicle = new Map<string, string>();
      for (const v of (vehicles ?? []) as Vehicle[]) {
        const p = normalizeCompact(v.placa);
        if (p && !EXCLUDED_PLATES.has(p)) placaToVehicle.set(p, v.id);
      }

      const ocrResults = await mapWithConcurrency(unmatchedForAttachment, 3, async (row) => {
        const attachment = row.expense.attachmentUrl!;
        const ocr = await extractTextFromAttachment(attachment, LOVABLE_API_KEY);
        if (!ocr) return { rowIndex: row.rowIndex, ocr: null, parsed: null, byPlaca: false };

        // 1) Tenta match direto pela placa extraída
        if (ocr.placa && placaToVehicle.has(ocr.placa)) {
          return {
            rowIndex: row.rowIndex,
            ocr,
            parsed: { vehicle_id: placaToVehicle.get(ocr.placa)!, keyword: ocr.placa, source: null, matched_by: "plate" as const },
            byPlaca: true,
          };
        }

        // 2) Fallback: keyword search no texto + clues
        const combinedText = [ocr.text, ...ocr.clues, ocr.placa ?? ""].filter(Boolean).join(" ");
        const parsed = parseVehicleFromText(combinedText, index);
        return { rowIndex: row.rowIndex, ocr, parsed, byPlaca: false };
      });

      for (const result of ocrResults) {
        if (!result?.ocr) continue;
        const row = baseRows[result.rowIndex];
        // Sempre salva o OCR no payload, mesmo se não bateu (auditoria)
        row.raw_payload = {
          ...(row.raw_payload ?? {}),
          attachment_ocr: result.ocr,
        };
        if (!result.parsed?.vehicle_id) continue;
        row.vehicle_id = result.parsed.vehicle_id;
        row.parsed_keyword = result.parsed.keyword;
        row.parse_status = result.byPlaca
          ? "matched_attachment_ocr_plate"
          : `matched_attachment_${result.parsed.matched_by}`;
      }
    }

    const rows = baseRows.map((row) => ({
      auvo_id: row.expense.id,
      description: row.description,
      amount: Number(row.expense.amount ?? 0),
      expense_date: row.date,
      type_id: row.expense.typeId ?? null,
      type_name: row.expense.typeName ?? null,
      user_to_id: row.expense.userToId ?? null,
      user_to_name: row.expense.userToName ?? null,
      attachment_url: row.expense.attachmentUrl || null,
      vehicle_id: row.vehicle_id,
      parse_status: row.parse_status,
      parsed_keyword: row.parsed_keyword,
      raw_payload: row.raw_payload,
      synced_at: new Date().toISOString(),
    }));

    let upserted = 0;
    if (!dryRun && rows.length) {
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from("auvo_expenses").upsert(chunk, { onConflict: "auvo_id" });
        if (error) throw new Error(`Upsert failed: ${error.message}`);
        upserted += chunk.length;
      }
    }

    const matched = rows.filter((row) => row.vehicle_id).length;
    const matchedByDescription = rows.filter((row) => row.parse_status.startsWith("matched_description")).length;
    const matchedByAttachment = rows.filter((row) => row.parse_status.startsWith("matched_attachment")).length;

    return new Response(
      JSON.stringify({
        success: true,
        startDate,
        endDate,
        fetched: rows.length,
        upserted,
        matched,
        matchedByDescription,
        matchedByAttachment,
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
