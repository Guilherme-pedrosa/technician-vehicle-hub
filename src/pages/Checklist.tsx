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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ClipboardCheck, Plus, CheckCircle, XCircle, AlertTriangle,
  Loader2, Car, Droplets, Wrench, Shield, Eye, CalendarDays,
  Camera, ChevronLeft, ChevronRight, X, Image as ImageIcon, Download,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { toast } from "sonner";

// ─── Photo categories that require camera capture ───
type PhotoCategory =
  | "nivel_oleo"
  | "reservatorio"
  | "exterior_frente"
  | "exterior_traseira"
  | "exterior_esquerda"
  | "exterior_direita"
  | "danos_veiculo"
  | "farois_lanternas"
  | "calibracao_pneus"
  | "estepe"
  | "itens_seguranca"
  | "pneus_todos"
  | "vidros"
  | "som"
  | "motor"
  | "cambio"
  | "acessorios"
  | "limpeza"
  | "ruido_anormal";

const PHOTO_LABELS: Record<PhotoCategory, { label: string; hint: string; min: number }> = {
  nivel_oleo: { label: "Foto do Nível de Óleo", hint: "Foto da vareta ou painel mostrando o nível", min: 1 },
  reservatorio: { label: "Reservatório de Água", hint: "Foto com a tampa fechada, após conferir", min: 1 },
  exterior_frente: { label: "📸 Frente do Veículo", hint: "Foto da frente completa", min: 1 },
  exterior_traseira: { label: "📸 Traseira do Veículo", hint: "Foto da traseira completa", min: 1 },
  exterior_esquerda: { label: "📸 Lateral Esquerda", hint: "Foto da lateral esquerda completa", min: 1 },
  exterior_direita: { label: "📸 Lateral Direita", hint: "Foto da lateral direita completa", min: 1 },
  danos_veiculo: { label: "Foto dos Danos", hint: "Registre cada dano encontrado", min: 1 },
  farois_lanternas: { label: "Foto dos Faróis/Lanternas", hint: "Faróis acesos, lanternas funcionando", min: 1 },
  calibracao_pneus: { label: "Calibração dos 4 Pneus", hint: "Foto do calibrador mostrando a pressão de cada pneu", min: 4 },
  estepe: { label: "Pneu de Estepe", hint: "Foto mostrando condição do estepe", min: 1 },
  itens_seguranca: { label: "Itens de Segurança", hint: "Macaco, chave de roda e triângulo visíveis na foto", min: 1 },
  pneus_todos: { label: "Fotos de Todos os Pneus", hint: "Uma foto de cada pneu mostrando estado da banda", min: 4 },
  vidros: { label: "Fotos dos Vidros", hint: "Para-brisa e vidros laterais", min: 2 },
  som: { label: "Foto do Som/Painel", hint: "Foto do painel ou som ligado", min: 1 },
  motor: { label: "Foto do Motor", hint: "Foto do compartimento do motor aberto", min: 1 },
  cambio: { label: "Foto do Câmbio", hint: "Foto mostrando o câmbio", min: 1 },
  acessorios: { label: "Foto dos Acessórios", hint: "Suporte celular, câmera, etc", min: 1 },
  limpeza: { label: "Foto do Interior", hint: "Foto mostrando organização e limpeza", min: 1 },
  ruido_anormal: { label: "Vídeo/Foto do Ruído", hint: "Registre evidência do ruído", min: 1 },
};

// ─── Checklist inspection fields ───
type ChecklistField = {
  key: string;
  label: string;
  options: { value: string; label: string; color: string }[];
  category: string;
  photoAfter?: PhotoCategory | PhotoCategory[];
  photoConditional?: "always" | "non_conforme";
};

