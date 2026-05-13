import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useSaveManualReconciliation, useDeleteManualReconciliation } from "@/hooks/useManualReconciliations";
import { Link2, Trash2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rotaExternalId: string;
  auvoExternalId: string;
  rotaInfo: { valor: number; descricao?: string; data?: string; criado_por?: string };
  auvoInfo: { valor: number; descricao?: string; data?: string; criado_por?: string };
  existingId?: string;
  existingMotivo?: string;
};

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ManualReconciliationDialog({
  open, onOpenChange,
  rotaExternalId, auvoExternalId,
  rotaInfo, auvoInfo,
  existingId, existingMotivo,
}: Props) {
  const [motivo, setMotivo] = useState(existingMotivo ?? "");
  const save = useSaveManualReconciliation();
  const del = useDeleteManualReconciliation();
  const diff = rotaInfo.valor - auvoInfo.valor;

  const handleSave = async () => {
    if (!motivo.trim()) { toast.error("Informe o motivo da conciliação"); return; }
    try {
      await save.mutateAsync({ rota_external_id: rotaExternalId, auvo_external_id: auvoExternalId, motivo });
      toast.success("Conciliação manual registrada");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  };

  const handleDelete = async () => {
    if (!existingId) return;
    try {
      await del.mutateAsync(existingId);
      toast.success("Conciliação removida");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Conciliar manualmente
          </DialogTitle>
          <DialogDescription>
            Amarra um lançamento do Ticket Log a um comprovante do Auvo.
            <strong> O valor consolidado será sempre o do Ticket Log.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Ticket Log</div>
            <div className="font-semibold">{fmtBRL(rotaInfo.valor)}</div>
            {rotaInfo.criado_por && <div className="text-xs">{rotaInfo.criado_por}</div>}
            {rotaInfo.descricao && <div className="text-xs text-muted-foreground line-clamp-2">{rotaInfo.descricao}</div>}
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Auvo (comprovante)</div>
            <div className="font-semibold">{fmtBRL(auvoInfo.valor)}</div>
            {auvoInfo.criado_por && <div className="text-xs">{auvoInfo.criado_por}</div>}
            {auvoInfo.descricao && <div className="text-xs text-muted-foreground line-clamp-2">{auvoInfo.descricao}</div>}
          </div>
          {Math.abs(diff) > 0.001 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Diferença: <strong>{fmtBRL(diff)}</strong> ({diff > 0 ? "Ticket maior" : "Auvo maior"}).
              O sistema consolidará pelo valor do Ticket.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="motivo">Motivo da conciliação manual *</Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: comprovante lançado com valor errado pelo técnico, mas é a mesma transação."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {existingId && (
              <Button variant="outline" size="sm" onClick={handleDelete} disabled={del.isPending}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover conciliação
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={save.isPending || !motivo.trim()}>
              {existingId ? "Atualizar" : "Conciliar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
