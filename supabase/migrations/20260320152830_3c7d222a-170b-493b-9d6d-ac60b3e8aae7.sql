
-- Add fotos JSONB column to store categorized photos
ALTER TABLE public.vehicle_checklists 
ADD COLUMN IF NOT EXISTS fotos jsonb DEFAULT '{}'::jsonb;

-- Create storage bucket for checklist photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('checklist-photos', 'checklist-photos', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can upload
CREATE POLICY "Authenticated users can upload checklist photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'checklist-photos');

-- Anyone authenticated can view
CREATE POLICY "Authenticated users can view checklist photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'checklist-photos');

-- Admins can delete
CREATE POLICY "Admins can delete checklist photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'checklist-photos' AND public.has_role(auth.uid(), 'admin'));
