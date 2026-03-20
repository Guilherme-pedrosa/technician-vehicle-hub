CREATE TABLE public.email_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id text,
  recipient_email text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  resend_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view email logs"
  ON public.email_send_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service can insert email logs"
  ON public.email_send_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX idx_email_send_log_created_at ON public.email_send_log (created_at DESC);
CREATE INDEX idx_email_send_log_status ON public.email_send_log (status);