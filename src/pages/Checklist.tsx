import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ClipboardCheck, Plus, CheckCircle, XCircle, AlertTriangle,
  Loader2, Car, CalendarDays, Camera, ChevronLeft, ChevronRight,
  X, Image as ImageIcon, Download, Eye, Pencil, Trash2, Save, ShieldAlert, ShieldCheck, AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Constants ───
const PNEU_PROBLEMAS = [
  "Careca", "Corte", "Bolha", "Prego / perfuração",
  "Deformado", "Ressecado / rachado", "Desgaste irregular", "Outro",
];
const FLUIDO_PROBLEMAS = ["Óleo", "Água / arrefecimento", "Vazamento", "Outro"];
const CONDUCAO_PROBLEMAS = ["Freio", "Direção", "Luzes", "Alerta no painel", "Outro"];
const KIT_FALTANTES = [
  "Estepe", "Macaco", "Chave de roda", "Triângulo",
  "Documento", "Ferramenta / equipamento da operação", "Outro",
];

const CRITICAL_CONDITIONS = (detalhes: any, answers: Record<string, string>) => {
  if (answers.calibragem_ok === "nao") return true;
  if (answers.pneus_visual_ok === "nao") return true;
  if (answers.fluidos_ok === "nao") {
    const probs = detalhes?.fluidos_problemas ?? [];
    if (probs.includes("Vazamento") || probs.includes("Óleo") || probs.includes("Água / arrefecimento")) return true;
  }
  if (answers.conducao_ok === "nao") {
    const probs = detalhes?.conducao_problemas ?? [];
    if (probs.includes("Freio") || probs.includes("Direção") || probs.includes("Alerta no painel")) return true;
  }
  return false;
};

type PhotosMap = Record<string, File[]>;

