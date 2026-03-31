import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useMaintenancePlans,
  useMaintenanceExecutions,
  computeVehiclePlanStatuses,
  type AlertLevel,
  type VehiclePlanStatus,
} from "@/hooks/useMaintenancePlans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Skull,
  Loader2,
  Wrench,
  Filter,
  User,
  Building2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const CATEGORY_LABELS: Record<string, string> = {
  faixa_m: "🔵 Faixa M — Mensal",
  faixa_a: "🟢 Faixa A — 10.000km / 3 meses",
  faixa_b: "🟡 Faixa B — 30.000km / 6 meses",
  faixa_c: "🔴 Faixa C — 50-100k km / 12-24 meses",
};

const CATEGORY_SHORT: Record<string, string> = {
  faixa_m: "M",
  faixa_a: "A",
  faixa_b: "B",
  faixa_c: "C",
};

const TYPE_LABELS: Record<string, string> = {
  troca: "Troca",
  servico: "Serviço",
  inspecao: "Inspeção",
};

const EXECUTOR_BADGE: Record<string, { icon: typeof User; label: string; className: string }> = {
  tecnico: { icon: User, label: "Técnico", className: "bg-blue-100 text-blue-800 border-blue-200" },
  oficina: { icon: Building2, label: "Oficina", className: "bg-orange-100 text-orange-800 border-orange-200" },
};

const ALERT_CONFIG: Record<AlertLevel, { icon: typeof CheckCircle; color: string; label: string }> = {
  ok: { icon: CheckCircle, color: "text-success", label: "Em dia" },
  yellow: { icon: AlertTriangle, color: "text-warning", label: "Pré-alerta" },
  red: { icon: XCircle, color: "text-destructive", label: "Vencido" },
  black: { icon: Skull, color: "text-foreground", label: "Crítico" },
};

interface Vehicle {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  km_atual: number;
  status: string;
}

