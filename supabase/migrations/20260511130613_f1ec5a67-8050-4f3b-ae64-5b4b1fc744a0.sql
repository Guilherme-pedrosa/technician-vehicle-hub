CREATE POLICY "Assigned drivers can continue their own draft checklists"
ON public.vehicle_checklists
FOR UPDATE
TO authenticated
USING (
  status = 'rascunho'
  AND EXISTS (
    SELECT 1
    FROM public.drivers d
    WHERE d.id = vehicle_checklists.driver_id
      AND d.user_id = auth.uid()
  )
)
WITH CHECK (
  status IN ('rascunho', 'finalizado')
  AND EXISTS (
    SELECT 1
    FROM public.drivers d
    WHERE d.id = vehicle_checklists.driver_id
      AND d.user_id = auth.uid()
  )
);