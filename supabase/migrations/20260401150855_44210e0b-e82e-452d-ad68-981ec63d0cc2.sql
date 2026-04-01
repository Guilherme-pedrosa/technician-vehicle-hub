-- Add new columns for telemetry data
ALTER TABLE public.daily_vehicle_km ADD COLUMN IF NOT EXISTS telemetrias INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.daily_vehicle_km ADD COLUMN IF NOT EXISTS velocidade_maxima NUMERIC(6,1) DEFAULT 0;
ALTER TABLE public.daily_vehicle_km ADD COLUMN IF NOT EXISTS excessos_velocidade INTEGER NOT NULL DEFAULT 0;

-- App settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage settings" ON public.app_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (key, value) VALUES ('limite_velocidade_kmh', '120') ON CONFLICT DO NOTHING;