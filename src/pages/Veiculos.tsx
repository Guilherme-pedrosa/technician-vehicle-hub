import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
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
import { Plus, Search, Pencil, Truck, RefreshCw, Loader2 } from "lucide-react";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { useUltimaPosicaoTodos, type RotaExataPosicao } from "@/hooks/useRotaExata";
import { useSyncAllFromRotaExata } from "@/hooks/useSyncRotaExata";

type Vehicle = Tables<"vehicles">;
type VehicleInsert = TablesInsert<"vehicles">;
type VehicleStatus = "disponivel" | "em_uso" | "manutencao";

const STATUS_MAP: Record<VehicleStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  disponivel: { label: "Disponível", variant: "default" },
  em_uso: { label: "Em Uso", variant: "secondary" },
  manutencao: { label: "Manutenção", variant: "destructive" },
};

const emptyForm: Partial<VehicleInsert> = {
  placa: "",
  marca: "",
  modelo: "",
  ano: undefined,
  tipo: "",
  km_atual: 0,
  adesao_id: "",
  status: "disponivel",
};

export default function Veiculos() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<VehicleInsert>>(emptyForm);

  // Rota Exata - positions
  const { data: posicoes } = useUltimaPosicaoTodos();
  const syncMutation = useSyncVehiclesFromRotaExata();

  const posicaoMap = new Map<string, RotaExataPosicao>();
  if (Array.isArray(posicoes)) {
    posicoes.forEach((p) => {
      if (p.adesao_id) posicaoMap.set(String(p.adesao_id), p);
    });
  }

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Vehicle[];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (vehicle: Partial<VehicleInsert> & { id?: string }) => {
      if (vehicle.id) {
        const { error } = await supabase
          .from("vehicles")
          .update({
            placa: vehicle.placa!,
            marca: vehicle.marca!,
            modelo: vehicle.modelo!,
            ano: vehicle.ano ?? null,
            tipo: vehicle.tipo ?? null,
            km_atual: vehicle.km_atual ?? 0,
            adesao_id: vehicle.adesao_id || null,
            status: vehicle.status as VehicleStatus,
          })
          .eq("id", vehicle.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vehicles").insert({
          placa: vehicle.placa!,
          marca: vehicle.marca!,
          modelo: vehicle.modelo!,
          ano: vehicle.ano ?? null,
          tipo: vehicle.tipo ?? null,
          km_atual: vehicle.km_atual ?? 0,
          adesao_id: vehicle.adesao_id || null,
          status: (vehicle.status as VehicleStatus) ?? "disponivel",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success(editingId ? "Veículo atualizado!" : "Veículo cadastrado!");
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditingId(v.id);
    setForm({
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      ano: v.ano ?? undefined,
      tipo: v.tipo ?? "",
      km_atual: v.km_atual,
      adesao_id: v.adesao_id ?? "",
      status: v.status,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = () => {
    if (!form.placa || !form.marca || !form.modelo) {
      toast.error("Preencha placa, marca e modelo");
      return;
    }
    upsertMutation.mutate({ ...form, id: editingId ?? undefined });
  };

  const filtered = vehicles.filter((v) => {
    const matchSearch =
      v.placa.toLowerCase().includes(search.toLowerCase()) ||
      v.modelo.toLowerCase().includes(search.toLowerCase()) ||
      v.marca.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "todos" || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = {
    todos: vehicles.length,
    disponivel: vehicles.filter((v) => v.status === "disponivel").length,
    em_uso: vehicles.filter((v) => v.status === "em_uso").length,
    manutencao: vehicles.filter((v) => v.status === "manutencao").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Veículos</h1>
          <p className="text-muted-foreground">Cadastro e status dos veículos da frota</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sincronizar Rota Exata
            </Button>
          )}
          {isAdmin && (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" /> Novo Veículo
            </Button>
          )}
        </div>
      </div>

      {/* Sync hint when empty */}
      {vehicles.length === 0 && !isLoading && (
        <div className="ai-banner">
          <RefreshCw className="ai-banner-icon" />
          <div className="ai-banner-content">
            <p className="ai-banner-text font-medium">
              Nenhum veículo cadastrado. Clique em "Sincronizar Rota Exata" para importar seus veículos automaticamente.
            </p>
          </div>
        </div>
      )}

      {/* Status filter cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["todos", "disponivel", "em_uso", "manutencao"] as const).map((s) => {
          const borderClass = s === "todos" ? "status-card-total" : s === "disponivel" ? "status-card-paid" : s === "em_uso" ? "status-card-upcoming" : "status-card-overdue";
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`status-card ${statusFilter === s ? `status-card-active ${borderClass}` : ""}`}
            >
              <span className="status-card-count">{counts[s]}</span>
              <span className="status-card-label">
                {s === "todos" ? "Todos" : STATUS_MAP[s].label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por placa, marca ou modelo..."
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
                <div key={i} className="skeleton-table-row">
                  <div className="skeleton-table-cell" />
                  <div className="skeleton-table-cell" />
                  <div className="skeleton-table-cell" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Truck className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">Nenhum veículo encontrado</p>
              <p className="text-sm">
                {vehicles.length === 0
                  ? "Sincronize do Rota Exata ou cadastre manualmente"
                  : "Tente alterar os filtros"}
              </p>
            </div>
          ) : (
            <Table className="table-enterprise">
              <TableHeader>
                <TableRow>
                  <TableHead>Placa</TableHead>
                  <TableHead>Marca / Modelo</TableHead>
                  <TableHead>Ano</TableHead>
                  <TableHead>KM Atual</TableHead>
                  <TableHead>Rastreamento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => {
                  const pos = v.adesao_id ? posicaoMap.get(v.adesao_id) : undefined;
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono font-semibold">{v.placa}</TableCell>
                      <TableCell>{v.marca} {v.modelo}</TableCell>
                      <TableCell>{v.ano ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{v.km_atual.toLocaleString("pt-BR")} km</TableCell>
                      <TableCell>
                        {pos ? (
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${pos.velocidade > 0 ? "bg-success animate-pulse" : pos.ignicao ? "bg-warning" : "bg-muted-foreground/30"}`} />
                            <span className="text-xs tabular-nums">{pos.velocidade} km/h</span>
                          </div>
                        ) : v.adesao_id ? (
                          <span className="text-xs text-muted-foreground">Sem sinal</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_MAP[v.status].variant}>
                          {STATUS_MAP[v.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => openEdit(v)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Veículo" : "Novo Veículo"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Placa *</Label>
                <Input
                  value={form.placa ?? ""}
                  onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
                  placeholder="ABC1D23"
                />
              </div>
              <div className="space-y-2">
                <Label>Ano</Label>
                <Input
                  type="number"
                  value={form.ano ?? ""}
                  onChange={(e) => setForm({ ...form, ano: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="2024"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Marca *</Label>
                <Input
                  value={form.marca ?? ""}
                  onChange={(e) => setForm({ ...form, marca: e.target.value })}
                  placeholder="Toyota"
                />
              </div>
              <div className="space-y-2">
                <Label>Modelo *</Label>
                <Input
                  value={form.modelo ?? ""}
                  onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                  placeholder="Hilux"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Input
                  value={form.tipo ?? ""}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                  placeholder="Pickup, Van, Sedan..."
                />
              </div>
              <div className="space-y-2">
                <Label>KM Atual</Label>
                <Input
                  type="number"
                  value={form.km_atual ?? 0}
                  onChange={(e) => setForm({ ...form, km_atual: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Adesão Rota Exata</Label>
                <Input
                  value={form.adesao_id ?? ""}
                  onChange={(e) => setForm({ ...form, adesao_id: e.target.value })}
                  placeholder="ID da adesão"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status ?? "disponivel"}
                  onValueChange={(v) => setForm({ ...form, status: v as VehicleStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disponivel">Disponível</SelectItem>
                    <SelectItem value="em_uso">Em Uso</SelectItem>
                    <SelectItem value="manutencao">Manutenção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
