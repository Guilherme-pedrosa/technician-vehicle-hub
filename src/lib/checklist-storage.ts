// ═══════════════════════════════════════════════════════════════
// REFERÊNCIAS DE FOTO → PATH REAL NO BUCKET `checklist-photos`
// ───────────────────────────────────────────────────────────────
// O banco guarda referências heterogêneas (histórico do projeto):
//  - URL pública legada .../storage/v1/object/public/checklist-photos/<path>
//  - URL assinada        .../storage/v1/object/sign/checklist-photos/<path>?token=...
//  - referência canônica "checklist-photos/<path>" ou apenas "<path>"
// Para descartar um rascunho de verdade precisamos do <path> em todos os casos.
// ═══════════════════════════════════════════════════════════════

export const CHECKLIST_PHOTO_BUCKET = "checklist-photos";

const BUCKET_MARKER = `/${CHECKLIST_PHOTO_BUCKET}/`;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extrai o path dentro do bucket a partir de qualquer referência conhecida.
 * Retorna null quando a referência não pertence ao bucket de checklists.
 */
export function extractChecklistPhotoPath(reference: unknown): string | null {
  const raw = String(reference ?? "").trim();
  if (!raw) return null;

  // remove query string / fragmento (token de URL assinada, cache-buster…)
  const withoutQuery = raw.split("#")[0].split("?")[0];
  if (!withoutQuery) return null;

  let path: string | null = null;

  const markerIdx = withoutQuery.indexOf(BUCKET_MARKER);
  if (markerIdx >= 0) {
    path = withoutQuery.slice(markerIdx + BUCKET_MARKER.length);
  } else if (withoutQuery.startsWith(`${CHECKLIST_PHOTO_BUCKET}/`)) {
    path = withoutQuery.slice(CHECKLIST_PHOTO_BUCKET.length + 1);
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(withoutQuery) && !withoutQuery.startsWith("/")) {
    // referência relativa já dentro do bucket
    path = withoutQuery;
  }

  if (!path) return null;
  path = safeDecode(path).replace(/^\/+/, "").trim();
  if (!path || path.includes("..")) return null;
  return path;
}

/** Extrai todos os paths de um mapa `fotos` persistido (categoria → lista). */
export function collectChecklistPhotoPaths(fotos: unknown): string[] {
  if (!fotos || typeof fotos !== "object" || Array.isArray(fotos)) return [];
  const out = new Set<string>();
  for (const value of Object.values(fotos as Record<string, unknown>)) {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const path = extractChecklistPhotoPath(item);
      if (path) out.add(path);
    }
  }
  return [...out];
}
