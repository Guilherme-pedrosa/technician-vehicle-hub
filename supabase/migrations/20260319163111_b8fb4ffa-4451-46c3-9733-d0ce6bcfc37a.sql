
-- Table to store daily vehicle checklists
CREATE TABLE public.vehicle_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE NOT NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  checklist_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Identification
  tripulacao text,
  destino text,
  
  -- Fluids
  nivel_oleo text NOT NULL DEFAULT 'conforme',
  troca_oleo text NOT NULL DEFAULT 'ok',
  nivel_agua text NOT NULL DEFAULT 'conforme',
  
  -- Exterior / Body
  danos_veiculo text NOT NULL DEFAULT 'nao',
  farois_lanternas text NOT NULL DEFAULT 'conforme',
  vidros text NOT NULL DEFAULT 'conforme',
  limpeza_organizacao text NOT NULL DEFAULT 'sim',
  
  -- Mechanical
  motor text NOT NULL DEFAULT 'conforme',
  cambio text NOT NULL DEFAULT 'conforme',
  ruido_anormal text NOT NULL DEFAULT 'nao',
  som text NOT NULL DEFAULT 'conforme',
  
  -- Tires
  pneus text NOT NULL DEFAULT 'conforme',
  pneu_estepe text NOT NULL DEFAULT 'conforme',
  
  -- Safety
  itens_seguranca text NOT NULL DEFAULT 'sim',
  acessorios text NOT NULL DEFAULT 'sim',
  
  -- Observations
  observacoes text,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- One checklist per vehicle per day
  UNIQUE(vehicle_id, checklist_date)
);

-- RLS
ALTER TABLE public.vehicle_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view checklists"
  ON public.vehicle_checklists FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can create checklists"
  ON public.vehicle_checklists FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can manage checklists"
  ON public.vehicle_checklists FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_vehicle_checklists
  BEFORE UPDATE ON public.vehicle_checklists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
