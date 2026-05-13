import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveCostPlacaOverride } from "@/hooks/useCostPlacaOverrides";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: "rotaexata" | "auvo";
  externalId: string;
  currentPlaca?: string;
  description?: string;
}

export function EditPlacaDialog({ open, onOpenChange, source, externalId, currentPlaca, description }: Props) {
  const [placa, setPlaca] = useState("");
  const save = useSaveCostPlacaOverride();

  useEffect(() => {
    if (open) setPlaca(currentPlaca ?? "");
  }, [open, currentPlaca]);

  const submit = async () => {
    try {
      await save.mutateAsync({ source, external_id: externalId, placa });
      toast.success(placa ? "Placa vinculada ao custo" : "Vínculo de placa removido");
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
            {description ? description : "Informe a placa do veículo. Deixe em branco para remover o vínculo manual."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="placa-override">Placa</Label>
          <Input
            id="placa-override"
            value={placa}
            onChange={(e) => setPlaca(e.target.value.toUpperCase())}
            placeholder="Ex: ABC1D23"
            maxLength={8}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Fonte: <span className="font-mono">{source}</span> · ID: <span className="font-mono">{externalId.slice(0, 8)}…</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
