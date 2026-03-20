import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRotaExataUsuarios } from "@/hooks/useRotaExata";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  { key: "nivel_oleo", label: "Nível de Óleo", category: "Fluidos", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
    { value: "nao_aplicavel", label: "N/A", color: "secondary" },
  ]},
  { key: "troca_oleo", label: "Troca de Óleo", category: "Fluidos", options: [
    { value: "ok", label: "OK", color: "success" },
    { value: "se_aproximando", label: "PRÓXIMO", color: "warning" },
    { value: "vencido", label: "VENCIDO", color: "destructive" },
  ]},
  { key: "nivel_agua", label: "Nível de Água", category: "Fluidos", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "danos_veiculo", label: "Danos no Veículo", category: "Exterior", options: [
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
  { key: "limpeza_organizacao", label: "Limpo e Organizado", category: "Exterior", options: [
    { value: "sim", label: "SIM", color: "success" },
    { value: "nao", label: "NÃO", color: "destructive" },
  ]},
  { key: "motor", label: "Motor Funcionando", category: "Mecânica", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "cambio", label: "Câmbio", category: "Mecânica", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "ruido_anormal", label: "Ruído Anormal", category: "Mecânica", options: [
    { value: "nao", label: "NÃO", color: "success" },
    { value: "sim", label: "SIM", color: "destructive" },
  ]},
  { key: "som", label: "Som", category: "Mecânica", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "pneus", label: "Pneus OK", category: "Pneus", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "pneu_estepe", label: "Estepe", category: "Pneus", options: [
    { value: "conforme", label: "CONFORME", color: "success" },
    { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  ]},
  { key: "itens_seguranca", label: "Macaco, Chave, Triângulo", category: "Segurança", options: [
    { value: "sim", label: "SIM", color: "success" },
    { value: "nao", label: "NÃO", color: "destructive" },
  ]},
  { key: "acessorios", label: "Acessórios", category: "Segurança", options: [
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

function isNonConforme(key: string, val: string) {
  return val === "nao_conforme" || val === "vencido" ||
    (key === "danos_veiculo" && val === "sim") ||
    (key === "ruido_anormal" && val === "sim") ||
    (key === "itens_seguranca" && val === "nao") ||
    (key === "acessorios" && val === "nao") ||
    (key === "limpeza_organizacao" && val === "nao");
}

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
    CHECKLIST_FIELDS.forEach((f) => { defaults[f.key] = f.options[0]?.value ?? ""; });
    return defaults;
  });

  const mutation = useMutation({
    mutationFn: async () => {
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
    CHECKLIST_FIELDS.forEach((f) => { defaults[f.key] = f.options[0]?.value ?? ""; });
    setAnswers(defaults);
  };

  const nonConformeCount = useMemo(() =>
    CHECKLIST_FIELDS.filter((f) => isNonConforme(f.key, answers[f.key])).length
  , [answers]);

  const categories = useMemo(() => {
    const cats: string[] = [];
    CHECKLIST_FIELDS.forEach((f) => { if (!cats.includes(f.category)) cats.push(f.category); });
    return cats;
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo</span> Checklist
        </Button>
      </DialogTrigger>
      {/* Full-screen on mobile, max-w on desktop */}
      <DialogContent className="max-w-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] p-0 gap-0">
        <DialogHeader className="p-4 sm:p-6 pb-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            Checklist — {format(new Date(), "dd/MM/yyyy")}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="space-y-5 pt-4">
            {/* Identification — stacked on mobile */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-sm">Veículo *</Label>
                <SearchableSelect
                  value={vehicleId}
                  onValueChange={setVehicleId}
                  placeholder="Selecione o veículo"
                  searchPlaceholder="Buscar placa ou modelo..."
                  options={vehicles.map((v) => ({ value: v.id, label: `${v.placa} — ${v.modelo}` }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Motorista *</Label>
                <SearchableSelect
                  value={selectedDriverName}
                  onValueChange={setSelectedDriverName}
                  placeholder="Selecione o motorista"
                  searchPlaceholder="Buscar motorista..."
                  options={drivers.map((d) => ({ value: d.nome, label: d.nome }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-sm">Tripulação</Label>
                  <Input placeholder="Nomes dos técnicos" value={tripulacao} onChange={(e) => setTripulacao(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Destino(s)</Label>
                  <Input placeholder="Destinos do dia" value={destino} onChange={(e) => setDestino(e.target.value)} />
                </div>
              </div>
            </div>

            <Separator />

            {/* Checklist Items — mobile optimized */}
            {categories.map((cat) => {
              const Icon = CATEGORY_ICONS[cat] ?? ClipboardCheck;
              const fields = CHECKLIST_FIELDS.filter((f) => f.category === cat);

              return (
                <div key={cat} className="space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground sticky top-0 bg-background py-1 z-10">
                    <Icon className="w-4 h-4 text-primary" />
                    {cat}
                  </h3>
                  <div className="space-y-1">
                    {fields.map((field) => (
                      <div key={field.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 py-2 border-b border-border/50 last:border-0">
                        <span className="text-sm font-medium sm:font-normal">{field.label}</span>
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
                                className={`flex-1 sm:flex-none min-w-0 px-3 py-2 sm:py-1 rounded-md text-xs font-medium border transition-colors active:scale-[0.97] ${colorMap[opt.color ?? "secondary"]}`}
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

            <div className="space-y-2">
              <Label className="text-sm">Observações</Label>
              <Textarea
                placeholder="Descreva problemas encontrados..."
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Submit — sticky on mobile */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 pb-4 sticky bottom-0 bg-background">
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
                className="gap-2 w-full sm:w-auto"
                size="lg"
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
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${isOk ? "text-success" : isWarn ? "text-warning" : "text-destructive"}`}>
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
    CHECKLIST_FIELDS.forEach((f) => { if (!cats.includes(f.category)) cats.push(f.category); });
    return cats;
  }, []);

  return (
    <DialogContent className="max-w-lg w-full h-[100dvh] sm:h-auto sm:max-h-[80vh] p-0 gap-0">
      <DialogHeader className="p-4 sm:p-6 pb-0">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Eye className="w-4 h-4 text-primary" />
          {vehicle?.placa ?? "—"} — {new Date(checklist.checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}
        </DialogTitle>
      </DialogHeader>
      <ScrollArea className="flex-1 px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="space-y-4 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
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

  const nonConformeChecklists = useMemo(() =>
    checklists.filter((cl: any) =>
      CHECKLIST_FIELDS.some((f) => isNonConforme(f.key, cl[f.key]))
    ).length
  , [checklists]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header — stacked on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Checklist Veicular</h1>
          <p className="text-sm text-muted-foreground">Inspeção diária dos veículos</p>
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

      {/* KPI Cards — 3 cols on mobile (compact) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Preenchidos</span>
              <CheckCircle className="w-4 h-4 text-success hidden sm:block" />
            </div>
            <p className="text-xl sm:text-3xl font-bold tabular-nums">{filledCount}<span className="text-sm sm:text-lg text-muted-foreground font-normal">/{totalVehicles}</span></p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">{pendingCount} pendente{pendingCount !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Não Conforme</span>
              <AlertTriangle className="w-4 h-4 text-destructive hidden sm:block" />
            </div>
            <p className="text-xl sm:text-3xl font-bold tabular-nums text-destructive">{nonConformeChecklists}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">com problemas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Conformidade</span>
              <ClipboardCheck className="w-4 h-4 text-primary hidden sm:block" />
            </div>
            <p className="text-xl sm:text-3xl font-bold tabular-nums">
              {filledCount > 0 ? Math.round(((filledCount - nonConformeChecklists) / filledCount) * 100) : 0}%
            </p>
            <p className="text-[10px] sm:text-xs text-muted-foreground">inspecionados</p>
          </CardContent>
        </Card>
      </div>

      {/* Checklist list */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between p-3 sm:p-6">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Checklists do Dia
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <Input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="w-full sm:w-40 h-8 text-xs"
            max={format(new Date(), "yyyy-MM-dd")}
          />
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {checklists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
              <ClipboardCheck className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">Nenhum checklist preenchido</p>
              <p className="text-xs">Clique em "Novo Checklist" para começar</p>
            </div>
          ) : (
            <>
              {/* Mobile: Card list */}
              <div className="sm:hidden divide-y divide-border">
                {checklists.map((cl: any) => {
                  const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
                  const driver = localDrivers.find((d) => d.id === cl.driver_id);
                  const hasIssue = CHECKLIST_FIELDS.some((f) => isNonConforme(f.key, cl[f.key]));

                  return (
                    <Dialog key={cl.id}>
                      <DialogTrigger asChild>
                        <button
                          className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 active:bg-muted/50 transition-colors"
                          onClick={() => setSelectedChecklist(cl)}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{vehicle?.placa ?? "—"}</p>
                            <p className="text-xs text-muted-foreground truncate">{driver?.full_name ?? cl.tripulacao ?? "—"}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {hasIssue ? (
                              <XCircle className="w-4 h-4 text-destructive" />
                            ) : (
                              <CheckCircle className="w-4 h-4 text-success" />
                            )}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        </button>
                      </DialogTrigger>
                      {selectedChecklist?.id === cl.id && (
                        <ChecklistDetailDialog checklist={selectedChecklist} vehicles={vehicles} localDrivers={localDrivers} />
                      )}
                    </Dialog>
                  );
                })}
              </div>

              {/* Desktop: Table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Placa</th>
                      <th className="text-left p-3 font-medium">Motorista</th>
                      <th className="text-left p-3 font-medium">Destino</th>
                      <th className="text-center p-3 font-medium">Status</th>
                      <th className="text-center p-3 font-medium">Hora</th>
                      <th className="text-center p-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.map((cl: any) => {
                      const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
                      const driver = localDrivers.find((d) => d.id === cl.driver_id);
                      const hasIssue = CHECKLIST_FIELDS.some((f) => isNonConforme(f.key, cl[f.key]));

                      return (
                        <tr key={cl.id} className="border-b last:border-0">
                          <td className="p-3 font-medium">{vehicle?.placa ?? "—"}</td>
                          <td className="p-3">{driver?.full_name ?? cl.tripulacao ?? "—"}</td>
                          <td className="p-3 text-muted-foreground">{cl.destino ?? "—"}</td>
                          <td className="p-3 text-center">
                            {hasIssue ? (
                              <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="w-3 h-3" /> Não conforme</Badge>
                            ) : (
                              <Badge className="gap-1 text-xs bg-success text-success-foreground"><CheckCircle className="w-3 h-3" /> Conforme</Badge>
                            )}
                          </td>
                          <td className="p-3 text-center text-xs text-muted-foreground tabular-nums">
                            {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="p-3 text-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setSelectedChecklist(cl)}>
                                  <Eye className="w-3.5 h-3.5" /> Ver
                                </Button>
                              </DialogTrigger>
                              {selectedChecklist?.id === cl.id && (
                                <ChecklistDetailDialog checklist={selectedChecklist} vehicles={vehicles} localDrivers={localDrivers} />
                              )}
                            </Dialog>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
