-- =====================================================================
-- 1) Trilha de auditoria de IA do checklist
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.checklist_ai_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.vehicle_checklists(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id),
  driver_id uuid REFERENCES public.drivers(id),
  user_id uuid NOT NULL,
  categoria text NOT NULL,
  label text,
  status text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  motivo text,
  reason_original text,
  reject_code text,
  confidence numeric,
  model_used text,
  prompt_version text,
  duration_ms integer,
  photo_url text,
  photo_index integer,
  forced_by uuid,
  forced_at timestamptz,
  audit_required boolean NOT NULL DEFAULT true,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.checklist_ai_audit_events TO authenticated;
GRANT ALL ON public.checklist_ai_audit_events TO service_role;

ALTER TABLE public.checklist_ai_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_events_select" ON public.checklist_ai_audit_events;
CREATE POLICY "audit_events_select" ON public.checklist_ai_audit_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "audit_events_insert" ON public.checklist_ai_audit_events;
CREATE POLICY "audit_events_insert" ON public.checklist_ai_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "audit_events_admin_update" ON public.checklist_ai_audit_events;
CREATE POLICY "audit_events_admin_update" ON public.checklist_ai_audit_events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- event_key SEMPRE gerada/normalizada no servidor (não confiar no cliente)
CREATE OR REPLACE FUNCTION public.set_checklist_audit_event_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.event_key := NEW.checklist_id::text || '|' || NEW.categoria || '|'
    || COALESCE(NEW.photo_index::text, 'na') || '|' || NEW.status;
  IF NEW.forced_at IS NULL THEN
    NEW.forced_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_checklist_audit_event_key ON public.checklist_ai_audit_events;
CREATE TRIGGER trg_set_checklist_audit_event_key
  BEFORE INSERT ON public.checklist_ai_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.set_checklist_audit_event_key();

CREATE UNIQUE INDEX IF NOT EXISTS uq_checklist_audit_event_key
  ON public.checklist_ai_audit_events (event_key);
CREATE INDEX IF NOT EXISTS idx_checklist_audit_checklist
  ON public.checklist_ai_audit_events (checklist_id);
CREATE INDEX IF NOT EXISTS idx_checklist_audit_queue
  ON public.checklist_ai_audit_events (created_at DESC, severity, status);
CREATE INDEX IF NOT EXISTS idx_checklist_audit_recurrence
  ON public.checklist_ai_audit_events (user_id, categoria, status);

-- =====================================================================
-- 2) Idempotência do chamado automático: 1 chamado por checklist
-- =====================================================================
ALTER TABLE public.maintenance_tickets
  ADD COLUMN IF NOT EXISTS source_checklist_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_por_checklist
  ON public.maintenance_tickets (source_checklist_id)
  WHERE source_checklist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_source_checklist
  ON public.maintenance_tickets (source_checklist_id);

-- Subtarefa idempotente por item de NC
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_action_por_descricao
  ON public.ticket_actions (ticket_id, md5(descricao));

-- =====================================================================
-- 3) Deduplicação de e-mails de alerta
-- =====================================================================
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_dedupe_key
  ON public.email_send_log (dedupe_key)
  WHERE dedupe_key IS NOT NULL;