export default function ManutencaoPreventiva() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedVehicle, setSelectedVehicle] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAlert, setSelectedAlert] = useState<string>("all");

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery<Vehicle[]>({
    queryKey: ["vehicles-preventiva"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, placa, marca, modelo, km_atual, status")
        .order("placa");
      if (error) throw error;
      return data;
    },
  });

  const { data: plans = [], isLoading: loadingPlans } = useMaintenancePlans();
  const { data: executions = [], isLoading: loadingExecs } = useMaintenanceExecutions();

  // Check for existing open preventiva tickets to avoid duplicates
  const { data: openTickets = [] } = useQuery({
    queryKey: ["open-preventiva-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_tickets")
        .select("id, vehicle_id, maintenance_plan_id")
        .eq("tipo", "preventiva")
        .in("status", ["aberto", "em_andamento", "aguardando_peca"])
        .not("maintenance_plan_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const isLoading = loadingVehicles || loadingPlans || loadingExecs;

  const allStatuses = useMemo(() => {
    if (!plans.length || !vehicles.length) return [];

    const result: { vehicle: Vehicle; statuses: VehiclePlanStatus[] }[] = [];

    const filteredVehicles = selectedVehicle === "all"
      ? vehicles
      : vehicles.filter((v) => v.id === selectedVehicle);

    for (const vehicle of filteredVehicles) {
      let statuses = computeVehiclePlanStatuses(plans, executions, vehicle.id, vehicle.km_atual);

      if (selectedCategory !== "all") {
        statuses = statuses.filter((s) => s.plan.category === selectedCategory);
      }
      if (selectedAlert !== "all") {
        statuses = statuses.filter((s) => s.alert === selectedAlert);
      }

      if (statuses.length > 0) {
        result.push({ vehicle, statuses });
      }
    }

    return result;
  }, [plans, executions, vehicles, selectedVehicle, selectedCategory, selectedAlert]);

  const summary = useMemo(() => {
    const counts = { ok: 0, yellow: 0, red: 0, black: 0 };
    for (const { statuses } of allStatuses) {
      for (const s of statuses) {
        counts[s.alert]++;
      }
    }
    return counts;
  }, [allStatuses]);

  // Create ticket mutation
  const createTicketMutation = useMutation({
    mutationFn: async (data: { vehicleId: string; planId: string; planName: string; vehiclePlaca: string; vehicleModelo: string; alert: AlertLevel; pctMax: number; executorType: string }) => {
      const prioridade = data.alert === "black" ? "critica" : data.alert === "red" ? "alta" : "media";
      const descricao = `Manutenção preventiva: ${data.planName}\nVeículo: ${data.vehiclePlaca} — ${data.vehicleModelo}\nUrgência: ${Math.round(data.pctMax)}% do intervalo consumido\nExecutor: ${data.executorType === "tecnico" ? "Técnico (autogestão)" : "Oficina mecânica"}`;

      const { error } = await supabase.from("maintenance_tickets").insert({
        titulo: `[Preventiva] ${data.planName} — ${data.vehiclePlaca}`,
        descricao,
        vehicle_id: data.vehicleId,
        tipo: "preventiva",
        prioridade,
        created_by: user?.id,
        maintenance_plan_id: data.planId,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["open-preventiva-tickets"] });
      toast.success("Chamado criado! Acesse os Chamados para acompanhar.", {
        action: { label: "Ver Chamados", onClick: () => navigate("/chamados") },
      });
    },
    onError: (err: any) => toast.error(err.message || "Erro ao criar chamado"),
  });

  const hasOpenTicket = (vehicleId: string, planId: string) => {
    return openTickets.some(
      (t) => t.vehicle_id === vehicleId && t.maintenance_plan_id === planId
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" />
          Manutenção Preventiva
        </h1>
        <p className="text-sm text-muted-foreground">Controle de planos e execuções por veículo</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        {(["ok", "yellow", "red", "black"] as const).map((level) => {
          const cfg = ALERT_CONFIG[level];
          return (
            <Card
              key={level}
              className={`cursor-pointer transition-all ${selectedAlert === level ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelectedAlert(selectedAlert === level ? "all" : level)}
            >
              <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                <cfg.icon className={`w-6 h-6 ${cfg.color}`} />
                <div>
                  <p className="text-2xl font-bold tabular-nums">{summary[level]}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filtros:</span>
          </div>
          <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Todos os veículos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os veículos</SelectItem>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.placa} — {v.modelo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-56 h-9">
              <SelectValue placeholder="Todas as faixas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as faixas</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Main table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : allStatuses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum item encontrado com os filtros selecionados
          </CardContent>
        </Card>
      ) : (
        allStatuses.map(({ vehicle, statuses }) => (
          <Card key={vehicle.id}>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>
                  <span className="font-mono text-primary">{vehicle.placa}</span>
                  <span className="text-muted-foreground font-normal ml-2">{vehicle.marca} {vehicle.modelo}</span>
                </span>
                <Badge variant="outline" className="text-xs tabular-nums">
                  {vehicle.km_atual.toLocaleString("pt-BR")} km
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Mobile */}
              <div className="sm:hidden divide-y divide-border">
                {statuses.map((s) => {
                  const cfg = ALERT_CONFIG[s.alert];
                  const executor = EXECUTOR_BADGE[(s.plan as any).executor_type] ?? EXECUTOR_BADGE.oficina;
                  const ticketExists = hasOpenTicket(vehicle.id, s.plan.id);
                  return (
                    <div key={s.plan.id} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
                          <span className="text-sm font-medium truncate max-w-[180px]">{s.plan.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${executor.className}`}>
                            {executor.label}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {CATEGORY_SHORT[s.plan.category]}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                          {Math.round(s.pctMax)}% · {s.daysSince}d
                          {s.plan.km_interval ? ` · ${s.kmSince.toLocaleString("pt-BR")}km` : ""}
                        </span>
                        {ticketExists ? (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                            Chamado aberto
                          </Badge>
                        ) : (s.alert !== "ok") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            disabled={createTicketMutation.isPending}
                            onClick={() => createTicketMutation.mutate({
                              vehicleId: vehicle.id,
                              planId: s.plan.id,
                              planName: s.plan.name,
                              vehiclePlaca: vehicle.placa,
                              vehicleModelo: vehicle.modelo,
                              alert: s.alert,
                              pctMax: s.pctMax,
                              executorType: (s.plan as any).executor_type ?? "oficina",
                            })}
                          >
                            <Wrench className="w-3 h-3 mr-1" /> Abrir Chamado
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Status</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Faixa</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Executor</TableHead>
                      <TableHead className="text-right">% Consumido</TableHead>
                      <TableHead className="text-right">KM desde</TableHead>
                      <TableHead className="text-right">Dias desde</TableHead>
                      <TableHead className="text-right">Última execução</TableHead>
                      <TableHead className="w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statuses.map((s) => {
                      const cfg = ALERT_CONFIG[s.alert];
                      const executor = EXECUTOR_BADGE[(s.plan as any).executor_type] ?? EXECUTOR_BADGE.oficina;
                      const ticketExists = hasOpenTicket(vehicle.id, s.plan.id);
                      return (
                        <TableRow key={s.plan.id}>
                          <TableCell>
                            <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
                          </TableCell>
                          <TableCell className="font-medium text-sm">{s.plan.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {CATEGORY_SHORT[s.plan.category]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {TYPE_LABELS[s.plan.item_type] ?? s.plan.item_type}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${executor.className}`}>
                              <executor.icon className="w-3 h-3 mr-1" />
                              {executor.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            <span className={cfg.color}>{Math.round(s.pctMax)}%</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {s.plan.km_interval ? `${s.kmSince.toLocaleString("pt-BR")} km` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {s.lastExecution ? `${s.daysSince}d` : "Nunca"}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {s.lastExecution ? format(new Date(s.lastExecution.executed_at), "dd/MM/yy") : "—"}
                          </TableCell>
                          <TableCell>
                            {ticketExists ? (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                                Chamado aberto
                              </Badge>
                            ) : (s.alert !== "ok") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={createTicketMutation.isPending}
                                onClick={() => createTicketMutation.mutate({
                                  vehicleId: vehicle.id,
                                  planId: s.plan.id,
                                  planName: s.plan.name,
                                  vehiclePlaca: vehicle.placa,
                                  vehicleModelo: vehicle.modelo,
                                  alert: s.alert,
                                  pctMax: s.pctMax,
                                  executorType: (s.plan as any).executor_type ?? "oficina",
                                })}
                              >
                                <Wrench className="w-3 h-3 mr-1" /> Abrir Chamado
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