// ─── Camera Capture ───
function CameraCapture({ id, label, hint, photos, onCapture, onRemove, required }: {
  id: string; label: string; hint: string; photos: File[];
  onCapture: (id: string, files: FileList) => void;
  onRemove: (id: string, idx: number) => void;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{label} {required && <span className="text-destructive">*</span>}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {required && (
          <Badge variant={photos.length > 0 ? "default" : "destructive"} className="text-[10px]">
            {photos.length > 0 ? "✓" : "Obrigatória"}
          </Badge>
        )}
      </div>
      {photos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {photos.map((file, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
              <button type="button" onClick={() => onRemove(id, i)}
                className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl-lg p-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { if (e.target.files?.length) { onCapture(id, e.target.files); e.target.value = ""; } }} />
      <Button type="button" variant="outline" className="w-full gap-2 h-12 text-base active:scale-[0.97]"
        onClick={() => inputRef.current?.click()}>
        <Camera className="w-5 h-5" /> Tirar Foto
      </Button>
    </div>
  );
}

// ─── Yes/No Toggle ───
function YesNoToggle({ value, onChange, yesLabel = "Sim", noLabel = "Não", invertColors = false }: {
  value: string; onChange: (v: string) => void;
  yesLabel?: string; noLabel?: string; invertColors?: boolean;
}) {
  const yesColor = invertColors
    ? (value === "sim" ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/40 text-destructive")
    : (value === "sim" ? "bg-success text-success-foreground border-success" : "border-success/40 text-success");
  const noColor = invertColors
    ? (value === "nao" ? "bg-success text-success-foreground border-success" : "border-success/40 text-success")
    : (value === "nao" ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/40 text-destructive");

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange("sim")}
        className={`flex-1 py-3 rounded-xl text-base font-bold border-2 transition-all active:scale-[0.96] ${yesColor}`}>
        {yesLabel}
      </button>
      <button type="button" onClick={() => onChange("nao")}
        className={`flex-1 py-3 rounded-xl text-base font-bold border-2 transition-all active:scale-[0.96] ${noColor}`}>
        {noLabel}
      </button>
    </div>
  );
}

// ─── Multi-select chips ───
function ChipSelect({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = selected.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all active:scale-[0.96] ${
              isSelected
                ? "bg-destructive/10 border-destructive text-destructive"
                : "border-border text-muted-foreground hover:border-foreground/30"
            }`}>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Form Dialog ───
function ChecklistFormDialog({ vehicles, localDrivers, userId }: {
  vehicles: { id: string; placa: string; modelo: string; km_atual: number }[];
  localDrivers: { id: string; full_name: string }[];
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const [vehicleId, setVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [answers, setAnswers] = useState({
    calibragem_ok: "sim",
    pneus_visual_ok: "sim",
    fluidos_ok: "sim",
    conducao_ok: "sim",
    kit_ok: "sim",
    avaria_nova: "nao",
  });
  const [detalhes, setDetalhes] = useState<Record<string, any>>({});
  const [resultado, setResultado] = useState("");
  const [resultadoMotivo, setResultadoMotivo] = useState("");
  const [termoAceito, setTermoAceito] = useState(false);
  const [photos, setPhotos] = useState<PhotosMap>({});
  const [uploading, setUploading] = useState(false);

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const selectedDriver = localDrivers.find((d) => d.id === selectedDriverId);
  const now = new Date();

  const setDetail = (key: string, value: any) => setDetalhes((prev) => ({ ...prev, [key]: value }));
  const getDetail = (key: string, fallback: any = "") => detalhes[key] ?? fallback;

  const handleCapture = useCallback((id: string, files: FileList) => {
    setPhotos((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), ...Array.from(files)] }));
  }, []);
  const handleRemovePhoto = useCallback((id: string, idx: number) => {
    setPhotos((prev) => ({ ...prev, [id]: (prev[id] ?? []).filter((_, i) => i !== idx) }));
  }, []);

  const isCritical = CRITICAL_CONDITIONS(detalhes, answers);
  const hasAnyProblem = Object.values(answers).some((v) => v === "nao") || answers.avaria_nova === "sim";

  const suggestedResult = isCritical ? "bloqueado" : hasAnyProblem ? "liberado_obs" : "liberado";

  const resetForm = () => {
    setStep(0); setVehicleId(""); setSelectedDriverId("");
    setAnswers({ calibragem_ok: "sim", pneus_visual_ok: "sim", fluidos_ok: "sim", conducao_ok: "sim", kit_ok: "sim", avaria_nova: "nao" });
    setDetalhes({}); setResultado(""); setResultadoMotivo(""); setTermoAceito(false); setPhotos({});
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setUploading(true);
      const date = format(now, "yyyy-MM-dd");

      // Upload photos
      const fotosUrls: Record<string, string[]> = {};
      for (const [cat, files] of Object.entries(photos)) {
        fotosUrls[cat] = [];
        for (const file of files) {
          const ext = file.name.split(".").pop() || "jpg";
          const path = `${date}/${vehicleId}/${cat}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from("checklist-photos").upload(path, file, { contentType: file.type });
          if (error) throw new Error(`Erro no upload: ${error.message}`);
          const { data: urlData } = supabase.storage.from("checklist-photos").getPublicUrl(path);
          fotosUrls[cat].push(urlData.publicUrl);
        }
      }

      const finalResultado = resultado || suggestedResult;

      const { error } = await supabase.from("vehicle_checklists").insert({
        vehicle_id: vehicleId,
        driver_id: selectedDriverId || null,
        created_by: userId,
        checklist_date: date,
        tripulacao: selectedDriver?.full_name || null,
        fotos: fotosUrls,
        calibragem_ok: answers.calibragem_ok,
        pneus_visual_ok: answers.pneus_visual_ok,
        fluidos_ok: answers.fluidos_ok,
        conducao_ok: answers.conducao_ok,
        kit_ok: answers.kit_ok,
        avaria_nova: answers.avaria_nova,
        avaria_descricao: answers.avaria_nova === "sim" ? (getDetail("avaria_descricao") || null) : null,
        resultado: finalResultado,
        resultado_motivo: finalResultado !== "liberado" ? (resultadoMotivo || null) : null,
        termo_aceito: termoAceito,
        detalhes,
        observacoes: null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setUploading(false);
      toast.success("Checklist salvo!");
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] });
      setOpen(false); resetForm();
    },
    onError: (err: any) => {
      setUploading(false);
      if (err?.message?.includes("duplicate key") || err?.code === "23505") {
        toast.error("Já existe checklist para este veículo hoje.");
      } else {
        toast.error("Erro: " + err.message);
      }
    },
  });

  const STEPS = [
    { id: "info", title: "Identificação" },
    { id: "painel", title: "Foto do Painel" },
    { id: "conferencia", title: "Conferência" },
    { id: "resultado", title: "Resultado" },
  ];

  const canAdvance = () => {
    if (step === 0) return !!vehicleId && !!selectedDriverId;
    if (step === 1) return (photos["painel"]?.length ?? 0) > 0;
    if (step === 2) return true;
    if (step === 3) {
      const finalRes = resultado || suggestedResult;
      if (finalRes !== "liberado" && !resultadoMotivo.trim()) return false;
      return termoAceito;
    }
    return true;
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-semibold">Veículo *</Label>
            <SearchableSelect value={vehicleId} onValueChange={setVehicleId}
              placeholder="Selecione o veículo" searchPlaceholder="Buscar placa..."
              options={vehicles.map((v) => ({ value: v.id, label: `${v.placa} — ${v.modelo}` }))} />
          </div>
          <div className="space-y-2">
            <Label className="text-base font-semibold">Técnico Responsável *</Label>
            <SearchableSelect value={selectedDriverId} onValueChange={setSelectedDriverId}
              placeholder="Selecione o técnico" searchPlaceholder="Buscar nome..."
              options={localDrivers.map((d) => ({ value: d.id, label: d.full_name }))} />
          </div>

          {selectedVehicle && selectedDriver && (
            <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dados Automáticos</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Placa:</span> <strong>{selectedVehicle.placa}</strong></div>
                <div><span className="text-muted-foreground">Modelo:</span> <strong>{selectedVehicle.modelo}</strong></div>
                <div><span className="text-muted-foreground">Técnico:</span> <strong>{selectedDriver.full_name}</strong></div>
                <div><span className="text-muted-foreground">KM Atual:</span> <strong>{selectedVehicle.km_atual.toLocaleString("pt-BR")}</strong></div>
                <div><span className="text-muted-foreground">Data:</span> <strong>{format(now, "dd/MM/yyyy")}</strong></div>
                <div><span className="text-muted-foreground">Hora:</span> <strong>{format(now, "HH:mm")}</strong></div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Tire uma foto do painel do veículo ligado, mostrando KM e indicadores.</p>
          <CameraCapture id="painel" label="Foto do Painel" hint="KM e indicadores visíveis"
            photos={photos["painel"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required />
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="space-y-5">
          {/* Q1: Calibragem */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">1. Calibragem diária realizada?</p>
            <YesNoToggle value={answers.calibragem_ok} onChange={(v) => setAnswers((a) => ({ ...a, calibragem_ok: v }))} />
            {answers.calibragem_ok === "nao" && (
              <div className="space-y-2 pl-2 border-l-2 border-destructive/30 ml-1">
                <Input placeholder="Qual anormalidade?" value={getDetail("calibragem_anormalidade")}
                  onChange={(e) => setDetail("calibragem_anormalidade", e.target.value)} className="h-11" />
                <Textarea placeholder="Observação..." value={getDetail("calibragem_obs")}
                  onChange={(e) => setDetail("calibragem_obs", e.target.value)} rows={2} />
              </div>
            )}
          </div>

          {/* Q2: Pneus */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">2. Pneus em condição visual de saída?</p>
            <YesNoToggle value={answers.pneus_visual_ok} onChange={(v) => setAnswers((a) => ({ ...a, pneus_visual_ok: v }))} />
            {answers.pneus_visual_ok === "nao" && (
              <div className="space-y-2 pl-2 border-l-2 border-destructive/30 ml-1">
                <ChipSelect options={PNEU_PROBLEMAS} selected={getDetail("pneus_problemas", [])}
                  onChange={(v) => setDetail("pneus_problemas", v)} />
                <Textarea placeholder="Observação..." value={getDetail("pneus_obs")}
                  onChange={(e) => setDetail("pneus_obs", e.target.value)} rows={2} />
                <CameraCapture id="pneus_exc" label="Foto do Problema" hint="Registre a anormalidade"
                  photos={photos["pneus_exc"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} />
              </div>
            )}
          </div>

          {/* Q3: Fluidos */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">3. Óleo, água e ausência de vazamentos conferidos?</p>
            <YesNoToggle value={answers.fluidos_ok} onChange={(v) => setAnswers((a) => ({ ...a, fluidos_ok: v }))} />
            {answers.fluidos_ok === "nao" && (
              <div className="space-y-2 pl-2 border-l-2 border-destructive/30 ml-1">
                <ChipSelect options={FLUIDO_PROBLEMAS} selected={getDetail("fluidos_problemas", [])}
                  onChange={(v) => setDetail("fluidos_problemas", v)} />
                <Textarea placeholder="Observação..." value={getDetail("fluidos_obs")}
                  onChange={(e) => setDetail("fluidos_obs", e.target.value)} rows={2} />
                <CameraCapture id="fluidos_exc" label="Foto do Problema" hint="Registre a anormalidade"
                  photos={photos["fluidos_exc"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} />
              </div>
            )}
          </div>

          {/* Q4: Condução */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">4. Veículo em condição normal de condução?</p>
            <YesNoToggle value={answers.conducao_ok} onChange={(v) => setAnswers((a) => ({ ...a, conducao_ok: v }))} />
            {answers.conducao_ok === "nao" && (
              <div className="space-y-2 pl-2 border-l-2 border-destructive/30 ml-1">
                <ChipSelect options={CONDUCAO_PROBLEMAS} selected={getDetail("conducao_problemas", [])}
                  onChange={(v) => setDetail("conducao_problemas", v)} />
                <Textarea placeholder="Observação..." value={getDetail("conducao_obs")}
                  onChange={(e) => setDetail("conducao_obs", e.target.value)} rows={2} />
                <CameraCapture id="conducao_exc" label="Foto do Problema" hint="Registre a anormalidade"
                  photos={photos["conducao_exc"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} />
              </div>
            )}
          </div>

          {/* Q5: Kit */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">5. Kit obrigatório e itens de operação conferidos?</p>
            <YesNoToggle value={answers.kit_ok} onChange={(v) => setAnswers((a) => ({ ...a, kit_ok: v }))} />
            {answers.kit_ok === "nao" && (
              <div className="space-y-2 pl-2 border-l-2 border-destructive/30 ml-1">
                <ChipSelect options={KIT_FALTANTES} selected={getDetail("kit_faltantes", [])}
                  onChange={(v) => setDetail("kit_faltantes", v)} />
                <Textarea placeholder="Observação..." value={getDetail("kit_obs")}
                  onChange={(e) => setDetail("kit_obs", e.target.value)} rows={2} />
              </div>
            )}
          </div>

          {/* Q6: Avaria */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">6. Há nova avaria visível no veículo?</p>
            <YesNoToggle value={answers.avaria_nova} onChange={(v) => setAnswers((a) => ({ ...a, avaria_nova: v }))}
              yesLabel="Sim" noLabel="Não" invertColors />
            {answers.avaria_nova === "sim" && (
              <div className="space-y-2 pl-2 border-l-2 border-destructive/30 ml-1">
                <Textarea placeholder="Descreva a avaria..." value={getDetail("avaria_descricao")}
                  onChange={(e) => setDetail("avaria_descricao", e.target.value)} rows={2} />
                <CameraCapture id="avaria" label="Foto da Avaria" hint="Obrigatória para registro"
                  photos={photos["avaria"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required />
              </div>
            )}
          </div>
        </div>
      );
    }

    // Step 3: Resultado
    const finalRes = resultado || suggestedResult;
    return (
      <div className="space-y-5">
        {/* Suggestion */}
        {isCritical && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive font-medium">
              Item crítico detectado. Recomendação: <strong>Bloqueado para saída</strong>.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-base font-semibold">Resultado da Inspeção *</Label>
          <div className="space-y-2">
            {[
              { value: "liberado", label: "Liberado", icon: ShieldCheck, color: "success" },
              { value: "liberado_obs", label: "Liberado com observação", icon: AlertCircle, color: "warning" },
              { value: "bloqueado", label: "Bloqueado para saída", icon: ShieldAlert, color: "destructive" },
            ].map((opt) => {
              const isSelected = finalRes === opt.value;
              const colorMap: Record<string, string> = {
                success: isSelected ? "bg-success/10 border-success text-success" : "border-border text-muted-foreground",
                warning: isSelected ? "bg-warning/10 border-warning text-warning" : "border-border text-muted-foreground",
                destructive: isSelected ? "bg-destructive/10 border-destructive text-destructive" : "border-border text-muted-foreground",
              };
              return (
                <button key={opt.value} type="button"
                  onClick={() => setResultado(opt.value)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all active:scale-[0.97] ${colorMap[opt.color]}`}>
                  <opt.icon className="w-5 h-5 shrink-0" />
                  <span className="text-base font-semibold">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {finalRes !== "liberado" && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Motivo da classificação *</Label>
            <Textarea placeholder="Descreva o motivo..." value={resultadoMotivo}
              onChange={(e) => setResultadoMotivo(e.target.value)} rows={3} />
          </div>
        )}

        <Separator />

        <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-3">
          <p className="text-sm leading-relaxed">
            "Declaro que conferi o veículo antes da saída e registrei neste checklist qualquer anormalidade identificada."
          </p>
          <div className="flex items-center gap-3">
            <Checkbox id="termo" checked={termoAceito} onCheckedChange={(v) => setTermoAceito(v === true)} className="w-5 h-5" />
            <label htmlFor="termo" className="text-sm font-medium cursor-pointer">Li e concordo</label>
          </div>
        </div>
      </div>
    );
  };

  const STEP_TITLES = ["Identificação", "Foto do Painel", "Conferência", "Resultado"];

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2 h-12 text-base px-6">
          <Plus className="w-5 h-5" /> Novo Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            {STEP_TITLES[step]}
          </DialogTitle>
          <div className="flex gap-1.5 pt-2">
            {STEP_TITLES.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Etapa {step + 1} de {STEP_TITLES.length}
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4">
          <div className="pb-28 sm:pb-6 pt-2">{renderStep()}</div>
        </div>

        <div className="border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} className="gap-1 h-12">
              <ChevronLeft className="w-4 h-4" /> Voltar
            </Button>
          )}
          <div className="flex-1" />
          {step < STEP_TITLES.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()} className="gap-1 h-12 text-base">
              Próximo <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={() => mutation.mutate()}
              disabled={!canAdvance() || mutation.isPending || uploading}
              className="gap-2 h-12 text-base" size="lg">
              {(mutation.isPending || uploading) ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardCheck className="w-5 h-5" />}
              Salvar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Question labels for detail/PDF ───
const QUESTION_MAP = [
  { key: "calibragem_ok", label: "Calibragem diária realizada?" },
  { key: "pneus_visual_ok", label: "Pneus em condição visual de saída?" },
  { key: "fluidos_ok", label: "Óleo, água e ausência de vazamentos conferidos?" },
  { key: "conducao_ok", label: "Veículo em condição normal de condução?" },
  { key: "kit_ok", label: "Kit obrigatório e itens conferidos?" },
  { key: "avaria_nova", label: "Há nova avaria visível no veículo?", invert: true },
];

const RESULTADO_LABELS: Record<string, { label: string; color: string }> = {
  liberado: { label: "Liberado", color: "success" },
  liberado_obs: { label: "Liberado com observação", color: "warning" },
  bloqueado: { label: "Bloqueado para saída", color: "destructive" },
};

// ─── PDF Export ───
function exportChecklistPDF(cl: any, vehicle: any, driverName: string) {
  const doc = new jsPDF();
  const dateStr = new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR");
  const placa = vehicle?.placa ?? "—";

  doc.setFontSize(16);
  doc.text("Checklist Pré-Operação — WeDo", 14, 20);
  doc.setFontSize(10);
  doc.text(`Data: ${dateStr}`, 14, 28);
  doc.text(`Veículo: ${placa} — ${vehicle?.modelo ?? ""}`, 14, 34);
  doc.text(`Técnico: ${driverName}`, 14, 40);

  const rows: any[][] = [];
  QUESTION_MAP.forEach((q) => {
    const val = cl[q.key];
    const isOk = q.invert ? val === "nao" : val === "sim";
    rows.push([q.label, isOk ? "OK" : "PROBLEMA"]);
  });

  autoTable(doc, {
    startY: 48,
    head: [["Item", "Resultado"]],
    body: rows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [41, 98, 255] },
  });

  const res = RESULTADO_LABELS[cl.resultado];
  const finalY = (doc as any).lastAutoTable?.finalY ?? 120;
  doc.setFontSize(11);
  doc.text(`Resultado: ${res?.label ?? cl.resultado ?? "—"}`, 14, finalY + 10);
  if (cl.resultado_motivo) {
    doc.setFontSize(9);
    doc.text(`Motivo: ${cl.resultado_motivo}`, 14, finalY + 16, { maxWidth: 180 });
  }

  doc.save(`checklist_${placa}_${cl.checklist_date}.pdf`);
}

// ─── Detail Dialog ───
function ChecklistDetailDialog({ checklist: cl, vehicles, localDrivers, onDeleted }: {
  checklist: any;
  vehicles: { id: string; placa: string; modelo: string; km_atual: number }[];
  localDrivers: { id: string; full_name: string }[];
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
  const driver = localDrivers.find((d) => d.id === cl.driver_id);
  const driverName = driver?.full_name ?? cl.tripulacao ?? "—";
  const fotosData = (cl.fotos && typeof cl.fotos === "object") ? cl.fotos : {};
  const detalhes = (cl.detalhes && typeof cl.detalhes === "object") ? cl.detalhes : {};
  const res = RESULTADO_LABELS[cl.resultado] ?? { label: cl.resultado ?? "—", color: "muted" };

  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    setDeleting(true);
    if (fotosData && typeof fotosData === "object") {
      for (const urls of Object.values(fotosData)) {
        if (Array.isArray(urls)) {
          for (const url of urls) {
            const path = (url as string).split("/checklist-photos/")[1];
            if (path) await supabase.storage.from("checklist-photos").remove([path]);
          }
        }
      }
    }
    const { error } = await supabase.from("vehicle_checklists").delete().eq("id", cl.id);
    setDeleting(false);
    if (error) { toast.error("Erro: " + error.message); }
    else { toast.success("Checklist apagado!"); queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] }); onDeleted?.(); }
  };

  return (
    <DialogContent className="max-w-lg w-full h-[100dvh] sm:h-auto sm:max-h-[85vh] p-0 gap-0 flex flex-col">
      <DialogHeader className="p-4 pb-0">
        <div className="flex items-center justify-between gap-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="w-4 h-4 text-primary" />
            {vehicle?.placa ?? "—"} — {new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}
          </DialogTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
              onClick={() => exportChecklistPDF(cl, vehicle, driverName)}>
              <Download className="w-3.5 h-3.5" /> PDF
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" className="h-8 w-8">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apagar checklist?</AlertDialogTitle>
                  <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Apagar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogHeader>
      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="space-y-4 pt-3">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-1.5 text-sm">
            <div><span className="text-muted-foreground">Veículo:</span> {vehicle?.placa} — {vehicle?.modelo}</div>
            <div><span className="text-muted-foreground">Técnico:</span> {driverName}</div>
            <div><span className="text-muted-foreground">Data:</span> {new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}</div>
            <div><span className="text-muted-foreground">Hora:</span> {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>

          {/* Photos */}
          {Object.entries(fotosData).map(([key, urls]: [string, any]) => {
            if (!Array.isArray(urls) || urls.length === 0) return null;
            return (
              <div key={key} className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">{key.replace(/_/g, " ")}</p>
                <div className="flex gap-2 flex-wrap">
                  {urls.map((url: string, i: number) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="w-14 h-14 rounded-md overflow-hidden border border-border block">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            );
          })}

          <Separator />

          {/* Questions */}
          {QUESTION_MAP.map((q) => {
            const val = cl[q.key];
            const isOk = q.invert ? val === "nao" : val === "sim";
            return (
              <div key={q.key} className="flex items-center justify-between py-1.5">
                <span className="text-sm flex-1">{q.label}</span>
                {isOk ? (
                  <Badge className="bg-success/10 text-success border-success/30 gap-1"><CheckCircle className="w-3 h-3" /> OK</Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> Problema</Badge>
                )}
              </div>
            );
          })}

          {/* Detail expansions */}
          {detalhes && Object.keys(detalhes).length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Detalhes das Anormalidades</p>
                {Object.entries(detalhes).map(([key, value]: [string, any]) => {
                  if (!value || (Array.isArray(value) && value.length === 0)) return null;
                  return (
                    <div key={key} className="text-sm">
                      <span className="text-muted-foreground">{key.replace(/_/g, " ")}:</span>{" "}
                      {Array.isArray(value) ? value.join(", ") : String(value)}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {cl.avaria_descricao && (
            <div className="text-sm">
              <span className="text-muted-foreground">Avaria:</span> {cl.avaria_descricao}
            </div>
          )}

          <Separator />

          {/* Result */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Resultado</p>
            <Badge className={`gap-1 ${
              res.color === "success" ? "bg-success/10 text-success border-success/30" :
              res.color === "warning" ? "bg-warning/10 text-warning border-warning/30" :
              "bg-destructive/10 text-destructive border-destructive/30"
            }`}>
              {res.color === "success" ? <ShieldCheck className="w-3 h-3" /> :
               res.color === "warning" ? <AlertCircle className="w-3 h-3" /> :
               <ShieldAlert className="w-3 h-3" />}
              {res.label}
            </Badge>
            {cl.resultado_motivo && <p className="text-sm mt-1">{cl.resultado_motivo}</p>}
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  );
}

// ─── Main Page ───
export default function Checklist() {
  const { user } = useAuth();
  const [filterDate, setFilterDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, placa, modelo, km_atual").order("placa");
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

  const { data: checklists = [], isLoading } = useQuery({
    queryKey: ["vehicle-checklists", filterDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_checklists").select("*")
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

  const blockedCount = useMemo(() =>
    checklists.filter((cl: any) => cl.resultado === "bloqueado").length, [checklists]);
  const obsCount = useMemo(() =>
    checklists.filter((cl: any) => cl.resultado === "liberado_obs").length, [checklists]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Checklist Pré-Operação</h1>
          <p className="text-sm text-muted-foreground">Inspeção rápida antes da saída</p>
        </div>
        {user && <ChecklistFormDialog vehicles={vehicles} localDrivers={localDrivers} userId={user.id} />}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Preenchidos</span>
              <CheckCircle className="w-4 h-4 text-success hidden sm:block" />
            </div>
            <p className="text-xl sm:text-3xl font-bold tabular-nums">{filledCount}<span className="text-sm sm:text-lg text-muted-foreground font-normal">/{totalVehicles}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Bloqueados</span>
              <ShieldAlert className="w-4 h-4 text-destructive hidden sm:block" />
            </div>
            <p className="text-xl sm:text-3xl font-bold tabular-nums text-destructive">{blockedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Com Obs.</span>
              <AlertCircle className="w-4 h-4 text-warning hidden sm:block" />
            </div>
            <p className="text-xl sm:text-3xl font-bold tabular-nums text-warning">{obsCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between p-3 sm:p-6">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Checklists do Dia
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
            className="w-full sm:w-40 h-8 text-xs" max={format(new Date(), "yyyy-MM-dd")} />
        </CardHeader>
        <CardContent className="p-0 max-h-[60vh] overflow-y-auto">
          {checklists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
              <ClipboardCheck className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">Nenhum checklist preenchido</p>
              <p className="text-xs">Clique em "Novo Checklist" para começar</p>
            </div>
          ) : (
            <>
              {/* Mobile */}
              <div className="sm:hidden divide-y divide-border">
                {checklists.map((cl: any) => {
                  const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
                  const driver = localDrivers.find((d) => d.id === cl.driver_id);
                  const res = RESULTADO_LABELS[cl.resultado] ?? { label: "—", color: "muted" };
                  return (
                    <Dialog key={cl.id}>
                      <DialogTrigger asChild>
                        <button className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 active:bg-muted/50"
                          onClick={() => setSelectedChecklist(cl)}>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{vehicle?.placa ?? "—"}</p>
                            <p className="text-xs text-muted-foreground truncate">{driver?.full_name ?? cl.tripulacao ?? "—"}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {res.color === "success" ? <ShieldCheck className="w-4 h-4 text-success" /> :
                             res.color === "warning" ? <AlertCircle className="w-4 h-4 text-warning" /> :
                             <ShieldAlert className="w-4 h-4 text-destructive" />}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </button>
                      </DialogTrigger>
                      {selectedChecklist?.id === cl.id && (
                        <ChecklistDetailDialog checklist={selectedChecklist} vehicles={vehicles} localDrivers={localDrivers}
                          onDeleted={() => setSelectedChecklist(null)} />
                      )}
                    </Dialog>
                  );
                })}
              </div>

              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Placa</th>
                      <th className="text-left p-3 font-medium">Técnico</th>
                      <th className="text-center p-3 font-medium">Resultado</th>
                      <th className="text-center p-3 font-medium">Hora</th>
                      <th className="text-center p-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.map((cl: any) => {
                      const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
                      const driver = localDrivers.find((d) => d.id === cl.driver_id);
                      const res = RESULTADO_LABELS[cl.resultado] ?? { label: "—", color: "muted" };
                      return (
                        <tr key={cl.id} className="border-b last:border-0">
                          <td className="p-3 font-medium">{vehicle?.placa ?? "—"}</td>
                          <td className="p-3">{driver?.full_name ?? cl.tripulacao ?? "—"}</td>
                          <td className="p-3 text-center">
                            <Badge className={`gap-1 text-xs ${
                              res.color === "success" ? "bg-success/10 text-success border-success/30" :
                              res.color === "warning" ? "bg-warning/10 text-warning border-warning/30" :
                              "bg-destructive/10 text-destructive border-destructive/30"
                            }`}>
                              {res.color === "success" ? <ShieldCheck className="w-3 h-3" /> :
                               res.color === "warning" ? <AlertCircle className="w-3 h-3" /> :
                               <ShieldAlert className="w-3 h-3" />}
                              {res.label}
                            </Badge>
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
                                <ChecklistDetailDialog checklist={selectedChecklist} vehicles={vehicles} localDrivers={localDrivers}
                                  onDeleted={() => setSelectedChecklist(null)} />
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
