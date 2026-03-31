
DROP POLICY "Authenticated can update ticket actions" ON public.ticket_actions;

CREATE POLICY "Users can update ticket actions"
  ON public.ticket_actions FOR UPDATE TO authenticated
  USING (auth.uid() = created_by);
