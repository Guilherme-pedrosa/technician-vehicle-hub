/**
 * Veículos que devem ser ignorados em TODOS os relatórios, métricas e dashboards.
 * Saveiro Sport (DIW9D20) e demais carros desativados.
 */
export const EXCLUDED_PLACAS = new Set([
  "DIW9D20", // Saveiro Sport G4
  "IXO3G66",
  "OHW9F00",
]);

/**
 * Aliases de placa: o Ticket Log e o sistema/Rota Exata podem ter grafias
 * diferentes para o mesmo veículo (ex: Strada com e sem o "A").
 * Mapeamos para uma forma canônica única.
 */
const PLACA_ALIASES: Record<string, string> = {
  // Strada — Ticket Log usa JKC3076, Rota Exata usa JKC3A76
  JKC3076: "JKC3A76",
  JKC3A76: "JKC3A76",
};

/**
 * Normaliza uma placa: uppercase, trim e aplica aliases conhecidos.
 * Use SEMPRE para agrupar dados por veículo entre fontes diferentes
 * (Rota Exata, Ticket Log, daily_vehicle_km, etc).
 */
export function normalizePlaca(placa: string | null | undefined): string {
  if (!placa) return "";
  const clean = String(placa).toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  return PLACA_ALIASES[clean] ?? clean;
}

export function isExcludedPlaca(placa: string | null | undefined): boolean {
  if (!placa) return false;
  return EXCLUDED_PLACAS.has(normalizePlaca(placa));
}
