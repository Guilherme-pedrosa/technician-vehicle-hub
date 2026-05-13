import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CostPlacaOverride = {
  id: string;
  source: "rotaexata" | "auvo";
  external_id: string;
  placa: string;
  note: string | null;
};

export function useCostPlacaOverrides() {
  return useQuery<CostPlacaOverride[]>({
    queryKey: ["cost-placa-overrides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_placa_overrides")
        .select("id, source, external_id, placa, note");
      if (error) throw error;
      return (data ?? []) as CostPlacaOverride[];
    },
    staleTime: 60 * 1000,
  });
}

export function useSaveCostPlacaOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { source: "rotaexata" | "auvo"; external_id: string; placa: string; note?: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Usuário não autenticado");

      const placa = input.placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!placa) {
        // Remove override
        const { error } = await supabase
          .from("cost_placa_overrides")
          .delete()
          .eq("source", input.source)
          .eq("external_id", input.external_id);
        if (error) throw error;
        return null;
      }

      const { error } = await supabase
        .from("cost_placa_overrides")
        .upsert(
          {
            source: input.source,
            external_id: input.external_id,
            placa,
            note: input.note ?? null,
            created_by: userId,
          },
          { onConflict: "source,external_id" },
        );
      if (error) throw error;
      return placa;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost-placa-overrides"] });
    },
  });
}
