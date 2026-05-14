UPDATE public.vehicle_checklists vc
SET checklist_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
WHERE status = 'rascunho'
  AND updated_at >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
  AND checklist_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
  AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_checklists other
    WHERE other.vehicle_id = vc.vehicle_id
      AND other.checklist_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      AND other.id <> vc.id
  );