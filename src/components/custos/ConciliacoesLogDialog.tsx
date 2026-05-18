import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link2, Download } from "lucide-react";
import type { MergedCusto } from "@/lib/merge-custos";

function formatBR(iso?: string) {
  if (!iso) return "—";
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function formatCurrency(v?: number) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Row = {
  key: string;
  tipo: "auto" | "manual";
  data: string;
  placa: string;
  valor: number;
  outroValor?: number;
  descricao: string;
  responsavel: string;
  ticketId: string;
  auvoId: string;
  motivo?: string;
};

export function ConciliacoesLogDialog({
  open,
  onOpenChange,
  custos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  custos: MergedCusto[];
}) {
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const c of custos) {
      if (c.manual_reconciliation) {
        const rotaIsThis = c.source === "rotaexata";
        out.push({
          key: `m:${c.source}:${c.external_id}`,
          tipo: "manual",
          data: c.dt_lancamento ?? "",
          placa: c.placa ?? "—",
          valor: c.valor ?? 0,
          outroValor: c.manual_reconciliation.other_valor,
          descricao: c.descricao ?? c.veiculo_descricao ?? "—",
          responsavel: c.criado_por_nome ?? "—",
          ticketId: rotaIsThis ? c.external_id : c.manual_reconciliation.other_external_id,
          auvoId: rotaIsThis ? c.manual_reconciliation.other_external_id : c.external_id,
          motivo: c.manual_reconciliation.motivo,
        });
      } else if (c.matched_with && c.source === "rotaexata") {
        // só conta uma vez (do lado Rota) para não duplicar
        out.push({
          key: `a:${c.external_id}`,
          tipo: "auto",
          data: c.dt_lancamento ?? "",
          placa: c.placa ?? "—",
          valor: c.valor ?? 0,
          outroValor: c.matched_with.valor,
          descricao: c.descricao ?? c.veiculo_descricao ?? "—",
          responsavel: c.criado_por_nome ?? "—",
          ticketId: c.external_id,
          auvoId: c.matched_with.id,
        });
      }
    }
    return out.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
  }, [custos]);

  const totals = useMemo(() => {
    const auto = rows.filter((r) => r.tipo === "auto").length;
    const manual = rows.filter((r) => r.tipo === "manual").length;
    return { auto, manual };
  }, [rows]);

  const exportCSV = () => {
    const headers = ["Tipo", "Data", "Placa", "Valor Ticket", "Valor Auvo", "Descrição", "Responsável", "Ticket ID", "Auvo ID", "Motivo"];
    const data = rows.map((r) => [
      r.tipo,
      formatBR(r.data),
      r.placa,
      String(r.valor).replace(".", ","),
      String(r.outroValor ?? 0).replace(".", ","),
      r.descricao,
      r.responsavel,
      r.ticketId,
      r.auvoId,
      r.motivo ?? "",
    ]);
    const csv = [headers, ...data].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `log_conciliacoes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Log de Conciliações
          </DialogTitle>
          <DialogDescription>
            Transações conciliadas no período filtrado · {totals.auto} automáticas · {totals.manual} manuais
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2" disabled={rows.length === 0}>
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </div>

        <div className="flex-1 overflow-auto border rounded-md">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma conciliação no período filtrado.
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead className="text-right">Ticket</TableHead>
                  <TableHead className="text-right">Auvo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>
                      {r.tipo === "auto" ? (
                        <Badge variant="secondary" className="text-[10px]">automática</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-emerald-400 bg-emerald-50 text-emerald-800">manual</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatBR(r.data)}</TableCell>
                    <TableCell className="font-medium text-sm">{r.placa}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatCurrency(r.valor)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatCurrency(r.outroValor ?? 0)}
                      {r.tipo === "manual" && Math.abs((r.valor ?? 0) - (r.outroValor ?? 0)) > 0.005 && (
                        <div className="text-[10px] text-amber-700">Δ {formatCurrency(Math.abs((r.valor ?? 0) - (r.outroValor ?? 0)))}</div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={r.descricao}>
                      {r.descricao}
                    </TableCell>
                    <TableCell className="text-xs">{r.responsavel}</TableCell>
                    <TableCell className="max-w-[200px] text-xs text-muted-foreground" title={r.motivo}>
                      {r.motivo ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
