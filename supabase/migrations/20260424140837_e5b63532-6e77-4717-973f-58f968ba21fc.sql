-- Garante deduplicação determinística de eventos de telemetria.
-- A API /dirigibilidade pode devolver o mesmo evento em chamadas distintas;
-- usamos external_id (id do evento na RotaExata) como chave única.
-- Eventos sem id externo recebem um synthetic key composto no sync.

-- 1) Limpa duplicatas existentes mantendo o registro mais recente por external_id
WITH ranked AS (
  SELECT id,
         external_id,
         ROW_NUMBER() OVER (
           PARTITION BY external_id
           ORDER BY synced_at DESC, created_at DESC
         ) AS rn
  FROM public.vehicle_telemetry_events
  WHERE external_id IS NOT NULL
)
DELETE FROM public.vehicle_telemetry_events v
USING ranked r
WHERE v.id = r.id AND r.rn > 1;

-- 2) Index único parcial (permite NULL no external_id durante migração,
--    mas o sync sempre vai gerar uma chave determinística)
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_telemetry_events_external_id_uniq
  ON public.vehicle_telemetry_events (external_id)
  WHERE external_id IS NOT NULL;

-- 3) Index para acelerar consultas por dia/adesao (usado pelo sync e dashboard)
CREATE INDEX IF NOT EXISTS vehicle_telemetry_events_adesao_data_idx
  ON public.vehicle_telemetry_events (adesao_id, data);
