import { useState, useMemo, useRef, useCallback, useEffect } from "react";
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
import { computeKmPainelDivergence } from "@/lib/km-painel-divergence";

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
  interior: { label: "🪑 Interior do Veículo", hint: "Bancos, painel e forros de porta visíveis", min: 1 },
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

const NA_OPTION = { value: "na", label: "N/A", color: "secondary" };

const CONFORME_NAO = [
  { value: "conforme", label: "CONFORME", color: "success" },
  { value: "nao_conforme", label: "NÃO CONFORME", color: "destructive" },
  NA_OPTION,
];
const SIM_NAO = [
  { value: "sim", label: "SIM", color: "success" },
  { value: "nao", label: "NÃO", color: "destructive" },
  NA_OPTION,
];
const NAO_SIM = [
  { value: "nao", label: "NÃO", color: "success" },
  { value: "sim", label: "SIM", color: "destructive" },
  NA_OPTION,
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

type PersistedPhotoValidationMetadata = {
  fotos_forcadas: ValidationSummaryItem[];
  fotos_invalidas: ValidationSummaryItem[];
  fotos_erro_validacao: ValidationSummaryItem[];
};

const CHECKLIST_DB_FIELD_KEYS = new Set(CHECKLIST_FIELDS.map((field) => field.key));

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
  vehicle_match?: boolean;
  target_match?: boolean;
  focus_ok?: boolean;
  critical_visible?: boolean;
  quality: "boa" | "aceitavel" | "ruim";
  reason: string;
  confidence?: number;
  ai_error?: boolean;
  detected_elements?: string[];
  km_lido?: string;
  km_legivel?: boolean;
};

// Comparação KM painel × cadastro: feita sob demanda na exibição
// (helper em src/lib/km-painel-divergence.ts) para não atrasar o submit do
// checklist e refletir sempre o `km_atual` mais recente do veículo.

type PhotoValidation = {
  status: "idle" | "validating" | "valid" | "invalid" | "forced";
  result?: ValidationResult;
};

async function compressImage(file: File, maxDim = 1280, quality = 0.75): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Falha ao comprimir imagem"));
          resolve(new File([blob], file.name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Falha ao carregar imagem")); };
    img.src = url;
  });
}

async function prepareCapturedImages(files: File[], maxDim = 1280, quality = 0.75): Promise<File[]> {
  return Promise.all(files.map((file) => compressImage(file, maxDim, quality).catch(() => file)));
}

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

