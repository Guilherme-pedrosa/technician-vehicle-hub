// Helper puro de resolução motorista <-> evento de telemetria.
//
// FONTE DE VERDADE: /relatorios/rastreamento/log_motorista
// O campo `motorista` retornado pelo evento de /dirigibilidade NÃO é confiável:
// vem vazio ou errado com frequência. Usamos como fallback final apenas se
// não houver janela ativa para o (adesao_id, timestamp).
//
// FUSO HORÁRIO: a API RotaExata trabalha em horário local Brasil (sem TZ
// explícito nos timestamps de log_motorista). Convertemos tudo para UTC
// no momento da ingestão. Os timestamps do evento já vêm parseados em ms UTC
// pelo chamador (parseDateMs).

export type DriverWindow = {
  adesao_id: string;
  driver_id: string | null;
  driver_name: string;
  // Instantes absolutos em ms desde epoch (UTC).
  start_ms: number;
  end_ms: number; // pode ser fechado pelo dia ou pela próxima janela
  vinculo_tipo: string | null;
};

export type ResolvedDriver = {
  driver_id: string | null;
  driver_name: string; // "Sem condutor vinculado" se nada bater
  vinculo_tipo: string | null;
  source: "log_motorista" | "event_fallback" | "unknown";
};

const UNKNOWN: ResolvedDriver = {
  driver_id: null,
  driver_name: "Sem condutor vinculado",
  vinculo_tipo: null,
  source: "unknown",
};

// Constrói as janelas a partir das entries cruas do log_motorista.
// - hora_vinculo / horario_vinculo / dt_inicio: início da janela
// - hora_desvinculo / horario_desvinculo / dt_fim: fim (pode ser null)
// Quando o fim é null:
//   - se for dia corrente: janela aberta (end = agora)
//   - se for dia anterior: fecha no fim do dia (23:59:59)
//   - se houver próxima janela do mesmo (adesao_id), fecha no início dela
export function buildDriverWindows(
  entries: Record<string, unknown>[],
  adesao_id: string,
  day: string,
  parseDateMs: (s: unknown) => number,
): DriverWindow[] {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const isToday = day === todayUtc;
  const endOfDayMs = Date.parse(`${day}T23:59:59.999Z`);
  const nowMs = Date.now();

  const windows: DriverWindow[] = [];
  for (const entry of entries) {
    const motorista = entry.motorista as Record<string, unknown> | undefined;
    const driver_id = motorista?.id
      ? String(motorista.id)
      : entry.motorista_id
        ? String(entry.motorista_id)
        : null;
    const nomeRaw = motorista?.nome
      ? String(motorista.nome)
      : entry.motorista_nome
        ? String(entry.motorista_nome)
        : "";
    const driver_name = nomeRaw && nomeRaw !== "Desconhecido"
      ? nomeRaw
      : "Sem condutor vinculado";

    const start_ms = parseDateMs(
      entry.horario_vinculo ?? entry.hr_vinculo ?? entry.dt_inicio ?? entry.hora_inicio,
    );
    if (!start_ms) continue;

    const rawEnd =
      entry.horario_desvinculo ?? entry.hr_desvinculo ?? entry.dt_fim ?? entry.hora_fim;
    let end_ms = parseDateMs(rawEnd);
    if (!end_ms) {
      end_ms = isToday ? nowMs : endOfDayMs;
    }

    const vinculo_tipo =
      (entry.tipo_vinculo as string | undefined) ??
      (motorista?.tipo_vinculo as string | undefined) ??
      null;

    windows.push({ adesao_id, driver_id, driver_name, start_ms, end_ms, vinculo_tipo });
  }

  // Ordena por início e fecha janelas abertas pelo início da próxima
  windows.sort((a, b) => a.start_ms - b.start_ms);
  for (let i = 0; i < windows.length - 1; i++) {
    if (windows[i].end_ms > windows[i + 1].start_ms) {
      windows[i].end_ms = windows[i + 1].start_ms;
    }
  }

  return windows;
}

// Resolve o motorista de um evento isolado.
// `eventFallback` é o que veio dentro do próprio evento de /dirigibilidade
// (motorista.nome / motorista.id). Usado APENAS se nenhuma janela bater
// E o nome vier preenchido e diferente de "Desconhecido".
export function resolveDriverForTelemetry(
  event: { adesao_id: string; timestamp_ms: number },
  windows: DriverWindow[],
  eventFallback?: { driver_id: string | null; driver_name: string | null },
): ResolvedDriver {
  if (event.timestamp_ms > 0) {
    for (const w of windows) {
      if (w.adesao_id !== event.adesao_id) continue;
      if (event.timestamp_ms >= w.start_ms && event.timestamp_ms <= w.end_ms) {
        return {
          driver_id: w.driver_id,
          driver_name: w.driver_name,
          vinculo_tipo: w.vinculo_tipo,
          source: "log_motorista",
        };
      }
    }
  }

  // Fallback: motorista informado pelo próprio evento (não-vazio e não-Desconhecido)
  const fallbackName = eventFallback?.driver_name?.trim();
  if (fallbackName && fallbackName !== "Desconhecido") {
    return {
      driver_id: eventFallback?.driver_id ?? null,
      driver_name: fallbackName,
      vinculo_tipo: null,
      source: "event_fallback",
    };
  }

  return { ...UNKNOWN };
}
