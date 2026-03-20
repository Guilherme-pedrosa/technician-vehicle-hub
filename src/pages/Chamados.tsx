import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Wrench, Plus, AlertTriangle, Clock, CheckCircle, Package,
  GripVertical, Car, User, CalendarDays, ChevronRight, Eye, Filter,
  Pencil, Trash2, Save, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

// ═══════════════════════════════════════════
// TYPES & CONSTANTS
// ═══════════════════════════════════════════

type TicketStatus = "aberto" | "em_andamento" | "aguardando_peca" | "concluido";
type TicketPriority = "baixa" | "media" | "alta" | "critica";
type TicketType = "preventiva" | "corretiva" | "nao_conformidade";

type Ticket = Tables<"maintenance_tickets"> & {
  vehicles?: { placa: string; modelo: string } | null;
  drivers?: { full_name: string } | null;
};

const COLUMNS: { id: TicketStatus; label: string; icon: React.ReactNode; color: string; bgClass: string }[] = [
  { id: "aberto", label: "Aberto", icon: <AlertTriangle className="w-4 h-4" />, color: "text-red-600", bgClass: "bg-red-50 border-red-200" },
  { id: "em_andamento", label: "Em Andamento", icon: <Clock className="w-4 h-4" />, color: "text-amber-600", bgClass: "bg-amber-50 border-amber-200" },
  { id: "aguardando_peca", label: "Aguardando Peça", icon: <Package className="w-4 h-4" />, color: "text-blue-600", bgClass: "bg-blue-50 border-blue-200" },
  { id: "concluido", label: "Concluído", icon: <CheckCircle className="w-4 h-4" />, color: "text-emerald-600", bgClass: "bg-emerald-50 border-emerald-200" },
];

const PRIORITY_BADGE: Record<TicketPriority, { label: string; className: string }> = {
  baixa: { label: "Baixa", className: "bg-slate-100 text-slate-700 border-slate-200" },
  media: { label: "Média", className: "bg-amber-100 text-amber-800 border-amber-200" },
  alta: { label: "Alta", className: "bg-orange-100 text-orange-800 border-orange-200" },
  critica: { label: "Crítica", className: "bg-red-100 text-red-800 border-red-300 animate-pulse" },
};

const TYPE_LABEL: Record<TicketType, { label: string; className: string }> = {
  preventiva: { label: "Preventiva", className: "bg-emerald-100 text-emerald-800" },
  corretiva: { label: "Corretiva", className: "bg-amber-100 text-amber-800" },
  nao_conformidade: { label: "Não Conformidade", className: "bg-red-100 text-red-800" },
};

// ═══════════════════════════════════════════
// TICKET CARD
// ═══════════════════════════════════════════

