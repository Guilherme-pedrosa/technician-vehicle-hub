import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";
import type { CustoRotaExata } from "./useCustosFlota";

type AuvoExpenseRow = {
  id: string;
  auvo_id: number;
  description: string | null;
  amount: number;
  expense_date: string;
  type_name: string | null;
  user_to_name: string | null;
  attachment_url: string | null;
  vehicle_id: string | null;
  parse_status: string;
  parsed_keyword: string | null;
  vehicles?: { placa: string; modelo: string } | null;
};

export type AuvoCusto = CustoRotaExata & {
  attachment_url?: string | null;
  parse_status?: string;
  source: "auvo";
};

export function useAuvoExpenses(start: Date, end: Date) {
  return useQuery<AuvoCusto[]>({
    queryKey: ["auvo-expenses", start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("auvo_expenses")
        .select(
          "id, auvo_id, description, amount, expense_date, type_name, user_to_name, attachment_url, vehicle_id, parse_status, parsed_keyword, vehicles(placa, modelo)"
        )
        .gte("expense_date", startStr)
        .lte("expense_date", endStr)
        .order("expense_date", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const rows = (data ?? []) as unknown as AuvoExpenseRow[];

      return rows
        .filter((r) => !isExcludedPlaca(r.vehicles?.placa))
        .map((r): AuvoCusto => ({
          id: r.id,
          adesao_id: r.auvo_id,
          placa: r.vehicles?.placa,
          veiculo_descricao: r.vehicles?.modelo,
          tipo_custo_nome: r.type_name ?? "Despesa",
          dt_lancamento: r.expense_date,
          valor: Number(r.amount ?? 0),
          parcelado: false,
          mensalidade: false,
          descricao: r.description ?? undefined,
          criado_por_nome: r.user_to_name ?? undefined,
          attachment_url: r.attachment_url,
          parse_status: r.parse_status,
          source: "auvo",
        }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export async function syncAuvoExpenses(startDate?: string, endDate?: string) {
  const { data, error } = await supabase.functions.invoke("sync-auvo-expenses", {
    body: { startDate, endDate },
  });
  if (error) throw error;
  return data as {
    success: boolean;
    fetched: number;
    upserted: number;
    matched: number;
    unmatched: number;
  };
}
