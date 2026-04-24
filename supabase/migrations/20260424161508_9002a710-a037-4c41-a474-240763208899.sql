CREATE TABLE public.checklist_release_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.vehicle_checklists(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('liberacao', 'rebloqueio')),
  previous_resultado TEXT NOT NULL,
  new_resultado TEXT NOT NULL,
  motivo TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_release_log_checklist ON public.checklist_release_log(checklist_id, created_at DESC);
CREATE INDEX idx_release_log_created_at ON public.checklist_release_log(created_at DESC);

ALTER TABLE public.checklist_release_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view release log"
  ON public.checklist_release_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert release log"
  ON public.checklist_release_log FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid());