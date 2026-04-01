import { useMemo, useState } from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DollarSign, Fuel, Car, FileText, Download, CalendarIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useCustosFlota, type CustoRotaExata } from "@/hooks/useCustosFlota";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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

  const { start, end } = getDateRange(period, customStart, customEnd);

  // Build where clause
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

  const { data: custos = [], isLoading } = useCustosFlota(where);

  // Filter by placa client-side (placa comes from API directly)
  const filteredCustos = useMemo(() => {
    if (placaFilter === "todos") return custos;
    return custos.filter((c) => c.placa === placaFilter);
  }, [custos, placaFilter]);

  // Summary cards
  const summary = useMemo(() => {
    const total = filteredCustos.reduce((s, c) => s + (c.valor || 0), 0);
    const combustivel = filteredCustos
      .filter((c) => c.tipo_custo_nome?.toLowerCase().includes("combust"))
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

  // Unique placas for filter
  const placas = useMemo(() => {
    const set = new Set<string>();
    vehicles.forEach((v) => {
      if (v.placa) set.add(v.placa);
    });
    return Array.from(set).sort();
  }, [vehicles]);

  // CSV export
  const exportCSV = () => {
    const headers = ["Data", "Placa", "Tipo", "Descrição", "Valor", "Parcelado"];
    const rows = filteredCustos.map((c) => [
      c.dt_lancamento ? format(new Date(c.dt_lancamento), "dd/MM/yyyy") : "",
      placaMap.get(String(c.adesao_id)) ?? `ID ${c.adesao_id}`,
      c.tipo_custo_nome ?? "",
      c.descricao ?? "",
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
        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
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

      {/* Table */}
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
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-center">Parcelado</TableHead>
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
                      <TableCell className="font-medium text-sm">
                        {placaMap.get(String(custo.adesao_id)) ?? `ID ${custo.adesao_id}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {custo.tipo_custo_nome ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {custo.descricao ?? "—"}
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
