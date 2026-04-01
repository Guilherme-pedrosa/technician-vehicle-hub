import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, MapPin, Gauge } from "lucide-react";
import { toast } from "sonner";
import { getUltimaPosicao } from "@/services/rotaexata";
import type { Tables } from "@/integrations/supabase/types";

interface PlanItem {
  id: string;
  name: string;
  km_interval: number | null;
  time_interval_days: number;
}

interface ConcluirPreventivaDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ticket: Tables<"maintenance_tickets"> & {
    vehicles?: { placa: string; modelo: string } | null;
  };
  vehicles: Tables<"vehicles">[];
  onDone: () => void;
}

export function ConcluirPreventivaDialog({
  open,
  onOpenChange,
  ticket,
  vehicles,
  onDone,
}: ConcluirPreventivaDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());
  const [trackerKm, setTrackerKm] = useState<number | null>(null);
  const [loadingKm, setLoadingKm] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const vehicle = vehicles.find((v) => v.id === ticket.vehicle_id);

  // Load plans and tracker km when dialog opens
  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      setLoadingPlans(true);
      setLoadingKm(true);

      // 1. Parse plan names from description
      const desc = ticket.descricao || "";
      const planNames: string[] = [];
      const lines = desc.split("\n");
      for (const line of lines) {
        const match = line.match(/^•\s*(.+?)\s*\(\d+%/);
        if (match) planNames.push(match[1].trim());
      }

      // 2. If single plan ticket (maintenance_plan_id set, no bullet items)
      if (planNames.length === 0 && ticket.maintenance_plan_id) {
        const { data } = await supabase
          .from("maintenance_plans")
          .select("id, name, km_interval, time_interval_days")
          .eq("id", ticket.maintenance_plan_id)
          .single();
        if (data) {
          setPlans([data]);
          setSelectedPlanIds(new Set([data.id]));
        }
      } else if (planNames.length > 0) {
        // Fetch all active plans and match by name
        const { data: allPlans } = await supabase
          .from("maintenance_plans")
          .select("id, name, km_interval, time_interval_days")
          .eq("active", true);
        
        if (allPlans) {
          const matched = planNames
            .map((name) => allPlans.find((p) => p.name === name))
            .filter(Boolean) as PlanItem[];
          setPlans(matched);
          setSelectedPlanIds(new Set(matched.map((p) => p.id)));
        }
      }
      setLoadingPlans(false);

      // 3. Fetch km from tracker
      if (vehicle?.adesao_id) {
        try {
          const pos = await getUltimaPosicao(vehicle.adesao_id);
          const km = pos.odometro ? Math.round(pos.odometro / 1000) : null;
          setTrackerKm(km);
        } catch (err) {
          console.error("Erro ao buscar km do rastreador:", err);
          setTrackerKm(null);
        }
      } else {
        setTrackerKm(vehicle?.km_atual ?? null);
      }
      setLoadingKm(false);
    };

    loadData();
  }, [open, ticket, vehicle]);

  const togglePlan = (planId: string) => {
    setSelectedPlanIds((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const km = trackerKm ?? vehicle?.km_atual ?? 0;

      // 1. Update ticket status to concluido
      const { error: statusErr } = await supabase
        .from("maintenance_tickets")
        .update({ status: "concluido" } as any)
        .eq("id", ticket.id);
      if (statusErr) throw statusErr;

      // 2. Create executions for selected plans
      const selectedPlans = plans.filter((p) => selectedPlanIds.has(p.id));
      for (const plan of selectedPlans) {
        const nextKm = plan.km_interval ? km + plan.km_interval : null;
        const nextDate = new Date(
          Date.now() + plan.time_interval_days * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .split("T")[0];

        await supabase.from("maintenance_executions").insert({
          vehicle_id: ticket.vehicle_id,
          maintenance_plan_id: plan.id,
          km_at_execution: km,
          next_km_due: nextKm,
          next_date_due: nextDate,
          executed_by: user?.id,
          ticket_id: ticket.id,
          notes: `Execução via chamado: ${ticket.titulo}`,
        } as any);
      }

      // 3. Update vehicle km if tracker km is newer
      if (trackerKm && vehicle && trackerKm > vehicle.km_atual) {
        await supabase
          .from("vehicles")
          .update({ km_atual: trackerKm } as any)
          .eq("id", vehicle.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-executions"] });
      queryClient.invalidateQueries({ queryKey: ["open-preventiva-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      const total = plans.length;
      const done = selectedPlanIds.size;
      toast.success(
        `Chamado concluído! ${done}/${total} execuções registradas com ${(trackerKm ?? vehicle?.km_atual ?? 0).toLocaleString("pt-BR")} km.`
      );
      onDone();
      onOpenChange(false);
    },
    onError: (err: any) => toast.error("Erro: " + err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            Concluir Preventiva
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Vehicle info */}
          <div className="bg-muted/50 rounded-lg p-3 space-y-1">
            <p className="text-sm font-medium">
              {ticket.vehicles?.placa} — {ticket.vehicles?.modelo}
            </p>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Gauge className="w-3.5 h-3.5" />
                <span>BD: {(vehicle?.km_atual ?? 0).toLocaleString("pt-BR")} km</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                {loadingKm ? (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Buscando...
                  </span>
                ) : trackerKm !== null ? (
                  <span className="font-semibold text-emerald-700">
                    Rastreador: {trackerKm.toLocaleString("pt-BR")} km
                  </span>
                ) : (
                  <span className="text-muted-foreground">Rastreador indisponível</span>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Plan checkboxes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Itens executados</Label>
              <span className="text-xs text-muted-foreground">
                {selectedPlanIds.size}/{plans.length} selecionados
              </span>
            </div>

            {loadingPlans ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando itens...
              </div>
            ) : plans.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                Nenhum plano de manutenção encontrado neste chamado.
              </p>
            ) : (
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {plans.map((plan) => (
                  <label
                    key={plan.id}
                    className="flex items-start gap-3 rounded-md px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedPlanIds.has(plan.id)}
                      onCheckedChange={() => togglePlan(plan.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{plan.name}</span>
                      <div className="flex gap-1.5 mt-0.5">
                        {plan.km_interval && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {plan.km_interval.toLocaleString("pt-BR")} km
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {plan.time_interval_days} dias
                        </Badge>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Confirm button */}
          <Button
            className="w-full"
            disabled={
              confirmMutation.isPending ||
              loadingKm ||
              loadingPlans ||
              selectedPlanIds.size === 0
            }
            onClick={() => confirmMutation.mutate()}
          >
            {confirmMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Confirmar Conclusão ({selectedPlanIds.size} {selectedPlanIds.size === 1 ? "item" : "itens"})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
