import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, LayoutGrid, Columns, Settings,
  AlertCircle, Clock, Package, CheckCircle2, Circle, Wrench, Flag, Pause, ListTodo,
} from "lucide-react";
import { toast } from "sonner";

const ICON_OPTIONS = [
  { value: "Circle", label: "Círculo", Icon: Circle },
  { value: "AlertCircle", label: "Alerta", Icon: AlertCircle },
  { value: "Clock", label: "Relógio", Icon: Clock },
  { value: "Package", label: "Pacote", Icon: Package },
  { value: "CheckCircle2", label: "Check", Icon: CheckCircle2 },
  { value: "Wrench", label: "Ferramenta", Icon: Wrench },
  { value: "Flag", label: "Bandeira", Icon: Flag },
  { value: "Pause", label: "Pausa", Icon: Pause },
  { value: "ListTodo", label: "Lista", Icon: ListTodo },
];

const COLOR_OPTIONS = [
  "#ef4444", "#f59e0b", "#eab308", "#10b981", "#3b82f6",
  "#6366f1", "#8b5cf6", "#ec4899", "#64748b", "#0ea5e9",
];

const STATUS_OPTIONS = [
  { value: "aberto", label: "Aberto" },
  { value: "em_andamento", label: "Em Andamento" },
  { value: "aguardando_peca", label: "Aguardando Peça" },
  { value: "concluido", label: "Concluído" },
];

type Board = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_default: boolean;
};

type Column = {
  id: string;
  board_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  mapped_status: string | null;
};

