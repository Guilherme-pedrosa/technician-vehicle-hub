DROP POLICY IF EXISTS "Authenticated users can view checklist photos" ON storage.objects;

CREATE POLICY "Users can view own checklist photos by exact path"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'checklist-photos'
  AND owner = auth.uid()
);