const CONFORME_NAO = [
  { value: "conforme", label: "CONFORME", color: "success" },
  { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
];
const SIM_NAO = [
  { value: "sim", label: "SIM", color: "success" },
  { value: "nao", label: "NÃO", color: "destructive" },
];
const NAO_SIM = [
  { value: "nao", label: "NÃO", color: "success" },
  { value: "sim", label: "SIM", color: "destructive" },
];

const CHECKLIST_FIELDS: ChecklistField[] = [
  // Fluidos
  { key: "nivel_oleo", label: "Nível de Óleo OK?", category: "Fluidos", options: CONFORME_NAO, photoAfter: "nivel_oleo", photoConditional: "always" },
  { key: "troca_oleo", label: "Troca de Óleo", category: "Fluidos", options: [
    { value: "ok", label: "OK", color: "success" },
    { value: "se_aproximando", label: "PRÓXIMO", color: "warning" },
    { value: "vencido", label: "VENCIDO", color: "destructive" },
  ]},
  { key: "nivel_agua", label: "Nível de Água OK?", category: "Fluidos", options: CONFORME_NAO, photoAfter: "reservatorio", photoConditional: "always" },
  // Exterior — danos + faróis (360° photos are in their own step)
  { key: "danos_veiculo", label: "Tem algum dano diferente no veículo?", category: "Fotos 360° Exterior", options: NAO_SIM,
    photoAfter: "danos_veiculo", photoConditional: "non_conforme" },
  { key: "farois_lanternas", label: "Faróis e Lanternas funcionando?", category: "Fotos 360° Exterior", options: CONFORME_NAO, photoAfter: "farois_lanternas", photoConditional: "always" },
  // Funcionamento
  { key: "som", label: "Som funcionando?", category: "Verificações de Funcionamento", options: CONFORME_NAO, photoAfter: "som", photoConditional: "always" },
  { key: "motor", label: "Motor em pleno funcionamento?", category: "Verificações de Funcionamento", options: CONFORME_NAO, photoAfter: "motor", photoConditional: "always" },
  { key: "cambio", label: "Câmbio funcionando corretamente?", category: "Verificações de Funcionamento", options: CONFORME_NAO, photoAfter: "cambio", photoConditional: "always" },
  { key: "pneus", label: "Pneus OK?", category: "Verificações de Funcionamento", options: CONFORME_NAO, photoAfter: "calibracao_pneus", photoConditional: "always" },
  { key: "pneu_estepe", label: "Estepe cheio e em boas condições?", category: "Verificações de Funcionamento", options: CONFORME_NAO, photoAfter: "estepe", photoConditional: "always" },
  // Segurança
  { key: "itens_seguranca", label: "Chave de roda, macaco e triângulo disponíveis?", category: "Inspeção do Veículo", options: SIM_NAO, photoAfter: "itens_seguranca", photoConditional: "always" },
  { key: "acessorios", label: "Acessórios no local adequado e funcionando?", category: "Inspeção do Veículo", options: SIM_NAO, photoAfter: "acessorios", photoConditional: "always" },
  { key: "limpeza_organizacao", label: "Veículo limpo e organizado?", category: "Inspeção do Veículo", options: SIM_NAO, photoAfter: "limpeza", photoConditional: "always" },
  { key: "vidros", label: "Todos os vidros estão OK?", category: "Inspeção do Veículo", options: SIM_NAO, photoAfter: "vidros", photoConditional: "always" },
  { key: "ruido_anormal", label: "Existe algum ruído anormal?", category: "Inspeção do Veículo", options: NAO_SIM, photoAfter: "ruido_anormal", photoConditional: "non_conforme" },
];

const CATEGORY_ICONS: Record<string, typeof Droplets> = {
  "Fluidos": Droplets,
  "Fotos 360° Exterior": Car,
  "Verificações de Funcionamento": Wrench,
  "Inspeção do Veículo": Shield,
};

type FormData = Record<string, string>;
type PhotosMap = Record<string, File[]>;

function isNonConforme(key: string, val: string) {
  return val === "nao_conforme" || val === "vencido" ||
    (key === "danos_veiculo" && val === "sim") ||
    (key === "ruido_anormal" && val === "sim") ||
    (key === "itens_seguranca" && val === "nao") ||
    (key === "acessorios" && val === "nao") ||
    (key === "limpeza_organizacao" && val === "nao") ||
    (key === "vidros" && val === "nao");
}

// ─── Camera Capture Component ───
function CameraCapture({ category, photos, onCapture, onRemove }: {
  category: PhotoCategory;
  photos: File[];
  onCapture: (cat: PhotoCategory, files: FileList) => void;
  onRemove: (cat: PhotoCategory, idx: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = PHOTO_LABELS[category];

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        <Badge variant="outline" className="text-xs tabular-nums">
          {photos.length}/{meta.min}
        </Badge>
      </div>

      {/* Photo thumbnails */}
      {photos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {photos.map((file, i) => (
            <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden border border-border">
              <img
                src={URL.createObjectURL(file)}
                alt=""
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(category, i)}
                className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl-md p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onCapture(category, e.target.files);
            e.target.value = "";
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="w-4 h-4" /> Tirar Foto
      </Button>
    </div>
  );
}

// ─── Wizard Steps ───
const STEPS = [
  { id: "info", title: "Identificação" },
  { id: "fluidos", title: "Fluidos" },
  { id: "exterior_360", title: "Fotos 360°" },
  { id: "exterior_check", title: "Exterior" },
  { id: "funcionamento", title: "Funcionamento" },
  { id: "seguranca", title: "Inspeção" },
  { id: "final", title: "Finalizar" },
];

const STEP_CATEGORIES: Record<string, string[]> = {
  fluidos: ["Fluidos"],
  exterior_check: ["Fotos 360° Exterior"],
  funcionamento: ["Verificações de Funcionamento"],
  seguranca: ["Inspeção do Veículo"],
};

// ─── Form Dialog ───
function ChecklistFormDialog({ vehicles, localDrivers, userId }: {
  vehicles: { id: string; placa: string; modelo: string }[];
  localDrivers: { id: string; full_name: string }[];
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Form state
  const [vehicleId, setVehicleId] = useState("");
  const [selectedDriverName, setSelectedDriverName] = useState("");
  const [tripulacao, setTripulacao] = useState("");
  const [destino, setDestino] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [answers, setAnswers] = useState<FormData>(() => {
    const d: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => { d[f.key] = f.options[0]?.value ?? ""; });
    return d;
  });
  const [photos, setPhotos] = useState<PhotosMap>({});
  const [uploading, setUploading] = useState(false);

  const handleCapture = useCallback((cat: PhotoCategory, files: FileList) => {
    setPhotos((prev) => ({
      ...prev,
      [cat]: [...(prev[cat] ?? []), ...Array.from(files)],
    }));
  }, []);

  const handleRemovePhoto = useCallback((cat: PhotoCategory, idx: number) => {
    setPhotos((prev) => ({
      ...prev,
      [cat]: (prev[cat] ?? []).filter((_, i) => i !== idx),
    }));
  }, []);

  const resetForm = () => {
    setStep(0);
    setVehicleId("");
    setSelectedDriverName("");
    setTripulacao("");
    setDestino("");
    setObservacoes("");
    setPhotos({});
    const d: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => { d[f.key] = f.options[0]?.value ?? ""; });
    setAnswers(d);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setUploading(true);

      // Upload all photos
      const fotosUrls: Record<string, string[]> = {};
      const date = format(new Date(), "yyyy-MM-dd");

      for (const [cat, files] of Object.entries(photos)) {
        fotosUrls[cat] = [];
        for (const file of files) {
          const ext = file.name.split(".").pop() || "jpg";
          const path = `${date}/${vehicleId}/${cat}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from("checklist-photos").upload(path, file, {
            contentType: file.type,
          });
          if (error) throw new Error(`Erro no upload: ${error.message}`);
          const { data: urlData } = supabase.storage.from("checklist-photos").getPublicUrl(path);
          fotosUrls[cat].push(urlData.publicUrl);
        }
      }

      const matchedLocal = selectedDriverName
        ? localDrivers.find((d) => d.full_name.toLowerCase().trim() === selectedDriverName.toLowerCase().trim())
        : null;

      const { error } = await supabase.from("vehicle_checklists").insert({
        vehicle_id: vehicleId,
        driver_id: matchedLocal?.id || null,
        created_by: userId,
        checklist_date: date,
        tripulacao: tripulacao || selectedDriverName || null,
        destino: destino || null,
        observacoes: observacoes || null,
        fotos: fotosUrls,
        ...answers,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setUploading(false);
      toast.success("Checklist salvo com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] });
      setOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setUploading(false);
      if (err?.message?.includes("duplicate key") || err?.code === "23505") {
        toast.error("Já existe um checklist para este veículo hoje.");
      } else {
        toast.error("Erro ao salvar: " + err.message);
      }
    },
  });

  const nonConformeCount = useMemo(() =>
    CHECKLIST_FIELDS.filter((f) => isNonConforme(f.key, answers[f.key])).length
  , [answers]);

  const canAdvance = () => {
    if (step === 0) return !!vehicleId && !!selectedDriverName;
    return true;
  };

  const renderStepContent = () => {
    const currentStep = STEPS[step];

    if (currentStep.id === "info") {
      return (
        <div className="space-y-4">
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
            <Label>Motorista Responsável *</Label>
            <SearchableSelect
              value={selectedDriverName}
              onValueChange={setSelectedDriverName}
              placeholder="Selecione o motorista"
              searchPlaceholder="Buscar motorista..."
              options={localDrivers.map((d) => ({ value: d.full_name, label: d.full_name }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Técnicos Tripulação</Label>
            <Input placeholder="Nomes dos técnicos" value={tripulacao} onChange={(e) => setTripulacao(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Destino(s)</Label>
            <Input placeholder="Destinos do dia" value={destino} onChange={(e) => setDestino(e.target.value)} />
          </div>
        </div>
      );
    }

    if (currentStep.id === "final") {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              placeholder="Descreva problemas encontrados, detalhes adicionais..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={4}
            />
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <h4 className="text-sm font-semibold">Resumo</h4>
            <div className="flex items-center gap-2">
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
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>Veículo: {vehicles.find((v) => v.id === vehicleId)?.placa ?? "—"}</p>
              <p>Motorista: {selectedDriverName || "—"}</p>
              <p>Fotos: {Object.values(photos).reduce((sum, arr) => sum + arr.length, 0)} tiradas</p>
            </div>
          </div>
        </div>
      );
    }

    // Dedicated 360° photos step
    if (currentStep.id === "exterior_360") {
      const angleCats: PhotoCategory[] = ["exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita"];
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Tire uma foto de cada ângulo do veículo:</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {angleCats.map((cat) => (
              <CameraCapture
                key={cat}
                category={cat}
                photos={photos[cat] ?? []}
                onCapture={handleCapture}
                onRemove={handleRemovePhoto}
              />
            ))}
          </div>
        </div>
      );
    }

    // Category-based steps
    const categories = STEP_CATEGORIES[currentStep.id] ?? [];
    const fields = CHECKLIST_FIELDS.filter((f) => categories.includes(f.category));

    return (
      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <p className="text-sm font-medium">{field.label}</p>
            <div className="flex gap-2">
              {field.options.map((opt) => {
                const isSelected = answers[field.key] === opt.value;
                const colorMap: Record<string, string> = {
                  success: isSelected ? "bg-success text-success-foreground border-success" : "border-success/40 text-success hover:bg-success/10",
                  destructive: isSelected ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/40 text-destructive hover:bg-destructive/10",
                  warning: isSelected ? "bg-warning text-warning-foreground border-warning" : "border-warning/40 text-warning hover:bg-warning/10",
                };
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAnswers((prev) => ({ ...prev, [field.key]: opt.value }))}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors active:scale-[0.97] ${colorMap[opt.color]}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Photo capture after this field */}
            {field.photoAfter && (() => {
              const shouldShow = field.photoConditional === "non_conforme"
                ? isNonConforme(field.key, answers[field.key])
                : true;
              if (!shouldShow) return null;
              const cats = Array.isArray(field.photoAfter) ? field.photoAfter : [field.photoAfter];
              return cats.map((cat) => (
                <CameraCapture
                  key={cat}
                  category={cat}
                  photos={photos[cat] ?? []}
                  onCapture={handleCapture}
                  onRemove={handleRemovePhoto}
                />
              ));
            })()}
          </div>
        ))}

        {/* Pneus_todos photos after funcionamento step */}
        {currentStep.id === "funcionamento" && (
          <CameraCapture
            category="pneus_todos"
            photos={photos["pneus_todos"] ?? []}
            onCapture={handleCapture}
            onRemove={handleRemovePhoto}
          />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Novo</span> Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] p-0 gap-0 flex flex-col">
        {/* Header with step indicator */}
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            {STEPS[step].title}
          </DialogTitle>
          {/* Step dots */}
          <div className="flex gap-1.5 pt-2">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Etapa {step + 1} de {STEPS.length} — {format(new Date(), "dd/MM/yyyy")}
          </p>
        </DialogHeader>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4">
          <div className="pb-28 sm:pb-6">
            {renderStepContent()}
          </div>
        </div>

        {/* Navigation — sticky bottom */}
        <div className="border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} className="gap-1">
              <ChevronLeft className="w-4 h-4" /> Voltar
            </Button>
          )}
          <div className="flex-1" />
          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="gap-1"
            >
              Próximo <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={() => mutation.mutate()}
              disabled={!vehicleId || mutation.isPending || uploading}
              className="gap-2"
              size="lg"
            >
              {(mutation.isPending || uploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
              Salvar Checklist
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status badge for detail view ───
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

// ─── Detail Dialog ───
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

  const fotosData = (checklist.fotos && typeof checklist.fotos === "object") ? checklist.fotos : {};

  return (
    <DialogContent className="max-w-lg w-full h-[100dvh] sm:h-auto sm:max-h-[85vh] p-0 gap-0">
      <DialogHeader className="p-4 pb-0">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Eye className="w-4 h-4 text-primary" />
          {vehicle?.placa ?? "—"} — {new Date(checklist.checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}
        </DialogTitle>
      </DialogHeader>
      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="space-y-4 pt-3">
          <div className="grid grid-cols-1 gap-1.5 text-sm">
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
                  <div key={f.key}>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-sm">{f.label}</span>
                      {statusBadge(checklist[f.key], f)}
                    </div>
                    {/* Show photos if any */}
                    {f.photoAfter && (() => {
                      const cats = Array.isArray(f.photoAfter) ? f.photoAfter : [f.photoAfter];
                      const allUrls = cats.flatMap((cat) => fotosData[cat] ?? []);
                      if (allUrls.length === 0) return null;
                      return (
                        <div className="flex gap-2 flex-wrap py-1">
                          {allUrls.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="w-14 h-14 rounded-md overflow-hidden border border-border block">
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            );
          })}
          {/* Additional photo categories */}
          {fotosData["pneus_todos"]?.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" /> Fotos dos Pneus
              </h4>
              <div className="flex gap-2 flex-wrap">
                {fotosData["pneus_todos"].map((url: string, i: number) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="w-14 h-14 rounded-md overflow-hidden border border-border block">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
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

// ─── Main Page ───
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Checklist Veicular</h1>
          <p className="text-sm text-muted-foreground">Inspeção diária obrigatória</p>
        </div>
        {user && (
          <ChecklistFormDialog
            vehicles={vehicles}
            localDrivers={localDrivers}
            userId={user.id}
          />
        )}
      </div>

      {/* KPI Cards */}
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
        <CardContent className="p-0">
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
                  const fotoCount = cl.fotos ? Object.values(cl.fotos as Record<string, any[]>).reduce((s: number, a) => s + (a?.length ?? 0), 0) : 0;

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
                            {fotoCount > 0 && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                <ImageIcon className="w-3 h-3" /> {fotoCount}
                              </span>
                            )}
                            {hasIssue ? (
                              <XCircle className="w-4 h-4 text-destructive" />
                            ) : (
                              <CheckCircle className="w-4 h-4 text-success" />
                            )}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
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
                      <th className="text-center p-3 font-medium">Fotos</th>
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
                      const fotoCount = cl.fotos ? Object.values(cl.fotos as Record<string, any[]>).reduce((s: number, a) => s + (a?.length ?? 0), 0) : 0;

                      return (
                        <tr key={cl.id} className="border-b last:border-0">
                          <td className="p-3 font-medium">{vehicle?.placa ?? "—"}</td>
                          <td className="p-3">{driver?.full_name ?? cl.tripulacao ?? "—"}</td>
                          <td className="p-3 text-muted-foreground">{cl.destino ?? "—"}</td>
                          <td className="p-3 text-center">
                            {fotoCount > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <ImageIcon className="w-3 h-3" /> {fotoCount}
                              </span>
                            )}
                          </td>
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
