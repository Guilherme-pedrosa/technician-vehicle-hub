import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklist: { id: string; vehicle_id: string; resultado: string };
  vehiclePlaca?: string;
  mode: "liberar" | "rebloquear";
  onDone?: () => void;
}

export function LiberarBloqueioDialog({ open, onOpenChange, checklist, vehiclePlaca, mode, onDone }: Props) {
  const { user, profile } = useAuth();
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const isLiberar = mode === "liberar";
  const newResultado = isLiberar ? "liberado_obs" : "bloqueado";
  const action = isLiberar ? "liberacao" : "rebloqueio";

  async function handleConfirm() {
    if (motivo.trim().length < 5) {
      toast.error("Justificativa precisa ter ao menos 5 caracteres");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      const { error: updateErr } = await supabase
        .from("vehicle_checklists")
        .update({ resultado: newResultado, resultado_motivo: motivo.trim() })
        .eq("id", checklist.id);
      if (updateErr) throw updateErr;

      const { error: logErr } = await supabase.from("checklist_release_log").insert({
        checklist_id: checklist.id,
        vehicle_id: checklist.vehicle_id,
        action,
        previous_resultado: checklist.resultado,
        new_resultado: newResultado,
        motivo: motivo.trim(),
        created_by: user.id,
        created_by_name: profile?.full_name ?? user.email ?? null,
      });
      if (logErr) throw logErr;

      toast.success(isLiberar ? "Veículo liberado com sucesso" : "Veículo re-bloqueado");
      setMotivo("");
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Falha ao registrar ação");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isLiberar ? <ShieldCheck className="w-5 h-5 text-success" /> : <ShieldAlert className="w-5 h-5 text-destructive" />}
            {isLiberar ? "Liberar veículo bloqueado" : "Re-bloquear veículo"}
          </DialogTitle>
          <DialogDescription>
            {vehiclePlaca && <span className="font-medium">{vehiclePlaca} — </span>}
            {isLiberar
              ? "Esta ação altera o resultado para 'Liberado c/ observação' e fica registrada no histórico."
              : "Esta ação reverte para 'Bloqueado' e fica registrada no histórico."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo">Justificativa <span className="text-destructive">*</span></Label>
          <Textarea
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={isLiberar ? "Ex: Item corrigido em oficina, autorizado pelo gestor..." : "Ex: Liberação indevida, item não foi corrigido..."}
            rows={4}
            disabled={saving}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button
            variant={isLiberar ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={saving || motivo.trim().length < 5}
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isLiberar ? "Confirmar liberação" : "Confirmar re-bloqueio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
