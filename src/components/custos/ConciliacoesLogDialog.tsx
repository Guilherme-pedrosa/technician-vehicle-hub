import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link2, Download, Paperclip } from "lucide-react";
import type { MergedCusto } from "@/lib/merge-custos";
import type { CustoRotaExata } from "@/hooks/useCustosFlota";
import type { AuvoCusto } from "@/hooks/useAuvoExpenses";

function formatBR(iso?: string) {
  if (!iso) return "—";
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function formatCurrency(v?: number) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Side = {
  id: string;
  data?: string;
  valor: number;
  descricao?: string;
  responsavel?: string;
  hodometro?: number;
  litros?: number;
  tipo?: string;
  fornecedor?: string;
  attachment_url?: string | null;
  inRange: boolean;
};

type Row = {
  key: string;
  tipo: "auto" | "manual";
  placa: string;
  motivo?: string;
  ticket?: Side;
  auvo?: Side;
};

function toTicketSide(r: CustoRotaExata | undefined, inRange: boolean): Side | undefined {
  if (!r) return undefined;
  return {
    id: r.id,
    data: r.dt_lancamento,
    valor: Number(r.valor) || 0,
    descricao: r.descricao ?? r.veiculo_descricao,
    responsavel: r.criado_por_nome,
    hodometro: r.hodometro,
    litros: r.litros,
    tipo: r.tipo_custo_nome,
    fornecedor: r.fornecedor_nome,
    attachment_url: null,
    inRange,
  };
}

function toAuvoSide(a: AuvoCusto | undefined, inRange: boolean): Side | undefined {
  if (!a) return undefined;
  return {
    id: a.id,
    data: a.dt_lancamento,
    valor: Number(a.valor) || 0,
    descricao: a.descricao ?? a.veiculo_descricao,
    responsavel: a.criado_por_nome,
    hodometro: a.hodometro,
    litros: a.litros,
    tipo: a.tipo_custo_nome,
    fornecedor: a.fornecedor_nome,
    attachment_url: a.attachment_url ?? null,
    inRange,
  };
}

function SideCell({ side }: { side?: Side }) {
  if (!side) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5 text-xs leading-tight">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{formatBR(side.data)}</span>
        <span className="tabular-nums font-semibold">{formatCurrency(side.valor)}</span>
        {!side.inRange && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-400 text-amber-700">
            fora do filtro
          </Badge>
        )}
        {side.attachment_url && (
          <a href={side.attachment_url} target="_blank" rel="noreferrer" className="text-primary">
            <Paperclip className="h-3 w-3" />
          </a>
        )}
      </div>
      {side.responsavel && (
        <span><span className="text-muted-foreground">Resp:</span> {side.responsavel}</span>
      )}
      {side.descricao && (
        <span className="text-muted-foreground truncate max-w-[280px]" title={side.descricao}>
          {side.descricao}
        </span>
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-0 text-muted-foreground">
        {side.tipo && <span>{side.tipo}</span>}
        {side.hodometro ? <span>Hod: {side.hodometro.toLocaleString("pt-BR")}</span> : null}
        {side.litros ? <span>{side.litros.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} L</span> : null}
        {side.fornecedor && <span>{side.fornecedor}</span>}
      </div>
      <span className="text-[10px] text-muted-foreground/70">ID: {side.id}</span>
    </div>
  );
}

export function ConciliacoesLogDialog({
  open,
  onOpenChange,
  custos,
  rotaAll,
  auvoAll,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  custos: MergedCusto[];
  rotaAll: CustoRotaExata[];
  auvoAll: AuvoCusto[];
}) {
  const rows: Row[] = useMemo(() => {
    const rotaById = new Map(rotaAll.map((r) => [r.id, r] as const));
    const auvoById = new Map(auvoAll.map((a) => [a.id, a] as const));
    const inRangeIds = new Set(custos.map((c) => `${c.source}:${c.external_id}`));

    const out: Row[] = [];
    for (const c of custos) {
      if (c.manual_reconciliation) {
        const rotaIsThis = c.source === "rotaexata";
        const rotaId = rotaIsThis ? c.external_id : c.manual_reconciliation.other_external_id;
        const auvoId = rotaIsThis ? c.manual_reconciliation.other_external_id : c.external_id;
        const r = rotaById.get(rotaId);
        const a = auvoById.get(auvoId);
        out.push({
          key: `m:${c.source}:${c.external_id}`,
          tipo: "manual",
          placa: c.placa ?? r?.placa ?? a?.placa ?? "—",
          motivo: c.manual_reconciliation.motivo,
          ticket: toTicketSide(r, inRangeIds.has(`rotaexata:${rotaId}`)),
          auvo: toAuvoSide(a, inRangeIds.has(`auvo:${auvoId}`)),
        });
      } else if (c.matched_with && c.source === "rotaexata") {
        const r = rotaById.get(c.external_id);
        const a = auvoById.get(c.matched_with.id);
        out.push({
          key: `a:${c.external_id}`,
          tipo: "auto",
          placa: c.placa ?? "—",
          ticket: toTicketSide(r, true),
          auvo: toAuvoSide(a, inRangeIds.has(`auvo:${c.matched_with.id}`)),
        });
      }
    }
    return out.sort((x, y) => (y.ticket?.data ?? y.auvo?.data ?? "").localeCompare(x.ticket?.data ?? x.auvo?.data ?? ""));
  }, [custos, rotaAll, auvoAll]);

  const totals = useMemo(() => ({
    auto: rows.filter((r) => r.tipo === "auto").length,
    manual: rows.filter((r) => r.tipo === "manual").length,
  }), [rows]);

  const exportCSV = () => {
    const headers = [
      "Tipo", "Placa", "Motivo",
      "Ticket Data", "Ticket Valor", "Ticket Responsável", "Ticket Descrição", "Ticket Hodômetro", "Ticket Litros", "Ticket Fornecedor", "Ticket ID",
      "Auvo Data", "Auvo Valor", "Auvo Responsável", "Auvo Descrição", "Auvo Hodômetro", "Auvo Litros", "Auvo Fornecedor", "Auvo Anexo", "Auvo ID",
    ];
    const data = rows.map((r) => [
      r.tipo, r.placa, r.motivo ?? "",
      formatBR(r.ticket?.data), String(r.ticket?.valor ?? "").replace(".", ","),
      r.ticket?.responsavel ?? "", r.ticket?.descricao ?? "",
      r.ticket?.hodometro ?? "", r.ticket?.litros ?? "", r.ticket?.fornecedor ?? "", r.ticket?.id ?? "",
      formatBR(r.auvo?.data), String(r.auvo?.valor ?? "").replace(".", ","),
      r.auvo?.responsavel ?? "", r.auvo?.descricao ?? "",
      r.auvo?.hodometro ?? "", r.auvo?.litros ?? "", r.auvo?.fornecedor ?? "",
      r.auvo?.attachment_url ?? "", r.auvo?.id ?? "",
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
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
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
                  <TableHead className="w-[90px]">Tipo</TableHead>
                  <TableHead className="w-[90px]">Placa</TableHead>
                  <TableHead>Detalhes Ticket (Rota Exata)</TableHead>
                  <TableHead>Detalhes Auvo</TableHead>
                  <TableHead className="w-[180px]">Motivo / Δ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const diff = (r.ticket?.valor ?? 0) - (r.auvo?.valor ?? 0);
                  const hasDiff = Math.abs(diff) > 0.005;
                  return (
                    <TableRow key={r.key} className="align-top">
                      <TableCell className="pt-3">
                        {r.tipo === "auto" ? (
                          <Badge variant="secondary" className="text-[10px]">automática</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-emerald-400 bg-emerald-50 text-emerald-800">manual</Badge>
                        )}
                      </TableCell>
                      <TableCell className="pt-3 font-medium text-sm">{r.placa}</TableCell>
                      <TableCell className="pt-3"><SideCell side={r.ticket} /></TableCell>
                      <TableCell className="pt-3"><SideCell side={r.auvo} /></TableCell>
                      <TableCell className="pt-3 text-xs">
                        {r.motivo && (
                          <div className="text-muted-foreground mb-1">{r.motivo}</div>
                        )}
                        {hasDiff && (
                          <Badge variant="outline" className="text-[10px] border-amber-400 bg-amber-50 text-amber-800">
                            Δ {formatCurrency(Math.abs(diff))}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
