import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { format, isPast, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Pencil, Users, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { useSyncAllFromRotaExata } from "@/hooks/useSyncRotaExata";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type Driver = Tables<"drivers">;
type DriverStatus = "ativo" | "inativo";

const emptyForm = {
  full_name: "",
  cnh: "",
  categoria_cnh: "B",
  cnh_validade: "",
  phone: "",
  status: "ativo" as DriverStatus,
};

function CnhBadge({ validade }: { validade: string }) {
  const date = new Date(validade);
  const days = differenceInDays(date, new Date());
  if (isPast(date)) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="w-3 h-3" /> Vencida
      </Badge>
    );
  }
  if (days <= 30) {
    return <Badge className="bg-warning text-warning-foreground">Vence em {days}d</Badge>;
  }
  return <span className="text-sm">{format(date, "dd/MM/yyyy")}</span>;
}

export default function Condutores() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const syncMutation = useSyncAllFromRotaExata();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return data as Driver[];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (driver: typeof emptyForm & { id?: string }) => {
      const payload = {
        full_name: driver.full_name,
        cnh: driver.cnh,
        categoria_cnh: driver.categoria_cnh,
        cnh_validade: driver.cnh_validade,
        phone: driver.phone || null,
        status: driver.status as DriverStatus,
      };
      if (driver.id) {
        const { error } = await supabase.from("drivers").update(payload).eq("id", driver.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("drivers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      toast.success(editingId ? "Condutor atualizado!" : "Condutor cadastrado!");
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (d: Driver) => {
    setEditingId(d.id);
    setForm({
      full_name: d.full_name,
      cnh: d.cnh,
      categoria_cnh: d.categoria_cnh,
      cnh_validade: d.cnh_validade,
      phone: d.phone ?? "",
      status: d.status,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = () => {
    if (!form.full_name || !form.cnh || !form.cnh_validade) {
      toast.error("Preencha nome, CNH e validade");
      return;
    }
    upsertMutation.mutate({ ...form, id: editingId ?? undefined });
  };

  const cnhVencidas = drivers.filter((d) => d.status === "ativo" && isPast(new Date(d.cnh_validade))).length;

  const filtered = drivers.filter((d) => {
    const matchSearch =
      (d.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (d.cnh ?? "").includes(search);
    const matchStatus = statusFilter === "todos" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = {
    todos: drivers.length,
    ativo: drivers.filter((d) => d.status === "ativo").length,
    inativo: drivers.filter((d) => d.status === "inativo").length,
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Condutores</h1>
          <p className="text-sm text-muted-foreground">Gerenciamento de condutores</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex-1 sm:flex-none"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              <span className="hidden sm:inline">Sincronizar</span> Rota Exata
            </Button>
          )}
          {isAdmin && (
            <Button onClick={openCreate} size="sm" className="flex-1 sm:flex-none">
              <Plus className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">Novo</span> Condutor
            </Button>
          )}
        </div>
      </div>

      {/* CNH Alert */}
      {cnhVencidas > 0 && (
        <div className="ai-banner" style={{ backgroundColor: "hsl(0 84% 97%)", borderColor: "hsl(0 84% 60% / 0.2)" }}>
          <AlertTriangle className="ai-banner-icon" style={{ color: "hsl(0 84% 60%)" }} />
          <div className="ai-banner-content">
            <p className="ai-banner-text font-medium" style={{ color: "hsl(0 84% 40%)" }}>
              {cnhVencidas} condutor{cnhVencidas > 1 ? "es" : ""} com CNH vencida
            </p>
          </div>
        </div>
      )}

      {/* Status filter */}
      <div className="grid grid-cols-3 gap-3 max-w-md">
        {(["todos", "ativo", "inativo"] as const).map((s) => {
          const borderClass = s === "todos" ? "status-card-total" : s === "ativo" ? "status-card-paid" : "status-card-overdue";
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`status-card ${statusFilter === s ? `status-card-active ${borderClass}` : ""}`}
            >
              <span className="status-card-count">{counts[s]}</span>
              <span className="status-card-label">
                {s === "todos" ? "Todos" : s === "ativo" ? "Ativos" : "Inativos"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou CNH..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">Nenhum condutor encontrado</p>
              <p className="text-sm">
                {drivers.length === 0 ? "Clique em 'Novo Condutor' para cadastrar" : "Tente alterar os filtros"}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="sm:hidden divide-y divide-border">
                {filtered.map((d) => (
                  <div key={d.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{d.full_name}</p>
                      <p className="text-xs text-muted-foreground">CNH: {d.cnh} · {d.categoria_cnh}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <CnhBadge validade={d.cnh_validade} />
                        <Badge variant={d.status === "ativo" ? "default" : "secondary"} className="text-[10px]">
                          {d.status === "ativo" ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                    </div>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(d)} className="flex-shrink-0">
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Nome</th>
                      <th className="text-left p-3 font-medium">CNH</th>
                      <th className="text-left p-3 font-medium">Cat.</th>
                      <th className="text-left p-3 font-medium">Validade</th>
                      <th className="text-left p-3 font-medium">Telefone</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-right p-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="p-3 font-medium">{d.full_name}</td>
                        <td className="p-3 font-mono text-xs">{d.cnh}</td>
                        <td className="p-3">{d.categoria_cnh}</td>
                        <td className="p-3"><CnhBadge validade={d.cnh_validade} /></td>
                        <td className="p-3">{d.phone ?? "—"}</td>
                        <td className="p-3">
                          <Badge variant={d.status === "ativo" ? "default" : "secondary"}>
                            {d.status === "ativo" ? "Ativo" : "Inativo"}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          {isAdmin && (
                            <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Condutor" : "Novo Condutor"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Nome Completo *</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="João da Silva"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CNH *</Label>
                <Input
                  value={form.cnh}
                  onChange={(e) => setForm({ ...form, cnh: e.target.value })}
                  placeholder="00000000000"
                />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select
                  value={form.categoria_cnh}
                  onValueChange={(v) => setForm({ ...form, categoria_cnh: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["A", "B", "AB", "C", "D", "E"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Validade CNH *</Label>
                <Input
                  type="date"
                  value={form.cnh_validade}
                  onChange={(e) => setForm({ ...form, cnh_validade: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as DriverStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
