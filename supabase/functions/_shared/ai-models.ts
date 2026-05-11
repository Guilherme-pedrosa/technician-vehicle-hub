// =====================================================================
// AI Models — fonte única de verdade para os modelos usados nas Edge
// Functions de IA. NUNCA usar outro provedor (Gemini/Anthropic/Claude/...)
// sem autorização explícita do dono do app.
//
// Política completa: mem://constraints/openai-only
// =====================================================================

export const AI_PROVIDER_ALLOWED = "openai" as const;

/** Validação de fotos do checklist (cluster, painel, etiqueta de óleo, etc). */
export const AI_VISION_MODEL = "openai/gpt-5.4" as const;

/** OCR de comprovantes Auvo (extração inicial — alto volume, baixo custo). */
export const AI_OCR_MODEL = "openai/gpt-5.4-mini" as const;

/** Verificação crítica de placa quando o OCR inicial não bater com a frota. */
export const AI_OCR_VERIFY_MODEL = "openai/gpt-5.4" as const;

/** Versão do prompt de validação de fotos — incrementar a cada mudança relevante. */
export const PHOTO_VALIDATION_PROMPT_VERSION = "2026-05-11.v3-audit";

/** Endpoint do Lovable AI Gateway (compatível com OpenAI Chat Completions). */
export const AI_GATEWAY_URL =
  "https://ai.gateway.lovable.dev/v1/chat/completions" as const;
