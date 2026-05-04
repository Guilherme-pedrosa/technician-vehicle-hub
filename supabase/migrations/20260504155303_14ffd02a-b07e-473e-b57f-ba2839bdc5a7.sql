-- Add new ticket types
ALTER TYPE public.ticket_type ADD VALUE IF NOT EXISTS 'preenchimento_incorreto';
ALTER TYPE public.ticket_type ADD VALUE IF NOT EXISTS 'alerta_telemetria';

-- Create the "Ocorrências" board
INSERT INTO public.kanban_boards (id, name, color, sort_order, is_default)
VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Ocorrências', '#f59e0b', 1, false);

-- Create columns for the new board
INSERT INTO public.kanban_columns (board_id, name, icon, color, mapped_status, sort_order) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Novo', 'AlertTriangle', '#ef4444', 'aberto', 0),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Em Análise', 'Clock', '#f59e0b', 'em_andamento', 1),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Resolvido', 'CheckCircle', '#22c55e', 'concluido', 2),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Descartado', 'X', '#94a3b8', 'aguardando_peca', 3);