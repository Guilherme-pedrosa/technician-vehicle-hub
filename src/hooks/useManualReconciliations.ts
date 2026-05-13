import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ManualReconciliation = {
  id: string;
  rota_external_id: string;
  auvo_external_id: string;
  motivo: string;
  created_by: string;
  created_at: string;
};

export function useManualReconciliations() {
  return useQuery<ManualReconciliation[]>({
    queryKey: ["cost-manual-reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_manual_reconciliations")
        .select("*");
      if (error) throw error;
      return (data ?? []) as ManualReconciliation[];
    },
    staleTime: 60 * 1000,
  });
}

export function useSaveManualReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rota_external_id: string; auvo_external_id: string; motivo: string }) => {
      const motivo = input.motivo.trim();
      if (!motivo) throw new Error("Motivo da conciliação é obrigatório");
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Usuário não autenticado");

      // Remove any existing reconciliation envolvendo qualquer um dos dois lados
      await supabase
        .from("cost_manual_reconciliations")
        .delete()
        .or(
          `rota_external_id.eq.${input.rota_external_id},auvo_external_id.eq.${input.auvo_external_id}`,
        );

      const { error } = await supabase.from("cost_manual_reconciliations").insert({
        rota_external_id: input.rota_external_id,
        auvo_external_id: input.auvo_external_id,
        motivo,
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost-manual-reconciliations"] });
    },
  });
}

export function useDeleteManualReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cost_manual_reconciliations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost-manual-reconciliations"] });
    },
  });
}
