-- Tabela de eventos brutos de telemetria (1 linha por evento)
CREATE TABLE IF NOT EXISTS public.vehicle_telemetry_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adesao_id TEXT NOT NULL,
  placa TEXT NOT NULL,
  data DATE NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL, -- 'freada' | 'aceleracao' | 'curva' | 'outro'
  event_type_raw TEXT,      -- texto original vindo da API
  motorista_id TEXT,
  motorista_nome TEXT,
  endereco TEXT,
  velocidade NUMERIC,
  duracao_segundos NUMERIC,
  external_id TEXT,         -- id do evento na Rota Exata, se houver
  raw JSONB,                -- payload completo p/ debug
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de leitura
CREATE INDEX IF NOT EXISTS idx_vte_data ON public.vehicle_telemetry_events (data);
CREATE INDEX IF NOT EXISTS idx_vte_placa_data ON public.vehicle_telemetry_events (placa, data);
CREATE INDEX IF NOT EXISTS idx_vte_adesao_data ON public.vehicle_telemetry_events (adesao_id, data);
CREATE INDEX IF NOT EXISTS idx_vte_motorista_data ON public.vehicle_telemetry_events (motorista_id, data);
CREATE INDEX IF NOT EXISTS idx_vte_event_at ON public.vehicle_telemetry_events (event_at);

-- Dedup: mesmo veículo+timestamp+tipo+motorista = mesmo evento
CREATE UNIQUE INDEX IF NOT EXISTS uq_vte_dedup
  ON public.vehicle_telemetry_events (adesao_id, event_at, event_type, COALESCE(motorista_id, ''));

-- RLS
ALTER TABLE public.vehicle_telemetry_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view telemetry events"
  ON public.vehicle_telemetry_events
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage telemetry events"
  ON public.vehicle_telemetry_events
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage telemetry events"
  ON public.vehicle_telemetry_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);