import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ListChecks } from "lucide-react";
import { toast } from "sonner";

interface TicketAction {
  id: string;
  ticket_id: string;
  descricao: string;
  concluida: boolean;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  sort_order: number;
}

export function TicketActions({ ticketId }: { ticketId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newAction, setNewAction] = useState("");

  const { data: actions = [], isLoading } = useQuery({
    queryKey: ["ticket-actions", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_actions")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as TicketAction[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (descricao: string) => {
      const { error } = await supabase.from("ticket_actions").insert({
        ticket_id: ticketId,
        descricao,
        created_by: user!.id,
        sort_order: actions.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket-actions", ticketId] });
      setNewAction("");
    },
    onError: () => toast.error("Erro ao adicionar ação"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, concluida }: { id: string; concluida: boolean }) => {
      const { error } = await supabase
        .from("ticket_actions")
        .update({
          concluida,
          completed_at: concluida ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ticket-actions", ticketId] }),
    onError: () => toast.error("Erro ao atualizar ação"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ticket_actions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ticket-actions", ticketId] }),
    onError: () => toast.error("Erro ao remover ação"),
  });

  const handleAdd = () => {
    const desc = newAction.trim();
    if (!desc) return;
    addMutation.mutate(desc);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const doneCount = actions.filter((a) => a.concluida).length;
  const totalCount = actions.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-semibold">Serviços / Ações</Label>
        </div>
        {totalCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {doneCount}/{totalCount} concluídos
          </span>
        )}
      </div>

      {totalCount > 0 && (
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
          />
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : (
        <div className="space-y-1">
          {actions.map((action) => (
            <div
              key={action.id}
              className="flex items-center gap-2 group rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                checked={action.concluida}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ id: action.id, concluida: Boolean(checked) })
                }
              />
              <span
                className={`flex-1 text-sm ${
                  action.concluida ? "line-through text-muted-foreground" : ""
                }`}
              >
                {action.descricao}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                onClick={() => deleteMutation.mutate(action.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={newAction}
          onChange={(e) => setNewAction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ex: Trocar pneu dianteiro..."
          className="text-sm h-8"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          onClick={handleAdd}
          disabled={!newAction.trim() || addMutation.isPending}
        >
          <Plus className="w-3 h-3 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
