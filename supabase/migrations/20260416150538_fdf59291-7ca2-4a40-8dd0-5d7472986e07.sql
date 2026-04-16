-- Add sequential ticket number
ALTER TABLE public.maintenance_tickets
ADD COLUMN ticket_number SERIAL;

-- Add duplicate_of reference
ALTER TABLE public.maintenance_tickets
ADD COLUMN duplicate_of uuid REFERENCES public.maintenance_tickets(id) ON DELETE SET NULL;

-- Backfill existing tickets with sequential numbers based on creation order
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.maintenance_tickets
)
UPDATE public.maintenance_tickets t
SET ticket_number = n.rn
FROM numbered n
WHERE t.id = n.id;

-- Reset sequence to continue after last number
SELECT setval(
  pg_get_serial_sequence('public.maintenance_tickets', 'ticket_number'),
  COALESCE((SELECT MAX(ticket_number) FROM public.maintenance_tickets), 0)
);