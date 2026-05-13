import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useSaveManualReconciliation } from "@/hooks/useManualReconciliations";
import { Link2, Search } from "lucide-react";
import type { MergedCusto } from "@/lib/merge-custos";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Lançamento de origem (não casado) */
  source: MergedCusto;
  /** Lista mesclada completa para extrair candidatos do lado oposto */
  merged: MergedCusto[];
};

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso?: string) {
  if (!iso) return "—";
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso.slice(0, 10);
}

function normalizePlaca(p?: string | null) {
  return (p ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function ManualReconcilePickerDialog({ open, onOpenChange, source, merged }: Props) {
  const oppositeSource: "rotaexata" | "auvo" = source.source === "rotaexata" ? "auvo" : "rotaexata";
  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const save = useSaveManualReconciliation();

  const candidates = useMemo(() => {
    const srcDate = source.dt_lancamento ? new Date(source.dt_lancamento).getTime() : 0;
    const srcPlaca = normalizePlaca(source.placa);
    const list = merged
      .filter(
        (c) =>
          c.source === oppositeSource &&
          !c.matched_with &&
          !c.manual_reconciliation,
      )
      .map((c) => {
        const dt = c.dt_lancamento ? new Date(c.dt_lancamento).getTime() : 0;
        const dDays = srcDate && dt ? Math.abs(dt - srcDate) / 86400000 : 999;
        const dValor = Math.abs((c.valor ?? 0) - (source.valor ?? 0));
        const samePlaca = srcPlaca && normalizePlaca(c.placa) === srcPlaca;
        return { c, dDays, dValor, samePlaca };
      })
      .filter(({ c }) => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        return (
          (c.placa ?? "").toLowerCase().includes(s) ||
          (c.descricao ?? "").toLowerCase().includes(s) ||
          (c.criado_por_nome ?? "").toLowerCase().includes(s) ||
          String(c.valor ?? "").includes(s)
        );
      })
      .sort((a, b) => {
        // mesma placa primeiro, depois menor diferença de valor, depois mais perto na data
        if (a.samePlaca !== b.samePlaca) return a.samePlaca ? -1 : 1;
        if (a.dValor !== b.dValor) return a.dValor - b.dValor;
        return a.dDays - b.dDays;
      })
      .slice(0, 50);
    return list;
  }, [merged, oppositeSource, source, search]);

  const picked = candidates.find((x) => x.c.external_id === pickedId)?.c;

  const handleSave = async () => {
    if (!picked) {
      toast.error("Selecione um lançamento para conciliar");
      return;
    }
    if (!motivo.trim()) {
      toast.error("Informe o motivo da conciliação");
      return;
    }
    const rotaId = source.source === "rotaexata" ? source.external_id : picked.external_id;
    const auvoId = source.source === "auvo" ? source.external_id : picked.external_id;
    try {
      await save.mutateAsync({ rota_external_id: rotaId, auvo_external_id: auvoId, motivo });
      toast.success("Conciliação manual registrada");
      onOpenChange(false);
      setPickedId(null);
      setMotivo("");
      setSearch("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Conciliar manualmente
          </DialogTitle>
          <DialogDescription>
            Selecione o lançamento {oppositeSource === "auvo" ? "do Auvo" : "do Ticket Log"} que corresponde a este registro.{" "}
            <strong>O valor consolidado será sempre o do Ticket Log.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border p-3 text-sm bg-muted/30">
            <div className="text-xs text-muted-foreground">
              {source.source === "rotaexata" ? "Ticket Log" : "Auvo"} · {fmtDate(source.dt_lancamento)} · {source.placa ?? "sem placa"}
            </div>
            <div className="font-semibold">{fmtBRL(source.valor ?? 0)}</div>
            {source.criado_por_nome && <div className="text-xs">{source.criado_por_nome}</div>}
            {source.descricao && <div className="text-xs text-muted-foreground line-clamp-2">{source.descricao}</div>}
          </div>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por placa, valor, descrição ou pessoa..."
              className="pl-8"
            />
          </div>

          <ScrollArea className="h-64 rounded-md border">
            <div className="divide-y">
              {candidates.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Nenhum lançamento {oppositeSource === "auvo" ? "do Auvo" : "do Ticket Log"} disponível para conciliar.
                </div>
              )}
              {candidates.map(({ c, dValor, dDays, samePlaca }) => {
                const isPicked = c.external_id === pickedId;
                return (
                  <button
                    type="button"
                    key={c.external_id}
                    onClick={() => setPickedId(c.external_id)}
                    className={`w-full text-left p-2.5 text-sm transition-colors ${isPicked ? "bg-emerald-50 ring-1 ring-emerald-400" : "hover:bg-muted/50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col leading-tight">
                        <span className="font-medium">
                          {fmtBRL(c.valor ?? 0)}
                          {dValor > 0.001 && (
                            <span className="ml-2 text-xs text-amber-700">
                              (Δ {fmtBRL(dValor)})
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fmtDate(c.dt_lancamento)} · {c.placa ?? "sem placa"}
                          {samePlaca && <span className="ml-1 text-emerald-700">· mesma placa</span>}
                          {!samePlaca && dDays < 999 && <span className="ml-1">· {Math.round(dDays)}d</span>}
                        </span>
                        {c.criado_por_nome && <span className="text-xs">{c.criado_por_nome}</span>}
                        {c.descricao && (
                          <span className="text-xs text-muted-foreground line-clamp-1">{c.descricao}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          <div className="space-y-1.5">
            <Label htmlFor="motivo-picker">Motivo da conciliação manual *</Label>
            <Textarea
              id="motivo-picker"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: diferença de centavos por arredondamento, mesma transação."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={save.isPending || !picked || !motivo.trim()}>
            Conciliar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
