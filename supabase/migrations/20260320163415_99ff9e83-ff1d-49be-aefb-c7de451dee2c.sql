
ALTER TABLE public.vehicle_checklists 
ADD COLUMN IF NOT EXISTS calibragem_ok text NOT NULL DEFAULT 'sim',
ADD COLUMN IF NOT EXISTS pneus_visual_ok text NOT NULL DEFAULT 'sim',
ADD COLUMN IF NOT EXISTS fluidos_ok text NOT NULL DEFAULT 'sim',
ADD COLUMN IF NOT EXISTS conducao_ok text NOT NULL DEFAULT 'sim',
ADD COLUMN IF NOT EXISTS kit_ok text NOT NULL DEFAULT 'sim',
ADD COLUMN IF NOT EXISTS avaria_nova text NOT NULL DEFAULT 'nao',
ADD COLUMN IF NOT EXISTS avaria_descricao text,
ADD COLUMN IF NOT EXISTS resultado text NOT NULL DEFAULT 'liberado',
ADD COLUMN IF NOT EXISTS resultado_motivo text,
ADD COLUMN IF NOT EXISTS termo_aceito boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS detalhes jsonb DEFAULT '{}'::jsonb;
