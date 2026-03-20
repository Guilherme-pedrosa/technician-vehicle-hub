import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, startOfWeek, startOfMonth, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { BarChart3, CalendarIcon, Clock3, Gauge, Loader2, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRelatorioKmRodado } from "@/services/rotaexata";
import { useUltimaPosicaoTodos, type RotaExataPosicao } from "@/hooks/useRotaExata";

type PeriodPreset = "hoje" | "semana" | "mes" | "personalizado";

function getPresetDates(preset: PeriodPreset) {
  const now = new Date();
  switch (preset) {
    case "hoje": return { inicio: startOfDay(now), fim: now };
    case "semana": return { inicio: startOfWeek(now, { weekStartsOn: 1, locale: ptBR }), fim: now };
    case "mes": return { inicio: startOfMonth(now), fim: now };
    default: return { inicio: subDays(now, 7), fim: now };
  }
}

function extractKm(payload: unknown): number {
  if (typeof payload === "number") return Number.isFinite(payload) ? payload : 0;
  if (typeof payload === "string") {
    const n = Number(payload.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (Array.isArray(payload)) return payload.reduce<number>((s, i) => s + extractKm(i), 0);
  if (payload && typeof payload === "object") {
    const r = payload as Record<string, unknown>;
    for (const k of ["km", "km_rodado", "kmRodado", "distancia", "distancia_total", "total_km", "quilometragem"]) {
      if (r[k] !== undefined) return extractKm(r[k]);
    }
    if ("data" in r) return extractKm(r.data);
  }
  return 0;
}

export default function Relatorios() {
  const [preset, setPreset] = useState<PeriodPreset>("hoje");
  const [customInicio, setCustomInicio] = useState<Date>();
  const [customFim, setCustomFim] = useState<Date>();
  const [driverFilter, setDriverFilter] = useState<string>("todos");

  const dates = useMemo(() => {
    if (preset === "personalizado" && customInicio && customFim) {
      return { inicio: customInicio, fim: customFim };
    }
    return getPresetDates(preset);
  }, [preset, customInicio, customFim]);

  const dataInicio = format(dates.inicio, "yyyy-MM-dd");
  const dataFim = format(dates.fim, "yyyy-MM-dd");

  // Vehicles
  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-relatorios"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, placa, marca, modelo, adesao_id, km_atual").order("placa");
      if (error) throw error;
      return data;
    },
  });

  // Drivers
  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-relatorios"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, full_name, status").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Active assignments
  const { data: assignments = [] } = useQuery({
    queryKey: ["assignments-relatorios"],
    queryFn: async () => {
      const { data, error } = await supabase.from("driver_vehicle_assignments").select("driver_id, vehicle_id, returned_at").is("returned_at", null);
      if (error) throw error;
      return data;
    },
  });

  // Positions
  const { data: posicoes } = useUltimaPosicaoTodos();
  const posMap = useMemo(() => {
    const m = new Map<string, RotaExataPosicao>();
    (posicoes ?? []).forEach(p => { if (p.adesao_id) m.set(String(p.adesao_id), p); });
    return m;
  }, [posicoes]);

  // Build driver -> vehicles map
  const driverVehicleMap = useMemo(() => {
    const m = new Map<string, string[]>();
    assignments.forEach(a => {
      const list = m.get(a.driver_id) ?? [];
      list.push(a.vehicle_id);
      m.set(a.driver_id, list);
    });
    return m;
  }, [assignments]);

  const vehicleDriverMap = useMemo(() => {
    const m = new Map<string, string>();
    assignments.forEach(a => m.set(a.vehicle_id, a.driver_id));
    return m;
  }, [assignments]);

  // Filter vehicles by driver
  const filteredVehicles = useMemo(() => {
    if (driverFilter === "todos") return vehicles.filter(v => v.adesao_id);
    const vehicleIds = driverVehicleMap.get(driverFilter) ?? [];
    return vehicles.filter(v => v.adesao_id && vehicleIds.includes(v.id));
  }, [vehicles, driverFilter, driverVehicleMap]);

  // KM reports
  const { data: kmData, isLoading: loadingKm } = useQuery({
    queryKey: ["km-reports", filteredVehicles.map(v => v.adesao_id).join(","), dataInicio, dataFim],
    enabled: filteredVehicles.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const results = await Promise.allSettled(
        filteredVehicles.map(async (v) => {
          const raw = await getRelatorioKmRodado({ adesao_id: v.adesao_id!, data_inicio: dataInicio, data_fim: dataFim });
          return { adesaoId: v.adesao_id!, km: extractKm(raw) };
        })
      );
      const m = new Map<string, number>();
      results.forEach(r => { if (r.status === "fulfilled") m.set(r.value.adesaoId, r.value.km); });
      return m;
    },
  });

  // Build table rows
  const rows = useMemo(() => {
    return filteredVehicles.map(v => {
      const driverId = vehicleDriverMap.get(v.id);
      const driver = driverId ? drivers.find(d => d.id === driverId) : undefined;
      const pos = v.adesao_id ? posMap.get(v.adesao_id) : undefined;
      const kmPeriodo = v.adesao_id ? (kmData?.get(v.adesao_id) ?? 0) : 0;
      return { ...v, driver, pos, kmPeriodo };
    });
  }, [filteredVehicles, vehicleDriverMap, drivers, posMap, kmData]);

  const totalKmPeriodo = rows.reduce((s, r) => s + r.kmPeriodo, 0);
  const totalKmAtual = rows.reduce((s, r) => s + r.km_atual, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">KM rodado e telemetria por veículo/condutor</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-end">
            {/* Period preset */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Período</label>
              <div className="flex gap-1 flex-wrap">
                {(["hoje", "semana", "mes", "personalizado"] as const).map(p => (
                  <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => setPreset(p)} className="flex-1 sm:flex-none">
                    {p === "hoje" ? "Hoje" : p === "semana" ? "Semana" : p === "mes" ? "Mês" : "Custom"}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom date pickers */}
            {preset === "personalizado" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">De</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !customInicio && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customInicio ? format(customInicio, "dd/MM/yyyy") : "Selecionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customInicio} onSelect={setCustomInicio} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Até</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal", !customFim && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customFim ? format(customFim, "dd/MM/yyyy") : "Selecionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customFim} onSelect={setCustomFim} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}

            {/* Driver filter */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Condutor</label>
              <SearchableSelect
                value={driverFilter}
                onValueChange={setDriverFilter}
                placeholder="Todos"
                searchPlaceholder="Buscar condutor..."
                className="w-full sm:w-[200px]"
                options={[
                  { value: "todos", label: "Todos os condutores" },
                  ...drivers.filter(d => d.status === "ativo").map(d => ({ value: d.id, label: d.full_name })),
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardHeader className="pb-1 p-3 sm:p-6 sm:pb-2"><CardTitle className="text-xs sm:text-sm text-muted-foreground">KM Período</CardTitle></CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <p className="text-lg sm:text-3xl font-bold tabular-nums">
              {loadingKm ? <Loader2 className="w-5 h-5 animate-spin" /> : totalKmPeriodo.toLocaleString("pt-BR")}
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 hidden sm:block">{dataInicio} a {dataFim}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 p-3 sm:p-6 sm:pb-2"><CardTitle className="text-xs sm:text-sm text-muted-foreground">Odômetro</CardTitle></CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0"><p className="text-lg sm:text-3xl font-bold tabular-nums">{totalKmAtual.toLocaleString("pt-BR")}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 p-3 sm:p-6 sm:pb-2"><CardTitle className="text-xs sm:text-sm text-muted-foreground">Veículos</CardTitle></CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0"><p className="text-lg sm:text-3xl font-bold tabular-nums">{rows.length}</p></CardContent>
        </Card>
      </div>

      {/* Data table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Telemetria e KM por Veículo
            {loadingKm && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Placa</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Veículo</th>
                <th className="text-left p-3 font-medium">Condutor</th>
                <th className="text-right p-3 font-medium">KM Período</th>
                <th className="text-right p-3 font-medium hidden md:table-cell">KM Atual</th>
                <th className="text-center p-3 font-medium hidden lg:table-cell">Telemetria</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    {vehicles.length === 0 ? "Sincronize os veículos primeiro" : "Nenhum veículo encontrado"}
                  </td>
                </tr>
              ) : (
                rows.map(r => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-3 font-mono font-semibold">{r.placa}</td>
                    <td className="p-3 hidden md:table-cell">{r.marca} {r.modelo}</td>
                    <td className="p-3">
                      {r.driver ? (
                        <span className="text-sm">{r.driver.full_name}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem condutor</span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold">
                      {loadingKm ? "..." : `${r.kmPeriodo.toLocaleString("pt-BR")} km`}
                    </td>
                    <td className="p-3 text-right tabular-nums hidden md:table-cell">{r.km_atual.toLocaleString("pt-BR")} km</td>
                    <td className="p-3 text-center hidden lg:table-cell">
                      {r.pos ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${r.pos.velocidade > 0 ? "bg-success animate-pulse" : r.pos.ignicao ? "bg-warning" : "bg-muted-foreground/30"}`} />
                          <span className="text-xs tabular-nums">{r.pos.velocidade} km/h</span>
                          <Badge variant={r.pos.ignicao ? "default" : "secondary"} className="text-xs">
                            <Radio className="w-3 h-3 mr-1" /> {r.pos.ignicao ? "ON" : "OFF"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem sinal</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
