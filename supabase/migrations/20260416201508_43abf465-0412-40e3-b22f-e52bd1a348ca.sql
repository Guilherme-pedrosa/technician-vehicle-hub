
-- Boards table
CREATE TABLE public.kanban_boards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.kanban_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view boards"
ON public.kanban_boards FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage boards"
ON public.kanban_boards FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Columns table
CREATE TABLE public.kanban_columns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Circle',
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  mapped_status ticket_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view columns"
ON public.kanban_columns FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage columns"
ON public.kanban_columns FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_kanban_columns_board ON public.kanban_columns(board_id, sort_order);

-- Add column reference to tickets
ALTER TABLE public.maintenance_tickets
ADD COLUMN kanban_column_id UUID REFERENCES public.kanban_columns(id) ON DELETE SET NULL,
ADD COLUMN kanban_board_id UUID REFERENCES public.kanban_boards(id) ON DELETE SET NULL;

CREATE INDEX idx_tickets_kanban_column ON public.maintenance_tickets(kanban_column_id);
CREATE INDEX idx_tickets_kanban_board ON public.maintenance_tickets(kanban_board_id);

-- Update timestamps trigger
CREATE TRIGGER update_kanban_boards_updated_at
BEFORE UPDATE ON public.kanban_boards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_kanban_columns_updated_at
BEFORE UPDATE ON public.kanban_columns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default board with current 4 columns
DO $$
DECLARE
  default_board_id UUID;
  col_aberto UUID;
  col_andamento UUID;
  col_peca UUID;
  col_concluido UUID;
BEGIN
  INSERT INTO public.kanban_boards (name, color, sort_order, is_default)
  VALUES ('Chamados', '#3b82f6', 0, true)
  RETURNING id INTO default_board_id;

  INSERT INTO public.kanban_columns (board_id, name, icon, color, sort_order, mapped_status)
  VALUES (default_board_id, 'Aberto', 'AlertCircle', '#ef4444', 0, 'aberto')
  RETURNING id INTO col_aberto;

  INSERT INTO public.kanban_columns (board_id, name, icon, color, sort_order, mapped_status)
  VALUES (default_board_id, 'Em Andamento', 'Clock', '#f59e0b', 1, 'em_andamento')
  RETURNING id INTO col_andamento;

  INSERT INTO public.kanban_columns (board_id, name, icon, color, sort_order, mapped_status)
  VALUES (default_board_id, 'Aguardando Peça', 'Package', '#3b82f6', 2, 'aguardando_peca')
  RETURNING id INTO col_peca;

  INSERT INTO public.kanban_columns (board_id, name, icon, color, sort_order, mapped_status)
  VALUES (default_board_id, 'Concluído', 'CheckCircle2', '#10b981', 3, 'concluido')
  RETURNING id INTO col_concluido;

  -- Migrate existing tickets to the default board/columns
  UPDATE public.maintenance_tickets SET kanban_board_id = default_board_id, kanban_column_id = col_aberto WHERE status = 'aberto';
  UPDATE public.maintenance_tickets SET kanban_board_id = default_board_id, kanban_column_id = col_andamento WHERE status = 'em_andamento';
  UPDATE public.maintenance_tickets SET kanban_board_id = default_board_id, kanban_column_id = col_peca WHERE status = 'aguardando_peca';
  UPDATE public.maintenance_tickets SET kanban_board_id = default_board_id, kanban_column_id = col_concluido WHERE status = 'concluido';
END $$;
