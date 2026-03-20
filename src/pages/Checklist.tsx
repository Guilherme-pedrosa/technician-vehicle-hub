import { useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  Loader2, Car, Droplets, Wrench, Shield, CalendarDays, Camera,
  ChevronLeft, ChevronRight, X, Image as ImageIcon, Download, Eye,
  Trash2, ShieldAlert, ShieldCheck, AlertCircle, Gauge, CircleDot,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ═══════════════════════════════════════════
// PHOTO CATEGORIES — Baseado em benchmark Localiza/Sigefro
// ═══════════════════════════════════════════

type PhotoCategory =
  | "painel" | "exterior_frente" | "exterior_traseira" | "exterior_esquerda" | "exterior_direita"
  | "nivel_oleo" | "reservatorio_agua"
  | "pneu_de" | "pneu_dd" | "pneu_te" | "pneu_td" | "calibracao" | "estepe"
  | "farois_lanternas" | "motor" | "itens_seguranca" | "interior"
  | "danos" | "avaria";

const PHOTO_META: Record<PhotoCategory, { label: string; hint: string; min: number }> = {
  painel: { label: "📊 Painel do Veículo", hint: "KM e indicadores visíveis, veículo ligado", min: 1 },
  exterior_frente: { label: "📸 Frente do Veículo", hint: "Foto frontal completa", min: 1 },
  exterior_traseira: { label: "📸 Traseira do Veículo", hint: "Foto traseira completa", min: 1 },
  exterior_esquerda: { label: "📸 Lateral Esquerda", hint: "Foto lateral esquerda completa", min: 1 },
  exterior_direita: { label: "📸 Lateral Direita", hint: "Foto lateral direita completa", min: 1 },
  nivel_oleo: { label: "🛢️ Nível de Óleo", hint: "Foto da vareta ou indicador de nível", min: 1 },
  reservatorio_agua: { label: "💧 Reservatório de Água", hint: "Foto do reservatório de arrefecimento", min: 1 },
  pneu_de: { label: "🔵 Pneu Dianteiro Esquerdo", hint: "Foto mostrando banda de rodagem", min: 1 },
  pneu_dd: { label: "🔵 Pneu Dianteiro Direito", hint: "Foto mostrando banda de rodagem", min: 1 },
  pneu_te: { label: "🔵 Pneu Traseiro Esquerdo", hint: "Foto mostrando banda de rodagem", min: 1 },
  pneu_td: { label: "🔵 Pneu Traseiro Direito", hint: "Foto mostrando banda de rodagem", min: 1 },
  calibracao: { label: "📏 Calibração dos Pneus", hint: "Foto do calibrador mostrando pressão", min: 1 },
  estepe: { label: "🔄 Pneu Estepe", hint: "Foto mostrando condição do estepe", min: 1 },
  farois_lanternas: { label: "💡 Faróis e Lanternas", hint: "Faróis acesos, setas funcionando", min: 1 },
  motor: { label: "⚙️ Compartimento do Motor", hint: "Foto do motor aberto", min: 1 },
  itens_seguranca: { label: "🔺 Itens de Segurança", hint: "Triângulo, macaco, chave de roda visíveis", min: 1 },
  interior: { label: "🪑 Interior do Veículo", hint: "Foto da organização e limpeza interna", min: 1 },
  danos: { label: "⚠️ Registro de Dano/Avaria", hint: "Foto detalhada do dano encontrado", min: 1 },
  avaria: { label: "⚠️ Nova Avaria", hint: "Foto obrigatória da avaria encontrada", min: 1 },
};

// ═══════════════════════════════════════════
// CHECKLIST FIELDS — Itens de inspeção
// ═══════════════════════════════════════════

type ChecklistField = {
  key: string;
  label: string;
  options: { value: string; label: string; color: string }[];
  category: string;
  critical?: boolean;
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
  // Exterior (durante caminhada 360°)
  { key: "farois_lanternas", label: "Faróis e lanternas funcionando?", category: "Exterior", options: CONFORME_NAO, critical: true },
  { key: "vidros", label: "Vidros sem trincas/danos?", category: "Exterior", options: SIM_NAO },
  { key: "limpeza_organizacao", label: "Veículo limpo e organizado?", category: "Exterior", options: SIM_NAO },
  // Pneus + Estepe + Itens de segurança (tudo no mesmo local)
  { key: "pneus", label: "Pneus em condição de saída?", category: "Pneus", options: CONFORME_NAO, critical: true },
  { key: "pneu_estepe", label: "Estepe em boas condições?", category: "Pneus", options: CONFORME_NAO },
  { key: "itens_seguranca", label: "Triângulo, macaco e chave de roda?", category: "Pneus", options: SIM_NAO, critical: true },
  // Capô — tudo junto: motor + fluidos (abre capô 1x só)
  { key: "motor", label: "Motor funcionando normalmente?", category: "Capô", options: CONFORME_NAO, critical: true },
  { key: "nivel_oleo", label: "Nível de óleo OK?", category: "Capô", options: CONFORME_NAO, critical: true },
  { key: "nivel_agua", label: "Nível de água/arrefecimento OK?", category: "Capô", options: CONFORME_NAO, critical: true },
  { key: "ruido_anormal", label: "Existe algum ruído anormal?", category: "Capô", options: NAO_SIM, critical: true },
  // Interior (cabine)
  { key: "cambio", label: "Câmbio funcionando corretamente?", category: "Interior", options: CONFORME_NAO, critical: true },
  { key: "som", label: "Som/rádio funcionando?", category: "Interior", options: CONFORME_NAO },
  { key: "acessorios", label: "Acessórios e ferramentas presentes?", category: "Interior", options: SIM_NAO },
  // Danos
  { key: "danos_veiculo", label: "Há algum dano/avaria nova no veículo?", category: "Danos", options: NAO_SIM },
];

const CATEGORY_ICONS: Record<string, typeof Droplets> = {
  "Exterior": Car,
  "Pneus": CircleDot,
  "Capô": Wrench,
  "Interior": Shield,
  "Danos": AlertTriangle,
};

type FormData = Record<string, string>;
type PhotosMap = Record<string, File[]>;

type ValidationSummaryItem = {
  categoria: string;
  label: string;
  motivos: string[];
};

function isNonConforme(key: string, val: string) {
  return val === "nao_conforme" || val === "vencido" ||
    (key === "danos_veiculo" && val === "sim") ||
    (key === "ruido_anormal" && val === "sim") ||
    (["itens_seguranca", "acessorios", "limpeza_organizacao", "vidros"].includes(key) && val === "nao");
}

function isCriticalNonConforme(key: string, val: string) {
  const field = CHECKLIST_FIELDS.find((f) => f.key === key);
  if (!field?.critical) return false;
  return isNonConforme(key, val);
}

// ═══════════════════════════════════════════
// AI PHOTO VALIDATION
// ═══════════════════════════════════════════

type ValidationResult = {
  valid: boolean;
  quality: "boa" | "aceitavel" | "ruim";
  reason: string;
  ai_error?: boolean;
};

type PhotoValidation = {
  status: "idle" | "validating" | "valid" | "invalid" | "forced";
  result?: ValidationResult;
};

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // Remove data:image/...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function validatePhoto(file: File, category: string): Promise<ValidationResult> {
  try {
    // Resize image to reduce base64 size for faster API calls
    const base64 = await fileToBase64(file);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-checklist-photo`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ image_base64: base64, category }),
      }
    );

    if (!response.ok) throw new Error("Validation failed");
    return await response.json();
  } catch (err) {
    console.error("Photo validation error:", err);
    return { valid: false, quality: "ruim", reason: "Falha ao validar a foto", ai_error: true };
  }
}

function summarizePhotoValidations(photos: PhotosMap, photoValidations: Record<string, PhotoValidation[]>) {
  const pendingMap = new Map<string, ValidationSummaryItem>();
  const invalidMap = new Map<string, ValidationSummaryItem>();
  const forcedMap = new Map<string, ValidationSummaryItem>();
  const errorMap = new Map<string, ValidationSummaryItem>();

  const ensureItem = (map: Map<string, ValidationSummaryItem>, category: string) => {
    if (!map.has(category)) {
      map.set(category, {
        categoria: category,
        label: PHOTO_META[category as PhotoCategory]?.label ?? category,
        motivos: [],
      });
    }

    return map.get(category)!;
  };

  (Object.keys(photos) as PhotoCategory[]).forEach((category) => {
    const files = photos[category] ?? [];
    const validations = photoValidations[category] ?? [];

    files.forEach((_, index) => {
      const validation = validations[index];

      if (!validation || validation.status === "idle" || validation.status === "validating") {
        const item = ensureItem(pendingMap, category);
        if (!item.motivos.includes("Validação em andamento")) item.motivos.push("Validação em andamento");
        return;
      }

      if (validation.status === "forced") {
        const item = ensureItem(forcedMap, category);
        const reason = validation.result?.reason ?? "Foto forçada pelo técnico";
        if (!item.motivos.includes(reason)) item.motivos.push(reason);
        return;
      }

      if (validation.result?.ai_error) {
        const item = ensureItem(errorMap, category);
        const reason = validation.result?.reason ?? "Falha na validação automática";
        if (!item.motivos.includes(reason)) item.motivos.push(reason);
        return;
      }

      if (validation.status === "invalid") {
        const item = ensureItem(invalidMap, category);
        const reason = validation.result?.reason ?? "Foto reprovada pela IA";
        if (!item.motivos.includes(reason)) item.motivos.push(reason);
      }
    });
  });

  const pending = Array.from(pendingMap.values());
  const invalid = Array.from(invalidMap.values());
  const forced = Array.from(forcedMap.values());
  const errors = Array.from(errorMap.values());

  return {
    pending,
    invalid,
    forced,
    errors,
    hasPending: pending.length > 0,
    hasBadPhotos: invalid.length > 0 || forced.length > 0 || errors.length > 0,
  };
}

// ═══════════════════════════════════════════
// CAMERA CAPTURE COMPONENT
// ═══════════════════════════════════════════

function CameraCapture({ category, photos, onCapture, onRemove, required, validations, onValidationUpdate }: {
  category: PhotoCategory;
  photos: File[];
  onCapture: (cat: PhotoCategory, files: FileList) => void;
  onRemove: (cat: PhotoCategory, idx: number) => void;
  required?: boolean;
  validations?: PhotoValidation[];
  onValidationUpdate?: (cat: PhotoCategory, idx: number, validation: PhotoValidation) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = PHOTO_META[category];
  const hasEnough = photos.length >= meta.min;

  const handleCapture = async (files: FileList) => {
    onCapture(category, files);
    // Trigger validation for new photo
    if (onValidationUpdate) {
      const newIdx = photos.length;
      const file = files[0];
      onValidationUpdate(category, newIdx, { status: "validating" });
      const result = await validatePhoto(file, category);
      onValidationUpdate(category, newIdx, {
        status: result.valid ? "valid" : "invalid",
        result,
      });
      if (!result.valid) {
        toast.warning(`⚠️ Foto pode estar inadequada: ${result.reason}`, { duration: 6000 });
      }
    }
  };

  return (
    <div className={`space-y-2 rounded-xl border-2 p-3 transition-colors ${
      required && !hasEnough ? "border-destructive/50 bg-destructive/5" : "border-dashed border-border bg-muted/20"
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
        </div>
        <Badge variant={hasEnough ? "default" : "destructive"} className="text-[10px] shrink-0 ml-2">
          {photos.length}/{meta.min}
        </Badge>
      </div>

      {photos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {photos.map((file, i) => {
            const v = validations?.[i];
            const borderColor = !v || v.status === "idle" ? "border-border"
              : v.status === "validating" ? "border-primary animate-pulse"
              : v.status === "valid" ? "border-success"
              : v.status === "forced" ? "border-warning"
              : "border-destructive";
            return (
              <div key={i} className="space-y-1">
                <div className={`relative w-16 h-16 rounded-lg overflow-hidden border-2 ${borderColor}`}>
                  <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                  {v?.status === "validating" && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                  )}
                  {v?.status === "valid" && (
                    <div className="absolute bottom-0 right-0 bg-success rounded-tl-lg p-0.5">
                      <CheckCircle className="w-3 h-3 text-success-foreground" />
                    </div>
                  )}
                  {v?.status === "invalid" && (
                    <div className="absolute bottom-0 right-0 bg-destructive rounded-tl-lg p-0.5">
                      <XCircle className="w-3 h-3 text-destructive-foreground" />
                    </div>
                  )}
                  {v?.status === "forced" && (
                    <div className="absolute bottom-0 right-0 bg-warning rounded-tl-lg p-0.5">
                      <AlertCircle className="w-3 h-3 text-warning-foreground" />
                    </div>
                  )}
                  <button type="button" onClick={() => onRemove(category, i)}
                    className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl-lg p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {v?.status === "invalid" && v.result && (
                  <div className="w-16">
                    <p className="text-[9px] text-destructive leading-tight">{v.result.reason}</p>
                    <button type="button"
                      className="text-[9px] text-warning font-bold underline mt-0.5"
                      onClick={() => onValidationUpdate?.(category, i, { status: "forced", result: v.result })}>
                      Forçar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { if (e.target.files?.length) { handleCapture(e.target.files); e.target.value = ""; } }} />
      <Button type="button" variant={hasEnough ? "outline" : "default"} className="w-full gap-2 h-12 text-base active:scale-[0.97]"
        onClick={() => inputRef.current?.click()}>
        <Camera className="w-5 h-5" /> {hasEnough ? "Tirar Outra" : "Tirar Foto"}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════
// WIZARD STEPS — Fluxo físico do técnico
// Lógica: painel → ao redor (360°+exterior) → pneus → capô (motor+óleo+água) → interior+kit → danos → resultado
// ═══════════════════════════════════════════

const STEPS = [
  { id: "info", title: "Identificação", icon: ClipboardCheck },
  { id: "painel", title: "Foto do Painel", icon: Gauge },
  { id: "exterior_360", title: "360° e Exterior", icon: Car },
  { id: "pneus", title: "Pneus e Calibração", icon: CircleDot },
  { id: "capo", title: "Capô Aberto", icon: Wrench },
  { id: "interior", title: "Interior", icon: Shield },
  { id: "danos", title: "Danos e Avarias", icon: AlertTriangle },
  { id: "resultado", title: "Resultado Final", icon: ShieldCheck },
];

const STEP_FIELD_CATEGORIES: Record<string, string[]> = {
  exterior_360: ["Exterior"],
  pneus: ["Pneus"],
  capo: ["Capô"],
  interior: ["Interior"],
  danos: ["Danos"],
};

const STEP_PHOTOS: Record<string, PhotoCategory[]> = {
  painel: ["painel"],
  exterior_360: ["exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita", "farois_lanternas"],
  pneus: ["pneu_de", "pneu_dd", "pneu_te", "pneu_td", "calibracao", "estepe", "itens_seguranca"],
  capo: ["motor", "nivel_oleo", "reservatorio_agua"],
  interior: ["interior"],
};

// ═══════════════════════════════════════════
// FORM DIALOG
// ═══════════════════════════════════════════

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
  const [tripulacao, setTripulacao] = useState("");
  const [destino, setDestino] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [answers, setAnswers] = useState<FormData>(() => {
    const d: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => { d[f.key] = f.options[0]?.value ?? ""; });
    return d;
  });
  const [photos, setPhotos] = useState<PhotosMap>({});
  const [photoValidations, setPhotoValidations] = useState<Record<string, PhotoValidation[]>>({});
  const [uploading, setUploading] = useState(false);
  const [resultado, setResultado] = useState("");
  const [resultadoMotivo, setResultadoMotivo] = useState("");
  const [termoAceito, setTermoAceito] = useState(false);
  const [kmProximaTroca, setKmProximaTroca] = useState("");

  const photoValidationSummary = useMemo(
    () => summarizePhotoValidations(photos, photoValidations),
    [photos, photoValidations],
  );

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const selectedDriver = localDrivers.find((d) => d.id === selectedDriverId);
  const now = new Date();

  const handleCapture = useCallback((cat: PhotoCategory, files: FileList) => {
    setPhotos((prev) => ({ ...prev, [cat]: [...(prev[cat] ?? []), ...Array.from(files)] }));
  }, []);
  const handleRemovePhoto = useCallback((cat: PhotoCategory, idx: number) => {
    setPhotos((prev) => ({ ...prev, [cat]: (prev[cat] ?? []).filter((_, i) => i !== idx) }));
    setPhotoValidations((prev) => ({ ...prev, [cat]: (prev[cat] ?? []).filter((_, i) => i !== idx) }));
  }, []);
  const handleValidationUpdate = useCallback((cat: PhotoCategory, idx: number, validation: PhotoValidation) => {
    setPhotoValidations((prev) => {
      const arr = [...(prev[cat] ?? [])];
      arr[idx] = validation;
      return { ...prev, [cat]: arr };
    });
  }, []);

  const resetForm = () => {
    setStep(0); setVehicleId(""); setSelectedDriverId("");
    setTripulacao(""); setDestino(""); setObservacoes("");
    setPhotos({}); setPhotoValidations({}); setResultado(""); setResultadoMotivo(""); setTermoAceito(false);
    const d: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => { d[f.key] = f.options[0]?.value ?? ""; });
    setAnswers(d);
    setKmProximaTroca("");
  };

  // Troca de óleo: auto-detecta NC comparando KM próxima troca vs KM atual
  const kmTrocaNum = kmProximaTroca ? parseInt(kmProximaTroca, 10) : null;
  const trocaOleoVencida = kmTrocaNum !== null && selectedVehicle ? kmTrocaNum <= selectedVehicle.km_atual : false;

  const nonConformeFields = useMemo(() =>
    CHECKLIST_FIELDS.filter((f) => isNonConforme(f.key, answers[f.key])), [answers]);
  const criticalCount = useMemo(() =>
    CHECKLIST_FIELDS.filter((f) => isCriticalNonConforme(f.key, answers[f.key])).length, [answers]);
  const hasCritical = criticalCount > 0 || trocaOleoVencida;
  const hasAnyProblem = nonConformeFields.length > 0 || trocaOleoVencida;
  const suggestedResult = hasCritical ? "bloqueado" : hasAnyProblem ? "liberado_obs" : "liberado";

  const mutation = useMutation({
    mutationFn: async () => {
      setUploading(true);

      if (photoValidationSummary.hasPending) {
        throw new Error("Aguarde a validação das fotos terminar antes de salvar.");
      }

      const date = format(now, "yyyy-MM-dd");

      // Upload photos
      const fotosUrls: Record<string, string[]> = {};
      for (const [cat, files] of Object.entries(photos)) {
        fotosUrls[cat] = [];
        for (const file of files) {
          const ext = file.name.split(".").pop() || "jpg";
          const path = `${date}/${vehicleId}/${cat}/${crypto.randomUUID()}.${ext}`;
          const { error } = await supabase.storage.from("checklist-photos").upload(path, file, { contentType: file.type });
          if (error) throw new Error(`Upload: ${error.message}`);
          const { data: urlData } = supabase.storage.from("checklist-photos").getPublicUrl(path);
          fotosUrls[cat].push(urlData.publicUrl);
        }
      }

      const finalResultado = resultado || suggestedResult;

      // Save checklist
      // Calcula troca_oleo automaticamente
      const trocaOleoStatus = trocaOleoVencida ? "vencido" : "ok";

      const { data: savedChecklist, error } = await supabase.from("vehicle_checklists").insert({
        vehicle_id: vehicleId,
        driver_id: selectedDriverId || null,
        created_by: userId,
        checklist_date: date,
        tripulacao: tripulacao || selectedDriver?.full_name || null,
        destino: destino || null,
        observacoes: observacoes || null,
        fotos: fotosUrls,
        resultado: finalResultado,
        resultado_motivo: finalResultado !== "liberado" ? (resultadoMotivo || null) : null,
        termo_aceito: termoAceito,
        troca_oleo: trocaOleoStatus,
        detalhes: {
          km_proxima_troca: kmTrocaNum,
          fotos_forcadas: photoValidationSummary.forced,
          fotos_invalidas: photoValidationSummary.invalid,
          fotos_erro_validacao: photoValidationSummary.errors,
        },
        ...answers,
      } as any).select("id").single();
      if (error) throw error;

      // AUTO-TICKET: criar chamado de não conformidade se houver problemas
      if (hasAnyProblem && savedChecklist) {
        const problemItems = nonConformeFields.map((f) => `• ${f.label}: ${answers[f.key]}`).join("\n");
        const oilLine = trocaOleoVencida ? `\n• Troca de óleo vencida (próxima: ${kmTrocaNum?.toLocaleString("pt-BR")} km, atual: ${selectedVehicle?.km_atual.toLocaleString("pt-BR")} km)` : "";
        const ticketDesc = `Não conformidade detectada no checklist pré-operação.\n\nVeículo: ${selectedVehicle?.placa} — ${selectedVehicle?.modelo}\nTécnico: ${selectedDriver?.full_name ?? "—"}\nData: ${format(now, "dd/MM/yyyy HH:mm")}\nResultado: ${RESULTADO_LABELS[finalResultado]?.label ?? finalResultado}\n\nItens com problema:\n${problemItems}${oilLine}${observacoes ? `\n\nObservações: ${observacoes}` : ""}`;

        await supabase.from("maintenance_tickets").insert({
          vehicle_id: vehicleId,
          driver_id: selectedDriverId || null,
          created_by: userId,
          tipo: "nao_conformidade" as any,
          prioridade: hasCritical ? "alta" : "media",
          status: "aberto",
          titulo: `Checklist NC — ${selectedVehicle?.placa} — ${format(now, "dd/MM")}`,
          descricao: ticketDesc,
          fotos: Object.values(fotosUrls).flat().slice(0, 5),
        } as any);
      }
    },
    onSuccess: () => {
      setUploading(false);
      if (hasAnyProblem) {
        toast.success("Checklist salvo! Chamado de não conformidade criado automaticamente.", { duration: 5000 });
      } else {
        toast.success("Checklist salvo com sucesso!");
      }
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
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

  const canAdvance = () => {
    const currentStep = STEPS[step];
    if (currentStep.id === "info") return !!vehicleId && !!selectedDriverId;
    // Check mandatory photos for photo steps
    const requiredPhotos = STEP_PHOTOS[currentStep.id];
    if (requiredPhotos) {
      const missing = requiredPhotos.filter((cat) => !(photos[cat]?.length > 0));
      if (currentStep.id === "danos") {
        // danos photos only required if danos_veiculo === "sim"
        return true;
      }
      if (missing.length > 0) return false;
    }
    if (currentStep.id === "resultado") {
      const finalRes = resultado || suggestedResult;
      if (finalRes !== "liberado" && !resultadoMotivo.trim()) return false;
      return termoAceito;
    }
    return true;
  };

  const renderStep = () => {
    const currentStep = STEPS[step];

    // ── IDENTIFICAÇÃO ──
    if (currentStep.id === "info") {
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
          <div className="space-y-2">
            <Label>Tripulação</Label>
            <Input placeholder="Outros técnicos a bordo" value={tripulacao} onChange={(e) => setTripulacao(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label>Destino</Label>
            <Input placeholder="Destino(s) do dia" value={destino} onChange={(e) => setDestino(e.target.value)} className="h-11" />
          </div>

          {selectedVehicle && selectedDriver && (
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Dados Automáticos</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Placa:</span> <strong>{selectedVehicle.placa}</strong></div>
                <div><span className="text-muted-foreground">Modelo:</span> <strong>{selectedVehicle.modelo}</strong></div>
                <div><span className="text-muted-foreground">KM:</span> <strong>{selectedVehicle.km_atual.toLocaleString("pt-BR")}</strong></div>
                <div><span className="text-muted-foreground">Data:</span> <strong>{format(now, "dd/MM/yyyy")}</strong></div>
                <div><span className="text-muted-foreground">Hora:</span> <strong>{format(now, "HH:mm")}</strong></div>
                <div><span className="text-muted-foreground">Técnico:</span> <strong>{selectedDriver.full_name}</strong></div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── PAINEL (dentro do veículo, ligado) ──
    if (currentStep.id === "painel") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground font-medium">📷 Ligue o veículo e tire a foto do painel com KM visível:</p>
          <CameraCapture category="painel" photos={photos["painel"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations["painel"]} onValidationUpdate={handleValidationUpdate} />
        </div>
      );
    }

    // ── 360° + EXTERIOR (caminhada ao redor) ──
    if (currentStep.id === "exterior_360") {
      const extCategories = STEP_FIELD_CATEGORIES[currentStep.id] ?? [];
      const extFields = CHECKLIST_FIELDS.filter((f) => extCategories.includes(f.category));
      const extPhotos = STEP_PHOTOS[currentStep.id] ?? [];
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground font-medium">📷 Caminhe ao redor do veículo tirando as fotos:</p>
          {extPhotos.map((cat) => (
            <CameraCapture key={cat} category={cat} photos={photos[cat] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations[cat]} onValidationUpdate={handleValidationUpdate} />
          ))}
          {extFields.length > 0 && (
            <>
              <Separator />
              <p className="text-sm font-semibold text-muted-foreground">Conferências:</p>
              {extFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold flex-1">{field.label}</p>
                    {field.critical && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Crítico</Badge>}
                  </div>
                  <div className="flex gap-2">
                    {field.options.map((opt) => {
                      const isSelected = answers[field.key] === opt.value;
                      const colorMap: Record<string, string> = {
                        success: isSelected ? "bg-success text-success-foreground border-success" : "border-success/40 text-success hover:bg-success/10",
                        destructive: isSelected ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/40 text-destructive hover:bg-destructive/10",
                        warning: isSelected ? "bg-warning text-warning-foreground border-warning" : "border-warning/40 text-warning hover:bg-warning/10",
                      };
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setAnswers((prev) => ({ ...prev, [field.key]: opt.value }))}
                          className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-[0.96] ${colorMap[opt.color]}`}>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {isNonConforme(field.key, answers[field.key]) && (
                    <div className="pl-2 border-l-2 border-destructive/30 ml-1 space-y-2">
                      <Textarea placeholder={`Descreva o problema...`}
                        value={answers[`obs_${field.key}`] ?? ""} rows={2}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [`obs_${field.key}`]: e.target.value }))} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      );
    }

    // ── CAPÔ ABERTO (motor + óleo + água — abre capô 1x) ──
    if (currentStep.id === "capo") {
      const capoCategories = STEP_FIELD_CATEGORIES[currentStep.id] ?? [];
      const capoFields = CHECKLIST_FIELDS.filter((f) => capoCategories.includes(f.category));
      const capoPhotos = STEP_PHOTOS[currentStep.id] ?? [];
      return (
        <div className="space-y-3">
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-3">
            <p className="text-sm font-bold text-primary">🔧 Abra o capô do veículo</p>
            <p className="text-xs text-muted-foreground">Tire todas as fotos e faça as conferências antes de fechar.</p>
          </div>
          {capoPhotos.map((cat) => (
            <CameraCapture key={cat} category={cat} photos={photos[cat] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations[cat]} onValidationUpdate={handleValidationUpdate} />
          ))}
          {capoFields.length > 0 && (
            <>
              <Separator />

              {/* KM Próxima Troca de Óleo */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">KM da próxima troca de óleo</Label>
                <Input type="number" inputMode="numeric" placeholder="Ex: 85000"
                  value={kmProximaTroca} onChange={(e) => setKmProximaTroca(e.target.value)}
                  className="h-12 text-base" />
                {selectedVehicle && kmProximaTroca && (
                  <div className={`rounded-lg p-2 text-xs font-medium ${
                    trocaOleoVencida
                      ? "bg-destructive/10 text-destructive border border-destructive/30"
                      : "bg-success/10 text-success border border-success/30"
                  }`}>
                    {trocaOleoVencida
                      ? `⚠️ VENCIDA — KM atual: ${selectedVehicle.km_atual.toLocaleString("pt-BR")} ≥ ${parseInt(kmProximaTroca).toLocaleString("pt-BR")}. Não conformidade será registrada.`
                      : `✅ OK — Faltam ${(parseInt(kmProximaTroca) - selectedVehicle.km_atual).toLocaleString("pt-BR")} km para a próxima troca.`
                    }
                  </div>
                )}
              </div>

              <p className="text-sm font-semibold text-muted-foreground">Conferências:</p>
              {capoFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold flex-1">{field.label}</p>
                    {field.critical && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Crítico</Badge>}
                  </div>
                  <div className="flex gap-2">
                    {field.options.map((opt) => {
                      const isSelected = answers[field.key] === opt.value;
                      const colorMap: Record<string, string> = {
                        success: isSelected ? "bg-success text-success-foreground border-success" : "border-success/40 text-success hover:bg-success/10",
                        destructive: isSelected ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/40 text-destructive hover:bg-destructive/10",
                        warning: isSelected ? "bg-warning text-warning-foreground border-warning" : "border-warning/40 text-warning hover:bg-warning/10",
                      };
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setAnswers((prev) => ({ ...prev, [field.key]: opt.value }))}
                          className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-[0.96] ${colorMap[opt.color]}`}>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {isNonConforme(field.key, answers[field.key]) && (
                    <div className="pl-2 border-l-2 border-destructive/30 ml-1 space-y-2">
                      <Textarea placeholder={`Descreva o problema...`}
                        value={answers[`obs_${field.key}`] ?? ""} rows={2}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [`obs_${field.key}`]: e.target.value }))} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      );
    }

    // ── RESULTADO FINAL ──
    if (currentStep.id === "resultado") {
      const finalRes = resultado || suggestedResult;
      return (
        <div className="space-y-5">
          {/* Summary */}
          <div className="rounded-xl border border-border p-4 space-y-2">
            <h4 className="text-sm font-bold">Resumo da Inspeção</h4>
            {(nonConformeFields.length > 0 || trocaOleoVencida) ? (
              <div className="space-y-1">
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {nonConformeFields.length + (trocaOleoVencida ? 1 : 0)} não conformidade{(nonConformeFields.length + (trocaOleoVencida ? 1 : 0)) > 1 ? "s" : ""}
                </Badge>
                <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
                  {nonConformeFields.map((f) => (
                    <li key={f.key} className="flex items-center gap-1">
                      <XCircle className="w-3 h-3 text-destructive shrink-0" />
                      {f.label}
                    </li>
                  ))}
                  {trocaOleoVencida && (
                    <li className="flex items-center gap-1">
                      <XCircle className="w-3 h-3 text-destructive shrink-0" />
                      Troca de óleo vencida (próxima: {kmTrocaNum?.toLocaleString("pt-BR")} km)
                    </li>
                  )}
                </ul>
              </div>
            ) : (
              <Badge className="gap-1 bg-success/10 text-success border-success/30">
                <CheckCircle className="w-3 h-3" /> Tudo conforme
              </Badge>
            )}
            <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
              <p>Fotos: {Object.values(photos).reduce((s, arr) => s + arr.length, 0)} tiradas</p>
            </div>

          {photoValidationSummary.hasPending && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Validação em andamento
              </p>
              <p className="mt-1 text-xs text-warning">
                Aguarde terminar a análise das fotos para liberar o salvamento.
              </p>
            </div>
          )}

          {photoValidationSummary.hasBadPhotos && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Fotos fora do padrão
              </p>
              <div className="mt-1 space-y-1 text-xs text-destructive">
                {photoValidationSummary.invalid.map((item) => (
                  <p key={`invalid-${item.categoria}`}>
                    <span className="font-semibold">{item.label}:</span> {item.motivos.join("; ")}
                  </p>
                ))}
                {photoValidationSummary.errors.map((item) => (
                  <p key={`error-${item.categoria}`}>
                    <span className="font-semibold">{item.label}:</span> {item.motivos.join("; ")}
                  </p>
                ))}
                {photoValidationSummary.forced.map((item) => (
                  <p key={`forced-${item.categoria}`}>
                    <span className="font-semibold">{item.label}:</span> validação foi forçada manualmente.
                  </p>
                ))}
              </div>
            </div>
          )}
          </div>

          {/* Critical warning */}
          {hasCritical && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-destructive font-bold">Item crítico detectado!</p>
                <p className="text-xs text-destructive/80">Recomendação: Bloqueado para saída. Um chamado será aberto automaticamente.</p>
              </div>
            </div>
          )}

          {/* Observações */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Observações Gerais</Label>
            <Textarea placeholder="Descreva problemas, detalhes adicionais..." value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)} rows={3} />
          </div>

          {/* Resultado */}
          <div className="space-y-2">
            <Label className="text-base font-bold">Resultado da Inspeção *</Label>
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
                  <button key={opt.value} type="button" onClick={() => setResultado(opt.value)}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all active:scale-[0.97] ${colorMap[opt.color]}`}>
                    <opt.icon className="w-5 h-5 shrink-0" />
                    <span className="text-base font-bold">{opt.label}</span>
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

          {/* Termo */}
          <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-3">
            <p className="text-sm leading-relaxed italic">
              "Declaro que conferi o veículo antes da saída e registrei neste checklist qualquer anormalidade identificada. Estou ciente de que qualquer problema decorrente de verificação inadequada será de minha inteira responsabilidade."
            </p>
            <div className="flex items-center gap-3">
              <Checkbox id="termo" checked={termoAceito} onCheckedChange={(v) => setTermoAceito(v === true)} className="w-5 h-5" />
              <label htmlFor="termo" className="text-sm font-semibold cursor-pointer">Li e concordo</label>
            </div>
          </div>

          {hasAnyProblem && (
            <div className="rounded-xl bg-warning/10 border border-warning/30 p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning font-medium">
                Um chamado de manutenção será criado automaticamente e o gestor será notificado.
              </p>
            </div>
          )}
        </div>
      );
    }

    // ── GENERIC CATEGORY STEPS (Pneus, Interior+Kit, Danos) ──
    const categories = STEP_FIELD_CATEGORIES[currentStep.id] ?? [];
    const fields = CHECKLIST_FIELDS.filter((f) => categories.includes(f.category));
    const stepPhotos = STEP_PHOTOS[currentStep.id] ?? [];

    return (
      <div className="space-y-4">
        {/* Photos first */}
        {stepPhotos.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground font-medium">📷 Fotos obrigatórias desta etapa:</p>
            {stepPhotos.map((cat) => (
              <CameraCapture key={cat} category={cat} photos={photos[cat] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations[cat]} onValidationUpdate={handleValidationUpdate} />
            ))}
            <Separator />
          </div>
        )}

        {/* Questions */}
        {fields.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted-foreground">Conferências:</p>
            {fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold flex-1">{field.label}</p>
                  {field.critical && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Crítico</Badge>}
                </div>
                <div className="flex gap-2">
                  {field.options.map((opt) => {
                    const isSelected = answers[field.key] === opt.value;
                    const colorMap: Record<string, string> = {
                      success: isSelected ? "bg-success text-success-foreground border-success" : "border-success/40 text-success hover:bg-success/10",
                      destructive: isSelected ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/40 text-destructive hover:bg-destructive/10",
                      warning: isSelected ? "bg-warning text-warning-foreground border-warning" : "border-warning/40 text-warning hover:bg-warning/10",
                    };
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, [field.key]: opt.value }))}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-[0.96] ${colorMap[opt.color]}`}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Conditional: photo of problem when non-conforme */}
                {isNonConforme(field.key, answers[field.key]) && (
                  <div className="pl-2 border-l-2 border-destructive/30 ml-1 space-y-2">
                    <Textarea placeholder={`Descreva o problema com ${field.label.toLowerCase()}...`}
                      value={answers[`obs_${field.key}`] ?? ""} rows={2}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [`obs_${field.key}`]: e.target.value }))} />
                    <CameraCapture category={"danos" as PhotoCategory} photos={photos[`exc_${field.key}`] ?? []}
                      onCapture={(_, files) => setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: [...(prev[`exc_${field.key}`] ?? []), ...Array.from(files)] }))}
                      onRemove={(_, idx) => setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: (prev[`exc_${field.key}`] ?? []).filter((__, i) => i !== idx) }))} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Danos step special */}
        {currentStep.id === "danos" && answers.danos_veiculo === "sim" && (
          <div className="space-y-3 pl-2 border-l-2 border-destructive/30 ml-1">
            <Textarea placeholder="Descreva o dano/avaria encontrado..." rows={3}
              value={answers["obs_danos_veiculo"] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, obs_danos_veiculo: e.target.value }))} />
            <CameraCapture category="avaria" photos={photos["avaria"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations["avaria"]} onValidationUpdate={handleValidationUpdate} />
          </div>
        )}
      </div>
    );
  };

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
            {(() => { const Icon = STEPS[step].icon; return <Icon className="w-5 h-5 text-primary" />; })()}
            {STEPS[step].title}
          </DialogTitle>
          <div className="flex gap-1 pt-2">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Etapa {step + 1} de {STEPS.length} — {format(now, "dd/MM/yyyy HH:mm")}
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
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()} className="gap-1 h-12 text-base">
              Próximo <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={() => mutation.mutate()}
              disabled={!canAdvance() || mutation.isPending || uploading || photoValidationSummary.hasPending}
              className="gap-2 h-12 text-base" size="lg">
              {(mutation.isPending || uploading || photoValidationSummary.hasPending) ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardCheck className="w-5 h-5" />}
              {photoValidationSummary.hasPending ? "Validando fotos..." : "Salvar"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════
// RESULT LABELS
// ═══════════════════════════════════════════

const RESULTADO_LABELS: Record<string, { label: string; color: string }> = {
  liberado: { label: "Liberado", color: "success" },
  liberado_obs: { label: "Liberado c/ observação", color: "warning" },
  bloqueado: { label: "Bloqueado", color: "destructive" },
};

// ═══════════════════════════════════════════
// PDF EXPORT
// ═══════════════════════════════════════════

async function exportChecklistPDF(cl: any, vehicle: any, driverName: string) {
  const doc = new jsPDF();
  const dateStr = new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR");
  const placa = vehicle?.placa ?? "—";

  doc.setFontSize(16);
  doc.text("Checklist Pré-Operação Veicular — WeDo", 14, 20);
  doc.setFontSize(10);
  doc.text(`Data: ${dateStr} — Hora: ${new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, 14, 28);
  doc.text(`Veículo: ${placa} — ${vehicle?.modelo ?? ""}`, 14, 34);
  doc.text(`Técnico: ${driverName}`, 14, 40);
  if (cl.tripulacao) doc.text(`Tripulação: ${cl.tripulacao}`, 14, 46);
  if (cl.destino) doc.text(`Destino: ${cl.destino}`, 14, cl.tripulacao ? 52 : 46);

  // Troca de óleo
  const detalhes = cl.detalhes as any;
  if (cl.troca_oleo || detalhes?.km_proxima_troca) {
    let oilY = cl.destino ? 58 : cl.tripulacao ? 54 : 48;
    doc.setFontSize(9);
    doc.text(`Troca de óleo: ${cl.troca_oleo === "vencido" ? "⚠ VENCIDO" : "OK"}${detalhes?.km_proxima_troca ? ` | Próxima troca: ${Number(detalhes.km_proxima_troca).toLocaleString("pt-BR")} km` : ""}`, 14, oilY);
  }

  const categories = [...new Set(CHECKLIST_FIELDS.map((f) => f.category))];
  const rows: any[][] = [];
  categories.forEach((cat) => {
    rows.push([{ content: cat, colSpan: 3, styles: { fontStyle: "bold", fillColor: [230, 230, 240] } } as any]);
    CHECKLIST_FIELDS.filter((f) => f.category === cat).forEach((f) => {
      const val = cl[f.key];
      const opt = f.options.find((o) => o.value === val);
      const nc = isNonConforme(f.key, val);
      const obsValue = cl[`obs_${f.key}`] ?? detalhes?.[`obs_${f.key}`] ?? "";
      rows.push([
        f.label,
        opt?.label ?? val ?? "—",
        nc && obsValue ? obsValue : "",
      ]);
    });
  });

  let startY = cl.destino ? 64 : cl.tripulacao ? 60 : 54;
  autoTable(doc, {
    startY,
    head: [["Item", "Resultado", "Observação"]],
    body: rows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 98, 255] },
    columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 35 }, 2: { cellWidth: 65 } },
  });

  let finalY = (doc as any).lastAutoTable?.finalY ?? 200;

  // Resultado
  const res = RESULTADO_LABELS[cl.resultado];
  doc.setFontSize(11);
  doc.setTextColor(res?.color === "destructive" ? 220 : res?.color === "warning" ? 180 : 0, res?.color === "destructive" ? 40 : res?.color === "warning" ? 120 : 150, res?.color === "success" ? 80 : 40);
  doc.text(`Resultado: ${res?.label ?? cl.resultado ?? "—"}`, 14, finalY + 10);
  doc.setTextColor(0, 0, 0);

  if (cl.resultado_motivo) {
    doc.setFontSize(9);
    doc.text(`Motivo: ${cl.resultado_motivo}`, 14, finalY + 16, { maxWidth: 180 });
    finalY += 8;
  }

  if (cl.observacoes) {
    doc.setFontSize(9);
    doc.text(`Observações: ${cl.observacoes}`, 14, finalY + 22, { maxWidth: 180 });
    finalY += 10;
  }

  // Fotos forçadas warning
  if (detalhes?.fotos_forcadas?.length > 0) {
    doc.setFontSize(8);
    doc.setTextColor(180, 100, 0);
    doc.text(`⚠ Fotos com validação forçada: ${detalhes.fotos_forcadas.map((f: any) => f.label).join(", ")}`, 14, finalY + 28, { maxWidth: 180 });
    doc.setTextColor(0, 0, 0);
    finalY += 8;
  }

  // ══════════════════════════════════════
  // FOTOS — nova página para cada categoria
  // ══════════════════════════════════════
  const fotosData = (cl.fotos && typeof cl.fotos === "object") ? cl.fotos as Record<string, string[]> : {};
  const photoEntries = Object.entries(fotosData).filter(([_, urls]) => Array.isArray(urls) && urls.length > 0);

  if (photoEntries.length > 0) {
    for (const [cat, urls] of photoEntries) {
      doc.addPage();
      const catLabel = PHOTO_META[cat as PhotoCategory]?.label ?? cat.replace(/_/g, " ").toUpperCase();
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`📷 ${catLabel}`, 14, 20);
      doc.setFont("helvetica", "normal");

      let imgX = 14;
      let imgY = 28;
      const imgW = 85;
      const imgH = 64;
      const gap = 6;

      for (let i = 0; i < urls.length; i++) {
        try {
          // Fetch image and convert to base64
          const response = await fetch(urls[i]);
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });

          // Check if we need a new row or new page
          if (imgY + imgH > 280) {
            doc.addPage();
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            doc.text(`📷 ${catLabel} (cont.)`, 14, 20);
            doc.setFont("helvetica", "normal");
            imgX = 14;
            imgY = 28;
          }

          doc.addImage(base64, "JPEG", imgX, imgY, imgW, imgH);

          // 2 per row
          if (i % 2 === 0) {
            imgX = 14 + imgW + gap;
          } else {
            imgX = 14;
            imgY += imgH + gap;
          }
        } catch (e) {
          console.warn(`Erro ao carregar foto ${cat}[${i}]:`, e);
        }
      }
    }
  }

  // Termo
  doc.addPage();
  doc.setFontSize(10);
  doc.text("Termo de Ciência", 14, 20);
  doc.setFontSize(8);
  doc.text(
    "Declaro que conferi o veículo antes da saída e registrei neste checklist qualquer anormalidade identificada. Estou ciente de que qualquer problema decorrente de verificação inadequada será de minha inteira responsabilidade.",
    14, 30, { maxWidth: 180 }
  );
  doc.text(`Aceito: ${cl.termo_aceito ? "SIM" : "NÃO"}`, 14, 55);
  doc.text(`Técnico: ${driverName}`, 14, 62);
  doc.text(`Data: ${dateStr}`, 14, 69);

  doc.save(`checklist_${placa}_${cl.checklist_date}.pdf`);
}

// ═══════════════════════════════════════════
// DETAIL DIALOG
// ═══════════════════════════════════════════

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
  const res = RESULTADO_LABELS[cl.resultado] ?? { label: cl.resultado ?? "—", color: "muted" };

  const categories = useMemo(() => {
    const cats: string[] = [];
    CHECKLIST_FIELDS.forEach((f) => { if (!cats.includes(f.category)) cats.push(f.category); });
    return cats;
  }, []);

  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    setDeleting(true);
    for (const urls of Object.values(fotosData)) {
      if (Array.isArray(urls)) {
        for (const url of urls) {
          const path = (url as string).split("/checklist-photos/")[1];
          if (path) await supabase.storage.from("checklist-photos").remove([path]);
        }
      }
    }
    const { error } = await supabase.from("vehicle_checklists").delete().eq("id", cl.id);
    setDeleting(false);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Checklist apagado!"); queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] }); onDeleted?.(); }
  };

  const allPhotoEntries = Object.entries(fotosData).filter(([_, urls]: [string, any]) => Array.isArray(urls) && urls.length > 0);

  const [exportingPdf, setExportingPdf] = useState(false);
  const handleExportPdf = async () => {
    setExportingPdf(true);
    try { await exportChecklistPDF(cl, vehicle, driverName); }
    catch (e) { console.error("PDF export error:", e); }
    finally { setExportingPdf(false); }
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
              onClick={handleExportPdf} disabled={exportingPdf}>
              {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exportingPdf ? "Gerando..." : "PDF"}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" className="h-8 w-8"><Trash2 className="w-3.5 h-3.5" /></Button>
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
          {/* Header */}
          <div className="grid grid-cols-2 gap-1.5 text-sm">
            <div><span className="text-muted-foreground">Veículo:</span> {vehicle?.placa} — {vehicle?.modelo}</div>
            <div><span className="text-muted-foreground">Técnico:</span> {driverName}</div>
            {cl.tripulacao && <div><span className="text-muted-foreground">Tripulação:</span> {cl.tripulacao}</div>}
            {cl.destino && <div><span className="text-muted-foreground">Destino:</span> {cl.destino}</div>}
            <div><span className="text-muted-foreground">Data:</span> {new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}</div>
            <div><span className="text-muted-foreground">Hora:</span> {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>

          {/* Result badge */}
          <div className="flex items-center gap-2">
            <Badge className={`gap-1 px-3 py-1 ${
              res.color === "success" ? "bg-success/10 text-success border-success/30" :
              res.color === "warning" ? "bg-warning/10 text-warning border-warning/30" :
              "bg-destructive/10 text-destructive border-destructive/30"
            }`}>
              {res.color === "success" ? <ShieldCheck className="w-3.5 h-3.5" /> :
               res.color === "warning" ? <AlertCircle className="w-3.5 h-3.5" /> :
               <ShieldAlert className="w-3.5 h-3.5" />}
              {res.label}
            </Badge>
          </div>
          {cl.resultado_motivo && <p className="text-sm italic text-muted-foreground">{cl.resultado_motivo}</p>}

          {/* Fotos forçadas alert */}
          {(cl.detalhes as any)?.fotos_forcadas?.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-1.5">
              <p className="text-xs font-bold text-warning flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> ⚠️ Fotos com validação forçada
              </p>
              {((cl.detalhes as any).fotos_forcadas as any[]).map((ff: any, i: number) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium">{ff.label}:</span>{" "}
                  {ff.motivos?.join("; ") ?? "Foto forçada pelo técnico"}
                </div>
              ))}
              <p className="text-[10px] text-warning/80 italic">Este checklist requer atenção — fotos foram aceitas manualmente apesar de reprovadas pela validação automática.</p>
            </div>
          )}

          <Separator />

          {/* Troca de óleo */}
          {(cl.troca_oleo || (cl.detalhes as any)?.km_proxima_troca) && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5" /> Troca de Óleo
              </h4>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm">Status da troca de óleo</span>
                <span className={`text-xs font-semibold ${cl.troca_oleo === "vencido" ? "text-destructive" : "text-success"}`}>
                  {cl.troca_oleo === "vencido" ? "⚠️ VENCIDO" : "✅ OK"}
                </span>
              </div>
              {(cl.detalhes as any)?.km_proxima_troca && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm">KM próxima troca</span>
                  <span className="text-xs font-semibold tabular-nums">{Number((cl.detalhes as any).km_proxima_troca).toLocaleString("pt-BR")} km</span>
                </div>
              )}
              <Separator />
            </div>
          )}

          {/* Inspection items */}
          {categories.map((cat) => {
            const fields = CHECKLIST_FIELDS.filter((f) => f.category === cat);
            const Icon = CATEGORY_ICONS[cat] ?? ClipboardCheck;
            return (
              <div key={cat} className="space-y-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" /> {cat}
                </h4>
                {fields.map((f) => {
                  const nc = isNonConforme(f.key, cl[f.key]);
                  const opt = f.options.find((o) => o.value === cl[f.key]);
                  const obsKey = `obs_${f.key}`;
                  const obsValue = cl[obsKey] ?? (cl.detalhes as any)?.[obsKey];
                  return (
                    <div key={f.key}>
                      <div className="flex items-center justify-between py-1">
                        <span className="text-sm flex-1">{f.label}</span>
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${nc ? "text-destructive" : opt?.color === "warning" ? "text-warning" : "text-success"}`}>
                          {nc ? <XCircle className="w-3 h-3" /> : opt?.color === "warning" ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                          {opt?.label ?? cl[f.key] ?? "—"}
                        </span>
                      </div>
                      {nc && obsValue && (
                        <div className="ml-3 pl-2 border-l-2 border-destructive/30 mb-2">
                          <p className="text-xs text-muted-foreground italic">📝 {obsValue}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {cl.observacoes && (
            <>
              <Separator />
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Observações</h4>
                <p className="text-sm whitespace-pre-wrap">{cl.observacoes}</p>
              </div>
            </>
          )}

          {/* Photos gallery — after inspection items */}
          {allPhotoEntries.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" /> Fotos ({allPhotoEntries.reduce((s, [_, urls]) => s + (urls as any[]).length, 0)})
                </h4>
                {allPhotoEntries.map(([key, urls]: [string, any]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {PHOTO_META[key as PhotoCategory]?.label ?? key.replace(/_/g, " ")}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {urls.map((url: string, i: number) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                          className="w-16 h-16 rounded-lg overflow-hidden border border-border block hover:ring-2 hover:ring-primary transition-all">
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </DialogContent>
  );
}

// ═══════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════

export default function Checklist() {
  const { user } = useAuth();
  const navigate = useNavigate();
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

  
  const totalVehicles = vehicles.length;
  const filledCount = checklists.length;

  const blockedCount = useMemo(() =>
    checklists.filter((cl: any) => cl.resultado === "bloqueado").length, [checklists]);
  const nonConformeCount = useMemo(() =>
    checklists.filter((cl: any) =>
      CHECKLIST_FIELDS.some((f) => isNonConforme(f.key, cl[f.key]))
    ).length, [checklists]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Checklist Pré-Operação</h1>
          <p className="text-sm text-muted-foreground">Inspeção veicular completa — padrão frota</p>
        </div>
        {user && <ChecklistFormDialog vehicles={vehicles} localDrivers={localDrivers} userId={user.id} />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <Card>
          <CardContent className="p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Preenchidos</span>
              <CheckCircle className="w-4 h-4 text-success hidden sm:block" />
            </div>
            <p className="text-xl sm:text-2xl font-bold tabular-nums">{filledCount}<span className="text-sm text-muted-foreground font-normal">/{totalVehicles}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Não Conforme</span>
              <AlertTriangle className="w-4 h-4 text-destructive hidden sm:block" />
            </div>
            <p className="text-xl sm:text-2xl font-bold tabular-nums text-destructive">{nonConformeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Bloqueados</span>
              <ShieldAlert className="w-4 h-4 text-destructive hidden sm:block" />
            </div>
            <p className="text-xl sm:text-2xl font-bold tabular-nums text-destructive">{blockedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs sm:text-sm text-muted-foreground">Conformidade</span>
              <ShieldCheck className="w-4 h-4 text-success hidden sm:block" />
            </div>
            <p className="text-xl sm:text-2xl font-bold tabular-nums">
              {filledCount > 0 ? Math.round(((filledCount - nonConformeCount) / filledCount) * 100) : 0}%
            </p>
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
                  const fotoCount = cl.fotos ? Object.values(cl.fotos as Record<string, any[]>).reduce((s: number, a) => s + (a?.length ?? 0), 0) : 0;
                  const det = cl.detalhes as any;
                  const forcedPhotos = (det?.fotos_forcadas ?? []) as any[];
                  const invalidPhotos = (det?.fotos_invalidas ?? []) as any[];
                  const errorPhotos = (det?.fotos_erro_validacao ?? []) as any[];
                  const allBadPhotos = [...forcedPhotos, ...invalidPhotos, ...errorPhotos];
                  const hasBadPhotos = allBadPhotos.length > 0;
                  return (
                    <button
                      key={cl.id}
                      className={`w-full text-left px-4 py-3 flex flex-col gap-2 active:bg-muted/50 ${hasBadPhotos ? "bg-destructive/5" : ""}`}
                      onClick={() => navigate(`/checklist/${cl.id}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{vehicle?.placa ?? "—"}</p>
                          <p className="text-xs text-muted-foreground truncate">{driver?.full_name ?? cl.tripulacao ?? "—"}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {fotoCount > 0 && (
                            <span className={`text-xs flex items-center gap-0.5 ${hasBadPhotos ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                              <ImageIcon className="w-3 h-3" /> {fotoCount}
                              {hasBadPhotos && <AlertTriangle className="w-3.5 h-3.5" />}
                            </span>
                          )}
                          {res.color === "success" ? <ShieldCheck className="w-4 h-4 text-success" /> :
                           res.color === "warning" ? <AlertCircle className="w-4 h-4 text-warning" /> :
                           <ShieldAlert className="w-4 h-4 text-destructive" />}
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>

                      {hasBadPhotos && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-destructive flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" /> Fotos fora do padrão
                          </p>
                          <p className="mt-1 text-[11px] text-destructive/90 line-clamp-2">
                            {allBadPhotos.map((item: any) => item.label).filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")}
                          </p>
                        </div>
                      )}
                    </button>
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
                      <th className="text-center p-3 font-medium">Fotos</th>
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
                      const fotoCount = cl.fotos ? Object.values(cl.fotos as Record<string, any[]>).reduce((s: number, a) => s + (a?.length ?? 0), 0) : 0;
                      const det = cl.detalhes as any;
                      const forcedPhotos = (det?.fotos_forcadas ?? []) as any[];
                      const invalidPhotos = (det?.fotos_invalidas ?? []) as any[];
                      const errorPhotos = (det?.fotos_erro_validacao ?? []) as any[];
                      const allBadPhotos = [...forcedPhotos, ...invalidPhotos, ...errorPhotos];
                      const hasBadPhotos = allBadPhotos.length > 0;
                      return (
                        <tr key={cl.id} className={`border-b last:border-0 ${hasBadPhotos ? "bg-destructive/5" : ""}`}>
                          <td className="p-3 font-medium">
                            <div className="space-y-1">
                              <p>{vehicle?.placa ?? "—"}</p>
                              {hasBadPhotos && (
                                <div className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                                  <AlertTriangle className="w-3 h-3" /> Fotos fora do padrão
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-3">{driver?.full_name ?? cl.tripulacao ?? "—"}</td>
                          <td className="p-3 text-center">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span className={`inline-flex items-center gap-1 text-xs ${hasBadPhotos ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                                <ImageIcon className="w-3 h-3" /> {fotoCount}
                                {hasBadPhotos && <AlertTriangle className="w-3.5 h-3.5" />}
                              </span>
                              {hasBadPhotos && (
                                <span className="max-w-[180px] text-[10px] leading-tight text-destructive">
                                  {allBadPhotos.map((item: any) => item.label).filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")}
                                </span>
                              )}
                            </div>
                          </td>
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
                            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate(`/checklist/${cl.id}`)}>
                              <Eye className="w-3.5 h-3.5" /> Ver
                            </Button>
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
