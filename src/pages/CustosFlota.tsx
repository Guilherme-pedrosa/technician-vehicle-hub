import { useMemo, useState } from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DollarSign, Fuel, Car, FileText, Download, CalendarIcon, RefreshCw, Paperclip, AlertCircle, Pencil, Link2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useCustosFlota } from "@/hooks/useCustosFlota";
import { useAuvoExpenses, syncAuvoExpenses } from "@/hooks/useAuvoExpenses";
import { useCustosPorVeiculo } from "@/hooks/useCustosPorVeiculo";
import { useCostPlacaOverrides } from "@/hooks/useCostPlacaOverrides";
import { useManualReconciliations } from "@/hooks/useManualReconciliations";
import { CustosPorVeiculoTable } from "@/components/custos/CustosPorVeiculoTable";
import { EditPlacaDialog } from "@/components/custos/EditPlacaDialog";
import { ManualReconciliationDialog } from "@/components/custos/ManualReconciliationDialog";
import { mergeCustos, type MergedCusto } from "@/lib/merge-custos";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type DataSource = "todos" | "auvo" | "rotaexata";

type PeriodFilter = "hoje" | "semana" | "mes" | "custom";

function getDateRange(period: PeriodFilter, customStart?: Date, customEnd?: Date) {
  const now = new Date();
  switch (period) {
    case "hoje":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "semana":
      return { start: startOfWeek(now, { locale: ptBR }), end: endOfWeek(now, { locale: ptBR }) };
    case "mes":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "custom":
      return {
        start: customStart ?? startOfMonth(now),
        end: customEnd ?? endOfMonth(now),
      };
  }
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Formata uma data ISO sem deslocar o dia por fuso horário.
// `new Date("2026-05-08")` é interpretado como UTC midnight, e em BRT (UTC-3)
// vira 07/05 21:00 — o que fazia o Rota mostrar a data um dia antes.
function formatDateBR(iso?: string): string {
  if (!iso) return "";
  const datePart = iso.slice(0, 10);
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // Fallback para formatos não-ISO
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "dd/MM/yyyy");
}

