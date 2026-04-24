CREATE TABLE public.daily_km_sync_status (
  data DATE PRIMARY KEY,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  processed_jobs INTEGER NOT NULL DEFAULT 0,
  failed_jobs INTEGER NOT NULL DEFAULT 0,
  empty_jobs INTEGER NOT NULL DEFAULT 0,
  inserted_events INTEGER NOT NULL DEFAULT 0,
  inserted_sessions INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_km_sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and technicians can view daily km sync status"
ON public.daily_km_sync_status
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'tecnico')
);

CREATE INDEX idx_daily_km_sync_status_synced_at
ON public.daily_km_sync_status (synced_at DESC);