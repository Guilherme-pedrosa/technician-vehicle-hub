import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users, Truck, Wrench, AlertTriangle, CheckCircle, Clock, MapPin,
  Gauge, Radio, Loader2, RefreshCw, UserCheck, CalendarDays, ChevronRight, Shield, XCircle, Skull, Download,
  Fuel, DollarSign, TrendingUp, Droplet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { isPast, format, startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useSyncAllFromRotaExata } from "@/hooks/useSyncRotaExata";
import { useAuth } from "@/contexts/AuthContext";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";
import { useKmPorTecnicoPeriodo } from "@/hooks/useKmPorTecnicoPeriodo";
import { useCachedKmPorTecnico, useSyncDailyKm } from "@/hooks/useCachedKmPorTecnico";
import { useNavigate } from "react-router-dom";
import { useMaintenancePlans, useMaintenanceExecutions, computeVehiclePlanStatuses } from "@/hooks/useMaintenancePlans";
import { useFuelMetrics } from "@/hooks/useFuelMetrics";

 type PeriodPreset = "hoje" | "semana" | "mes" | "personalizado";

function getPresetDates(preset: PeriodPreset) {
  const now = new Date();
  switch (preset) {
    case "hoje": return { inicio: startOfDay(now), fim: now };
    case "semana": return { inicio: startOfWeek(now, { weekStartsOn: 1, locale: ptBR }), fim: now };
    case "mes": return { inicio: startOfMonth(now), fim: now };
    default: return { inicio: startOfDay(now), fim: now };
  }
}

