-- Add integration tracking columns to maintenance_tickets
ALTER TABLE public.maintenance_tickets
  ADD COLUMN IF NOT EXISTS external_ref TEXT,
  ADD COLUMN IF NOT EXISTS external_task_id UUID,
  ADD COLUMN IF NOT EXISTS last_sync_source TEXT,
  ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMPTZ;

-- Unique partial index to prevent duplicate external refs
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_tickets_external_ref_unique 
  ON public.maintenance_tickets(external_ref) 
  WHERE external_ref IS NOT NULL;