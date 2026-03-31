
CREATE TABLE public.ticket_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.maintenance_tickets(id) ON DELETE CASCADE,
  descricao text NOT NULL,
  concluida boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE public.ticket_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view ticket actions"
  ON public.ticket_actions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can create ticket actions"
  ON public.ticket_actions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can manage ticket actions"
  ON public.ticket_actions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can update ticket actions"
  ON public.ticket_actions FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Admins can delete ticket actions"
  ON public.ticket_actions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
