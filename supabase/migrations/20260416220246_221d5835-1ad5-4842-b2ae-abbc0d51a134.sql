CREATE TABLE public.auvo_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auvo_id bigint NOT NULL UNIQUE,
  description text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  expense_date date NOT NULL,
  type_id integer,
  type_name text,
  user_to_id bigint,
  user_to_name text,
  attachment_url text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  parse_status text NOT NULL DEFAULT 'unmatched',
  parsed_keyword text,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_auvo_expenses_date ON public.auvo_expenses(expense_date DESC);
CREATE INDEX idx_auvo_expenses_vehicle ON public.auvo_expenses(vehicle_id);
CREATE INDEX idx_auvo_expenses_driver ON public.auvo_expenses(driver_id);
CREATE INDEX idx_auvo_expenses_user_to ON public.auvo_expenses(user_to_id);
CREATE INDEX idx_auvo_expenses_status ON public.auvo_expenses(parse_status);

ALTER TABLE public.auvo_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view auvo expenses"
  ON public.auvo_expenses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage auvo expenses"
  ON public.auvo_expenses FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage auvo expenses"
  ON public.auvo_expenses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_auvo_expenses_updated_at
  BEFORE UPDATE ON public.auvo_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de aliases para parsing (palavra-chave → veículo)
CREATE TABLE public.vehicle_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_aliases_keyword ON public.vehicle_aliases(lower(keyword));
CREATE INDEX idx_vehicle_aliases_vehicle ON public.vehicle_aliases(vehicle_id);

ALTER TABLE public.vehicle_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view vehicle aliases"
  ON public.vehicle_aliases FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage vehicle aliases"
  ON public.vehicle_aliases FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage vehicle aliases"
  ON public.vehicle_aliases FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_vehicle_aliases_updated_at
  BEFORE UPDATE ON public.vehicle_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();