// ═══════════════════════════════════════════════════════════════
// KM DO PAINEL — normalização determinística da leitura do hodômetro
// ───────────────────────────────────────────────────────────────
// Contrato:
// - "27754 1 km" (sem separador decimal) → 277541
// - "27754.1" / "27754,1"                → 27754 com decimal detectado
// - Leitura ambígua/suspeita NUNCA autoriza atualizar o KM do veículo.
// - Divergência com o cadastro gera sugestão/auditoria, jamais bloqueio.
// ═══════════════════════════════════════════════════════════════

export type OdometerReadingInput = {
  /** Leitura visual crua devolvida pela IA (pode conter espaço/separador). */
  raw?: string | null;
  /** Dígitos já normalizados pela IA (pode vir vazio). */
  km_lido?: string | null;
  /** A IA afirmou ver um separador decimal claro. */
  decimal_detected?: boolean | null;
  /** A IA marcou a leitura como ambígua. */
  ambiguous?: boolean | null;
  /** A IA confirmou que leu todos os dígitos com certeza. */
  legivel?: boolean | null;
  /** KM cadastrado do veículo, quando conhecido. */
  expectedKm?: number | null;
};

export type OdometerReading = {
  /** Texto original preservado para auditoria. */
  raw: string;
  /** Valor inteiro do hodômetro, ou null quando não é possível concluir. */
  normalized: number | null;
  /** Quantidade de dígitos considerados no valor normalizado. */
  digitCount: number;
  /** Houve separador decimal explícito na leitura. */
  decimalDetected: boolean;
  /** Parte decimal descartada (quando houve separador). */
  decimalPart: string | null;
  /** Leitura ambígua — não confiável para atualizar o cadastro. */
  ambiguous: boolean;
  /** Suspeita de dígito faltando frente ao cadastro. */
  suspect: boolean;
  /** Só true quando a leitura é segura o bastante para auto-update. */
  autoUpdateAllowed: boolean;
  /** Diferença contra o cadastro (normalizado - cadastro). */
  difference: number | null;
  /** Motivos legíveis para auditoria. */
  reasons: string[];
};

const DECIMAL_SEPARATOR = /[.,]/;

/**
 * Normaliza a leitura do hodômetro de forma determinística.
 * Nunca lança: entradas inválidas viram `normalized: null`.
 */
export function normalizeOdometerReading(input: OdometerReadingInput): OdometerReading {
  const rawText = String(input.raw ?? input.km_lido ?? "").trim();
  const reasons: string[] = [];

  const hasSeparator = DECIMAL_SEPARATOR.test(rawText);
  // Só tratamos como decimal quando o separador está entre dígitos e sobra
  // exatamente 1 dígito depois dele (padrão de hodômetro com décimo).
  const decimalMatch = rawText.match(/^(\d[\d\s]*)[.,](\d)\s*(?:km)?$/i);
  const explicitDecimal = Boolean(input.decimal_detected) || Boolean(decimalMatch);

  let digits = "";
  let decimalPart: string | null = null;

  if (decimalMatch) {
    digits = decimalMatch[1].replace(/\D/g, "");
    decimalPart = decimalMatch[2];
    reasons.push("Separador decimal explícito na leitura — dígito decimal descartado.");
  } else if (hasSeparator && input.decimal_detected) {
    const parts = rawText.split(DECIMAL_SEPARATOR);
    decimalPart = (parts.pop() ?? "").replace(/\D/g, "") || null;
    digits = parts.join("").replace(/\D/g, "");
    reasons.push("Separador decimal informado pela IA — dígito decimal descartado.");
  } else {
    // Sem separador: espaço NÃO é decimal. "27754 1" = 277541.
    digits = rawText.replace(/\D/g, "");
    if (/\d\s+\d/.test(rawText)) {
      reasons.push("Espaço sem separador decimal — dígitos concatenados (ex.: \"27754 1\" = 277541).");
    }
  }

  if (!digits && input.km_lido) digits = String(input.km_lido).replace(/\D/g, "");

  const normalized = digits ? Number.parseInt(digits, 10) : null;
  const digitCount = digits.length;

  const expectedKm =
    typeof input.expectedKm === "number" && Number.isFinite(input.expectedKm) && input.expectedKm > 0
      ? Math.trunc(input.expectedKm)
      : null;
  const expectedDigits = expectedKm ? String(expectedKm).length : null;

  let suspect = false;
  if (normalized !== null && expectedDigits && digitCount < expectedDigits) {
    suspect = true;
    reasons.push(`Leitura com ${digitCount} dígitos e cadastro com ${expectedDigits} — possível dígito perdido.`);
  }

  const ambiguous =
    Boolean(input.ambiguous) ||
    normalized === null ||
    digitCount < 4 ||
    (hasSeparator && !explicitDecimal);

  if (input.ambiguous) reasons.push("IA marcou a leitura como ambígua.");
  if (normalized === null) reasons.push("Nenhum dígito legível na foto.");

  const legivel = input.legivel !== false && normalized !== null;
  const autoUpdateAllowed = Boolean(legivel) && !ambiguous && !suspect && normalized !== null;
  if (!autoUpdateAllowed) reasons.push("KM não atualizado automaticamente.");

  return {
    raw: rawText,
    normalized,
    digitCount,
    decimalDetected: explicitDecimal,
    decimalPart,
    ambiguous,
    suspect,
    autoUpdateAllowed,
    difference: normalized !== null && expectedKm !== null ? normalized - expectedKm : null,
    reasons,
  };
}

/**
 * Divergência entre a leitura e o cadastro. NUNCA bloqueia o checklist:
 * devolve apenas a classificação para alerta/auditoria/sugestão.
 */
export function classifyKmDivergence(reading: OdometerReading, expectedKm?: number | null) {
  const expected =
    typeof expectedKm === "number" && Number.isFinite(expectedKm) ? Math.trunc(expectedKm) : null;
  if (reading.normalized === null || expected === null) {
    return { level: "unknown" as const, difference: null, suggestCorrection: false, blocks: false };
  }
  const difference = reading.normalized - expected;
  const abs = Math.abs(difference);
  const level = abs >= 2000 ? ("relevant" as const) : abs > 50 ? ("minor" as const) : ("none" as const);
  return {
    level,
    difference,
    // Leitura segura pode sugerir correção mesmo quando MENOR que o cadastro.
    suggestCorrection: reading.autoUpdateAllowed && difference !== 0,
    blocks: false,
  };
}
