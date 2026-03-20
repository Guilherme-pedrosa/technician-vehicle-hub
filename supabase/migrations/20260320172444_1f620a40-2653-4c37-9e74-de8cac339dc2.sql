
CREATE TABLE public.checklist_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text UNIQUE NOT NULL DEFAULT 'default',
  photo_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  inspection_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.checklist_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view config"
ON public.checklist_config FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage config"
ON public.checklist_config FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