export function KanbanConfigDialog({
  open,
  onOpenChange,
  selectedBoardId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selectedBoardId?: string;
}) {
  const qc = useQueryClient();
  const [activeBoardId, setActiveBoardId] = useState<string | null>(selectedBoardId ?? null);
  const [newBoardName, setNewBoardName] = useState("");
  const [newColumnName, setNewColumnName] = useState("");

  const { data: boards = [] } = useQuery({
    queryKey: ["kanban-boards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kanban_boards" as any)
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as Board[];
    },
  });

  useEffect(() => {
    if (!activeBoardId && boards.length > 0) setActiveBoardId(boards[0].id);
  }, [boards, activeBoardId]);

  const { data: columns = [] } = useQuery({
    queryKey: ["kanban-columns", activeBoardId],
    queryFn: async () => {
      if (!activeBoardId) return [];
      const { data, error } = await supabase
        .from("kanban_columns" as any)
        .select("*")
        .eq("board_id", activeBoardId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as Column[];
    },
    enabled: !!activeBoardId,
  });

  // ── Board mutations ────────────────────────────────
  const createBoard = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("kanban_boards" as any)
        .insert({ name, sort_order: boards.length, color: "#3b82f6" })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Board;
    },
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ["kanban-boards"] });
      setActiveBoardId(board.id);
      setNewBoardName("");
      toast.success("Quadro criado!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const updateBoard = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Board> }) => {
      const { error } = await supabase.from("kanban_boards" as any).update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-boards"] });
      toast.success("Quadro atualizado!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const deleteBoard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kanban_boards" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-boards"] });
      qc.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      setActiveBoardId(null);
      toast.success("Quadro apagado!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  // ── Column mutations ───────────────────────────────
  const createColumn = useMutation({
    mutationFn: async (name: string) => {
      if (!activeBoardId) throw new Error("Selecione um quadro");
      const { error } = await supabase.from("kanban_columns" as any).insert({
        board_id: activeBoardId,
        name,
        sort_order: columns.length,
        icon: "Circle",
        color: "#64748b",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-columns", activeBoardId] });
      setNewColumnName("");
      toast.success("Coluna criada!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const updateColumn = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Column> }) => {
      const { error } = await supabase.from("kanban_columns" as any).update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-columns", activeBoardId] });
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const deleteColumn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kanban_columns" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-columns", activeBoardId] });
      qc.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      toast.success("Coluna apagada!");
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const moveColumn = (col: Column, direction: -1 | 1) => {
    const sorted = [...columns].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((c) => c.id === col.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    updateColumn.mutate({ id: col.id, data: { sort_order: swap.sort_order } });
    updateColumn.mutate({ id: swap.id, data: { sort_order: col.sort_order } });
  };

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" /> Configurar Kanban
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── BOARDS ─────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold">Quadros</h3>
            </div>

            <div className="flex flex-wrap gap-2">
              {boards.map((b) => (
                <Badge
                  key={b.id}
                  variant={b.id === activeBoardId ? "default" : "outline"}
                  className="cursor-pointer h-8 px-3 gap-2"
                  style={b.id === activeBoardId ? { backgroundColor: b.color, borderColor: b.color } : { borderColor: b.color, color: b.color }}
                  onClick={() => setActiveBoardId(b.id)}
                >
                  {b.name}
                  {b.is_default && <span className="text-[10px] opacity-70">(padrão)</span>}
                </Badge>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Nome do novo quadro (ex: Frota Pesada)"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                className="h-9"
              />
              <Button
                size="sm"
                disabled={!newBoardName.trim()}
                onClick={() => createBoard.mutate(newBoardName.trim())}
              >
                <Plus className="w-4 h-4 mr-1" /> Criar Quadro
              </Button>
            </div>

            {activeBoard && (
              <div className="bg-muted/40 rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nome do quadro</Label>
                    <Input
                      defaultValue={activeBoard.name}
                      onBlur={(e) => {
                        if (e.target.value !== activeBoard.name) {
                          updateBoard.mutate({ id: activeBoard.id, data: { name: e.target.value } });
                        }
                      }}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cor</Label>
                    <div className="flex flex-wrap gap-1">
                      {COLOR_OPTIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => updateBoard.mutate({ id: activeBoard.id, data: { color: c } })}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${activeBoard.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {!activeBoard.is_default && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Trash2 className="w-4 h-4 mr-1" /> Apagar este quadro
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Apagar "{activeBoard.name}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Todas as colunas serão apagadas. Os chamados deste quadro ficarão sem quadro associado (não serão excluídos).
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground"
                          onClick={() => deleteBoard.mutate(activeBoard.id)}
                        >
                          Apagar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            )}
          </section>

          {/* ── COLUMNS ────────────────────────────── */}
          {activeBoard && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Columns className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold">Colunas de "{activeBoard.name}"</h3>
              </div>

              <div className="space-y-2">
                {columns.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Nenhuma coluna. Adicione abaixo.</p>
                )}
                {[...columns].sort((a, b) => a.sort_order - b.sort_order).map((col, idx, arr) => {
                  const IconComp = ICON_OPTIONS.find((i) => i.value === col.icon)?.Icon ?? Circle;
                  return (
                    <div key={col.id} className="bg-card border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <IconComp className="w-4 h-4 shrink-0" style={{ color: col.color }} />
                        <Input
                          defaultValue={col.name}
                          onBlur={(e) => {
                            if (e.target.value !== col.name) {
                              updateColumn.mutate({ id: col.id, data: { name: e.target.value } });
                            }
                          }}
                          className="h-8 flex-1"
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === 0} onClick={() => moveColumn(col, -1)}>
                          <ChevronUp className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === arr.length - 1} onClick={() => moveColumn(col, 1)}>
                          <ChevronDown className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteColumn.mutate(col.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Ícone</Label>
                          <Select value={col.icon} onValueChange={(v) => updateColumn.mutate({ id: col.id, data: { icon: v } })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ICON_OPTIONS.map(({ value, label, Icon }) => (
                                <SelectItem key={value} value={value}>
                                  <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5" /> {label}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Cor</Label>
                          <div className="flex flex-wrap gap-1 pt-1">
                            {COLOR_OPTIONS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => updateColumn.mutate({ id: col.id, data: { color: c } })}
                                className={`w-5 h-5 rounded-full border-2 ${col.color === c ? "border-foreground" : "border-transparent"}`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Status mapeado</Label>
                          <Select
                            value={col.mapped_status ?? "none"}
                            onValueChange={(v) => updateColumn.mutate({ id: col.id, data: { mapped_status: v === "none" ? null : v } })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Nenhum —</SelectItem>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Nome da nova coluna (ex: Em Aprovação)"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  className="h-9"
                />
                <Button
                  size="sm"
                  disabled={!newColumnName.trim()}
                  onClick={() => createColumn.mutate(newColumnName.trim())}
                >
                  <Plus className="w-4 h-4 mr-1" /> Adicionar Coluna
                </Button>
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