function parseDateInput(value: string, fallback: Date, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;

  const parsed = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function normalizeDriverName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const PRIORITY_COLORS: Record<string, string> = {
  critica: "bg-destructive text-destructive-foreground",
  alta: "bg-warning text-warning-foreground",
  media: "bg-accent text-accent-foreground",
  baixa: "bg-secondary text-secondary-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  em_andamento: "Em Andamento",
  aguardando_peca: "Aguardando Peça",
  concluido: "Concluído",
};

function SyncKmHistoricoDialog() {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const dayCount = useMemo(() => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }, [startDate, endDate]);

  // Split range into chunks of 7 days and call the edge function for each chunk sequentially
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setProgress("Iniciando...");
    setSyncedCount(null);

    const chunkSize = 7;
    const chunks: { start: string; end: string }[] = [];
    const d = new Date(startDate + "T00:00:00");
    const endD = new Date(endDate + "T00:00:00");

    while (d <= endD) {
      const chunkEnd = new Date(d);
      chunkEnd.setDate(chunkEnd.getDate() + chunkSize - 1);
      if (chunkEnd > endD) chunkEnd.setTime(endD.getTime());

      chunks.push({
        start: d.toISOString().split("T")[0],
        end: chunkEnd.toISOString().split("T")[0],
      });

      d.setDate(d.getDate() + chunkSize);
    }

    let totalSynced = 0;
    let totalErrors = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      setProgress(`Sincronizando ${chunk.start} a ${chunk.end} (${i + 1}/${chunks.length})...`);

      try {
        const { data, error } = await supabase.functions.invoke("sync-daily-km", {
          body: { start_date: chunk.start, end_date: chunk.end, force: true },
        });

        if (error) {
          console.warn(`Chunk ${i + 1} error:`, error);
          totalErrors++;
        } else {
          totalSynced += data?.synced ?? 0;
          totalErrors += data?.errors ?? 0;
        }
      } catch (err) {
        console.warn(`Chunk ${i + 1} exception:`, err);
        totalErrors++;
      }
    }

    setSyncedCount(totalSynced);
    setProgress(
      totalErrors > 0
        ? `Concluído: ${totalSynced} registros sincronizados (${totalErrors} erros)`
        : `Concluído: ${totalSynced} registros sincronizados!`
    );
    setSyncing(false);
    queryClient.invalidateQueries({ queryKey: ["cached-km-tecnico"] });
    toast.success(`Sincronização histórica: ${totalSynced} registros atualizados`);
  }, [startDate, endDate, queryClient]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!syncing) setOpen(v); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Sincronizar KM Histórico">
          <Download className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sincronizar KM Histórico</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Baixa os dados de KM do Rota Exata para o período selecionado e grava no banco de dados local.
          O processo é feito em lotes de 7 dias.
        </p>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Data Inicial</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={syncing} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Data Final</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={syncing} />
          </div>
        </div>

        {syncing && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{progress}</span>
            </div>
          </div>
        )}

        {!syncing && syncedCount !== null && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-sm">{progress}</span>
            </div>
          </div>
        )}

        {!syncing && syncedCount === null && (
          <p className="text-xs text-muted-foreground mt-2">
            {dayCount} dias · processado em lotes de 7 dias
          </p>
        )}

        {dayCount > 365 && (
          <p className="text-xs text-destructive">Reduza o período para no máximo 365 dias.</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={syncing}>
            Fechar
          </Button>
          <Button onClick={handleSync} disabled={syncing || dayCount <= 0 || dayCount > 365}>
            {syncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Sincronizar {dayCount} dias
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const syncMutation = useSyncAllFromRotaExata();
  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const [customInicio, setCustomInicio] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customFim, setCustomFim] = useState(format(new Date(), "yyyy-MM-dd"));

  const dates = useMemo(() => {
    if (preset === "personalizado") {
      const now = new Date();
      const inicioDate = parseDateInput(customInicio, startOfMonth(now));
      const fimDate = parseDateInput(customFim, now, true);

      if (inicioDate <= fimDate) {
        return { inicio: inicioDate, fim: fimDate };
      }

      return {
        inicio: parseDateInput(customFim, startOfMonth(now)),
        fim: parseDateInput(customInicio, now, true),
      };
    }

    return getPresetDates(preset);
  }, [preset, customInicio, customFim]);

  const isSingleDay = preset === "hoje";
  const rangeDays = Math.ceil((dates.fim.getTime() - dates.inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // "Hoje": direct API call (realtime) — used for KM only
  const realtimeData = useKmPorTecnicoPeriodo(
    isSingleDay ? dates.inicio : new Date(0),
    isSingleDay ? dates.fim : new Date(0)
  );

  // Cache table — always queried for telemetria data
  const cachedData = useCachedKmPorTecnico(dates.inicio, dates.fim);

  const { sync: syncKm, cancel: cancelSyncKm, isSyncing: isSyncingKm, progress: syncProgress } = useSyncDailyKm();

  // For single-day: use realtime KM rows enriched with cached telemetria; for multi-day: use cached entirely
  const driverTelemetryRows = useMemo(() => {
    if (!isSingleDay) return cachedData.driverRows;
    if (!realtimeData.driverRows.length) return cachedData.driverRows;

    const cachedById = new Map(cachedData.driverRows.map((row) => [row.id, row]));
    const cachedByName = new Map(cachedData.driverRows.map((row) => [normalizeDriverName(row.nome), row]));
    const matchedCachedIds = new Set<string>();

    const mergedRealtimeRows = realtimeData.driverRows.map((row) => {
      const cachedMatch = cachedById.get(row.id) ?? cachedByName.get(normalizeDriverName(row.nome));

      if (!cachedMatch) return row;

      matchedCachedIds.add(cachedMatch.id);

      return {
        ...row,
        telemetrias: cachedMatch.telemetrias,
        excessosVelocidade: cachedMatch.excessosVelocidade,
        velocidadeMaxima: cachedMatch.velocidadeMaxima,
        placas: row.placas.length ? row.placas : cachedMatch.placas,
        kmPorTelemetria:
          cachedMatch.telemetrias > 0
            ? Math.round((row.kmRodado / cachedMatch.telemetrias) * 100) / 100
            : row.kmRodado,
      };
    });

    const cachedOnlyRows = cachedData.driverRows.filter((row) => !matchedCachedIds.has(row.id));

    return [...mergedRealtimeRows, ...cachedOnlyRows].sort(
      (a, b) => b.kmRodado - a.kmRodado || b.telemetrias - a.telemetrias
    );
  }, [isSingleDay, realtimeData.driverRows, cachedData.driverRows]);

  const totalKm = isSingleDay
    ? (realtimeData.driverRows.length ? realtimeData.totalKm : cachedData.totalKm)
    : cachedData.totalKm;
  const totalTelemetrias = cachedData.totalTelemetrias;
  const loadingResumo = isSingleDay ? (realtimeData.isLoading || cachedData.isLoading) : cachedData.isLoading;

  const { rows: telemetryVehicles, summary, isLoading: loadingMetrics, isError: errorMetrics } = useFleetMetrics();

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, full_name, status, cnh_validade");
      if (error) throw error;
      return data;
    },
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_tickets")
        .select("id, titulo, status, tipo, prioridade, vehicle_id, created_at, vehicles(placa)")
        .neq("status", "concluido")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const activeDrivers = drivers.filter((d) => d.status === "ativo").length;
  const cnhVencidas = drivers.filter((d) => d.status === "ativo" && isPast(new Date(d.cnh_validade))).length;
  const vehiclesInUse = telemetryVehicles.filter((v) => v.status === "em_uso").length;
  const vehiclesAvailable = telemetryVehicles.filter((v) => v.status === "disponivel").length;
  const vehiclesMaintenance = telemetryVehicles.filter((v) => v.status === "manutencao").length;
  const openTickets = tickets.length;
  const naoConformidades = tickets.filter((t) => t.tipo === "nao_conformidade").length;

  const { data: mPlans = [] } = useMaintenancePlans();
  const { data: mExecs = [] } = useMaintenanceExecutions();
  const { data: allVehicles = [] } = useQuery({
    queryKey: ["vehicles-dash-prev"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, placa, km_atual");
      if (error) throw error;
      return data;
    },
  });

  const prevSummary = useMemo(() => {
    const counts = { yellow: 0, red: 0, black: 0 };
    for (const v of allVehicles) {
      const statuses = computeVehiclePlanStatuses(mPlans, mExecs, v.id, v.km_atual);
      for (const s of statuses) {
        if (s.alert === "yellow") counts.yellow++;
        if (s.alert === "red") counts.red++;
        if (s.alert === "black") counts.black++;
      }
    }
    return counts;
  }, [mPlans, mExecs, allVehicles]);

  const periodLabel = useMemo(() => {
    if (preset === "hoje") return "KM Hoje";
    if (preset === "semana") return "KM Semana";
    if (preset === "mes") return "KM Mês";
    return `KM ${format(dates.inicio, "dd/MM")} a ${format(dates.fim, "dd/MM")}`;
  }, [preset, dates]);

  const stats = [
    {
      label: "Veículos",
      value: summary.totalVeiculos,
      icon: Truck,
      color: "text-primary",
      subtitle: `${vehiclesAvailable} disp. · ${vehiclesInUse} uso · ${vehiclesMaintenance} manut.`,
      subtitleColor: "text-muted-foreground",
    },
    {
      label: periodLabel,
      value: loadingResumo ? "..." : totalKm.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      icon: CalendarDays,
      color: "text-success",
      subtitle: `${totalTelemetrias} telemetrias · ${summary.emMovimento} em movimento`,
      subtitleColor: "text-muted-foreground",
    },
    {
      label: "Telemetria Ativa",
      value: `${summary.emMovimento + summary.paradoLigado + summary.paradoDesligado}`,
      icon: Radio,
      color: "text-info",
      subtitle: `${summary.emMovimento} mov. · ${summary.paradoLigado} lig. · ${summary.paradoDesligado} desl.`,
      subtitleColor: "text-muted-foreground",
    },
    {
      label: "Chamados Abertos",
      value: openTickets,
      icon: Wrench,
      color: "text-warning",
      subtitle: naoConformidades > 0 ? `${naoConformidades} não conformidades` : `${tickets.length} total`,
      subtitleColor: naoConformidades > 0 ? "text-destructive" : "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">KM rodado e telemetria da frota</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="flex-1 sm:flex-none">
            {syncMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sincronizar Rota Exata
          </Button>
          <SyncKmHistoricoDialog />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2 p-3 sm:p-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`w-4 sm:w-5 h-4 sm:h-5 ${stat.color}`} />
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <p className="text-xl sm:text-3xl font-bold tabular-nums">{stat.value}</p>
              <p className={`text-[10px] sm:text-xs mt-1 ${stat.subtitleColor} line-clamp-1`}>{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* === TABELA POR TÉCNICO === */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between p-3 sm:p-6">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-primary" /> KM por Técnico
            {loadingResumo && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <div className="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2 flex-wrap">
              {(["hoje", "semana", "mes", "personalizado"] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={preset === p ? "default" : "outline"}
                  onClick={() => setPreset(p)}
                  className="h-7 text-xs px-3"
                >
                  {p === "hoje" ? "Hoje" : p === "semana" ? "Semana" : p === "mes" ? "Mês" : "Data"}
                </Button>
              ))}
              {!isSingleDay && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => isSyncingKm
                    ? cancelSyncKm()
                    : syncKm(format(dates.inicio, "yyyy-MM-dd"), format(dates.fim, "yyyy-MM-dd"))
                  }
                  className="h-7 text-xs"
                  title="Sincronizar dados do período"
                >
                  {isSyncingKm ? (
                    <><Loader2 className="w-3 h-3 animate-spin mr-1" />Cancelar</>
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                </Button>
              )}
            </div>
            {preset === "personalizado" && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">De</span>
                  <Input
                    type="date"
                    value={customInicio}
                    onChange={(e) => setCustomInicio(e.target.value)}
                    className="w-[150px] h-8 text-xs"
                    max={customFim}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Até</span>
                  <Input
                    type="date"
                    value={customFim}
                    onChange={(e) => setCustomFim(e.target.value)}
                    className="w-[150px] h-8 text-xs"
                    min={customInicio}
                    max={format(new Date(), "yyyy-MM-dd")}
                  />
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Progress bar during sync */}
          {isSyncingKm && syncProgress && (
            <div className="mx-3 sm:mx-6 mb-4 p-3 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando com RotaExata...
                </span>
                <span className="font-mono text-xs">
                  {syncProgress.current}/{syncProgress.total} dias
                  {syncProgress.synced > 0 && ` • ${syncProgress.synced} registros`}
                </span>
              </div>
              <div className="w-full bg-muted-foreground/20 rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
                />
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={cancelSyncKm}>
                Cancelar
              </Button>
            </div>
          )}

          {/* Completude indicator */}
          {!isSingleDay && !cachedData.isLoading && !isSyncingKm && (
            <div className="mx-3 sm:mx-6 mb-2">
              {cachedData.isComplete ? (
                <Badge variant="outline" className="text-xs text-success border-success">
                  ✓ {cachedData.syncedDays}/{cachedData.totalDaysInRange} dias sincronizados
                </Badge>
              ) : cachedData.syncedDays > 0 ? (
                <Badge variant="outline" className="text-xs text-warning border-warning">
                  ⚠ {cachedData.syncedDays}/{cachedData.totalDaysInRange} dias — dados parciais
                </Badge>
              ) : null}
            </div>
          )}

          {/* Sync prompt when incomplete */}
          {!isSingleDay && !isSyncingKm && !cachedData.isComplete && !cachedData.isLoading && (
            <div className="text-center py-6 space-y-3 mx-3 sm:mx-6">
              {cachedData.syncedDays > 0 ? (
                <p className="text-sm text-warning font-medium">
                  ⚠ Dados parciais: apenas {cachedData.syncedDays} de {cachedData.totalDaysInRange} dias sincronizados
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum dado sincronizado para este período
                </p>
              )}
              <Button
                onClick={() => syncKm(format(dates.inicio, "yyyy-MM-dd"), format(dates.fim, "yyyy-MM-dd"))}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Sincronizar período ({cachedData.totalDaysInRange} dias)
              </Button>
            </div>
          )}

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-border">
            {driverTelemetryRows.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">Nenhum dado encontrado</p>
            ) : (
              driverTelemetryRows.map((row) => (
                <div key={row.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{row.nome}</p>
                    <p className="font-semibold text-sm tabular-nums">{row.kmRodado.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</p>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-muted-foreground truncate max-w-[40%]">{row.placas?.join(", ") ?? "—"}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{row.telemetrias} tel.</span>
                      {(row as { excessosVelocidade?: number }).excessosVelocidade && (row as { excessosVelocidade?: number }).excessosVelocidade! > 0 && (
                        <Badge className="bg-destructive text-destructive-foreground text-[10px] h-4 px-1">
                          {(row as { excessosVelocidade?: number }).excessosVelocidade} exc.
                        </Badge>
                      )}
                      {(row as { velocidadeMaxima?: number }).velocidadeMaxima ? (
                        <span className="text-xs text-muted-foreground">{(row as { velocidadeMaxima?: number }).velocidadeMaxima} km/h</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block">
          <Table className="table-enterprise">
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead>Placas</TableHead>
                <TableHead className="text-right">Soma de KM Rodado</TableHead>
                <TableHead className="text-right">Telemetrias</TableHead>
                <TableHead className="text-right">KM por Telemetria</TableHead>
                <TableHead className="text-right">Excessos Vel.</TableHead>
                <TableHead className="text-right">Vel. Máxima</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {driverTelemetryRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhum dado de telemetria encontrado
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {driverTelemetryRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.nome}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.placas?.join(", ") ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {row.kmRodado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.telemetrias}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.kmPorTelemetria.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        {(row as { excessosVelocidade?: number }).excessosVelocidade && (row as { excessosVelocidade?: number }).excessosVelocidade! > 0 ? (
                          <Badge className="bg-destructive text-destructive-foreground">
                            {(row as { excessosVelocidade?: number }).excessosVelocidade}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(row as { velocidadeMaxima?: number }).velocidadeMaxima
                          ? `${(row as { velocidadeMaxima?: number }).velocidadeMaxima} km/h`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {driverTelemetryRows.reduce((s, r) => s + r.kmRodado, 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {driverTelemetryRows.reduce((s, r) => s + r.telemetrias, 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(() => {
                        const totalKmR = driverTelemetryRows.reduce((s, r) => s + r.kmRodado, 0);
                        const totalTel = driverTelemetryRows.reduce((s, r) => s + r.telemetrias, 0);
                        const val = totalTel > 0 ? totalKmR / totalTel : totalKmR;
                        return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge className={driverTelemetryRows.reduce((s, r) => s + ((r as { excessosVelocidade?: number }).excessosVelocidade ?? 0), 0) > 0 ? "bg-destructive text-destructive-foreground" : "bg-secondary text-secondary-foreground"}>
                        {driverTelemetryRows.reduce((s, r) => s + ((r as { excessosVelocidade?: number }).excessosVelocidade ?? 0), 0)}
                      </Badge>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* === CHAMADOS ABERTOS === */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-3 sm:p-6">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Wrench className="w-4 h-4 text-warning" /> Chamados Abertos ({openTickets})
          </CardTitle>
          <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate("/chamados")}>
            Ver todos <ChevronRight className="w-3 h-3" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {tickets.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">Nenhum chamado aberto</p>
          ) : (
            <>
              {/* Mobile */}
              <div className="sm:hidden divide-y divide-border">
                {tickets.slice(0, 5).map((t) => (
                  <div key={t.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm truncate max-w-[70%]">{t.titulo}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABELS[t.status] ?? t.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">
                        {(t.vehicles as any)?.placa ?? "—"} · {t.tipo === "nao_conformidade" ? "NC" : t.tipo}
                      </p>
                      <Badge className={`text-[10px] ${PRIORITY_COLORS[t.prioridade] ?? ""}`}>
                        {t.prioridade}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Placa</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Prioridade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tickets.slice(0, 10).map((t) => (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate("/chamados")}>
                        <TableCell className="font-medium max-w-[200px] truncate">{t.titulo}</TableCell>
                        <TableCell className="text-xs font-mono">{(t.vehicles as any)?.placa ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {t.tipo === "nao_conformidade" ? "Não Conformidade" : t.tipo === "preventiva" ? "Preventiva" : "Corretiva"}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${PRIORITY_COLORS[t.prioridade] ?? ""}`}>
                            {t.prioridade}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {STATUS_LABELS[t.status] ?? t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {format(new Date(t.created_at), "dd/MM/yy")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* === PREVENTIVA === */}
      {(prevSummary.yellow + prevSummary.red + prevSummary.black) > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between p-3 sm:p-6">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Preventivas Vencendo
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate("/manutencao-preventiva")}>
              Ver tudo <ChevronRight className="w-3 h-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0">
            <div className="flex items-center gap-6">
              {prevSummary.yellow > 0 && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                  <div>
                    <p className="text-xl font-bold">{prevSummary.yellow}</p>
                    <p className="text-xs text-muted-foreground">Pré-alerta</p>
                  </div>
                </div>
              )}
              {prevSummary.red > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-destructive" />
                  <div>
                    <p className="text-xl font-bold">{prevSummary.red}</p>
                    <p className="text-xs text-muted-foreground">Vencidos</p>
                  </div>
                </div>
              )}
              {prevSummary.black > 0 && (
                <div className="flex items-center gap-2">
                  <Skull className="w-5 h-5 text-foreground" />
                  <div>
                    <p className="text-xl font-bold">{prevSummary.black}</p>
                    <p className="text-xs text-muted-foreground">Críticos</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* === TELEMETRIA POR VEÍCULO === */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" /> Telemetria por Veículo
            {loadingMetrics && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {errorMetrics ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-warning" />
              <p className="text-sm font-medium">Erro ao carregar KM e telemetria</p>
            </div>
          ) : telemetryVehicles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MapPin className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">Nenhum dado encontrado</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Badge className="bg-success text-success-foreground gap-1 py-1 px-3"><Gauge className="w-3 h-3" /> {summary.emMovimento} em movimento</Badge>
                <Badge className="bg-warning text-warning-foreground gap-1 py-1 px-3"><Clock className="w-3 h-3" /> {summary.paradoLigado} parado (ignição ligada)</Badge>
                <Badge variant="secondary" className="gap-1 py-1 px-3"><MapPin className="w-3 h-3" /> {summary.paradoDesligado} parado (ignição desligada)</Badge>
              </div>

              <div className="divide-y divide-border">
                {telemetryVehicles.map((v) => {
                  const posDate = v.posicao?.data_posicao ? new Date(v.posicao.data_posicao).getTime() : 0;
                  const isStale = !posDate || (Date.now() - posDate) > 10 * 60 * 1000;
                  const isMoving = !isStale && v.posicao?.velocidade && v.posicao.velocidade > 0;
                  const isIgnitionOn = !isStale && v.posicao?.ignicao;

                  return (
                    <div key={v.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${isMoving ? "bg-success animate-pulse" : isIgnitionOn ? "bg-warning" : "bg-muted-foreground/30"}`} />
                        <div>
                          <p className="text-sm font-medium">{v.placa}<span className="text-muted-foreground font-normal"> — {v.marca} {v.modelo}</span></p>
                          <p className="text-xs text-muted-foreground">Odômetro: {v.kmAtual.toLocaleString("pt-BR")} km</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        {v.posicao ? (
                          <>
                            <div>
                              <p className="text-sm font-semibold tabular-nums">{isStale ? "0" : v.posicao.velocidade} km/h</p>
                              <p className="text-xs text-muted-foreground">{isStale ? "Sem sinal recente" : v.posicao.ignicao ? "Ignição ON" : "Ignição OFF"}</p>
                            </div>
                            <div className="text-xs text-muted-foreground">{v.kmAtual.toLocaleString("pt-BR")} km</div>
                            <div className="text-xs text-muted-foreground">{v.posicao.data_posicao ? new Date(v.posicao.data_posicao).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem sinal</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4" /> Frota</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Total de veículos</span><span className="font-semibold tabular-nums">{telemetryVehicles.length}</span></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-success" /><span className="text-sm text-muted-foreground">Disponíveis</span></div><span className="font-semibold tabular-nums">{vehiclesAvailable}</span></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-warning" /><span className="text-sm text-muted-foreground">Em uso</span></div><span className="font-semibold tabular-nums">{vehiclesInUse}</span></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Wrench className="w-3.5 h-3.5 text-destructive" /><span className="text-sm text-muted-foreground">Manutenção</span></div><span className="font-semibold tabular-nums">{vehiclesMaintenance}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Condutores</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Total de condutores</span><span className="font-semibold tabular-nums">{drivers.length}</span></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-success" /><span className="text-sm text-muted-foreground">Ativos</span></div><span className="font-semibold tabular-nums">{activeDrivers}</span></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Users className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-sm text-muted-foreground">Inativos</span></div><span className="font-semibold tabular-nums">{drivers.filter((d) => d.status === "inativo").length}</span></div>
            {cnhVencidas > 0 && <div className="flex items-center justify-between"><div className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5 text-destructive" /><span className="text-sm text-destructive font-medium">CNH Vencida</span></div><span className="font-semibold tabular-nums text-destructive">{cnhVencidas}</span></div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
