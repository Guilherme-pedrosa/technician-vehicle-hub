
CREATE TABLE public.cost_manual_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_external_id text NOT NULL,
  auvo_external_id text NOT NULL,
  motivo text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rota_external_id),
  UNIQUE (auvo_external_id)
);

ALTER TABLE public.cost_manual_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view manual reconciliations"
  ON public.cost_manual_reconciliations FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can manage manual reconciliations"
  ON public.cost_manual_reconciliations FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
