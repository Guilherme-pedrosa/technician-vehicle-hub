-- 1) Owner do objeto pode apagar as próprias fotos do bucket checklist-photos
DROP POLICY IF EXISTS "Owners can delete own checklist photos" ON storage.objects;
CREATE POLICY "Owners can delete own checklist photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'checklist-photos' AND owner = auth.uid());

-- 2) Reserva de e-mail realmente serial por dedupe_key (advisory lock antes do SELECT)
CREATE OR REPLACE FUNCTION public.reserve_email_send(
  p_dedupe_key text,
  p_checklist_id text,
  p_recipient_email text,
  p_subject text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_stale_after interval DEFAULT '00:10:00'::interval
)
RETURNS TABLE(log_id uuid, decision text)
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

  -- Serializa QUALQUER concorrência nesta chave, inclusive quando a linha
  -- ainda não existe (SELECT ... FOR UPDATE sozinho não cobre esse caso).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_dedupe_key, 0));

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