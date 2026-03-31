
-- Criar tabela de planos de manutenção preventiva
CREATE TABLE public.maintenance_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('faixa_m', 'faixa_a', 'faixa_b', 'faixa_c')),
  item_type TEXT NOT NULL CHECK (item_type IN ('troca', 'servico', 'inspecao')),
  km_interval INTEGER,
  time_interval_days INTEGER NOT NULL,
  alert_threshold_pct INTEGER DEFAULT 90,
  applies_to_all BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Criar tabela de overrides por veículo
CREATE TABLE public.vehicle_maintenance_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  maintenance_plan_id UUID REFERENCES public.maintenance_plans(id) ON DELETE CASCADE NOT NULL,
  custom_km_interval INTEGER,
  custom_time_interval_days INTEGER,
  active BOOLEAN DEFAULT true,
  UNIQUE(vehicle_id, maintenance_plan_id)
);

-- Criar tabela de execuções (histórico)
CREATE TABLE public.maintenance_executions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  maintenance_plan_id UUID REFERENCES public.maintenance_plans(id) ON DELETE CASCADE NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT now(),
  km_at_execution INTEGER NOT NULL,
  next_km_due INTEGER,
  next_date_due DATE,
  executed_by UUID,
  notes TEXT,
  cost DECIMAL(10,2),
  ticket_id UUID REFERENCES public.maintenance_tickets(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para maintenance_plans
ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view plans" ON public.maintenance_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage plans" ON public.maintenance_plans FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS para vehicle_maintenance_overrides
ALTER TABLE public.vehicle_maintenance_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view overrides" ON public.vehicle_maintenance_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage overrides" ON public.vehicle_maintenance_overrides FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS para maintenance_executions
ALTER TABLE public.maintenance_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view executions" ON public.maintenance_executions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage executions" ON public.maintenance_executions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated can create executions" ON public.maintenance_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() = executed_by);

-- Trigger updated_at para maintenance_plans
CREATE TRIGGER update_maintenance_plans_updated_at BEFORE UPDATE ON public.maintenance_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
