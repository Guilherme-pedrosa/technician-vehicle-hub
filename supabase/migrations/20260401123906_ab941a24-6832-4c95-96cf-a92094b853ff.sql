CREATE TABLE IF NOT EXISTS public.daily_vehicle_km (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adesao_id TEXT NOT NULL,
  placa TEXT NOT NULL,
  data DATE NOT NULL,
  motorista_nome TEXT NOT NULL DEFAULT 'Desconhecido',
  motorista_id TEXT,
  km_percorrido NUMERIC(10,2) NOT NULL DEFAULT 0,
  tempo_deslocamento TEXT,
  tipo_vinculo TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(adesao_id, data, motorista_nome)
);

CREATE INDEX idx_daily_vehicle_km_data ON public.daily_vehicle_km(data);
CREATE INDEX idx_daily_vehicle_km_adesao ON public.daily_vehicle_km(adesao_id);

ALTER TABLE public.daily_vehicle_km ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read daily_vehicle_km" 
  ON public.daily_vehicle_km FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage daily_vehicle_km" 
  ON public.daily_vehicle_km FOR ALL TO service_role USING (true);