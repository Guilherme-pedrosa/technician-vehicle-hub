DROP INDEX IF EXISTS public.uq_vte_dedup;

CREATE INDEX IF NOT EXISTS idx_vte_lookup_event
  ON public.vehicle_telemetry_events (adesao_id, data, event_at, event_type, motorista_id);