export default function CustosFlota() {
  const [period, setPeriod] = useState<PeriodFilter>("mes");
  const [tipoCusto, setTipoCusto] = useState("todos");
  const [placaFilter, setPlacaFilter] = useState("todos");
  const [customStart, setCustomStart] = useState<Date>();
  const [customEnd, setCustomEnd] = useState<Date>();
  const [source, setSource] = useState<DataSource>("todos");
  const [syncing, setSyncing] = useState(false);

  const { start, end: rawEnd } = getDateRange(period, customStart, customEnd);
  // Nunca consultar datas no futuro — clampa end ao fim do dia de hoje.
  const today = endOfDay(new Date());
  const end = rawEnd > today ? today : rawEnd;

  // Build where clause for Rota Exata
  const where = useMemo(() => {
    const filter: Record<string, unknown> = {
      dt_lancamento: {
        $gte: start.toISOString(),
        $lte: end.toISOString(),
      },
    };
    if (tipoCusto !== "todos") {
      filter.tipo_custo_nome = tipoCusto;
    }
    return JSON.stringify(filter);
  }, [start, end, tipoCusto]);

  const rotaQuery = useCustosFlota(source !== "auvo" ? where : undefined);
  const auvoQuery = useAuvoExpenses(start, end);

  const overridesQuery = useCostPlacaOverrides();
  const manualReconQuery = useManualReconciliations();

  // Mescla Rota+Auvo: mesma data+valor = uma transação só. Aplica overrides
  // de placa e conciliações manuais por cima.
  const merged: MergedCusto[] = useMemo(() => {
    const rota = source === "auvo" ? [] : (rotaQuery.data ?? []);
    const auvo = source === "rotaexata" ? [] : (auvoQuery.data ?? []);
    return mergeCustos(rota, auvo, overridesQuery.data ?? [], manualReconQuery.data ?? []);
  }, [source, rotaQuery.data, auvoQuery.data, overridesQuery.data, manualReconQuery.data]);

  const isLoading =
    source === "auvo"
      ? auvoQuery.isLoading
      : source === "rotaexata"
      ? rotaQuery.isLoading
      : auvoQuery.isLoading || rotaQuery.isLoading;

  // Filter by placa + tipo client-side (Auvo doesn't filter at API level)
  const filteredCustos = useMemo(() => {
    let list = merged;
    if (tipoCusto !== "todos") {
      list = list.filter((c) => c.tipo_custo_nome === tipoCusto);
    }
    if (placaFilter !== "todos") {
      list = list.filter((c) => c.placa === placaFilter);
    }
    return list;
  }, [merged, placaFilter, tipoCusto]);

  // Estado do diálogo de edição manual de placa
  const [editTarget, setEditTarget] = useState<MergedCusto | null>(null);
  // Estado do diálogo de conciliação manual (Ticket × Auvo)
  const [reconcileTarget, setReconcileTarget] = useState<{
    rotaId: string;
    auvoId: string;
    rotaInfo: { valor: number; descricao?: string; data?: string; criado_por?: string };
    auvoInfo: { valor: number; descricao?: string; data?: string; criado_por?: string };
    existingId?: string;
    existingMotivo?: string;
  } | null>(null);

  const openReconcileFromDivergence = (custo: MergedCusto) => {
    const div = custo.suspected_divergence;
    if (!div) return;
    const rotaIsThis = custo.source === "rotaexata";
    setReconcileTarget({
      rotaId: rotaIsThis ? custo.external_id : div.other_external_id,
      auvoId: rotaIsThis ? div.other_external_id : custo.external_id,
      rotaInfo: rotaIsThis
        ? { valor: custo.valor ?? 0, descricao: custo.descricao, data: custo.dt_lancamento, criado_por: custo.criado_por_nome }
        : { valor: div.other_valor, descricao: div.other_descricao, criado_por: div.other_criado_por },
      auvoInfo: rotaIsThis
        ? { valor: div.other_valor, descricao: div.other_descricao, criado_por: div.other_criado_por }
        : { valor: custo.valor ?? 0, descricao: custo.descricao, data: custo.dt_lancamento, criado_por: custo.criado_por_nome },
    });
  };

  const openReconcileFromManual = (custo: MergedCusto) => {
    const m = custo.manual_reconciliation;
    if (!m) return;
    const rotaIsThis = custo.source === "rotaexata";
    setReconcileTarget({
      rotaId: rotaIsThis ? custo.external_id : m.other_external_id,
      auvoId: rotaIsThis ? m.other_external_id : custo.external_id,
      rotaInfo: rotaIsThis
        ? { valor: custo.valor ?? 0, descricao: custo.descricao, criado_por: custo.criado_por_nome }
        : { valor: m.other_valor, descricao: m.other_descricao, criado_por: m.other_criado_por },
      auvoInfo: rotaIsThis
        ? { valor: m.other_valor, descricao: m.other_descricao, criado_por: m.other_criado_por }
        : { valor: custo.valor ?? 0, descricao: custo.descricao, criado_por: custo.criado_por_nome },
      existingId: m.id,
      existingMotivo: m.motivo,
    });
  };

  const [syncStart, setSyncStart] = useState<Date>();
  const [syncEnd, setSyncEnd] = useState<Date>();
  const [syncOpen, setSyncOpen] = useState(false);

  const runSync = async (s: Date, e: Date, label: string) => {
    setSyncing(true);
    setSyncOpen(false);
    try {
      const r = await syncAuvoExpenses(
        s.toISOString().slice(0, 10),
        e.toISOString().slice(0, 10),
      );
      await Promise.all([
        auvoQuery.refetch({ cancelRefetch: true }),
        rotaQuery.refetch({ cancelRefetch: true }),
        overridesQuery.refetch({ cancelRefetch: true }),
      ]);
      toast.success(
        `Sync Auvo (${label}): ${r.fetched} despesas — ${r.matched} vinculadas, ${r.unmatched} sem placa`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na sincronização");
    } finally {
      setSyncing(false);
    }
  };

  const syncPreset = (months: number) => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const e = endOfMonth(now);
    runSync(s, e, months === 1 ? "mês atual" : `últimos ${months}m`);
  };

  const syncCustom = () => {
    if (!syncStart || !syncEnd) {
      toast.error("Selecione data de início e fim");
      return;
    }
    runSync(syncStart, syncEnd, `${format(syncStart, "dd/MM/yy")}–${format(syncEnd, "dd/MM/yy")}`);
  };

  // Aggregate per vehicle (cost + KM + R$/km + km/L)
  const { rows: porVeiculo, isLoading: loadingPorVeiculo } = useCustosPorVeiculo(
    filteredCustos,
    start,
    end
  );

  // Summary cards
  const summary = useMemo(() => {
    const total = filteredCustos.reduce((s, c) => s + (c.valor || 0), 0);
    const combustivel = filteredCustos
      .filter((c) => {
        const n = c.tipo_custo_nome?.toLowerCase() ?? "";
        return (
          n.includes("combust") ||
          n.includes("abastec") ||
          n.includes("gasolin") ||
          n.includes("etanol") ||
          n.includes("diesel") ||
          n.includes("deslocamento")
        );
      })
      .reduce((s, c) => s + (c.valor || 0), 0);
    const uniqueVehicles = new Set(filteredCustos.map((c) => c.adesao_id)).size;
    const custoMedio = uniqueVehicles > 0 ? total / uniqueVehicles : 0;

    return { total, combustivel, custoMedio, registros: filteredCustos.length };
  }, [filteredCustos]);

  // Unique cost types for filter
  const tiposCusto = useMemo(() => {
    const tipos = new Set<string>();
    merged.forEach((c) => {
      if (c.tipo_custo_nome) tipos.add(c.tipo_custo_nome);
    });
    return Array.from(tipos).sort();
  }, [merged]);

  // Unique placas for filter (from API data)
  const placas = useMemo(() => {
    const set = new Set<string>();
    merged.forEach((c) => {
      if (c.placa) set.add(c.placa);
    });
    return Array.from(set).sort();
  }, [merged]);

  // CSV export
  const exportCSV = () => {
    const headers = ["Data", "Criado em", "Placa", "Descrição", "Hodômetro", "Tipo", "Fornecedor", "Criado por", "Valor", "Parcelado"];
    const rows = filteredCustos.map((c) => [
      formatDateBR(c.dt_lancamento),
      formatDateBR(c.dt_criacao),
      c.placa ?? `ID ${c.adesao_id}`,
      c.descricao ?? c.veiculo_descricao ?? "",
      String(c.hodometro ?? ""),
      c.tipo_custo_nome ?? "",
      c.fornecedor_nome ?? "Não informado",
      c.criado_por_nome ?? "",
      String(c.valor ?? 0).replace(".", ","),
      c.parcelado ? "Sim" : "Não",
    ]);

    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custos_frota_${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Custos da Frota</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe os custos operacionais de toda a frota
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={source} onValueChange={(v) => setSource(v as DataSource)}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as fontes</SelectItem>
              <SelectItem value="auvo">Auvo (despesas)</SelectItem>
              <SelectItem value="rotaexata">Rota Exata</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={syncing || rotaQuery.isFetching || auvoQuery.isFetching}
            onClick={async () => {
              try {
                const [rotaRes, auvoRes] = await Promise.all([
                  rotaQuery.refetch({ cancelRefetch: true }),
                  auvoQuery.refetch({ cancelRefetch: true }),
                  overridesQuery.refetch({ cancelRefetch: true }),
                ]);
                if (rotaRes.isError) {
                  toast.error("Falha ao atualizar Rota Exata");
                } else {
                  toast.success(`Atualizado · Rota: ${rotaRes.data?.length ?? 0} · Auvo: ${auvoRes.data?.length ?? 0}`);
                }
              } catch (e) {
                toast.error("Erro ao atualizar dados");
              }
            }}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", (rotaQuery.isFetching || auvoQuery.isFetching) && "animate-spin")} />
            Atualizar
          </Button>
          <Popover open={syncOpen} onOpenChange={setSyncOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={syncing} className="gap-2">
                  <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                  {syncing ? "Sincronizando…" : "Sincronizar Auvo"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-3" align="end">
                <div>
                  <p className="text-sm font-medium mb-2">Período rápido</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={() => syncPreset(1)}>Mês atual</Button>
                    <Button size="sm" variant="outline" onClick={() => syncPreset(3)}>Últimos 3 meses</Button>
                    <Button size="sm" variant="outline" onClick={() => syncPreset(6)}>Últimos 6 meses</Button>
                    <Button size="sm" variant="outline" onClick={() => syncPreset(12)}>Últimos 12 meses</Button>
                  </div>
                </div>
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-2">Período customizado</p>
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs">
                          <CalendarIcon className="h-3 w-3" />
                          {syncStart ? format(syncStart, "dd/MM/yy") : "Início"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={syncStart} onSelect={setSyncStart} locale={ptBR} />
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs">
                          <CalendarIcon className="h-3 w-3" />
                          {syncEnd ? format(syncEnd, "dd/MM/yy") : "Fim"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={syncEnd} onSelect={setSyncEnd} locale={ptBR} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Button size="sm" className="w-full mt-2" onClick={syncCustom}>
                    Sincronizar período
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Period */}
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hoje">Hoje</SelectItem>
            <SelectItem value="semana">Semana</SelectItem>
            <SelectItem value="mes">Mês</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>

        {period === "custom" && (
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4" />
                  {customStart ? format(customStart, "dd/MM/yyyy") : "Início"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customStart} onSelect={setCustomStart} locale={ptBR} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4" />
                  {customEnd ? format(customEnd, "dd/MM/yyyy") : "Fim"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} locale={ptBR} />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* Tipo */}
        <Select value={tipoCusto} onValueChange={setTipoCusto}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Tipo de custo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {tiposCusto.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Placa */}
        <Select value={placaFilter} onValueChange={setPlacaFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Placa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas placas</SelectItem>
            {placas.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Gasto</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(summary.total)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Fuel className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Combustível</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(summary.combustivel)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Car className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Custo/Veículo</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(summary.custoMedio)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Registros</p>
              <p className="text-lg font-bold text-foreground">{summary.registros}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-vehicle breakdown: ranking + detalhamento */}
      <CustosPorVeiculoTable rows={porVeiculo} isLoading={isLoading || loadingPorVeiculo} />

      {/* Tabela bruta de lançamentos */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Carregando custos...
            </div>
          ) : filteredCustos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <DollarSign className="mb-2 h-8 w-8 opacity-40" />
              <p>Nenhum custo encontrado no período</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Placa</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="text-right">Litros</TableHead>
                    <TableHead className="text-right">Hodômetro</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-center">Anexo</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustos.map((custo) => (
                    <TableRow key={`${custo.source}:${custo.external_id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateBR(custo.dt_lancamento) || "—"}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-1.5">
                          {custo.placa ? (
                            <span>{custo.placa}</span>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-300">
                              <AlertCircle className="h-3 w-3" /> Sem placa
                            </Badge>
                          )}
                          {custo.matched_with && !custo.manual_reconciliation && (
                            <Badge variant="secondary" className="gap-1 text-[10px]" title="Casado entre Ticket Log (Rota Exata) e Auvo — mesmo valor">
                              <Link2 className="h-3 w-3" /> match
                            </Badge>
                          )}
                          {custo.manual_reconciliation && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] border-emerald-400 bg-emerald-50 text-emerald-800"
                              title={`Conciliado manualmente. Motivo: ${custo.manual_reconciliation.motivo}. Valor consolidado pelo Ticket (R$ ${(custo.valor ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}); Auvo: R$ ${custo.manual_reconciliation.other_valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`}
                            >
                              <Link2 className="h-3 w-3" /> conciliado manual
                            </Badge>
                          )}
                          {!custo.matched_with && custo.source === "rotaexata" && (
                            <Badge variant="outline" className="gap-1 text-[10px] border-blue-300 text-blue-700" title="Esse lançamento existe no Ticket Log mas não foi encontrado comprovante correspondente no Auvo">
                              só no Ticket
                            </Badge>
                          )}
                          {!custo.matched_with && custo.source === "auvo" && (
                            <Badge variant="outline" className="gap-1 text-[10px] border-purple-300 text-purple-700" title="Comprovante lançado no Auvo, mas sem transação correspondente no Ticket Log">
                              só no Auvo
                            </Badge>
                          )}
                          {custo.suspected_divergence && (
                            <Badge
                              variant="outline"
                              className="gap-1 text-[10px] border-amber-400 bg-amber-50 text-amber-800"
                              title={`Possível divergência de valor: ${custo.source === "rotaexata" ? "Ticket" : "Auvo"} R$ ${(custo.valor ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} vs ${custo.suspected_divergence.other_source === "auvo" ? "Auvo" : "Ticket"} R$ ${custo.suspected_divergence.other_valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (diferença ${custo.suspected_divergence.diff > 0 ? "+" : ""}R$ ${custo.suspected_divergence.diff.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}). Mesma data e mesma pessoa — provável erro de digitação.`}
                            >
                              <AlertCircle className="h-3 w-3" /> divergência R$ {Math.abs(custo.suspected_divergence.diff).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </Badge>
                          )}
                          {custo.manual_placa && (
                            <Badge variant="outline" className="text-[10px]" title="Placa definida manualmente">manual</Badge>
                          )}

                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                        {custo.descricao ?? custo.veiculo_descricao ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {(() => {
                          const nome = custo.criado_por_nome?.trim();
                          const outro = custo.suspected_divergence?.other_criado_por?.trim();
                          const fonteAtual = custo.source === "rotaexata" ? "Ticket" : "Auvo";
                          const fonteOutra = custo.suspected_divergence?.other_source === "rotaexata" ? "Ticket" : "Auvo";
                          if (!nome && !outro) return <span className="text-muted-foreground">—</span>;
                          return (
                            <div className="flex flex-col leading-tight">
                              <span className="text-xs">
                                <span className="text-muted-foreground">{fonteAtual}:</span> {nome ?? "—"}
                              </span>
                              {outro && (
                                <span className="text-xs">
                                  <span className="text-muted-foreground">{fonteOutra}:</span> {outro}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {custo.litros && custo.litros > 0
                          ? `${custo.litros.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {custo.hodometro ? custo.hodometro.toLocaleString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {custo.tipo_custo_nome ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {custo.fornecedor_nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {formatCurrency(custo.valor ?? 0)}
                      </TableCell>
                      <TableCell className="text-center">
                        {custo.attachment_url ? (
                          <a
                            href={custo.attachment_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center text-primary hover:underline"
                          >
                            <Paperclip className="h-4 w-4" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {custo.suspected_divergence && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-emerald-700 hover:text-emerald-800"
                              onClick={() => openReconcileFromDivergence(custo)}
                              title="Conciliar manualmente este lançamento com o sugerido"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {custo.manual_reconciliation && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-emerald-700"
                              onClick={() => openReconcileFromManual(custo)}
                              title="Editar conciliação manual"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setEditTarget(custo)}
                            title="Editar placa do custo"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editTarget && (
        <EditPlacaDialog
          open={!!editTarget}
          onOpenChange={(o) => { if (!o) setEditTarget(null); }}
          source={editTarget.source}
          externalId={editTarget.external_id}
          currentPlaca={editTarget.placa}
          description={`Lançamento de ${formatDateBR(editTarget.dt_lancamento) || "—"} · ${formatCurrency(editTarget.valor ?? 0)}`}
        />
      )}
      {reconcileTarget && (
        <ManualReconciliationDialog
          open={!!reconcileTarget}
          onOpenChange={(o) => { if (!o) setReconcileTarget(null); }}
          rotaExternalId={reconcileTarget.rotaId}
          auvoExternalId={reconcileTarget.auvoId}
          rotaInfo={reconcileTarget.rotaInfo}
          auvoInfo={reconcileTarget.auvoInfo}
          existingId={reconcileTarget.existingId}
          existingMotivo={reconcileTarget.existingMotivo}
        />
      )}
    </div>
  );
}
