-- 1) Índice único de subtarefas compatível com onConflict (ticket_id, descricao)
DROP INDEX IF EXISTS public.uq_ticket_action_por_descricao;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_action_por_descricao
  ON public.ticket_actions (ticket_id, descricao);

-- 2) forced_at/forced_by apenas em eventos realmente forçados
CREATE OR REPLACE FUNCTION public.set_checklist_audit_event_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.event_key := NEW.checklist_id::text || '|' || NEW.categoria || '|'
    || COALESCE(NEW.photo_index::text, 'na') || '|' || NEW.status;

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

-- 3) Finalização do checklist não é mais bloqueada por incompletude.
--    Hard-block somente sem veículo ou sem técnico responsável.
CREATE OR REPLACE FUNCTION public.validate_vehicle_checklist_complete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'rascunho' THEN
    RETURN NEW;
  END IF;

  IF NEW.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Checklist inválido: veículo obrigatório';
  END IF;

  IF NEW.driver_id IS NULL THEN
    RAISE EXCEPTION 'Checklist inválido: técnico responsável obrigatório';
  END IF;

  RETURN NEW;
END;
$function$;