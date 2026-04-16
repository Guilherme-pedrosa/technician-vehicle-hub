/**
 * Veículos que devem ser ignorados em TODOS os relatórios, métricas e dashboards.
 * Saveiro Sport (DIW9D20) e demais carros desativados.
 */
export const EXCLUDED_PLACAS = new Set([
  "DIW9D20", // Saveiro Sport G4
  "IXO3G66",
  "OHW9F00",
]);

export function isExcludedPlaca(placa: string | null | undefined): boolean {
  if (!placa) return false;
  return EXCLUDED_PLACAS.has(placa.toUpperCase().trim());
}
