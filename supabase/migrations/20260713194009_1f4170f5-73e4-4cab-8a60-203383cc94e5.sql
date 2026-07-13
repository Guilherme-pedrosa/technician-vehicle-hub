CREATE TABLE public.cost_unmatch_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_external_id text NOT NULL,
  auvo_external_id text NOT NULL,
  motivo text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rota_external_id, auvo_external_id)
);

CREATE INDEX idx_cost_unmatch_blocks_rota ON public.cost_unmatch_blocks(rota_external_id);
CREATE INDEX idx_cost_unmatch_blocks_auvo ON public.cost_unmatch_blocks(auvo_external_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_unmatch_blocks TO authenticated;
GRANT ALL ON public.cost_unmatch_blocks TO service_role;

ALTER TABLE public.cost_unmatch_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read unmatch blocks"
ON public.cost_unmatch_blocks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can create unmatch blocks"
ON public.cost_unmatch_blocks FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can delete unmatch blocks"
ON public.cost_unmatch_blocks FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));