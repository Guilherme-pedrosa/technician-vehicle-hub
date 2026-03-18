import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users, Truck, Wrench, AlertTriangle, CheckCircle, Clock, MapPin,
  Gauge, Radio, Loader2, RefreshCw, UserCheck, CalendarDays,
} from "lucide-react";
import { isPast, format } from "date-fns";
import { useSyncAllFromRotaExata } from "@/hooks/useSyncRotaExata";
import { useAuth } from "@/contexts/AuthContext";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";
import { useResumoDiaFrota } from "@/hooks/useResumoDiaFrota";

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const syncMutation = useSyncAllFromRotaExata();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const { rows: telemetryVehicles, summary, isLoading: loadingMetrics, isError: errorMetrics } = useFleetMetrics();
  const {
    driverRows: driverTelemetryRows,
    totalKmHoje,
    totalTelemetrias,
    isLoading: loadingResumo,
  } = useResumoDiaFrota(selectedDate);

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, full_name, status, cnh_validade");
      if (error) throw error;
      return data;
    },
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("maintenance_tickets").select("id, status, tipo");
      if (error) throw error;
      return data;
    },
  });

  const activeDrivers = drivers.filter((d) => d.status === "ativo").length;
  const cnhVencidas = drivers.filter((d) => d.status === "ativo" && isPast(new Date(d.cnh_validade))).length;
  const vehiclesInUse = telemetryVehicles.filter((v) => v.status === "em_uso").length;
  const vehiclesAvailable = telemetryVehicles.filter((v) => v.status === "disponivel").length;
  const vehiclesMaintenance = telemetryVehicles.filter((v) => v.status === "manutencao").length;
  const openTickets = tickets.filter((t) => t.status === "aberto" || t.status === "em_andamento").length;
  const naoConformidades = tickets.filter((t) => t.tipo === "nao_conformidade").length;

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
      label: selectedDate === format(new Date(), "yyyy-MM-dd") ? "KM Hoje" : `KM ${new Date(selectedDate + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
      value: loadingResumo ? "..." : totalKmHoje.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">KM rodado e telemetria da frota</p>
        </div>
        {isAdmin && (
          <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sincronizar Rota Exata
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="kpi-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{stat.value}</p>
              <p className={`text-xs mt-1 ${stat.subtitleColor}`}>{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* === TABELA POR TÉCNICO === */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-primary" /> KM Rodado por Técnico
            {(loadingMetrics || loadingResumo) && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-40 h-8 text-xs"
              max={format(new Date(), "yyyy-MM-dd")}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-enterprise">
            <TableHeader>
              <TableRow>
                <TableHead>Técnico</TableHead>
                <TableHead>Placas</TableHead>
                <TableHead className="text-right">Soma de KM Rodado</TableHead>
                <TableHead className="text-right">Telemetrias</TableHead>
                <TableHead className="text-right">KM por Telemetria</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {driverTelemetryRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
                        const totalKm = driverTelemetryRows.reduce((s, r) => s + r.kmRodado, 0);
                        const totalTel = driverTelemetryRows.reduce((s, r) => s + r.telemetrias, 0);
                        const val = totalTel > 0 ? totalKm / totalTel : totalKm;
                        return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      })()}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                {telemetryVehicles.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${v.posicao?.velocidade && v.posicao.velocidade > 0 ? "bg-success animate-pulse" : v.posicao?.ignicao ? "bg-warning" : "bg-muted-foreground/30"}`} />
                      <div>
                        <p className="text-sm font-medium">{v.placa}<span className="text-muted-foreground font-normal"> — {v.marca} {v.modelo}</span></p>
                        <p className="text-xs text-muted-foreground">Odômetro: {v.kmAtual.toLocaleString("pt-BR")} km</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      {v.posicao ? (
                        <>
                          <div>
                            <p className="text-sm font-semibold tabular-nums">{v.posicao.velocidade} km/h</p>
                            <p className="text-xs text-muted-foreground">{v.posicao.ignicao ? "Ignição ON" : "Ignição OFF"}</p>
                          </div>
                          <div className="text-xs text-muted-foreground">{v.kmAtual.toLocaleString("pt-BR")} km</div>
                          <div className="text-xs text-muted-foreground">{v.posicao.data_posicao ? new Date(v.posicao.data_posicao).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem sinal</span>
                      )}
                    </div>
                  </div>
                ))}
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