import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type UnmatchBlock = {
  id: string;
  rota_external_id: string;
  auvo_external_id: string;
  motivo: string | null;
  created_by: string | null;
  created_at: string;
};

export function useUnmatchBlocks() {
  return useQuery<UnmatchBlock[]>({
    queryKey: ["cost-unmatch-blocks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_unmatch_blocks").select("*");
      if (error) throw error;
      return (data ?? []) as UnmatchBlock[];
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateUnmatchBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rota_external_id: string; auvo_external_id: string; motivo?: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Usuário não autenticado");

      // Se existir conciliação manual entre esses dois, remove primeiro.
      await supabase
        .from("cost_manual_reconciliations")
        .delete()
        .eq("rota_external_id", input.rota_external_id)
        .eq("auvo_external_id", input.auvo_external_id);

      const { error } = await supabase.from("cost_unmatch_blocks").upsert(
        {
          rota_external_id: input.rota_external_id,
          auvo_external_id: input.auvo_external_id,
          motivo: input.motivo?.trim() || null,
          created_by: userId,
        },
        { onConflict: "rota_external_id,auvo_external_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost-unmatch-blocks"] });
      qc.invalidateQueries({ queryKey: ["cost-manual-reconciliations"] });
    },
  });
}

export function useDeleteUnmatchBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cost_unmatch_blocks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cost-unmatch-blocks"] });
    },
  });
}
