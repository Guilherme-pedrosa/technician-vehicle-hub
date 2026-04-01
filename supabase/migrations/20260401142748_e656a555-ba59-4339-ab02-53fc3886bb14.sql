-- Remove old constraint that causes data loss (overwrites multiple sessions)
ALTER TABLE public.daily_vehicle_km DROP CONSTRAINT IF EXISTS daily_vehicle_km_adesao_id_data_motorista_nome_key;

-- Add session identifier column
ALTER TABLE public.daily_vehicle_km ADD COLUMN IF NOT EXISTS hr_vinculo TEXT;

-- New constraint allowing multiple sessions per driver per day
ALTER TABLE public.daily_vehicle_km ADD CONSTRAINT daily_vehicle_km_unique_session 
  UNIQUE(adesao_id, data, motorista_nome, hr_vinculo);