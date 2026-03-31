import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MaintenancePlan {
  id: string;
  name: string;
  description: string | null;
  category: string;
  item_type: string;
  km_interval: number | null;
  time_interval_days: number;
  alert_threshold_pct: number;
  applies_to_all: boolean;
  active: boolean;
}

export interface MaintenanceExecution {
  id: string;
  vehicle_id: string;
  maintenance_plan_id: string;
  executed_at: string;
  km_at_execution: number;
  next_km_due: number | null;
  next_date_due: string | null;
  executed_by: string | null;
  notes: string | null;
  cost: number | null;
  ticket_id: string | null;
}

export type AlertLevel = "ok" | "yellow" | "red" | "black";

export interface VehiclePlanStatus {
  plan: MaintenancePlan;
  lastExecution: MaintenanceExecution | null;
  pctKm: number;
  pctTime: number;
  pctMax: number;
  alert: AlertLevel;
  kmSince: number;
  daysSince: number;
}

function getAlertLevel(pct: number, threshold: number): AlertLevel {
  if (pct >= 120) return "black";
  if (pct >= 100) return "red";
  if (pct >= threshold) return "yellow";
  return "ok";
}

export function useMaintenancePlans() {
  return useQuery<MaintenancePlan[]>({
    queryKey: ["maintenance-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_plans")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name");
      if (error) throw error;
      return data as unknown as MaintenancePlan[];
    },
  });
}

export function useMaintenanceExecutions() {
  return useQuery<MaintenanceExecution[]>({
    queryKey: ["maintenance-executions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_executions")
        .select("*")
        .order("executed_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MaintenanceExecution[];
    },
  });
}

export function computeVehiclePlanStatuses(
  plans: MaintenancePlan[],
  executions: MaintenanceExecution[],
  vehicleId: string,
  currentKm: number
): VehiclePlanStatus[] {
  const now = new Date();
  
  return plans.map((plan) => {
    // Find last execution for this vehicle + plan
    const lastExec = executions.find(
      (e) => e.vehicle_id === vehicleId && e.maintenance_plan_id === plan.id
    ) ?? null;

    let kmSince = currentKm; // if no execution, assume all km
    let daysSince = 999; // default high

    if (lastExec) {
      kmSince = currentKm - lastExec.km_at_execution;
      daysSince = Math.floor(
        (now.getTime() - new Date(lastExec.executed_at).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    const pctKm = plan.km_interval ? (kmSince / plan.km_interval) * 100 : 0;
    const pctTime = (daysSince / plan.time_interval_days) * 100;
    const pctMax = Math.max(pctKm, pctTime);
    const alert = getAlertLevel(pctMax, plan.alert_threshold_pct);

    return { plan, lastExecution: lastExec, pctKm, pctTime, pctMax, alert, kmSince, daysSince };
  });
}
