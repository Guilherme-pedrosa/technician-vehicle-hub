-- ═══════════════════════════════════════════════════════════
-- 1) RESPOSTAS HONESTAS: nada de default "conforme/sim/nao"
-- ═══════════════════════════════════════════════════════════
DO $$
DECLARE
  col text;
  cols text[] := ARRAY[
    'nivel_oleo','troca_oleo','nivel_agua','danos_veiculo','farois_lanternas',
    'vidros','limpeza_organizacao','motor','cambio','ruido_anormal','som',
    'pneus','pneu_estepe','itens_seguranca','acessorios','freios',
    'calibragem_ok','pneus_visual_ok','fluidos_ok','conducao_ok','kit_ok','avaria_nova'
  ];
BEGIN
  FOREACH col IN ARRAY cols LOOP
    EXECUTE format('ALTER TABLE public.vehicle_checklists ALTER COLUMN %I DROP DEFAULT', col);
    EXECUTE format('ALTER TABLE public.vehicle_checklists ALTER COLUMN %I DROP NOT NULL', col);
  END LOOP;
END $$;

-- Resultado operacional nunca mais "liberado" por omissão.
ALTER TABLE public.vehicle_checklists ALTER COLUMN resultado DROP DEFAULT;

-- ═══════════════════════════════════════════════════════════
-- 2) EVENT_CODE ESTÁVEL NA TRILHA DE AUDITORIA
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.checklist_ai_audit_events
  ADD COLUMN IF NOT EXISTS event_code text NOT NULL DEFAULT 'generico';

CREATE OR REPLACE FUNCTION public.set_checklist_audit_event_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.event_code := COALESCE(NULLIF(TRIM(NEW.event_code), ''), 'generico');

  NEW.event_key := NEW.checklist_id::text || '|' || NEW.categoria || '|'
    || COALESCE(NEW.photo_index::text, 'na') || '|' || NEW.status
    || '|' || NEW.event_code;

  IF NEW.status = 'forced' THEN
    IF NEW.forced_at IS NULL THEN
      NEW.forced_at := now();
    END IF;
  ELSE
    NEW.forced_at := NULL;
    NEW.forced_by := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_checklist_audit_event_code
  ON public.checklist_ai_audit_events (event_code);

-- ═══════════════════════════════════════════════════════════
-- 3) RESERVA TRANSACIONAL DE E-MAIL (idempotência real)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.reserve_email_send(
  p_dedupe_key text,
  p_checklist_id text,
  p_recipient_email text,
  p_subject text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_stale_after interval DEFAULT interval '10 minutes'
)
RETURNS TABLE (log_id uuid, decision text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.email_send_log%ROWTYPE;
BEGIN
  IF p_dedupe_key IS NULL OR length(trim(p_dedupe_key)) = 0 THEN
    RAISE EXCEPTION 'dedupe_key obrigatório';
  END IF;

  SELECT * INTO v_row
  FROM public.email_send_log
  WHERE dedupe_key = p_dedupe_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.email_send_log (
      checklist_id, recipient_email, subject, status, dedupe_key, metadata,
      attempt_count, attempted_at, updated_at
    ) VALUES (
      p_checklist_id, p_recipient_email, p_subject, 'pending', p_dedupe_key, p_metadata,
      1, now(), now()
    )
    RETURNING id INTO log_id;
    decision := 'reserved';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_row.status = 'sent' THEN
    log_id := v_row.id;
    decision := 'already_sent';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_row.status = 'pending'
     AND COALESCE(v_row.attempted_at, v_row.created_at) > now() - p_stale_after THEN
    log_id := v_row.id;
    decision := 'in_flight';
    RETURN NEXT;
    RETURN;
  END IF;

  -- failed OU pending obsoleto (crash) => nova tentativa atômica na MESMA linha
  UPDATE public.email_send_log
     SET status = 'pending',
         subject = p_subject,
         metadata = p_metadata,
         error_message = NULL,
         attempt_count = COALESCE(v_row.attempt_count, 0) + 1,
         attempted_at = now(),
         updated_at = now()
   WHERE id = v_row.id;

  log_id := v_row.id;
  decision := 'retry';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_email_send(text, text, text, text, jsonb, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_send(text, text, text, text, jsonb, interval) TO service_role;