function TicketCard({
  ticket,
  onDragStart,
  onClick,
}: {
  ticket: Ticket;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: () => void;
}) {
  const prio = PRIORITY_BADGE[ticket.prioridade as TicketPriority] ?? PRIORITY_BADGE.media;
  const tipo = TYPE_LABEL[ticket.tipo as TicketType] ?? TYPE_LABEL.corretiva;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ticket.id)}
      onClick={onClick}
      className="group bg-white rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing active:scale-[0.98] p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-tight line-clamp-2 flex-1">{ticket.titulo}</h4>
        <GripVertical className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${prio.className}`}>{prio.label}</Badge>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${tipo.className}`}>{tipo.label}</Badge>
      </div>

      {ticket.vehicles && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Car className="w-3 h-3" />
          <span>{ticket.vehicles.placa} — {ticket.vehicles.modelo}</span>
        </div>
      )}

      {ticket.drivers && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="w-3 h-3" />
          <span>{ticket.drivers.full_name}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1 border-t border-border/50">
        <CalendarDays className="w-3 h-3" />
        <span>{format(new Date(ticket.created_at), "dd/MM/yy HH:mm")}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// KANBAN COLUMN
// ═══════════════════════════════════════════

function KanbanColumn({
  column,
  tickets,
  onDrop,
  onDragStart,
  onDragOver,
  onTicketClick,
}: {
  column: (typeof COLUMNS)[number];
  tickets: Ticket[];
  onDrop: (e: React.DragEvent, status: TicketStatus) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onTicketClick: (t: Ticket) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col min-w-[280px] max-w-[320px] flex-1 rounded-xl border ${column.bgClass} transition-all ${isDragOver ? "ring-2 ring-primary/40 scale-[1.01]" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); onDragOver(e); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => { setIsDragOver(false); onDrop(e, column.id); }}
    >
      <div className="flex items-center gap-2 p-3 pb-2">
        <span className={column.color}>{column.icon}</span>
        <h3 className={`text-sm font-semibold ${column.color}`}>{column.label}</h3>
        <Badge variant="secondary" className="ml-auto text-xs h-5 min-w-[24px] justify-center">
          {tickets.length}
        </Badge>
      </div>
      <ScrollArea className="flex-1 px-2 pb-2" style={{ maxHeight: "calc(100vh - 260px)" }}>
        <div className="space-y-2 p-1">
          {tickets.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-8 opacity-60">
              Nenhum chamado
            </div>
          )}
          {tickets.map((t) => (
            <TicketCard key={t.id} ticket={t} onDragStart={onDragStart} onClick={() => onTicketClick(t)} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ═══════════════════════════════════════════
// TICKET DETAIL DIALOG
// ═══════════════════════════════════════════

function TicketDetailDialog({
  ticket,
  open,
  onOpenChange,
  onStatusChange,
}: {
  ticket: Ticket | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStatusChange: (id: string, status: TicketStatus) => void;
}) {
  if (!ticket) return null;
  const prio = PRIORITY_BADGE[ticket.prioridade as TicketPriority] ?? PRIORITY_BADGE.media;
  const tipo = TYPE_LABEL[ticket.tipo as TicketType] ?? TYPE_LABEL.corretiva;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg leading-tight pr-6">{ticket.titulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={prio.className}>{prio.label}</Badge>
            <Badge variant="outline" className={tipo.className}>{tipo.label}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Veículo:</span>
              <p className="font-medium">{ticket.vehicles ? `${ticket.vehicles.placa} — ${ticket.vehicles.modelo}` : "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Técnico:</span>
              <p className="font-medium">{ticket.drivers?.full_name ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Criado em:</span>
              <p className="font-medium">{format(new Date(ticket.created_at), "dd/MM/yyyy HH:mm")}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Atualizado:</span>
              <p className="font-medium">{format(new Date(ticket.updated_at), "dd/MM/yyyy HH:mm")}</p>
            </div>
          </div>

          <Separator />

          {ticket.descricao && (
            <div>
              <Label className="text-sm font-semibold mb-1">Descrição</Label>
              <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3 mt-1 font-sans">{ticket.descricao}</pre>
            </div>
          )}

          {ticket.fotos && ticket.fotos.length > 0 && (
            <div>
              <Label className="text-sm font-semibold mb-2">Fotos</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {ticket.fotos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Foto ${i + 1}`}
                      className="w-full h-24 object-cover rounded-lg border hover:opacity-80 transition-opacity"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = "none";
                        const placeholder = document.createElement("div");
                        placeholder.className = "w-full h-24 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 flex items-center justify-center text-xs text-muted-foreground";
                        placeholder.textContent = "Foto indisponível";
                        target.parentElement?.appendChild(placeholder);
                      }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div>
            <Label className="text-sm font-semibold mb-2">Alterar Status</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {COLUMNS.map((col) => (
                <Button
                  key={col.id}
                  size="sm"
                  variant={ticket.status === col.id ? "default" : "outline"}
                  onClick={() => { onStatusChange(ticket.id, col.id); onOpenChange(false); }}
                  className="text-xs"
                >
                  {col.icon}
                  <span className="ml-1">{col.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════
// NEW TICKET DIALOG
// ═══════════════════════════════════════════

function NewTicketDialog({
  open,
  onOpenChange,
  vehicles,
  drivers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicles: Tables<"vehicles">[];
  drivers: Tables<"drivers">[];
  onSave: (data: any) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [tipo, setTipo] = useState<string>("corretiva");
  const [prioridade, setPrioridade] = useState<string>("media");

  const reset = () => { setTitulo(""); setDescricao(""); setVehicleId(""); setDriverId(""); setTipo("corretiva"); setPrioridade("media"); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Chamado</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Título *</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Descreva o problema..." />
          </div>

          <div className="space-y-2">
            <Label>Veículo *</Label>
            <SearchableSelect
              value={vehicleId} onValueChange={setVehicleId}
              placeholder="Selecione o veículo" searchPlaceholder="Buscar placa..."
              options={vehicles.map((v) => ({ value: v.id, label: `${v.placa} — ${v.modelo}` }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Técnico/Condutor</Label>
            <SearchableSelect
              value={driverId} onValueChange={setDriverId}
              placeholder="Selecione (opcional)" searchPlaceholder="Buscar..."
              options={drivers.map((d) => ({ value: d.id, label: d.full_name }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corretiva">Corretiva</SelectItem>
                  <SelectItem value="preventiva">Preventiva</SelectItem>
                  <SelectItem value="nao_conformidade">Não Conformidade</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={prioridade} onValueChange={setPrioridade}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Detalhes do problema..." rows={4} />
          </div>

          <Button
            className="w-full"
            disabled={!titulo.trim() || !vehicleId}
            onClick={() => {
              onSave({ titulo, descricao, vehicle_id: vehicleId, driver_id: driverId || null, tipo, prioridade, status: "aberto" });
              reset();
              onOpenChange(false);
            }}
          >
            <Plus className="w-4 h-4 mr-2" /> Criar Chamado
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════

export default function Chamados() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const dragIdRef = useRef<string | null>(null);

  // Fetch tickets
  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["maintenance-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_tickets")
        .select("*, vehicles(placa, modelo), drivers(full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Ticket[];
    },
  });

  // Fetch vehicles & drivers for new ticket form
  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-list"],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").order("placa");
      return data ?? [];
    },
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-list"],
    queryFn: async () => {
      const { data } = await supabase.from("drivers").select("*").eq("status", "ativo").order("full_name");
      return data ?? [];
    },
  });

  // Update ticket status
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TicketStatus }) => {
      const { error } = await supabase.from("maintenance_tickets").update({ status } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      toast.success("Status atualizado!");
    },
    onError: (err: any) => toast.error("Erro: " + err.message),
  });

  // Create ticket
  const createTicket = useMutation({
    mutationFn: async (data: any) => {
      const { data: inserted, error } = await supabase.from("maintenance_tickets").insert({
        ...data,
        created_by: user?.id,
      } as any).select("*, vehicles(placa, modelo), drivers(full_name)").single();
      if (error) throw error;

      // Send email notification
      try {
        const vehicle = inserted.vehicles as any;
        const driver = inserted.drivers as any;
        await supabase.functions.invoke("notify-checklist-nc", {
          body: {
            checklist_id: inserted.id,
            placa: vehicle?.placa ?? "—",
            modelo: vehicle?.modelo ?? "—",
            tecnico: driver?.full_name ?? "Não informado",
            data: new Date().toLocaleDateString("pt-BR") + " " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            resultado: data.tipo === "nao_conformidade" ? "Não Conformidade" : data.tipo === "corretiva" ? "Corretiva" : "Preventiva",
            itens_problema: data.descricao ? [{ label: "Descrição", valor: data.descricao }] : [],
            fotos_problema: [],
            troca_oleo_vencida: false,
            observacoes: data.descricao || null,
          },
        });
      } catch (emailErr) {
        console.error("Erro ao enviar notificação:", emailErr);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
      toast.success("Chamado criado!");
    },
    onError: (err: any) => toast.error("Erro: " + err.message),
  });

  // Filter tickets
  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (filterPriority !== "all" && t.prioridade !== filterPriority) return false;
      if (filterType !== "all" && t.tipo !== filterType) return false;
      if (search) {
        const s = search.toLowerCase();
        const matches = t.titulo.toLowerCase().includes(s) ||
          t.vehicles?.placa?.toLowerCase().includes(s) ||
          t.vehicles?.modelo?.toLowerCase().includes(s) ||
          t.drivers?.full_name?.toLowerCase().includes(s);
        if (!matches) return false;
      }
      return true;
    });
  }, [tickets, filterPriority, filterType, search]);

  // Group by status
  const grouped = useMemo(() => {
    const map: Record<TicketStatus, Ticket[]> = { aberto: [], em_andamento: [], aguardando_peca: [], concluido: [] };
    filtered.forEach((t) => {
      if (map[t.status as TicketStatus]) map[t.status as TicketStatus].push(t);
    });
    return map;
  }, [filtered]);

  // Drag & drop
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, status: TicketStatus) => {
    e.preventDefault();
    const id = dragIdRef.current;
    if (!id) return;
    dragIdRef.current = null;
    const ticket = tickets.find((t) => t.id === id);
    if (ticket && ticket.status !== status) {
      updateStatus.mutate({ id, status });
    }
  }, [tickets, updateStatus]);

  const handleStatusChange = useCallback((id: string, status: TicketStatus) => {
    updateStatus.mutate({ id, status });
  }, [updateStatus]);

  // Stats
  const stats = useMemo(() => ({
    total: tickets.length,
    abertos: tickets.filter((t) => t.status === "aberto").length,
    criticos: tickets.filter((t) => t.prioridade === "critica" && t.status !== "concluido").length,
    concluidos: tickets.filter((t) => t.status === "concluido").length,
  }), [tickets]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chamados de Manutenção</h1>
          <p className="text-muted-foreground text-sm">Arraste os cards para alterar o status</p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-2" /> Novo Chamado
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-slate-400">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-400">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Abertos</p>
            <p className="text-2xl font-bold text-red-600">{stats.abertos}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-400">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Críticos</p>
            <p className="text-2xl font-bold text-orange-600">{stats.criticos}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-400">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Concluídos</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.concluidos}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar chamado..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-[200px] h-8 text-sm"
        />
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Prioridade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="baixa">Baixa</SelectItem>
            <SelectItem value="media">Média</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="critica">Crítica</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="corretiva">Corretiva</SelectItem>
            <SelectItem value="preventiva">Preventiva</SelectItem>
            <SelectItem value="nao_conformidade">Não Conformidade</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Kanban */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Wrench className="w-8 h-8 animate-spin mr-3" />
          Carregando chamados...
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tickets={grouped[col.id]}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onTicketClick={(t) => { setSelectedTicket(t); setDetailOpen(true); }}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <NewTicketDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        vehicles={vehicles}
        drivers={drivers}
        onSave={(data) => createTicket.mutate(data)}
      />
      <TicketDetailDialog
        ticket={selectedTicket}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onStatusChange={handleStatusChange}
      />
    </div>
  );
}
