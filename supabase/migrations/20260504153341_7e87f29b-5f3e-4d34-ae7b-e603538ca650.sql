
-- Trigger function: sync tickets to TaskFlow via edge functions
CREATE OR REPLACE FUNCTION public.notify_taskflow_on_ticket_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_base_url text := 'https://qfmpyrekjbbqekxrjgov.supabase.co/functions/v1';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbXB5cmVramJicWVreHJqZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Njc5NzMsImV4cCI6MjA4OTQ0Mzk3M30.ac7r6m5dLzMrEQxMQr74Bo38bgeupr5-bs0Ja4CCo2s';
  v_payload jsonb;
  v_vehicle_placa text;
  v_vehicle_modelo text;
BEGIN
  -- Skip if this update came from taskflow callback (prevent loops)
  IF TG_OP = 'UPDATE' AND NEW.last_sync_source = 'taskflow-callback' THEN
    RETURN NEW;
  END IF;

  -- Get vehicle info
  SELECT placa, modelo INTO v_vehicle_placa, v_vehicle_modelo
  FROM public.vehicles WHERE id = NEW.vehicle_id;

  IF TG_OP = 'INSERT' THEN
    -- New ticket → forward to TaskFlow
    v_payload := jsonb_build_object(
      'ticket_id', NEW.id,
      'titulo', NEW.titulo,
      'descricao', COALESCE(NEW.descricao, ''),
      'prioridade', NEW.prioridade,
      'placa', COALESCE(v_vehicle_placa, ''),
      'modelo', COALESCE(v_vehicle_modelo, ''),
      'tipo', NEW.tipo
    );

    PERFORM net.http_post(
      url := v_base_url || '/forward-ticket-todoist',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := v_payload
    );

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only sync if status changed OR ticket has external_ref
    IF NEW.external_ref IS NOT NULL AND (
      OLD.status IS DISTINCT FROM NEW.status OR
      OLD.titulo IS DISTINCT FROM NEW.titulo OR
      OLD.prioridade IS DISTINCT FROM NEW.prioridade
    ) THEN
      v_payload := jsonb_build_object(
        'ticket_id', NEW.id,
        'external_ref', NEW.external_ref,
        'status', NEW.status,
        'titulo', NEW.titulo,
        'descricao', COALESCE(NEW.descricao, ''),
        'prioridade', NEW.prioridade,
        'placa', COALESCE(v_vehicle_placa, ''),
        'modelo', COALESCE(v_vehicle_modelo, '')
      );

      PERFORM net.http_post(
        url := v_base_url || '/forward-update-todoist',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body := v_payload
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_sync_ticket_to_taskflow ON public.maintenance_tickets;
CREATE TRIGGER trg_sync_ticket_to_taskflow
  AFTER INSERT OR UPDATE ON public.maintenance_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_taskflow_on_ticket_change();
