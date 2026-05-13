CREATE TABLE public.cost_placa_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('rotaexata', 'auvo')),
  external_id text NOT NULL,
  placa text NOT NULL,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

ALTER TABLE public.cost_placa_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view cost placa overrides"
  ON public.cost_placa_overrides FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage cost placa overrides"
  ON public.cost_placa_overrides FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_cost_placa_overrides_updated_at
  BEFORE UPDATE ON public.cost_placa_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cost_placa_overrides_lookup
  ON public.cost_placa_overrides (source, external_id);