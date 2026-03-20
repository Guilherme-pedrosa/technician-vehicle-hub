
-- Allow creators to update their own checklists
CREATE POLICY "Creators can update own checklists"
ON public.vehicle_checklists
FOR UPDATE
TO authenticated
USING (auth.uid() = created_by);

-- Allow creators to delete their own checklists
CREATE POLICY "Creators can delete own checklists"
ON public.vehicle_checklists
FOR DELETE
TO authenticated
USING (auth.uid() = created_by);
