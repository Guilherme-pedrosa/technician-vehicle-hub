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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Skull,
  Loader2,
  Plus,
  Filter,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

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
  const [selectedVehicle, setSelectedVehicle] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAlert, setSelectedAlert] = useState<string>("all");
  const [execDialog, setExecDialog] = useState<{ open: boolean; vehicleId: string; planId: string; vehicleKm: number } | null>(null);
  const [execKm, setExecKm] = useState("");
  const [execNotes, setExecNotes] = useState("");
  const [execCost, setExecCost] = useState("");

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

  const isLoading = loadingVehicles || loadingPlans || loadingExecs;

  // Compute statuses for all vehicles
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

  // Summary counts
  const summary = useMemo(() => {
    const counts = { ok: 0, yellow: 0, red: 0, black: 0 };
    for (const { statuses } of allStatuses) {
      for (const s of statuses) {
        counts[s.alert]++;
      }
    }
    return counts;
  }, [allStatuses]);

  // Register execution mutation
  const registerMutation = useMutation({
    mutationFn: async (data: { vehicleId: string; planId: string; km: number; notes: string; cost: number | null }) => {
      const plan = plans.find((p) => p.id === data.planId);
      const nextKm = plan?.km_interval ? data.km + plan.km_interval : null;
      const nextDate = plan ? new Date(Date.now() + plan.time_interval_days * 24 * 60 * 60 * 1000).toISOString().split("T")[0] : null;

      const { error } = await supabase.from("maintenance_executions").insert({
        vehicle_id: data.vehicleId,
        maintenance_plan_id: data.planId,
        km_at_execution: data.km,
        next_km_due: nextKm,
        next_date_due: nextDate,
        executed_by: user?.id,
        notes: data.notes || null,
        cost: data.cost,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-executions"] });
      toast.success("Execução registrada com sucesso");
      setExecDialog(null);
      setExecKm("");
      setExecNotes("");
      setExecCost("");
    },
    onError: (err: any) => toast.error(err.message || "Erro ao registrar"),
  });

  const handleRegister = () => {
    if (!execDialog) return;
    const km = parseInt(execKm);
    if (isNaN(km) || km <= 0) {
      toast.error("Informe o KM válido");
      return;
    }
    registerMutation.mutate({
      vehicleId: execDialog.vehicleId,
      planId: execDialog.planId,
      km,
      notes: execNotes,
      cost: execCost ? parseFloat(execCost) : null,
    });
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
                  return (
                    <div key={s.plan.id} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
                          <span className="text-sm font-medium truncate max-w-[200px]">{s.plan.name}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORY_SHORT[s.plan.category]}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                          {Math.round(s.pctMax)}% · {s.daysSince}d
                          {s.plan.km_interval ? ` · ${s.kmSince.toLocaleString("pt-BR")}km` : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => setExecDialog({ open: true, vehicleId: vehicle.id, planId: s.plan.id, vehicleKm: vehicle.km_atual })}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Registrar
                        </Button>
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
                      <TableHead className="text-right">% Consumido</TableHead>
                      <TableHead className="text-right">KM desde</TableHead>
                      <TableHead className="text-right">Dias desde</TableHead>
                      <TableHead className="text-right">Última execução</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statuses.map((s) => {
                      const cfg = ALERT_CONFIG[s.alert];
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
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setExecDialog({ open: true, vehicleId: vehicle.id, planId: s.plan.id, vehicleKm: vehicle.km_atual })}
                            >
                              <Plus className="w-3 h-3 mr-1" /> Registrar
                            </Button>
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

      {/* Register Execution Dialog */}
      <Dialog open={!!execDialog?.open} onOpenChange={(open) => !open && setExecDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Execução</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">KM no momento da execução</label>
              <Input
                type="number"
                value={execKm}
                onChange={(e) => setExecKm(e.target.value)}
                placeholder={execDialog ? `KM atual: ${execDialog.vehicleKm.toLocaleString("pt-BR")}` : ""}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Custo (R$)</label>
              <Input
                type="number"
                step="0.01"
                value={execCost}
                onChange={(e) => setExecCost(e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Observações</label>
              <Textarea
                value={execNotes}
                onChange={(e) => setExecNotes(e.target.value)}
                placeholder="Detalhes da execução..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecDialog(null)}>Cancelar</Button>
            <Button onClick={handleRegister} disabled={registerMutation.isPending}>
              {registerMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
