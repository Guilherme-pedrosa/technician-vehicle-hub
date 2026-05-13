import { describe, expect, it } from "vitest";
import { endOfDay, startOfDay } from "date-fns";
import { isMergedCustoInDateRange, mergeCustos } from "./merge-custos";
import type { CustoRotaExata } from "@/hooks/useCustosFlota";
import type { AuvoCusto } from "@/hooks/useAuvoExpenses";

const rotaBase: CustoRotaExata = {
  id: "rota-1",
  adesao_id: 10,
  placa: "ABC1D23",
  veiculo_descricao: "Veículo",
  tipo_custo_nome: "Combustível",
  dt_lancamento: "2026-05-01",
  valor: 100,
  parcelado: false,
  mensalidade: false,
};

const auvoBase: AuvoCusto = {
  ...rotaBase,
  id: "auvo-1",
  adesao_id: 99,
  dt_lancamento: "2026-04-30",
  source: "auvo",
};

describe("mergeCustos", () => {
  it("mantém conciliação automática como uma única transação quando só uma fonte cai no filtro de data", () => {
    const [merged] = mergeCustos([rotaBase], [auvoBase]);

    expect(merged).toBeDefined();
    expect(merged.source).toBe("rotaexata");
    expect(merged.matched_with).toMatchObject({ source: "auvo", id: "auvo-1", dt_lancamento: "2026-04-30" });
    expect(isMergedCustoInDateRange(merged, startOfDay(new Date(2026, 3, 30)), endOfDay(new Date(2026, 3, 30)))).toBe(true);
    expect(isMergedCustoInDateRange(merged, startOfDay(new Date(2026, 4, 1)), endOfDay(new Date(2026, 4, 1)))).toBe(true);
  });
});