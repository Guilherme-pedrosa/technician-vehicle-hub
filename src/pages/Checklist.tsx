import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRotaExataUsuarios } from "@/hooks/useRotaExata";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ClipboardCheck, Plus, CheckCircle, XCircle, AlertTriangle,
  Loader2, Car, Droplets, Wrench, Shield, Eye, CalendarDays,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type ChecklistField = {
  key: string;
  label: string;
  options: { value: string; label: string; color?: string }[];
  category: string;
};

const CHECKLIST_FIELDS: ChecklistField[] = [
  // Fluids
  { key: "nivel_oleo", label: "Nível de Óleo", category: "Fluidos", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
    { value: "nao_aplicavel", label: "N/A", color: "secondary" },
  ]},
  { key: "troca_oleo", label: "Troca de Óleo", category: "Fluidos", options: [
    { value: "ok", label: "OK", color: "success" },
    { value: "se_aproximando", label: "PRÓXIMO DO VENCIMENTO", color: "warning" },
    { value: "vencido", label: "VENCIDO", color: "destructive" },
  ]},
  { key: "nivel_agua", label: "Nível de Água", category: "Fluidos", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  // Exterior
  { key: "danos_veiculo", label: "Danos no Veículo (arranhão, amassado)", category: "Exterior", options: [
    { value: "nao", label: "NÃO", color: "success" },
    { value: "sim", label: "SIM", color: "destructive" },
  ]},
  { key: "farois_lanternas", label: "Faróis e Lanternas", category: "Exterior", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "vidros", label: "Vidros", category: "Exterior", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "limpeza_organizacao", label: "Veículo Limpo e Organizado", category: "Exterior", options: [
    { value: "sim", label: "SIM", color: "success" },
    { value: "nao", label: "NÃO", color: "destructive" },
  ]},
  // Mechanical
  { key: "motor", label: "Motor em Pleno Funcionamento", category: "Mecânica", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "cambio", label: "Câmbio Funcionando Corretamente", category: "Mecânica", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "ruido_anormal", label: "Ruído Anormal no Veículo", category: "Mecânica", options: [
    { value: "nao", label: "NÃO", color: "success" },
    { value: "sim", label: "SIM", color: "destructive" },
  ]},
  { key: "som", label: "Som Funcionando", category: "Mecânica", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  // Tires
  { key: "pneus", label: "Pneus OK (calibragem e estado)", category: "Pneus", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "pneu_estepe", label: "Pneu Estepe Cheio e em Boas Condições", category: "Pneus", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  // Safety
  { key: "itens_seguranca", label: "Macaco, Chave de Roda e Triângulo", category: "Segurança", options: [
    { value: "sim", label: "SIM", color: "success" },
    { value: "nao", label: "NÃO", color: "destructive" },
  ]},
  { key: "acessorios", label: "Acessórios no Local (suporte celular, câmera)", category: "Segurança", options: [
    { value: "sim", label: "SIM", color: "success" },
    { value: "nao", label: "NÃO", color: "destructive" },
  ]},
];

const CATEGORY_ICONS: Record<string, typeof Droplets> = {
  "Fluidos": Droplets,
  "Exterior": Car,
  "Mecânica": Wrench,
  "Pneus": Car,
  "Segurança": Shield,
};

type FormData = Record<string, string>;

function ChecklistFormDialog({ vehicles, drivers, localDrivers, userId }: {
  vehicles: { id: string; placa: string; modelo: string }[];
  drivers: { id: number; nome: string }[];
  localDrivers: { id: string; full_name: string }[];
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [selectedDriverName, setSelectedDriverName] = useState("");
  const [tripulacao, setTripulacao] = useState("");
  const [destino, setDestino] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [answers, setAnswers] = useState<FormData>(() => {
    const defaults: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => {
      const defaultOpt = f.options[0];
      defaults[f.key] = defaultOpt?.value ?? "";
    });
    return defaults;
  });

  const mutation = useMutation({
    mutationFn: async () => {
      // Try to match selected Rota Exata driver to local drivers table by name
      const matchedLocal = selectedDriverName
        ? localDrivers.find((d) => d.full_name.toLowerCase().trim() === selectedDriverName.toLowerCase().trim())
        : null;
      const { error } = await supabase.from("vehicle_checklists").insert({
        vehicle_id: vehicleId,
        driver_id: matchedLocal?.id || null,
        created_by: userId,
        checklist_date: format(new Date(), "yyyy-MM-dd"),
        tripulacao: selectedDriverName || tripulacao || null,
        destino: destino || null,
        observacoes: observacoes || null,
        ...answers,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Checklist salvo com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] });
      setOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      if (err?.message?.includes("duplicate key") || err?.code === "23505") {
        toast.error("Já existe um checklist para este veículo hoje.");
      } else {
        toast.error("Erro ao salvar checklist: " + err.message);
      }
    },
  });

  const resetForm = () => {
    setVehicleId("");
    setSelectedDriverName("");
    setTripulacao("");
    setDestino("");
    setObservacoes("");
    const defaults: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => {
      defaults[f.key] = f.options[0]?.value ?? "";
    });
    setAnswers(defaults);
  };

  const nonConformeCount = useMemo(() => {
    return CHECKLIST_FIELDS.filter((f) => {
      const val = answers[f.key];
      return val === "nao_conforme" || val === "vencido" || 
        (f.key === "danos_veiculo" && val === "sim") ||
        (f.key === "ruido_anormal" && val === "sim") ||
        (f.key === "itens_seguranca" && val === "nao") ||
        (f.key === "acessorios" && val === "nao") ||
        (f.key === "limpeza_organizacao" && val === "nao");
    }).length;
  }, [answers]);

  const categories = useMemo(() => {
    const cats: string[] = [];
    CHECKLIST_FIELDS.forEach((f) => {
      if (!cats.includes(f.category)) cats.push(f.category);
    });
    return cats;
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Novo Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            Checklist Diário — {format(new Date(), "dd/MM/yyyy")}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] px-6 pb-6">
          <div className="space-y-6 pt-4">
            {/* Identification */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Veículo *</Label>
                <SearchableSelect
                  value={vehicleId}
                  onValueChange={setVehicleId}
                  placeholder="Selecione o veículo"
                  searchPlaceholder="Buscar placa ou modelo..."
                  options={vehicles.map((v) => ({ value: v.id, label: `${v.placa} — ${v.modelo}` }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Motorista Responsável</Label>
                <SearchableSelect
                  value={selectedDriverName}
                  onValueChange={setSelectedDriverName}
                  placeholder="Selecione o motorista"
                  searchPlaceholder="Buscar motorista..."
                  options={drivers.map((d) => ({ value: d.nome, label: d.nome }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Tripulação</Label>
                <Input placeholder="Nomes dos técnicos" value={tripulacao} onChange={(e) => setTripulacao(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Destino(s)</Label>
                <Input placeholder="Destinos do dia" value={destino} onChange={(e) => setDestino(e.target.value)} />
              </div>
            </div>

            <Separator />

            {/* Checklist Items by Category */}
            {categories.map((cat) => {
              const Icon = CATEGORY_ICONS[cat] ?? ClipboardCheck;
              const fields = CHECKLIST_FIELDS.filter((f) => f.category === cat);

              return (
                <div key={cat} className="space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <Icon className="w-4 h-4 text-primary" />
                    {cat}
                  </h3>
                  <div className="space-y-3">
                    {fields.map((field) => (
                      <div key={field.key} className="flex items-center justify-between gap-4 py-2">
                        <span className="text-sm flex-1">{field.label}</span>
                        <div className="flex gap-1.5 flex-shrink-0">
                          {field.options.map((opt) => {
                            const isSelected = answers[field.key] === opt.value;
                            const colorMap: Record<string, string> = {
                              success: isSelected ? "bg-success text-success-foreground" : "border-success/40 text-success hover:bg-success/10",
                              destructive: isSelected ? "bg-destructive text-destructive-foreground" : "border-destructive/40 text-destructive hover:bg-destructive/10",
                              warning: isSelected ? "bg-warning text-warning-foreground" : "border-warning/40 text-warning hover:bg-warning/10",
                              secondary: isSelected ? "bg-muted text-muted-foreground" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/50",
                            };
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setAnswers((prev) => ({ ...prev, [field.key]: opt.value }))}
                                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${colorMap[opt.color ?? "secondary"]}`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <Separator />

            {/* Observations */}
            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                placeholder="Descreva qualquer problema encontrado, detalhes de não conformidades..."
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Summary & Submit */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-3 text-sm">
                {nonConformeCount > 0 ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {nonConformeCount} não conformidade{nonConformeCount > 1 ? "s" : ""}
                  </Badge>
                ) : (
                  <Badge className="gap-1 bg-success text-success-foreground">
                    <CheckCircle className="w-3 h-3" /> Tudo conforme
                  </Badge>
                )}
              </div>
              <Button
                onClick={() => mutation.mutate()}
                disabled={!vehicleId || mutation.isPending}
                className="gap-2"
              >
                {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
                Salvar Checklist
              </Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function statusBadge(value: string, field: ChecklistField) {
  const opt = field.options.find((o) => o.value === value);
  if (!opt) return <span className="text-xs text-muted-foreground">—</span>;

  const isOk = opt.color === "success";
  const isWarn = opt.color === "warning";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${
      isOk ? "text-success" : isWarn ? "text-warning" : "text-destructive"
    }`}>
      {isOk ? <CheckCircle className="w-3 h-3" /> : isWarn ? <AlertTriangle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {opt.label}
    </span>
  );
}

function ChecklistDetailDialog({ checklist, vehicles, localDrivers }: {
  checklist: any;
  vehicles: { id: string; placa: string; modelo: string }[];
  localDrivers: { id: string; full_name: string }[];
}) {
  const vehicle = vehicles.find((v) => v.id === checklist.vehicle_id);
  const driver = localDrivers.find((d) => d.id === checklist.driver_id);

  const categories = useMemo(() => {
    const cats: string[] = [];
    CHECKLIST_FIELDS.forEach((f) => {
      if (!cats.includes(f.category)) cats.push(f.category);
    });
    return cats;
  }, []);

  return (
    <DialogContent className="max-w-lg max-h-[80vh] p-0">
      <DialogHeader className="p-6 pb-0">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Eye className="w-4 h-4 text-primary" />
          {vehicle?.placa ?? "—"} — {new Date(checklist.checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}
        </DialogTitle>
      </DialogHeader>
      <ScrollArea className="max-h-[65vh] px-6 pb-6">
        <div className="space-y-4 pt-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Veículo:</span> {vehicle?.placa} — {vehicle?.modelo}</div>
            <div><span className="text-muted-foreground">Motorista:</span> {driver?.full_name ?? checklist.tripulacao ?? "—"}</div>
            {checklist.tripulacao && <div><span className="text-muted-foreground">Tripulação:</span> {checklist.tripulacao}</div>}
            {checklist.destino && <div><span className="text-muted-foreground">Destino:</span> {checklist.destino}</div>}
          </div>
          <Separator />
          {categories.map((cat) => {
            const fields = CHECKLIST_FIELDS.filter((f) => f.category === cat);
            const Icon = CATEGORY_ICONS[cat] ?? ClipboardCheck;
            return (
              <div key={cat} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" /> {cat}
                </h4>
                {fields.map((f) => (
                  <div key={f.key} className="flex items-center justify-between py-1">
                    <span className="text-sm">{f.label}</span>
                    {statusBadge(checklist[f.key], f)}
                  </div>
                ))}
              </div>
            );
          })}
          {checklist.observacoes && (
            <>
              <Separator />
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Observações</h4>
                <p className="text-sm whitespace-pre-wrap">{checklist.observacoes}</p>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </DialogContent>
  );
}

export default function Checklist() {
  const { user } = useAuth();
  const [filterDate, setFilterDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, placa, modelo").order("placa");
      if (error) throw error;
      return data;
    },
  });

  const { data: localDrivers = [] } = useQuery({
    queryKey: ["drivers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, full_name").eq("status", "ativo").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: rotaExataDrivers = [] } = useRotaExataUsuarios();

  const { data: checklists = [], isLoading } = useQuery({
    queryKey: ["vehicle-checklists", filterDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_checklists")
        .select("*")
        .eq("checklist_date", filterDate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [selectedChecklist, setSelectedChecklist] = useState<any>(null);

  const totalVehicles = vehicles.length;
  const filledCount = checklists.length;
  const pendingCount = totalVehicles - filledCount;

  const nonConformeChecklists = useMemo(() => {
    return checklists.filter((cl: any) =>
      CHECKLIST_FIELDS.some((f) => {
        const val = cl[f.key];
        return val === "nao_conforme" || val === "vencido" ||
          (f.key === "danos_veiculo" && val === "sim") ||
          (f.key === "ruido_anormal" && val === "sim") ||
          (f.key === "itens_seguranca" && val === "nao") ||
          (f.key === "acessorios" && val === "nao") ||
          (f.key === "limpeza_organizacao" && val === "nao");
      })
    ).length;
  }, [checklists]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checklist Veicular</h1>
          <p className="text-muted-foreground">Inspeção diária dos veículos da frota</p>
        </div>
        {user && (
          <ChecklistFormDialog
            vehicles={vehicles}
            drivers={rotaExataDrivers}
            localDrivers={localDrivers}
            userId={user.id}
          />
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="kpi-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Preenchidos</CardTitle>
            <CheckCircle className="w-5 h-5 text-success" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{filledCount}<span className="text-lg text-muted-foreground font-normal">/{totalVehicles}</span></p>
            <p className="text-xs text-muted-foreground mt-1">{pendingCount} pendente{pendingCount !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Não Conformidades</CardTitle>
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-destructive">{nonConformeChecklists}</p>
            <p className="text-xs text-muted-foreground mt-1">veículos com problemas</p>
          </CardContent>
        </Card>
        <Card className="kpi-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Conformidade</CardTitle>
            <ClipboardCheck className="w-5 h-5 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {filledCount > 0 ? Math.round(((filledCount - nonConformeChecklists) / filledCount) * 100) : 0}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">dos veículos inspecionados</p>
          </CardContent>
        </Card>
      </div>

      {/* Checklist Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Checklists do Dia
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <Input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-40 h-8 text-xs"
            max={format(new Date(), "yyyy-MM-dd")}
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-enterprise">
            <TableHeader>
              <TableRow>
                <TableHead>Placa</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Hora</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checklists.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">Nenhum checklist preenchido</p>
                    <p className="text-xs">Clique em "Novo Checklist" para começar</p>
                  </TableCell>
                </TableRow>
              ) : (
                checklists.map((cl: any) => {
                  const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
                  const driver = localDrivers.find((d) => d.id === cl.driver_id);
                  const hasIssue = CHECKLIST_FIELDS.some((f) => {
                    const val = cl[f.key];
                    return val === "nao_conforme" || val === "vencido" ||
                      (f.key === "danos_veiculo" && val === "sim") ||
                      (f.key === "ruido_anormal" && val === "sim") ||
                      (f.key === "itens_seguranca" && val === "nao") ||
                      (f.key === "acessorios" && val === "nao") ||
                      (f.key === "limpeza_organizacao" && val === "nao");
                  });

                  return (
                    <TableRow key={cl.id}>
                      <TableCell className="font-medium">{vehicle?.placa ?? "—"}</TableCell>
                      <TableCell className="text-sm">{driver?.full_name ?? cl.tripulacao ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{cl.destino ?? "—"}</TableCell>
                      <TableCell className="text-center">
                        {hasIssue ? (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <XCircle className="w-3 h-3" /> Não conforme
                          </Badge>
                        ) : (
                          <Badge className="gap-1 text-xs bg-success text-success-foreground">
                            <CheckCircle className="w-3 h-3" /> Conforme
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
                        {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setSelectedChecklist(cl)}>
                              <Eye className="w-3.5 h-3.5" /> Ver
                            </Button>
                          </DialogTrigger>
                          {selectedChecklist?.id === cl.id && (
                            <ChecklistDetailDialog
                              checklist={selectedChecklist}
                              vehicles={vehicles}
                              localDrivers={localDrivers}
                            />
                          )}
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
