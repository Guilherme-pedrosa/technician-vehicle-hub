import { useMemo, useState } from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DollarSign, Fuel, Car, FileText, Download, CalendarIcon, RefreshCw, Paperclip, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useCustosFlota, type CustoRotaExata } from "@/hooks/useCustosFlota";
import { useAuvoExpenses, syncAuvoExpenses, type AuvoCusto } from "@/hooks/useAuvoExpenses";
import { useCustosPorVeiculo } from "@/hooks/useCustosPorVeiculo";
import { CustosPorVeiculoTable } from "@/components/custos/CustosPorVeiculoTable";
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

export default function CustosFlota() {
  const [period, setPeriod] = useState<PeriodFilter>("mes");
  const [tipoCusto, setTipoCusto] = useState("todos");
  const [placaFilter, setPlacaFilter] = useState("todos");
  const [customStart, setCustomStart] = useState<Date>();
  const [customEnd, setCustomEnd] = useState<Date>();
  const [source, setSource] = useState<DataSource>("todos");
  const [syncing, setSyncing] = useState(false);

  const { start, end } = getDateRange(period, customStart, customEnd);

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

  const custos: (CustoRotaExata | AuvoCusto)[] = useMemo(() => {
    if (source === "auvo") return auvoQuery.data ?? [];
    if (source === "rotaexata") return rotaQuery.data ?? [];
    // todos: combina as duas fontes
    return [...(rotaQuery.data ?? []), ...(auvoQuery.data ?? [])];
  }, [source, auvoQuery.data, rotaQuery.data]);

  const isLoading =
    source === "auvo"
      ? auvoQuery.isLoading
      : source === "rotaexata"
      ? rotaQuery.isLoading
      : auvoQuery.isLoading || rotaQuery.isLoading;

  // Filter by placa + tipo client-side (Auvo doesn't filter at API level)
  const filteredCustos = useMemo(() => {
    let list = custos;
    if (source !== "rotaexata" && tipoCusto !== "todos") {
      list = list.filter((c) => c.tipo_custo_nome === tipoCusto);
    }
    if (placaFilter !== "todos") {
      list = list.filter((c) => c.placa === placaFilter);
    }
    return list;
  }, [custos, placaFilter, tipoCusto, source]);

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
      toast.success(
        `Sync Auvo (${label}): ${r.fetched} despesas — ${r.matched} vinculadas, ${r.unmatched} sem placa`,
      );
      auvoQuery.refetch();
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
    const tipos = new Set(custos.map((c) => c.tipo_custo_nome).filter(Boolean));
    return Array.from(tipos).sort();
  }, [custos]);

  // Unique placas for filter (from API data)
  const placas = useMemo(() => {
    const set = new Set<string>();
    custos.forEach((c) => {
      if (c.placa) set.add(c.placa);
    });
    return Array.from(set).sort();
  }, [custos]);

  // CSV export
  const exportCSV = () => {
    const headers = ["Data", "Criado em", "Placa", "Descrição", "Hodômetro", "Tipo", "Fornecedor", "Criado por", "Valor", "Parcelado"];
    const rows = filteredCustos.map((c) => [
      c.dt_lancamento ? format(new Date(c.dt_lancamento), "dd/MM/yyyy") : "",
      c.dt_criacao ? format(new Date(c.dt_criacao), "dd/MM/yyyy") : "",
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
          {source === "auvo" && (
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
          )}
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
                    <TableHead>Data Lançamento</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead>Placa</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Hodômetro</TableHead>
                    <TableHead>Tipo de Custo</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Criado por</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-center">Parcelado</TableHead>
                    {source === "auvo" && <TableHead className="text-center">Anexo</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustos.map((custo) => (
                    <TableRow key={custo.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {custo.dt_lancamento
                          ? format(new Date(custo.dt_lancamento), "dd/MM/yyyy")
                          : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {custo.dt_criacao
                          ? format(new Date(custo.dt_criacao), "dd/MM/yyyy")
                          : "—"}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {custo.placa ? (
                          custo.placa
                        ) : source === "auvo" ? (
                          <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-300">
                            <AlertCircle className="h-3 w-3" /> Sem placa
                          </Badge>
                        ) : (
                          `ID ${custo.adesao_id}`
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {custo.descricao ?? custo.veiculo_descricao ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {custo.hodometro ? custo.hodometro.toLocaleString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {custo.tipo_custo_nome ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {custo.fornecedor_nome ?? "Não informado"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {custo.criado_por_nome ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {formatCurrency(custo.valor ?? 0)}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {custo.parcelado ? (
                          <Badge variant="outline" className="text-xs">
                            {custo.quantidade_parcelas ? `${custo.quantidade_parcelas}x` : "Sim"}
                          </Badge>
                        ) : (
                          "Não"
                        )}
                      </TableCell>
                      {source === "auvo" && (
                        <TableCell className="text-center">
                          {(custo as AuvoCusto).attachment_url ? (
                            <a
                              href={(custo as AuvoCusto).attachment_url ?? "#"}
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
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
