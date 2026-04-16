DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Checklist photos are publicly accessible'
  ) THEN
    DROP POLICY "Checklist photos are publicly accessible" ON storage.objects;
  END IF;
END $$;