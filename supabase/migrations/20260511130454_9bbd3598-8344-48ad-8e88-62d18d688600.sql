UPDATE public.drivers
SET user_id = '263845e9-d0da-4eae-9f9a-18e30bb5acfd'
WHERE id = 'd07b3378-76f3-445b-8480-3d3fee3c2163'
  AND user_id IS NULL;

UPDATE public.vehicle_checklists
SET created_by = '263845e9-d0da-4eae-9f9a-18e30bb5acfd'
WHERE id = '2c443a53-b3ca-47b2-a32b-94293e46e8ed'
  AND status = 'rascunho';