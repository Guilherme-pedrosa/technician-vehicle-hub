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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Skull, Loader2, Wrench,
  Filter, User, Building2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { BatchTicketBar } from "@/components/manutencao/BatchTicketBar";
import { generatePreventivaPdf } from "@/components/manutencao/PreventivaPdfExport";

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

const CATEGORY_LABELS: Record<string, string> = {
  faixa_m: "🔵 Faixa M — Mensal",
  faixa_a: "🟢 Faixa A — 10.000km / 3 meses",
  faixa_b: "🟡 Faixa B — 30.000km / 6 meses",
  faixa_c: "🔴 Faixa C — 50-100k km / 12-24 meses",
};

const CATEGORY_SHORT: Record<string, string> = {
  faixa_m: "M", faixa_a: "A", faixa_b: "B", faixa_c: "C",
};

const TYPE_LABELS: Record<string, string> = {
  troca: "Troca", servico: "Serviço", inspecao: "Inspeção",
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

const ALERT_FILTER_OPTIONS = [
  { value: "all", label: "Todos os status" },
  { value: "atrasados", label: "⚠️ Todos atrasados (amarelo + vermelho + crítico)" },
  { value: "yellow", label: "🟡 Pré-alerta" },
  { value: "red", label: "🔴 Vencido" },
  { value: "black", label: "💀 Crítico" },
  { value: "ok", label: "✅ Em dia" },
];

const EXECUTOR_FILTER_OPTIONS = [
  { value: "all", label: "Todos os executores" },
  { value: "tecnico", label: "Técnico" },
  { value: "oficina", label: "Oficina" },
];

interface Vehicle {
  id: string;
  placa: string;
  marca: string;
  modelo: string;
  km_atual: number;
  status: string;
}

type SelectionKey = `${string}::${string}`;

// ═══════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════

export default function ManutencaoPreventiva() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedVehicle, setSelectedVehicle] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAlert, setSelectedAlert] = useState<string>("all");
  const [selectedExecutor, setSelectedExecutor] = useState<string>("all");
  const [selectedItems, setSelectedItems] = useState<Set<SelectionKey>>(new Set());

  // ── Data queries ──
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

  const { data: overrides = [] } = useQuery({
    queryKey: ["maintenance-overrides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_maintenance_overrides")
        .select("vehicle_id, maintenance_plan_id, active, custom_km_interval, custom_time_interval_days");
      if (error) throw error;
      return data ?? [];
    },
  });

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

  // ── Computed statuses ──
  const allStatuses = useMemo(() => {
    if (!plans.length || !vehicles.length) return [];
    const result: { vehicle: Vehicle; statuses: VehiclePlanStatus[] }[] = [];
    const filteredVehicles = selectedVehicle === "all"
      ? vehicles : vehicles.filter((v) => v.id === selectedVehicle);

    for (const vehicle of filteredVehicles) {
      let statuses = computeVehiclePlanStatuses(plans, executions, vehicle.id, vehicle.km_atual);
      // Filter out plans disabled via overrides
      statuses = statuses.filter((s) => {
        const ov = overrides.find((o) => o.vehicle_id === vehicle.id && o.maintenance_plan_id === s.plan.id);
        return !ov || ov.active !== false;
      });
      if (selectedCategory !== "all") {
        statuses = statuses.filter((s) => s.plan.category === selectedCategory);
      }
      if (selectedExecutor !== "all") {
        statuses = statuses.filter((s) => ((s.plan as any).executor_type ?? "oficina") === selectedExecutor);
      }
      if (selectedAlert === "atrasados") {
        statuses = statuses.filter((s) => s.alert !== "ok");
      } else if (selectedAlert !== "all") {
        statuses = statuses.filter((s) => s.alert === selectedAlert);
      }
      if (statuses.length > 0) result.push({ vehicle, statuses });
    }
    return result;
  }, [plans, executions, vehicles, overrides, selectedVehicle, selectedCategory, selectedAlert, selectedExecutor]);

  // Summary counts (unfiltered by alert)
  const summary = useMemo(() => {
    const counts = { ok: 0, yellow: 0, red: 0, black: 0 };
    if (!plans.length || !vehicles.length) return counts;
    const allVehicles = selectedVehicle === "all" ? vehicles : vehicles.filter((v) => v.id === selectedVehicle);
    for (const vehicle of allVehicles) {
      let statuses = computeVehiclePlanStatuses(plans, executions, vehicle.id, vehicle.km_atual);
      statuses = statuses.filter((s) => {
        const ov = overrides.find((o) => o.vehicle_id === vehicle.id && o.maintenance_plan_id === s.plan.id);
        return !ov || ov.active !== false;
      });
      if (selectedCategory !== "all") statuses = statuses.filter((s) => s.plan.category === selectedCategory);
      for (const s of statuses) counts[s.alert]++;
    }
    return counts;
  }, [plans, executions, vehicles, overrides, selectedVehicle, selectedCategory]);

  // ── Selection helpers ──
  const toggleItem = (vehicleId: string, planId: string) => {
    const key: SelectionKey = `${vehicleId}::${planId}`;
    setSelectedItems((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const hasOpenTicket = (vehicleId: string, planId: string) =>
    openTickets.some((t) => t.vehicle_id === vehicleId && t.maintenance_plan_id === planId);

  // Select all visible non-ok items without open tickets
  const selectAllVisible = () => {
    const keys: SelectionKey[] = [];
    for (const { vehicle, statuses } of allStatuses) {
      for (const s of statuses) {
        if (s.alert !== "ok" && !hasOpenTicket(vehicle.id, s.plan.id)) {
          keys.push(`${vehicle.id}::${s.plan.id}`);
        }
      }
    }
    setSelectedItems(new Set(keys));
  };

  const clearSelection = () => setSelectedItems(new Set());

  // Are all visible selectable items selected?
  const allVisibleSelected = useMemo(() => {
    let count = 0;
    for (const { vehicle, statuses } of allStatuses) {
      for (const s of statuses) {
        if (s.alert !== "ok" && !hasOpenTicket(vehicle.id, s.plan.id)) {
          count++;
          if (!selectedItems.has(`${vehicle.id}::${s.plan.id}`)) return false;
        }
      }
    }
    return count > 0;
  }, [allStatuses, selectedItems, openTickets]);

  // ── Build selected data for batch ──
  const getSelectedItemsData = () => {
    const grouped = new Map<string, { vehicle: Vehicle; items: VehiclePlanStatus[] }>();
    for (const key of selectedItems) {
      const [vehicleId, planId] = key.split("::");
      const vehicleGroup = allStatuses.find((g) => g.vehicle.id === vehicleId);
      if (!vehicleGroup) continue;
      const status = vehicleGroup.statuses.find((s) => s.plan.id === planId);
      if (!status) continue;
      if (!grouped.has(vehicleId)) grouped.set(vehicleId, { vehicle: vehicleGroup.vehicle, items: [] });
      grouped.get(vehicleId)!.items.push(status);
    }
    return grouped;
  };

  // ── Mutations ──
  const createBatchTicketMutation = useMutation({
    mutationFn: async () => {
      const grouped = getSelectedItemsData();
      const createdTickets: { vehiclePlaca: string; vehicleModelo: string; vehicleKm: number; items: VehiclePlanStatus[]; createdAt: string }[] = [];

      for (const [vehicleId, { vehicle, items }] of grouped) {
        const worstAlert = items.reduce<AlertLevel>((worst, s) => {
          const order: AlertLevel[] = ["ok", "yellow", "red", "black"];
          return order.indexOf(s.alert) > order.indexOf(worst) ? s.alert : worst;
        }, "ok");
        const prioridade = worstAlert === "black" ? "critica" : worstAlert === "red" ? "alta" : "media";
        const descricao = items.map((i) =>
          `• ${i.plan.name} (${Math.round(i.pctMax)}% consumido) — ${(i.plan as any).executor_type === "tecnico" ? "Técnico" : "Oficina"}`
        ).join("\n");

        const { error } = await supabase.from("maintenance_tickets").insert({
          titulo: `[Preventiva] ${vehicle.placa} — ${items.length} ${items.length === 1 ? "item" : "itens"}`,
          descricao: `Manutenção preventiva consolidada\nVeículo: ${vehicle.placa} — ${vehicle.modelo}\nKM: ${vehicle.km_atual.toLocaleString("pt-BR")}\n\nItens:\n${descricao}`,
          vehicle_id: vehicleId,
          tipo: "preventiva",
          prioridade,
          created_by: user?.id,
          maintenance_plan_id: items[0].plan.id,
        } as any);
        if (error) throw error;
        createdTickets.push({ vehiclePlaca: vehicle.placa, vehicleModelo: vehicle.modelo, vehicleKm: vehicle.km_atual, items, createdAt: new Date().toISOString() });
      }
      return createdTickets;
    },
    onSuccess: (createdTickets) => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["open-preventiva-tickets"] });
      clearSelection();
      for (const ticket of createdTickets) {
        generatePreventivaPdf({
          titulo: `Preventiva — ${ticket.vehiclePlaca}`,
          descricao: null,
          vehiclePlaca: ticket.vehiclePlaca,
          vehicleModelo: ticket.vehicleModelo,
          vehicleKm: ticket.vehicleKm,
          createdAt: ticket.createdAt,
          items: ticket.items.map((i) => ({
            name: i.plan.name, category: i.plan.category, itemType: i.plan.item_type,
            executorType: (i.plan as any).executor_type ?? "oficina",
            pctMax: i.pctMax, kmSince: i.kmSince, daysSince: i.daysSince,
          })),
        });
      }
      toast.success(`${createdTickets.length} chamado(s) criado(s) e PDF(s) gerado(s)!`, {
        action: { label: "Ver Chamados", onClick: () => navigate("/chamados") },
      });
    },
    onError: (err: any) => toast.error(err.message || "Erro ao criar chamados"),
  });

  const createTicketMutation = useMutation({
    mutationFn: async (data: { vehicleId: string; planId: string; planName: string; vehiclePlaca: string; vehicleModelo: string; alert: AlertLevel; pctMax: number; executorType: string }) => {
      const prioridade = data.alert === "black" ? "critica" : data.alert === "red" ? "alta" : "media";
      const descricao = `Manutenção preventiva: ${data.planName}\nVeículo: ${data.vehiclePlaca} — ${data.vehicleModelo}\nUrgência: ${Math.round(data.pctMax)}% do intervalo consumido\nExecutor: ${data.executorType === "tecnico" ? "Técnico (autogestão)" : "Oficina mecânica"}`;
      const { error } = await supabase.from("maintenance_tickets").insert({
        titulo: `[Preventiva] ${data.planName} — ${data.vehiclePlaca}`,
        descricao, vehicle_id: data.vehicleId, tipo: "preventiva", prioridade,
        created_by: user?.id, maintenance_plan_id: data.planId,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["open-preventiva-tickets"] });
      toast.success("Chamado criado!", { action: { label: "Ver Chamados", onClick: () => navigate("/chamados") } });
    },
    onError: (err: any) => toast.error(err.message || "Erro ao criar chamado"),
  });

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════

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
        <CardContent className="p-3 sm:p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filtros:</span>
          </div>
          <Select value={selectedVehicle} onValueChange={(value) => { setSelectedVehicle(value); clearSelection(); }}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Todos os veículos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os veículos</SelectItem>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.placa} — {v.modelo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedCategory} onValueChange={(value) => { setSelectedCategory(value); clearSelection(); }}>
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
          <Select value={selectedAlert} onValueChange={(value) => { setSelectedAlert(value); clearSelection(); }}>
            <SelectTrigger className="w-64 h-9">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent>
              {ALERT_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedExecutor} onValueChange={(value) => { setSelectedExecutor(value); clearSelection(); }}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Todos os executores" />
            </SelectTrigger>
            <SelectContent>
              {EXECUTOR_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
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
                  const isSelected = selectedItems.has(`${vehicle.id}::${s.plan.id}`);
                  const canSelect = s.alert !== "ok" && !ticketExists;
                  return (
                    <div key={s.plan.id} className={`px-4 py-3 ${isSelected ? "bg-primary/5" : ""}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isSelected}
                            disabled={!canSelect}
                            onCheckedChange={() => canSelect && toggleItem(vehicle.id, s.plan.id)}
                            className={!canSelect ? "opacity-30" : ""}
                          />
                          <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
                          <span className="text-sm font-medium truncate max-w-[140px]">{s.plan.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${executor.className}`}>{executor.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{CATEGORY_SHORT[s.plan.category]}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1 ml-8">
                        <span className="text-xs text-muted-foreground">
                          {Math.round(s.pctMax)}% · {s.daysSince}d
                          {s.plan.km_interval ? ` · ${s.kmSince.toLocaleString("pt-BR")}km` : ""}
                        </span>
                        {ticketExists ? (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Chamado aberto</Badge>
                        ) : s.alert !== "ok" && (
                          <Button size="sm" variant="ghost" className="h-6 text-xs"
                            disabled={createTicketMutation.isPending}
                            onClick={() => createTicketMutation.mutate({
                              vehicleId: vehicle.id, planId: s.plan.id, planName: s.plan.name,
                              vehiclePlaca: vehicle.placa, vehicleModelo: vehicle.modelo,
                              alert: s.alert, pctMax: s.pctMax, executorType: (s.plan as any).executor_type ?? "oficina",
                            })}
                          >
                            <Wrench className="w-3 h-3 mr-1" /> Abrir
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
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={(checked) => checked ? selectAllVisible() : clearSelection()}
                        />
                      </TableHead>
                      <TableHead className="w-10">Status</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Faixa</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Executor</TableHead>
                      <TableHead className="text-right">KM troca</TableHead>
                      <TableHead className="text-right">Periodicidade</TableHead>
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
                      const isSelected = selectedItems.has(`${vehicle.id}::${s.plan.id}`);
                      const canSelect = s.alert !== "ok" && !ticketExists;
                      return (
                        <TableRow key={s.plan.id} className={isSelected ? "bg-primary/5" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={isSelected}
                              disabled={!canSelect}
                              onCheckedChange={() => canSelect && toggleItem(vehicle.id, s.plan.id)}
                              className={!canSelect ? "opacity-30" : ""}
                            />
                          </TableCell>
                          <TableCell><cfg.icon className={`w-4 h-4 ${cfg.color}`} /></TableCell>
                          <TableCell className="font-medium text-sm">{s.plan.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{CATEGORY_SHORT[s.plan.category]}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {TYPE_LABELS[s.plan.item_type] ?? s.plan.item_type}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${executor.className}`}>
                              <executor.icon className="w-3 h-3 mr-1" />{executor.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                            {s.plan.km_interval ? `${s.plan.km_interval.toLocaleString("pt-BR")} km` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                            {s.plan.time_interval_days >= 30
                              ? `${Math.round(s.plan.time_interval_days / 30)} meses`
                              : `${s.plan.time_interval_days} dias`}
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
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">Chamado aberto</Badge>
                            ) : s.alert !== "ok" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                disabled={createTicketMutation.isPending}
                                onClick={() => createTicketMutation.mutate({
                                  vehicleId: vehicle.id, planId: s.plan.id, planName: s.plan.name,
                                  vehiclePlaca: vehicle.placa, vehicleModelo: vehicle.modelo,
                                  alert: s.alert, pctMax: s.pctMax, executorType: (s.plan as any).executor_type ?? "oficina",
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

      {/* Floating batch bar */}
      <BatchTicketBar
        count={selectedItems.size}
        onCreateTicket={() => createBatchTicketMutation.mutate()}
        onClear={clearSelection}
        isPending={createBatchTicketMutation.isPending}
      />
    </div>
  );
}