async function validatePhoto(file: File, category: string, vehicleMarca?: string, vehicleModelo?: string, limpezaClaim?: string): Promise<ValidationResult> {
  try {
    const base64 = await fileToBase64(file);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const body: Record<string, any> = {
      image_base64: base64,
      category,
      vehicle_marca: vehicleMarca || null,
      vehicle_modelo: vehicleModelo || null,
    };
    if (category === "interior" && limpezaClaim) {
      body.limpeza_claim = limpezaClaim;
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-checklist-photo`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }
    );

    clearTimeout(timeoutId);
    if (!response.ok) throw new Error("Validation failed");
    return await response.json();
  } catch (err: any) {
    console.error("Photo validation error:", err);
    // CRITICAL: Never block the technician. On any error/timeout, accept the photo.
    return {
      valid: true,
      quality: "aceitavel",
      reason: err?.name === "AbortError"
        ? "Validação IA indisponível (timeout). Foto aceita automaticamente."
        : "Validação IA indisponível. Foto aceita automaticamente.",
      ai_error: true,
      vehicle_match: true,
      target_match: true,
      focus_ok: true,
      critical_visible: true,
    };
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

      // Only count as pending if actively validating (not if validation was never triggered)
      if (validation?.status === "validating") {
        const item = ensureItem(pendingMap, category);
        if (!item.motivos.includes("Validação em andamento")) item.motivos.push("Validação em andamento");
        return;
      }

      // Skip if no validation data (validation wasn't triggered or not applicable)
      if (!validation || validation.status === "idle") {
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

function hasPersistedPhotoValidationMetadata(detalhes: any) {
  return Array.isArray(detalhes?.fotos_forcadas)
    || Array.isArray(detalhes?.fotos_invalidas)
    || Array.isArray(detalhes?.fotos_erro_validacao);
}

async function validatePhotoFromUrl(url: string, category: string): Promise<ValidationResult> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Não foi possível baixar a foto para revalidação");

  const blob = await response.blob();
  const extension = blob.type.split("/")[1] || "jpg";
  const file = new File([blob], `${category}.${extension}`, { type: blob.type || "image/jpeg" });
  return validatePhoto(file, category);
}

async function buildPersistedValidationMetadataFromUrls(fotos: Record<string, string[]>): Promise<PersistedPhotoValidationMetadata> {
  const invalidMap = new Map<string, ValidationSummaryItem>();
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

  for (const [category, urls] of Object.entries(fotos)) {
    for (const url of urls ?? []) {
      try {
        const result = await validatePhotoFromUrl(url, category);
        if (result.valid) continue;

        if (result.ai_error) {
          const item = ensureItem(errorMap, category);
          if (!item.motivos.includes(result.reason)) item.motivos.push(result.reason);
          continue;
        }

        const item = ensureItem(invalidMap, category);
        if (!item.motivos.includes(result.reason)) item.motivos.push(result.reason);
      } catch (error) {
        console.error("Legacy photo validation error:", error);
        const item = ensureItem(errorMap, category);
        if (!item.motivos.includes("Falha na revalidação automática")) item.motivos.push("Falha na revalidação automática");
      }
    }
  }

  return {
    fotos_forcadas: [],
    fotos_invalidas: Array.from(invalidMap.values()),
    fotos_erro_validacao: Array.from(errorMap.values()),
  };
}

// ═══════════════════════════════════════════
// CAMERA CAPTURE COMPONENT
// ═══════════════════════════════════════════

function CameraCapture({ category, photos, onCapture, onRemove, required, validations, onValidationUpdate, vehicleMarca, vehicleModelo, limpezaClaim }: {
  category: PhotoCategory;
  photos: File[];
  onCapture: (cat: PhotoCategory, files: File[]) => Promise<File[]>;
  onRemove: (cat: PhotoCategory, idx: number) => void;
  required?: boolean;
  validations?: PhotoValidation[];
  onValidationUpdate?: (cat: PhotoCategory, idx: number, validation: PhotoValidation) => void;
  vehicleMarca?: string;
  vehicleModelo?: string;
  limpezaClaim?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = PHOTO_META[category];
  const hasEnough = photos.length >= meta.min;

  const handleCapture = async (files: File[]) => {
    const preparedFiles = await onCapture(category, files);

    // Trigger validation for new photo
    if (!onValidationUpdate || preparedFiles.length === 0) return;

    await Promise.all(preparedFiles.map(async (file, offset) => {
      const newIdx = photos.length + offset;
      onValidationUpdate(category, newIdx, { status: "validating" });
      const result = await validatePhoto(file, category, vehicleMarca, vehicleModelo, limpezaClaim);
      onValidationUpdate(category, newIdx, {
        status: result.valid ? "valid" : "invalid",
        result,
      });

      if (result.ai_error) {
        toast.info("ℹ️ Validação IA indisponível. Foto aceita automaticamente.", { duration: 4000 });
      } else if (!result.valid) {
        const details: string[] = [];
        if (result.vehicle_match === false) details.push("veículo errado");
        if (result.target_match === false) details.push("item incorreto");
        if (result.focus_ok === false) details.push("sem foco");
        if (result.critical_visible === false) details.push("dado ilegível");
        const detailStr = details.length > 0 ? ` (${details.join(", ")})` : "";
        toast.warning(`⚠️ Foto reprovada${detailStr}: ${result.reason}`, { duration: 6000 });
      }

      // Interior coverage check: after each photo, check collective coverage
      if (category === "interior" && result.valid && result.detected_elements) {
        const allValidations = validations ? [...validations] : [];
        allValidations[newIdx] = { status: "valid", result };
        const allElements = new Set<string>();
        allValidations.forEach(v => {
          v?.result?.detected_elements?.forEach(el => allElements.add(el));
        });
        const hasSeats = allElements.has("bancos_dianteiros") || allElements.has("bancos_traseiros");
        const hasDash = allElements.has("painel_console");
        const hasDoors = allElements.has("forros_porta");
        const coverage = [hasSeats, hasDash, hasDoors].filter(Boolean).length;
        if (coverage < 2) {
          const missing: string[] = [];
          if (!hasSeats) missing.push("bancos");
          if (!hasDash) missing.push("painel/console");
          if (!hasDoors) missing.push("forros de porta");
          toast.info(`📸 Cobertura parcial do interior. Faltam: ${missing.join(", ")}. Adicione mais fotos.`, { duration: 6000 });
        }
      }
    }));
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
                  <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)} />
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
                    {/* PAINEL: NÃO permite forçar — sem hodômetro legível, veículo não sai */}
                    {category !== "painel" && (
                      <button type="button"
                        className="text-[9px] text-warning font-bold underline mt-0.5"
                        onClick={() => onValidationUpdate?.(category, i, { status: "forced", result: v.result })}>
                        Forçar
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => {
          const selectedFiles = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (selectedFiles.length > 0) void handleCapture(selectedFiles);
        }} />
      <Button type="button" variant={hasEnough ? "outline" : "default"} className="w-full gap-2 h-12 text-base active:scale-[0.97]"
        onClick={() => inputRef.current?.click()}>
        <Camera className="w-5 h-5" /> {hasEnough ? "Tirar Outra" : "Tirar Foto"}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════
// WIZARD STEPS — Fluxo produtivo do técnico
// Lógica: info → painel (KM) → capô (óleo+água+motor, CARRO DESLIGADO) → pneus → 360°/exterior (pode mover o carro) → interior+kit → danos → resultado
// ═══════════════════════════════════════════

const STEPS = [
  { id: "info", title: "Identificação", icon: ClipboardCheck },
  { id: "painel", title: "Foto do Painel", icon: Gauge },
  { id: "capo", title: "Capô (carro desligado)", icon: Wrench },
  { id: "calibracao", title: "Calibração e Segurança", icon: Gauge },
  { id: "exterior_360", title: "Exterior e Pneus", icon: Car },
  { id: "interior", title: "Interior", icon: Shield },
  { id: "danos", title: "Danos e Avarias", icon: AlertTriangle },
  { id: "resultado", title: "Resultado Final", icon: ShieldCheck },
];

const STEP_FIELD_CATEGORIES: Record<string, string[]> = {
  capo: ["Capô"],
  calibracao: ["Pneus"],
  exterior_360: ["Exterior"],
  interior: ["Interior"],
  danos: ["Danos"],
};

const STEP_PHOTOS: Record<string, PhotoCategory[]> = {
  painel: ["painel"],
  capo: ["motor", "nivel_oleo", "reservatorio_agua"],
  calibracao: ["calibracao", "estepe", "itens_seguranca"],
  exterior_360: ["exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita", "farois_lanternas", "pneu_de", "pneu_dd", "pneu_te", "pneu_td"],
  interior: ["interior"],
};

// ═══════════════════════════════════════════
// FORM DIALOG
// ═══════════════════════════════════════════

function ChecklistFormDialog({ vehicles, localDrivers, userId }: {
  vehicles: { id: string; placa: string; marca: string; modelo: string; km_atual: number }[];
  localDrivers: { id: string; full_name: string; user_id: string | null }[];
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-detect driver from logged user
  const autoDriverId = useMemo(() => {
    const match = localDrivers.find((d) => d.user_id === userId);
    return match?.id ?? "";
  }, [localDrivers, userId]);

  const [vehicleId, setVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState(autoDriverId);

  // Sync when autoDriverId loads after initial render
  useEffect(() => {
    if (autoDriverId && !selectedDriverId) setSelectedDriverId(autoDriverId);
  }, [autoDriverId]);
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
  // KM atual lido do painel — obrigatório p/ não atrapalhar a programação da troca de óleo.
  // Auto-preenchido pela IA quando o hodômetro é legível; o técnico pode corrigir manualmente.
  const [kmPainelManual, setKmPainelManual] = useState("");
  const [kmPainelEditadoManualmente, setKmPainelEditadoManualmente] = useState(false);

  // Auto-preencher kmPainelManual com o valor lido pela IA (apenas se o técnico ainda não digitou)
  useEffect(() => {
    if (kmPainelEditadoManualmente) return;
    const painelValidations = photoValidations.painel ?? [];
    let lidoNum: number | null = null;
    for (const v of painelValidations) {
      const raw = v?.result?.km_lido?.replace(/[^\d]/g, "") ?? "";
      if (raw.length >= 3 && v?.result?.km_legivel) {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && (lidoNum === null || n > lidoNum)) lidoNum = n;
      }
    }
    if (lidoNum !== null) setKmPainelManual(String(lidoNum));
  }, [photoValidations, kmPainelEditadoManualmente]);

  const photoValidationSummary = useMemo(
    () => summarizePhotoValidations(photos, photoValidations),
    [photos, photoValidations],
  );

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const selectedDriver = localDrivers.find((d) => d.id === selectedDriverId);
  const now = new Date();

  const handleCapture = useCallback(async (cat: PhotoCategory, files: File[]) => {
    const compressed = await prepareCapturedImages(files);
    setPhotos((prev) => ({ ...prev, [cat]: [...(prev[cat] ?? []), ...compressed] }));
    return compressed;
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
    setStep(0); setVehicleId(""); setSelectedDriverId(autoDriverId);
    setTripulacao(""); setDestino(""); setObservacoes("");
    setPhotos({}); setPhotoValidations({}); setResultado(""); setResultadoMotivo(""); setTermoAceito(false);
    const d: FormData = {};
    CHECKLIST_FIELDS.forEach((f) => { d[f.key] = f.options[0]?.value ?? ""; });
    setAnswers(d);
    setKmProximaTroca("");
    setKmPainelManual("");
    setKmPainelEditadoManualmente(false);
  };

  // Troca de óleo: auto-detecta NC quando faltam ≤ 1000 km para a próxima troca
  // (ou já passou). Antes de 1000 km de margem, está OK.
  const KM_OLEO_ALERTA_MARGEM = 1000;
  const kmTrocaNum = kmProximaTroca ? parseInt(kmProximaTroca, 10) : null;
  const kmRestanteOleo = kmTrocaNum !== null && selectedVehicle ? kmTrocaNum - selectedVehicle.km_atual : null;
  const trocaOleoVencida = kmRestanteOleo !== null ? kmRestanteOleo <= KM_OLEO_ALERTA_MARGEM : false;

  // Discrepância de odômetro: se a próxima troca for muito maior que o KM atual, o odômetro pode estar errado
  const KM_DISCREPANCY_THRESHOLD = 50_000;
  const odoDiscrepancy = kmTrocaNum !== null && selectedVehicle
    ? (kmTrocaNum - selectedVehicle.km_atual) > KM_DISCREPANCY_THRESHOLD
    : false;

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

      // Upload photos with retry (parallel per category)
      const uploadWithRetry = async (path: string, file: File, maxRetries = 2): Promise<string> => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          const { error } = await supabase.storage.from("checklist-photos").upload(path, file, { contentType: file.type, upsert: true });
          if (error) {
            if (attempt === maxRetries) throw new Error(`Upload falhou após ${maxRetries} tentativas: ${error.message}`);
            await new Promise(r => setTimeout(r, 500 * attempt));
            continue;
          }
          const { data: urlData } = supabase.storage.from("checklist-photos").getPublicUrl(path);
          return urlData.publicUrl;
        }
        throw new Error("Upload falhou");
      };

      // Upload all photos in parallel
      const fotosUrls: Record<string, string[]> = {};
      const uploadTasks: Promise<void>[] = [];
      for (const [cat, files] of Object.entries(photos)) {
        fotosUrls[cat] = new Array(files.length).fill("");
        files.forEach((file, idx) => {
          const ext = file.name.split(".").pop() || "jpg";
          const path = `${date}/${vehicleId}/${cat}/${crypto.randomUUID()}.${ext}`;
          uploadTasks.push(
            uploadWithRetry(path, file).then((url) => { fotosUrls[cat][idx] = url; })
          );
        });
      }
      await Promise.all(uploadTasks);

      const finalResultado = resultado || suggestedResult;

      // Save checklist
      // Calcula troca_oleo automaticamente
      const trocaOleoStatus = trocaOleoVencida ? "vencido" : "ok";

      const persistedAnswers = Object.fromEntries(
        Object.entries(answers).filter(([key]) => CHECKLIST_DB_FIELD_KEYS.has(key))
      );
      const answerObservations = Object.fromEntries(
        Object.entries(answers)
          .filter(([key, value]) => key.startsWith("obs_") && value.trim().length > 0)
          .map(([key, value]) => [key.replace(/^obs_/, ""), value.trim()])
      );

      const { data: savedChecklist, error } = await supabase.from("vehicle_checklists").insert({
        vehicle_id: vehicleId,
        driver_id: selectedDriverId || null,
        created_by: userId,
        checklist_date: date,
        tripulacao: tripulacao || selectedDriver?.full_name || null,
        destino: destino || null,
        observacoes: observacoes || null,
        avaria_descricao: (answers.obs_danos_veiculo || "").trim() || null,
        fotos: fotosUrls,
        resultado: finalResultado,
        resultado_motivo: finalResultado !== "liberado" ? (resultadoMotivo || null) : null,
        termo_aceito: termoAceito,
        troca_oleo: trocaOleoStatus,
        detalhes: {
          km_proxima_troca: kmTrocaNum,
          observacoes_itens: answerObservations,
          fotos_forcadas: photoValidationSummary.forced,
          fotos_invalidas: photoValidationSummary.invalid,
          fotos_erro_validacao: photoValidationSummary.errors,
          // Salvamos APENAS o número lido pela IA (extração já feita durante
          // a validação da foto, sem custo extra). A comparação com o
          // `km_atual` do veículo é feita SOB DEMANDA na exibição — assim
          // não atrasa o submit e sempre reflete o cadastro mais recente.
          km_lido_painel: (() => {
            // 1) Prioriza o KM informado/confirmado pelo técnico (campo obrigatório)
            const manualNum = kmPainelManual ? parseInt(kmPainelManual.replace(/[^\d]/g, ""), 10) : NaN;
            if (!isNaN(manualNum) && manualNum >= 100) return manualNum;
            // 2) Fallback: maior valor lido pela IA com km_legivel=true
            const painelValidations = photoValidations.painel ?? [];
            let lidoNum: number | null = null;
            for (const v of painelValidations) {
              const raw = v?.result?.km_lido?.replace(/[^\d]/g, "") ?? "";
              if (raw.length >= 3 && v?.result?.km_legivel) {
                const n = parseInt(raw, 10);
                if (!isNaN(n) && (lidoNum === null || n > lidoNum)) lidoNum = n;
              }
            }
            return lidoNum;
          })(),
        },
        ...persistedAnswers,
      } as any).select("id").single();
      if (error) throw error;

      // AUTO-TICKET: criar chamado de não conformidade se houver problemas
      const hasPhotoIssues = photoValidationSummary.invalid.length > 0 || photoValidationSummary.forced.length > 0;
      const shouldCreateTicket = hasAnyProblem || hasPhotoIssues;

      // ⚡ Fire-and-forget: não bloqueia o save. Ticket + e-mail rodam em background
      // para o técnico não esperar a Edge Function `notify-checklist-nc` (Resend pode levar 5-15s).
      const runBackgroundTasks = async () => {
        if (!shouldCreateTicket || !savedChecklist) return;
        const problemItems = nonConformeFields.map((f) => {
          const obs = (answers[`obs_${f.key}`] || "").trim();
          return `• ${f.label}: ${answers[f.key]}${obs ? ` — "${obs}"` : ""}`;
        }).join("\n");
        const oleoStatusLabel = kmRestanteOleo !== null && kmRestanteOleo <= 0 ? "vencida" : `faltam ${kmRestanteOleo?.toLocaleString("pt-BR")} km`;
        const oilLine = trocaOleoVencida ? `\n• Troca de óleo (${oleoStatusLabel}): próxima ${kmTrocaNum?.toLocaleString("pt-BR")} km, atual ${selectedVehicle?.km_atual.toLocaleString("pt-BR")} km` : "";
        
        // Include photo validation issues
        const photoIssueLines: string[] = [];
        for (const inv of photoValidationSummary.invalid) {
          const meta = PHOTO_META[inv.categoria as PhotoCategory];
          photoIssueLines.push(`• 📷 ${meta?.label ?? inv.categoria}: Foto reprovada pela IA — ${inv.motivos?.[0] ?? "Fora do padrão"}`);
        }
        for (const forced of photoValidationSummary.forced) {
          const meta = PHOTO_META[forced.categoria as PhotoCategory];
          photoIssueLines.push(`• ⚠️ ${meta?.label ?? forced.categoria}: Foto forçada pelo técnico (reprovada pela IA)`);
        }
        const photoSection = photoIssueLines.length > 0 ? `\n\nFotos com problemas:\n${photoIssueLines.join("\n")}` : "";

        const ticketDesc = `Não conformidade detectada no checklist pré-operação.\n\nVeículo: ${selectedVehicle?.placa} — ${selectedVehicle?.modelo}\nTécnico: ${selectedDriver?.full_name ?? "—"}\nData: ${format(now, "dd/MM/yyyy HH:mm")}\nResultado: ${RESULTADO_LABELS[finalResultado]?.label ?? finalResultado}${problemItems ? `\n\nItens com problema:\n${problemItems}` : ""}${oilLine}${photoSection}${observacoes ? `\n\nObservações: ${observacoes}` : ""}`;

        const ticketPrioridade = hasCritical ? "alta" : (hasPhotoIssues && !hasAnyProblem) ? "media" : hasAnyProblem ? "media" : "baixa";

        const { data: ticketData } = await supabase.from("maintenance_tickets").insert({
          vehicle_id: vehicleId,
          driver_id: selectedDriverId || null,
          created_by: userId,
          tipo: "nao_conformidade" as any,
          prioridade: ticketPrioridade as any,
          status: "aberto",
          titulo: `Checklist NC — ${selectedVehicle?.placa} — ${format(now, "dd/MM")}`,
          descricao: ticketDesc,
          fotos: Object.values(fotosUrls).flat().slice(0, 5),
        } as any).select("id").single();

        // Criar ações automáticas no chamado para cada item com problema
        if (ticketData?.id) {
          const actions: Array<{ ticket_id: string; descricao: string; created_by: string; sort_order: number }> = [];
          let sortOrder = 0;

          // Itens de inspeção não conformes
          for (const f of nonConformeFields) {
            const obs = (answers[`obs_${f.key}`] || "").trim();
            const descParts = [`Verificar/corrigir: ${f.label}`];
            if (obs) descParts.push(`Obs técnico: ${obs}`);
            actions.push({
              ticket_id: ticketData.id,
              descricao: descParts.join(" — "),
              created_by: userId,
              sort_order: sortOrder++,
            });
          }

          // Troca de óleo vencida
          if (trocaOleoVencida) {
            actions.push({
              ticket_id: ticketData.id,
              descricao: kmRestanteOleo !== null && kmRestanteOleo <= 0
                ? "Realizar troca de óleo (vencida)"
                : `Programar troca de óleo (faltam ${kmRestanteOleo?.toLocaleString("pt-BR")} km)`,
              created_by: userId,
              sort_order: sortOrder++,
            });
          }

          // Fotos reprovadas pela IA
          for (const inv of photoValidationSummary.invalid) {
            const meta = PHOTO_META[inv.categoria as PhotoCategory];
            actions.push({
              ticket_id: ticketData.id,
              descricao: `Foto reprovada: ${meta?.label ?? inv.categoria} — ${inv.motivos?.[0] ?? "Fora do padrão"}`,
              created_by: userId,
              sort_order: sortOrder++,
            });
          }

          // Fotos forçadas pelo técnico
          for (const forced of photoValidationSummary.forced) {
            const meta = PHOTO_META[forced.categoria as PhotoCategory];
            actions.push({
              ticket_id: ticketData.id,
              descricao: `Foto forçada pelo técnico: ${meta?.label ?? forced.categoria}`,
              created_by: userId,
              sort_order: sortOrder++,
            });
          }

          if (actions.length > 0) {
            await supabase.from("ticket_actions").insert(actions);
          }
        }

        // Send email notification to all users
        try {
          await supabase.functions.invoke("notify-checklist-nc", {
            body: {
              checklist_id: savedChecklist.id,
              placa: selectedVehicle?.placa,
              modelo: selectedVehicle?.modelo,
              tecnico: selectedDriver?.full_name ?? "—",
              data: format(now, "dd/MM/yyyy HH:mm"),
              resultado: RESULTADO_LABELS[finalResultado]?.label ?? finalResultado,
              itens_problema: nonConformeFields.map((f) => ({ label: f.label, valor: answers[f.key], observacao: answers[`obs_${f.key}`]?.trim() || null })),
              avaria_descricao: (answers.obs_danos_veiculo || "").trim() || null,
              fotos_problema: [
                ...photoValidationSummary.invalid.map((i) => ({ categoria: PHOTO_META[i.categoria as PhotoCategory]?.label ?? i.categoria, motivo: i.motivos?.[0] ?? "Fora do padrão", tipo: "reprovada" })),
                ...photoValidationSummary.forced.map((f) => ({ categoria: PHOTO_META[f.categoria as PhotoCategory]?.label ?? f.categoria, motivo: "Forçada pelo técnico", tipo: "forcada" })),
              ],
              troca_oleo_vencida: trocaOleoVencida,
              observacoes: observacoes || null,
            },
          });
        } catch (emailErr) {
          console.error("Erro ao enviar notificação por e-mail:", emailErr);
        }
      };

      // dispara em background — não bloqueia o usuário
      runBackgroundTasks().catch((err) =>
        console.error("Erro nas tarefas pós-save (ticket/e-mail):", err)
      );
    },
    onSuccess: () => {
      setUploading(false);
      const hasPhotoIssuesOnSuccess = photoValidationSummary.invalid.length > 0 || photoValidationSummary.forced.length > 0;
      const hadProblems = hasAnyProblem || hasPhotoIssuesOnSuccess;
      if (hadProblems) {
        toast.success("Checklist salvo! Chamado criado e notificação enviada por e-mail.", { duration: 5000 });
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
    // PAINEL: foto válida + KM atual OBRIGATÓRIOS (impacta a programação da troca de óleo)
    if (currentStep.id === "painel") {
      const painelVals = photoValidations.painel ?? [];
      // Precisa ter PELO MENOS UMA foto aprovada com hodômetro legível.
      // Status "forced" NÃO conta — não permitimos forçar foto do painel.
      const temFotoValida = painelVals.some(
        (v) => v?.status === "valid" && v?.result?.km_legivel === true
      );
      if (!temFotoValida) return false;
      // Se ainda há validação em andamento, espera (não trava se houver outra válida)
      const temPendente = painelVals.some((v) => v?.status === "validating");
      if (temPendente && !temFotoValida) return false;

      const kmManualNum = kmPainelManual ? parseInt(kmPainelManual.replace(/[^\d]/g, ""), 10) : null;
      if (kmManualNum === null || isNaN(kmManualNum) || kmManualNum < 100) return false;
      // Bloqueia retrocesso de odômetro além da margem de 50 km
      if (selectedVehicle && kmManualNum < selectedVehicle.km_atual - 50) return false;
    }
    if (currentStep.id === "resultado") {
      const finalRes = resultado || suggestedResult;
      // Só "bloqueado" exige motivo obrigatório; "liberado_obs" permite salvar sem motivo
      if (finalRes === "bloqueado" && !resultadoMotivo.trim()) return false;
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
      const kmManualNum = kmPainelManual ? parseInt(kmPainelManual.replace(/[^\d]/g, ""), 10) : null;
      const kmManualValido = kmManualNum !== null && !isNaN(kmManualNum) && kmManualNum >= 100;
      const kmRegredido = kmManualValido && selectedVehicle && kmManualNum < selectedVehicle.km_atual - 50;
      const painelVals = photoValidations.painel ?? [];
      const temFotoValida = painelVals.some((v) => v?.status === "valid" && v?.result?.km_legivel === true);
      const validandoAgora = painelVals.some((v) => v?.status === "validating");
      const temFotoInvalida = painelVals.some((v) => v?.status === "invalid");
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground font-medium">📷 Ligue o veículo e tire a foto do painel com KM visível:</p>
          <CameraCapture category="painel" photos={photos["painel"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations["painel"]} onValidationUpdate={handleValidationUpdate} vehicleMarca={selectedVehicle?.marca} vehicleModelo={selectedVehicle?.modelo} limpezaClaim={answers.limpeza_organizacao} />

          {/* BANNER de bloqueio: foto inválida = veículo NÃO sai */}
          {temFotoInvalida && !temFotoValida && (
            <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-destructive">Foto do painel rejeitada</p>
                <p className="text-xs text-destructive/90">
                  O hodômetro precisa estar nítido e legível. Aproxime-se do painel, enquadre o display do KM e tire outra foto. <strong>Sem foto válida o veículo não pode seguir viagem.</strong>
                </p>
              </div>
            </div>
          )}

          {/* KM atual do painel — só liberado após foto válida */}
          <div className={`space-y-2 rounded-xl border-2 p-3 transition-opacity ${temFotoValida ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/30 opacity-60"}`}>
            <Label className="text-sm font-bold flex items-center gap-1.5">
              <Gauge className="w-4 h-4 text-primary" />
              KM atual do painel <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder={temFotoValida ? "Ex: 176803" : "Tire a foto do painel primeiro"}
              value={kmPainelManual}
              disabled={!temFotoValida}
              onChange={(e) => {
                setKmPainelManual(e.target.value);
                setKmPainelEditadoManualmente(true);
              }}
              className="h-12 text-base font-semibold tabular-nums"
            />
            {!temFotoValida && !validandoAgora && (
              <p className="text-[11px] text-muted-foreground font-medium">
                Bloqueado até a IA confirmar que o hodômetro está legível.
              </p>
            )}
            {validandoAgora && (
              <p className="text-[11px] text-primary font-medium flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Validando foto…
              </p>
            )}
            {temFotoValida && !kmManualValido && (
              <p className="text-[11px] text-destructive font-medium">
                ⚠ Confirme/digite o KM exato do painel (mínimo 3 dígitos). Sem isso a programação da troca de óleo fica comprometida.
              </p>
            )}
            {temFotoValida && kmManualValido && selectedVehicle && (
              <p className="text-[11px] text-muted-foreground">
                Cadastro: {selectedVehicle.km_atual.toLocaleString("pt-BR")} km · Diferença: {(kmManualNum - selectedVehicle.km_atual > 0 ? "+" : "")}{(kmManualNum - selectedVehicle.km_atual).toLocaleString("pt-BR")} km
              </p>
            )}
            {kmRegredido && (
              <p className="text-[11px] text-destructive font-bold">
                ⚠ KM informado é MENOR que o cadastro ({selectedVehicle!.km_atual.toLocaleString("pt-BR")} km). Confira o painel — odômetros não retrocedem.
              </p>
            )}
          </div>
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
            <CameraCapture key={cat} category={cat} photos={photos[cat] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations[cat]} onValidationUpdate={handleValidationUpdate} vehicleMarca={selectedVehicle?.marca} vehicleModelo={selectedVehicle?.modelo} limpezaClaim={answers.limpeza_organizacao} />
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
                        secondary: isSelected ? "bg-muted text-muted-foreground border-muted-foreground/50" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/50",
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
                      <CameraCapture category={"danos" as PhotoCategory} photos={photos[`exc_${field.key}`] ?? []}
                        onCapture={async (_, files) => {
                          const compressed = await prepareCapturedImages(files);
                          setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: [...(prev[`exc_${field.key}`] ?? []), ...compressed] }));
                          return compressed;
                        }}
                        onRemove={(_, idx) => setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: (prev[`exc_${field.key}`] ?? []).filter((__, i) => i !== idx) }))} />
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
            <CameraCapture key={cat} category={cat} photos={photos[cat] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations[cat]} onValidationUpdate={handleValidationUpdate} vehicleMarca={selectedVehicle?.marca} vehicleModelo={selectedVehicle?.modelo} limpezaClaim={answers.limpeza_organizacao} />
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
                  <div className="space-y-2">
                    <div className={`rounded-lg p-2 text-xs font-medium ${
                      trocaOleoVencida
                        ? "bg-destructive/10 text-destructive border border-destructive/30"
                        : "bg-success/10 text-success border border-success/30"
                    }`}>
                      {(() => {
                        const restante = parseInt(kmProximaTroca) - selectedVehicle.km_atual;
                        if (restante <= 0) {
                          return `⚠️ VENCIDA — KM atual ${selectedVehicle.km_atual.toLocaleString("pt-BR")} ≥ próxima troca ${parseInt(kmProximaTroca).toLocaleString("pt-BR")}. Não conformidade será registrada.`;
                        }
                        if (restante <= KM_OLEO_ALERTA_MARGEM) {
                          return `⚠️ ATENÇÃO — Faltam apenas ${restante.toLocaleString("pt-BR")} km. Chamado de programação será aberto.`;
                        }
                        return `✅ OK — Faltam ${restante.toLocaleString("pt-BR")} km para a próxima troca.`;
                      })()}
                    </div>
                    {odoDiscrepancy && (
                      <div className="rounded-lg p-2 text-xs font-medium bg-warning/10 text-warning border border-warning/30">
                        ⚠️ ATENÇÃO — Diferença de {(parseInt(kmProximaTroca) - selectedVehicle.km_atual).toLocaleString("pt-BR")} km é muito grande.
                        O odômetro do veículo no sistema pode estar incorreto (mostra {selectedVehicle.km_atual.toLocaleString("pt-BR")} km).
                        Corrija em Veículos → Corrigir Odômetro.
                      </div>
                    )}
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
                        secondary: isSelected ? "bg-muted text-muted-foreground border-muted-foreground/50" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/50",
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
                      <CameraCapture category={"danos" as PhotoCategory} photos={photos[`exc_${field.key}`] ?? []}
                        onCapture={async (_, files) => {
                          const compressed = await prepareCapturedImages(files);
                          setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: [...(prev[`exc_${field.key}`] ?? []), ...compressed] }));
                          return compressed;
                        }}
                        onRemove={(_, idx) => setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: (prev[`exc_${field.key}`] ?? []).filter((__, i) => i !== idx) }))} />
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
                      {kmRestanteOleo !== null && kmRestanteOleo <= 0
                        ? `Troca de óleo vencida (próxima: ${kmTrocaNum?.toLocaleString("pt-BR")} km)`
                        : `Troca de óleo próxima (faltam ${kmRestanteOleo?.toLocaleString("pt-BR")} km)`}
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
                const hasAvaria = answers.danos_veiculo === "sim";
                const isDisabled = opt.value === "liberado" && (hasAnyProblem || hasAvaria);
                const isSelected = finalRes === opt.value;
                const colorMap: Record<string, string> = {
                  success: isSelected ? "bg-success/10 border-success text-success" : "border-border text-muted-foreground",
                  warning: isSelected ? "bg-warning/10 border-warning text-warning" : "border-border text-muted-foreground",
                  destructive: isSelected ? "bg-destructive/10 border-destructive text-destructive" : "border-border text-muted-foreground",
                };
                return (
                  <button key={opt.value} type="button"
                    onClick={() => !isDisabled && setResultado(opt.value)}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all active:scale-[0.97] ${colorMap[opt.color]} ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                    <opt.icon className="w-5 h-5 shrink-0" />
                    <span className="text-base font-bold">{opt.label}</span>
                    {isDisabled && hasAvaria && <span className="ml-auto text-xs text-muted-foreground">Veículo com avaria</span>}
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
              <CameraCapture key={cat} category={cat} photos={photos[cat] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations[cat]} onValidationUpdate={handleValidationUpdate} vehicleMarca={selectedVehicle?.marca} vehicleModelo={selectedVehicle?.modelo} limpezaClaim={answers.limpeza_organizacao} />
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
                      secondary: isSelected ? "bg-muted text-muted-foreground border-muted-foreground/50" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted/50",
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
                      onCapture={async (_, files) => {
                        const compressed = await prepareCapturedImages(files);
                        setPhotos((prev) => ({ ...prev, [`exc_${field.key}`]: [...(prev[`exc_${field.key}`] ?? []), ...compressed] }));
                        return compressed;
                      }}
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
            <CameraCapture category="avaria" photos={photos["avaria"] ?? []} onCapture={handleCapture} onRemove={handleRemovePhoto} required validations={photoValidations["avaria"]} onValidationUpdate={handleValidationUpdate} vehicleMarca={selectedVehicle?.marca} vehicleModelo={selectedVehicle?.modelo} limpezaClaim={answers.limpeza_organizacao} />
          </div>
        )}
      </div>
    );
  };

  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const hasProgress = step > 0 || Object.keys(photos).length > 0 || vehicleId !== "";

  const handleDialogClose = (newOpen: boolean) => {
    if (!newOpen && hasProgress) {
      setShowExitConfirm(true);
      return;
    }
    setOpen(newOpen);
    if (!newOpen) resetForm();
  };

  const confirmExit = () => {
    setShowExitConfirm(false);
    setOpen(false);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogTrigger asChild>
        <Button className="gap-2 h-12 text-base px-6">
          <Plus className="w-5 h-5" /> Novo Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] p-0 gap-0 flex flex-col"
        onPointerDownOutside={(e) => { if (hasProgress) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (hasProgress) { e.preventDefault(); setShowExitConfirm(true); } }}>
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

        {/* Exit confirmation dialog */}
        <AlertDialog open={showExitConfirm} onOpenChange={setShowExitConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar checklist?</AlertDialogTitle>
              <AlertDialogDescription>
                Você tem um preenchimento em andamento. Todo o progresso (fotos e respostas) será perdido.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar preenchendo</AlertDialogCancel>
              <AlertDialogAction onClick={confirmExit} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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

// Detail sections for dialog (matching wizard flow)
const DIALOG_SECTIONS = [
  { id: "painel", title: "Foto do Painel", icon: Gauge, photos: ["painel"] as PhotoCategory[], fieldCategories: [] as string[] },
  { id: "capo", title: "Capô (carro desligado)", icon: Wrench, photos: ["motor", "nivel_oleo", "reservatorio_agua"] as PhotoCategory[], fieldCategories: ["Capô"] },
  { id: "pneus", title: "Pneus e Calibração", icon: CircleDot, photos: ["pneu_de", "pneu_dd", "pneu_te", "pneu_td", "calibracao", "estepe", "itens_seguranca"] as PhotoCategory[], fieldCategories: ["Pneus"] },
  { id: "exterior", title: "360° e Exterior", icon: Car, photos: ["exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita", "farois_lanternas"] as PhotoCategory[], fieldCategories: ["Exterior"] },
  { id: "interior", title: "Interior", icon: Shield, photos: ["interior"] as PhotoCategory[], fieldCategories: ["Interior"] },
  { id: "danos", title: "Danos e Avarias", icon: AlertTriangle, photos: ["danos", "avaria"] as PhotoCategory[], fieldCategories: ["Danos"] },
];

function ChecklistDetailDialog({ checklist: cl, vehicles, localDrivers, onDeleted }: {
  checklist: any;
  vehicles: { id: string; placa: string; modelo: string; km_atual: number }[];
  localDrivers: { id: string; full_name: string; user_id: string | null }[];
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
  const driver = localDrivers.find((d) => d.id === cl.driver_id);
  const driverName = driver?.full_name ?? cl.tripulacao ?? "—";
  const fotosData = (cl.fotos && typeof cl.fotos === "object") ? cl.fotos : {};
  const res = RESULTADO_LABELS[cl.resultado] ?? { label: cl.resultado ?? "—", color: "muted" };
  const detalhes = (cl.detalhes as any) ?? {};

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

          {/* Alertas de validação */}
          {((detalhes?.fotos_invalidas?.length ?? 0) > 0 || (detalhes?.fotos_erro_validacao?.length ?? 0) > 0 || (detalhes?.fotos_forcadas?.length ?? 0) > 0) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-1.5">
              <p className="text-xs font-bold text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> ⚠️ Fotos fora do padrão
              </p>
              {(detalhes?.fotos_invalidas ?? []).map((ff: any, i: number) => (
                <div key={`inv-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">{ff.label}:</span> {ff.motivos?.join("; ")}
                </div>
              ))}
              {(detalhes?.fotos_forcadas ?? []).map((ff: any, i: number) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium text-warning">{ff.label}:</span> {ff.motivos?.join("; ") ?? "Foto forçada pelo técnico"}
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Troca de óleo */}
          {(cl.troca_oleo || detalhes?.km_proxima_troca) && (
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
              {detalhes?.km_proxima_troca && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm">KM próxima troca</span>
                  <span className="text-xs font-semibold tabular-nums">{Number(detalhes.km_proxima_troca).toLocaleString("pt-BR")} km</span>
                </div>
              )}
              <Separator />
            </div>
          )}

          {/* Sections: photos + fields interleaved */}
          {DIALOG_SECTIONS.map((section) => {
            const sectionPhotos = section.photos.filter((cat) => (fotosData as any)[cat]?.length > 0);
            const sectionFields = CHECKLIST_FIELDS.filter((f) => section.fieldCategories.includes(f.category));
            if (sectionPhotos.length === 0 && sectionFields.length === 0) return null;

            const fotosForcadas: any[] = detalhes?.fotos_forcadas ?? [];
            const fotosInvalidas: any[] = detalhes?.fotos_invalidas ?? [];
            const fotosErroValidacao: any[] = detalhes?.fotos_erro_validacao ?? [];
            const flaggedMap: Record<string, string[]> = {};
            [...fotosInvalidas, ...fotosErroValidacao, ...fotosForcadas].forEach((ff: any) => {
              flaggedMap[ff.categoria] = ff.motivos ?? ["Foto fora do padrão"];
            });

            const Icon = section.icon;
            return (
              <div key={section.id} className="space-y-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" /> {section.title}
                </h4>
                <div className="space-y-1 divide-y divide-border">
                  {sectionPhotos.map((cat) => {
                    const urls = (fotosData as any)[cat] as string[];
                    const isFlagged = !!flaggedMap[cat];
                    const meta = PHOTO_META[cat as PhotoCategory];
                    return (
                      <div key={cat} className={`py-1.5 ${isFlagged ? "bg-destructive/5 rounded-lg px-2" : ""}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm">{meta?.label ?? cat}</span>
                          {isFlagged ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive">
                              <AlertTriangle className="w-3 h-3" /> Inadequada
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                              <CheckCircle className="w-3 h-3" /> OK
                            </span>
                          )}
                        </div>
                        {isFlagged && flaggedMap[cat] && (
                          <p className="text-[10px] text-destructive font-medium mb-1">⚠️ {flaggedMap[cat].join("; ")}</p>
                        )}
                        <div className="flex gap-1.5 flex-wrap">
                          {urls.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                              className={`w-14 h-14 rounded-lg overflow-hidden border-2 block hover:ring-2 hover:ring-primary transition-all ${
                                isFlagged ? "border-destructive" : "border-border"
                              }`}>
                              <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {sectionFields.map((f) => {
                    const nc = isNonConforme(f.key, cl[f.key]);
                    const opt = f.options.find((o) => o.value === cl[f.key]);
                    const obsKey = `obs_${f.key}`;
                    const obsValue = cl[obsKey] ?? detalhes?.[obsKey];
                    return (
                      <div key={f.key} className="py-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm flex-1">{f.label}</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${nc ? "text-destructive" : opt?.color === "warning" ? "text-warning" : "text-success"}`}>
                            {nc ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                            {opt?.label ?? cl[f.key] ?? "—"}
                          </span>
                        </div>
                        {nc && obsValue && (
                          <div className="ml-3 pl-2 border-l-2 border-destructive/30 mt-1 mb-1">
                            <p className="text-xs text-muted-foreground italic">📝 {obsValue}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
  const queryClient = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [filterStart, setFilterStart] = useState(today);
  const [filterEnd, setFilterEnd] = useState(today);
  // Auto-invert if start > end
  const effectiveStart = filterStart <= filterEnd ? filterStart : filterEnd;
  const effectiveEnd = filterStart <= filterEnd ? filterEnd : filterStart;
  const [revalidatedChecklistMetadata, setRevalidatedChecklistMetadata] = useState<Record<string, PersistedPhotoValidationMetadata>>({});
  const repairingChecklistIdsRef = useRef<Set<string>>(new Set());

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").order("placa");
      if (error) throw error;
      return data;
    },
  });

  const { data: localDrivers = [] } = useQuery({
    queryKey: ["drivers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, full_name, user_id").eq("status", "ativo").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: checklists = [], isLoading } = useQuery({
    queryKey: ["vehicle-checklists", effectiveStart, effectiveEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_checklists").select("*")
        .gte("checklist_date", effectiveStart)
        .lte("checklist_date", effectiveEnd)
        .order("checklist_date", { ascending: false })
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

  useEffect(() => {
    const legacyChecklists = checklists.filter((cl: any) => {
      const fotos = cl.fotos as Record<string, string[]> | null;
      return fotos
        && Object.keys(fotos).length > 0
        && !hasPersistedPhotoValidationMetadata(cl.detalhes)
        && !repairingChecklistIdsRef.current.has(cl.id);
    });

    if (legacyChecklists.length === 0) return;

    void Promise.all(legacyChecklists.map(async (cl: any) => {
      repairingChecklistIdsRef.current.add(cl.id);

      const metadata = await buildPersistedValidationMetadataFromUrls((cl.fotos as Record<string, string[]>) ?? {});
      setRevalidatedChecklistMetadata((prev) => ({ ...prev, [cl.id]: metadata }));

      try {
        const { error } = await supabase
          .from("vehicle_checklists")
          .update({
            detalhes: {
              ...((cl.detalhes as Record<string, unknown> | null) ?? {}),
              ...metadata,
            },
          } as any)
          .eq("id", cl.id);

        if (error) throw error;
      } catch (error) {
        console.error("Checklist validation backfill error:", error);
      }
    })).finally(() => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists", effectiveStart, effectiveEnd] });
    });
  }, [checklists, effectiveStart, effectiveEnd, queryClient]);

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
            <CalendarDays className="w-4 h-4 text-primary" /> Checklists
            <span className="text-xs text-muted-foreground font-normal">({checklists.length})</span>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex flex-col gap-0.5 flex-1 sm:flex-initial">
              <Label className="text-[10px] text-muted-foreground">Início</Label>
              <Input type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)}
                className="w-full sm:w-36 h-8 text-xs" max={today} />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 sm:flex-initial">
              <Label className="text-[10px] text-muted-foreground">Fim</Label>
              <Input type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)}
                className="w-full sm:w-36 h-8 text-xs" max={today} />
            </div>
            {(filterStart !== today || filterEnd !== today) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs mt-3"
                onClick={() => { setFilterStart(today); setFilterEnd(today); }}>
                Hoje
              </Button>
            )}
          </div>
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
                   const det = hasPersistedPhotoValidationMetadata(cl.detalhes) ? ((cl.detalhes as any) ?? {}) : { ...((cl.detalhes as any) ?? {}), ...(revalidatedChecklistMetadata[cl.id] ?? {}) } as any;
                  const forcedPhotos = (det?.fotos_forcadas ?? []) as any[];
                  const invalidPhotos = (det?.fotos_invalidas ?? []) as any[];
                  const errorPhotos = (det?.fotos_erro_validacao ?? []) as any[];
                  const allBadPhotos = [...forcedPhotos, ...invalidPhotos, ...errorPhotos];
                  const hasBadPhotos = allBadPhotos.length > 0;
                  // Comparação sob demanda usando km_atual mais recente do veículo
                  const kmPainel = computeKmPainelDivergence(det, vehicle?.km_atual);
                  const kmDivergente = !!kmPainel?.divergente;
                  return (
                    <button
                      key={cl.id}
                      className={`w-full text-left px-4 py-3 flex flex-col gap-2 active:bg-muted/50 ${hasBadPhotos || kmDivergente ? "bg-destructive/5" : ""}`}
                      onClick={() => navigate(`/checklist/${cl.id}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{vehicle?.placa ?? "—"}</p>
                          <p className="text-xs text-muted-foreground truncate">{driver?.full_name ?? cl.tripulacao ?? "—"}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {fotoCount > 0 && (
                            <span className="text-xs flex items-center gap-0.5 text-muted-foreground">
                              <ImageIcon className="w-3 h-3" /> {fotoCount}
                            </span>
                          )}
                          {hasBadPhotos && (
                            <span className="text-xs flex items-center gap-0.5 text-destructive font-bold">
                              <AlertTriangle className="w-3.5 h-3.5" /> {allBadPhotos.length}
                            </span>
                          )}
                          {res.color === "success" ? <ShieldCheck className="w-4 h-4 text-success" /> :
                           res.color === "warning" ? <AlertCircle className="w-4 h-4 text-warning" /> :
                           <ShieldAlert className="w-4 h-4 text-destructive" />}
                          <span className="text-xs text-muted-foreground tabular-nums flex flex-col items-end leading-tight">
                            <span>{new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                            <span className="text-[10px] opacity-80">{new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
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

                      {kmDivergente && kmPainel && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-destructive flex items-center gap-1.5">
                            <Gauge className="w-3.5 h-3.5" /> KM divergente do cadastro
                          </p>
                          <p className="mt-1 text-[11px] text-destructive/90">
                            Painel: {kmPainel.lido.toLocaleString("pt-BR")} km · Cadastro: {kmPainel.esperado.toLocaleString("pt-BR")} km · Δ {kmPainel.diferenca > 0 ? "+" : ""}{kmPainel.diferenca.toLocaleString("pt-BR")} km
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
                      <th className="text-center p-3 font-medium">Data / Hora</th>
                      <th className="text-center p-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.map((cl: any) => {
                      const vehicle = vehicles.find((v) => v.id === cl.vehicle_id);
                      const driver = localDrivers.find((d) => d.id === cl.driver_id);
                      const res = RESULTADO_LABELS[cl.resultado] ?? { label: "—", color: "muted" };
                      const fotoCount = cl.fotos ? Object.values(cl.fotos as Record<string, any[]>).reduce((s: number, a) => s + (a?.length ?? 0), 0) : 0;
                      const det = hasPersistedPhotoValidationMetadata(cl.detalhes) ? ((cl.detalhes as any) ?? {}) : { ...((cl.detalhes as any) ?? {}), ...(revalidatedChecklistMetadata[cl.id] ?? {}) } as any;
                      const forcedPhotos = (det?.fotos_forcadas ?? []) as any[];
                      const invalidPhotos = (det?.fotos_invalidas ?? []) as any[];
                      const errorPhotos = (det?.fotos_erro_validacao ?? []) as any[];
                      const allBadPhotos = [...forcedPhotos, ...invalidPhotos, ...errorPhotos];
                      const hasBadPhotos = allBadPhotos.length > 0;
                      // Comparação sob demanda usando km_atual mais recente do veículo
                      const kmPainel = computeKmPainelDivergence(det, vehicle?.km_atual);
                      const kmDivergente = !!kmPainel?.divergente;
                      const rowFlagged = hasBadPhotos || kmDivergente;
                      return (
                        <tr key={cl.id} className={`border-b last:border-0 ${rowFlagged ? "bg-destructive/5" : ""}`}>
                          <td className="p-3 font-medium">
                            <div className="space-y-1">
                              <p>{vehicle?.placa ?? "—"}</p>
                              {hasBadPhotos && (
                                <div className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                                  <AlertTriangle className="w-3 h-3" /> Fotos fora do padrão
                                </div>
                              )}
                              {kmDivergente && kmPainel && (
                                <div className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive" title={`Painel: ${kmPainel.lido.toLocaleString("pt-BR")} km · Cadastro: ${kmPainel.esperado.toLocaleString("pt-BR")} km`}>
                                  <Gauge className="w-3 h-3" /> KM divergente ({kmPainel.diferenca > 0 ? "+" : ""}{kmPainel.diferenca.toLocaleString("pt-BR")} km)
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-3">{driver?.full_name ?? cl.tripulacao ?? "—"}</td>
                          <td className="p-3 text-center">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <ImageIcon className="w-3 h-3" /> {fotoCount}
                              </span>
                              {hasBadPhotos && (
                                <>
                                  <span className="inline-flex items-center gap-1 text-xs text-destructive font-bold">
                                    <AlertTriangle className="w-3.5 h-3.5" /> {allBadPhotos.length} com problema
                                  </span>
                                  <span className="max-w-[180px] text-[10px] leading-tight text-destructive">
                                    {allBadPhotos.map((item: any) => item.label).filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")}
                                  </span>
                                </>
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
                            <div className="flex flex-col leading-tight">
                              <span>{new Date(cl.checklist_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
                              <span className="text-[10px] opacity-80">{new Date(cl.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
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
