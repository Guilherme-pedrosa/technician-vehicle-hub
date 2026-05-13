import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useSaveCostPlacaOverride } from "@/hooks/useCostPlacaOverrides";
import { supabase } from "@/integrations/supabase/client";
import { isExcludedPlaca } from "@/lib/excluded-vehicles";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: "rotaexata" | "auvo";
  externalId: string;
  currentPlaca?: string;
  description?: string;
}

const NONE_VALUE = "__none__";

export function EditPlacaDialog({ open, onOpenChange, source, externalId, currentPlaca, description }: Props) {
  const [placa, setPlaca] = useState<string>(NONE_VALUE);
  const save = useSaveCostPlacaOverride();

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles-for-override"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("placa, modelo")
        .order("placa");
      if (error) throw error;
      return (data ?? []).filter((v) => !isExcludedPlaca(v.placa));
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (open) setPlaca(currentPlaca ? currentPlaca.toUpperCase() : NONE_VALUE);
  }, [open, currentPlaca]);

  const options = useMemo(
    () => (vehiclesQuery.data ?? []).map((v) => ({ value: v.placa, label: `${v.placa} — ${v.modelo}` })),
    [vehiclesQuery.data],
  );

  const submit = async () => {
    try {
      const placaToSave = placa === NONE_VALUE ? "" : placa;
      await save.mutateAsync({ source, external_id: externalId, placa: placaToSave });
      toast.success(placaToSave ? "Placa vinculada ao custo" : "Vínculo de placa removido");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular placa ao custo</DialogTitle>
          <DialogDescription>
            {description ? description : "Selecione a placa do veículo da frota. Use 'Remover vínculo' para desfazer."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Placa</Label>
          <SearchableSelect
            value={placa}
            onValueChange={setPlaca}
            placeholder={vehiclesQuery.isLoading ? "Carregando frota..." : "Selecione o veículo"}
            searchPlaceholder="Buscar placa ou modelo..."
            options={[{ value: NONE_VALUE, label: "— Remover vínculo —" }, ...options]}
          />
          <p className="text-xs text-muted-foreground">
            Fonte: <span className="font-mono">{source}</span> · ID: <span className="font-mono">{externalId.slice(0, 8)}…</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending || vehiclesQuery.isLoading}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
