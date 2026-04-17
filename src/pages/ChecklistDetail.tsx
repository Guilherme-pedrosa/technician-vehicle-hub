import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ClipboardCheck, CheckCircle, XCircle, AlertTriangle, Loader2, Car, Droplets, Wrench,
  Shield, ChevronLeft, Image as ImageIcon, Download, Trash2, ShieldAlert, ShieldCheck,
  AlertCircle, Gauge, CircleDot, Pencil, Save, X, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { computeKmPainelDivergence } from "@/lib/km-painel-divergence";

// ═══════════════════════════════════════════
// Shared constants (duplicated from Checklist.tsx for isolation)
// ═══════════════════════════════════════════

type PhotoCategory =
  | "painel" | "exterior_frente" | "exterior_traseira" | "exterior_esquerda" | "exterior_direita"
  | "nivel_oleo" | "reservatorio_agua"
  | "pneu_de" | "pneu_dd" | "pneu_te" | "pneu_td" | "calibracao" | "estepe"
  | "farois_lanternas" | "motor" | "itens_seguranca" | "interior"
  | "danos" | "avaria";

const PHOTO_META: Record<PhotoCategory, { label: string; icon: string }> = {
  painel: { label: "📊 Painel do Veículo", icon: "📊" },
  exterior_frente: { label: "📸 Frente do Veículo", icon: "📸" },
  exterior_traseira: { label: "📸 Traseira do Veículo", icon: "📸" },
  exterior_esquerda: { label: "📸 Lateral Esquerda", icon: "📸" },
  exterior_direita: { label: "📸 Lateral Direita", icon: "📸" },
  nivel_oleo: { label: "🛢️ Nível de Óleo", icon: "🛢️" },
  reservatorio_agua: { label: "💧 Reservatório de Água", icon: "💧" },
  pneu_de: { label: "🔵 Pneu Dianteiro Esquerdo", icon: "🔵" },
  pneu_dd: { label: "🔵 Pneu Dianteiro Direito", icon: "🔵" },
  pneu_te: { label: "🔵 Pneu Traseiro Esquerdo", icon: "🔵" },
  pneu_td: { label: "🔵 Pneu Traseiro Direito", icon: "🔵" },
  calibracao: { label: "📏 Calibração dos Pneus", icon: "📏" },
  estepe: { label: "🔄 Pneu Estepe", icon: "🔄" },
  farois_lanternas: { label: "💡 Faróis e Lanternas", icon: "💡" },
  motor: { label: "⚙️ Compartimento do Motor", icon: "⚙️" },
  itens_seguranca: { label: "🔺 Itens de Segurança", icon: "🔺" },
  interior: { label: "🪑 Interior do Veículo", icon: "🪑" },
  danos: { label: "⚠️ Registro de Dano/Avaria", icon: "⚠️" },
  avaria: { label: "⚠️ Nova Avaria", icon: "⚠️" },
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

type ChecklistField = { key: string; label: string; options: { value: string; label: string; color: string }[]; category: string; critical?: boolean };

const CHECKLIST_FIELDS: ChecklistField[] = [
  { key: "farois_lanternas", label: "Faróis e lanternas funcionando?", category: "Exterior", options: CONFORME_NAO, critical: true },
  { key: "vidros", label: "Vidros sem trincas/danos?", category: "Exterior", options: SIM_NAO },
  { key: "limpeza_organizacao", label: "Veículo limpo e organizado?", category: "Exterior", options: SIM_NAO },
  { key: "pneus", label: "Pneus em condição de saída?", category: "Pneus", options: CONFORME_NAO, critical: true },
  { key: "pneu_estepe", label: "Estepe em boas condições?", category: "Pneus", options: CONFORME_NAO },
  { key: "itens_seguranca", label: "Triângulo, macaco e chave de roda?", category: "Pneus", options: SIM_NAO, critical: true },
  { key: "motor", label: "Motor funcionando normalmente?", category: "Capô", options: CONFORME_NAO, critical: true },
  { key: "nivel_oleo", label: "Nível de óleo OK?", category: "Capô", options: CONFORME_NAO, critical: true },
  { key: "nivel_agua", label: "Nível de água/arrefecimento OK?", category: "Capô", options: CONFORME_NAO, critical: true },
  { key: "ruido_anormal", label: "Existe algum ruído anormal?", category: "Capô", options: NAO_SIM, critical: true },
  { key: "cambio", label: "Câmbio funcionando corretamente?", category: "Interior", options: CONFORME_NAO, critical: true },
  { key: "som", label: "Som/rádio funcionando?", category: "Interior", options: CONFORME_NAO },
  { key: "acessorios", label: "Acessórios e ferramentas presentes?", category: "Interior", options: SIM_NAO },
  { key: "danos_veiculo", label: "Há algum dano/avaria nova no veículo?", category: "Danos", options: NAO_SIM },
];

const CATEGORY_ICONS: Record<string, typeof Droplets> = {
  "Exterior": Car, "Pneus": CircleDot, "Capô": Wrench, "Interior": Shield, "Danos": AlertTriangle,
};

function isNonConforme(key: string, val: string) {
  return val === "nao_conforme" || val === "vencido" ||
    (key === "danos_veiculo" && val === "sim") ||
    (key === "ruido_anormal" && val === "sim") ||
    (["itens_seguranca", "acessorios", "limpeza_organizacao", "vidros"].includes(key) && val === "nao");
}

const RESULTADO_LABELS: Record<string, { label: string; color: string }> = {
  liberado: { label: "Liberado", color: "success" },
  liberado_obs: { label: "Liberado c/ observação", color: "warning" },
  bloqueado: { label: "Bloqueado", color: "destructive" },
};

const DETAIL_SECTIONS = [
  { id: "painel", title: "Foto do Painel", icon: Gauge, photos: ["painel"] as PhotoCategory[], fields: [] as string[] },
  { id: "exterior", title: "360° e Exterior", icon: Car, photos: ["exterior_frente", "exterior_traseira", "exterior_esquerda", "exterior_direita", "farois_lanternas"] as PhotoCategory[], fields: ["Exterior"] },
  { id: "pneus", title: "Pneus e Calibração", icon: CircleDot, photos: ["pneu_de", "pneu_dd", "pneu_te", "pneu_td", "calibracao", "estepe", "itens_seguranca"] as PhotoCategory[], fields: ["Pneus"] },
  { id: "capo", title: "Capô Aberto", icon: Wrench, photos: ["motor", "nivel_oleo", "reservatorio_agua"] as PhotoCategory[], fields: ["Capô"] },
  { id: "interior", title: "Interior", icon: Shield, photos: ["interior"] as PhotoCategory[], fields: ["Interior"] },
  { id: "danos", title: "Danos e Avarias", icon: AlertTriangle, photos: ["danos", "avaria"] as PhotoCategory[], fields: ["Danos"] },
];

// ═══════════════════════════════════════════
// Photo row
// ═══════════════════════════════════════════

function PhotoRow({ category, urls, isFlagged, flagReasons }: { category: PhotoCategory; urls: string[]; isFlagged?: boolean; flagReasons?: string[] }) {
  if (!urls || urls.length === 0) return null;
  const meta = PHOTO_META[category];
  return (
    <div className={`py-2 ${isFlagged ? "bg-destructive/5 rounded-lg px-2" : ""}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm flex-1">{meta?.label ?? category}</span>
        {isFlagged ? (
          <Badge variant="destructive" className="text-[10px] gap-1 px-1.5 py-0">
            <AlertTriangle className="w-2.5 h-2.5" /> Inadequada
          </Badge>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            <CheckCircle className="w-3.5 h-3.5" /> OK
          </span>
        )}
      </div>
      {isFlagged && flagReasons && flagReasons.length > 0 && (
        <p className="text-[11px] text-destructive font-medium mb-1.5">⚠️ {flagReasons.join("; ")}</p>
      )}
      <div className="flex gap-2 flex-wrap">
        {urls.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
            className={`w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 block hover:ring-2 hover:ring-primary transition-all ${
              isFlagged ? "border-destructive shadow-[0_0_8px_rgba(220,38,38,0.3)]" : "border-border"
            }`}>
            <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// PDF
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
      const obsValue = cl[`obs_${f.key}`] ?? detalhes?.[`obs_${f.key}`] ?? detalhes?.observacoes_itens?.[f.key] ?? "";
      rows.push([f.label, opt?.label ?? val ?? "—", nc && obsValue ? obsValue : ""]);
    });
  });

  let startY = cl.destino ? 64 : cl.tripulacao ? 60 : 54;
  autoTable(doc, { startY, head: [["Item", "Resultado", "Observação"]], body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [41, 98, 255] }, columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 35 }, 2: { cellWidth: 65 } } });

  let finalY = (doc as any).lastAutoTable?.finalY ?? 200;
  const res = RESULTADO_LABELS[cl.resultado];
  doc.setFontSize(11);
  doc.setTextColor(res?.color === "destructive" ? 220 : res?.color === "warning" ? 180 : 0, res?.color === "destructive" ? 40 : res?.color === "warning" ? 120 : 0, res?.color === "success" ? 80 : 40);
  doc.text(`Resultado: ${res?.label ?? cl.resultado ?? "—"}`, 14, finalY + 10);
  doc.setTextColor(0, 0, 0);
  if (cl.resultado_motivo) { doc.setFontSize(9); doc.text(`Motivo: ${cl.resultado_motivo}`, 14, finalY + 16, { maxWidth: 180 }); finalY += 8; }
  if (cl.observacoes) { doc.setFontSize(9); doc.text(`Observações: ${cl.observacoes}`, 14, finalY + 22, { maxWidth: 180 }); finalY += 10; }

  const fotosData = (cl.fotos && typeof cl.fotos === "object") ? cl.fotos as Record<string, string[]> : {};
  const photoEntries = Object.entries(fotosData).filter(([_, urls]) => Array.isArray(urls) && urls.length > 0);
  if (photoEntries.length > 0) {
    for (const [cat, urls] of photoEntries) {
      doc.addPage();
      const catLabel = PHOTO_META[cat as PhotoCategory]?.label ?? cat.replace(/_/g, " ").toUpperCase();
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text(`📷 ${catLabel}`, 14, 20); doc.setFont("helvetica", "normal");
      let imgX = 14, imgY = 28; const imgW = 85, imgH = 64, gap = 6;
      for (let i = 0; i < urls.length; i++) {
        try {
          const response = await fetch(urls[i]);
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); });
          if (imgY + imgH > 280) { doc.addPage(); doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text(`📷 ${catLabel} (cont.)`, 14, 20); doc.setFont("helvetica", "normal"); imgX = 14; imgY = 28; }
          doc.addImage(base64, "JPEG", imgX, imgY, imgW, imgH);
          if (i % 2 === 0) { imgX = 14 + imgW + gap; } else { imgX = 14; imgY += imgH + gap; }
        } catch (e) { console.warn(`Erro foto ${cat}[${i}]:`, e); }
      }
    }
  }

  doc.addPage(); doc.setFontSize(10); doc.text("Termo de Ciência", 14, 20); doc.setFontSize(8);
  doc.text("Declaro que conferi o veículo antes da saída e registrei neste checklist qualquer anormalidade identificada. Estou ciente de que qualquer problema decorrente de verificação inadequada será de minha inteira responsabilidade.", 14, 30, { maxWidth: 180 });
  doc.text(`Aceito: ${cl.termo_aceito ? "SIM" : "NÃO"}`, 14, 55);
  doc.text(`Técnico: ${driverName}`, 14, 62);
  doc.text(`Data: ${dateStr}`, 14, 69);
  doc.save(`checklist_${placa}_${cl.checklist_date}.pdf`);
}

// ═══════════════════════════════════════════
// Revalidate photos from URLs
// ═══════════════════════════════════════════

type RevalidationResult = {
  categoria: string;
  label: string;
  motivos: string[];
};

async function revalidatePhotos(
  fotosData: Record<string, string[]>,
  vehicleMarca?: string,
  vehicleModelo?: string
): Promise<{ invalidas: RevalidationResult[]; erros: RevalidationResult[] }> {
  const invalidas: RevalidationResult[] = [];
  const erros: RevalidationResult[] = [];

  for (const [category, urls] of Object.entries(fotosData)) {
    if (!Array.isArray(urls) || urls.length === 0) continue;

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Download failed");
        const blob = await response.blob();
        const file = new File([blob], `${category}.jpg`, { type: blob.type || "image/jpeg" });

        // Convert to base64
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Not authenticated");

        const valResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-checklist-photo`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              image_base64: base64,
              category,
              vehicle_marca: vehicleMarca || null,
              vehicle_modelo: vehicleModelo || null,
            }),
          }
        );

        if (!valResponse.ok) throw new Error("Validation request failed");
        const result = await valResponse.json();

        if (result.ai_error) {
          const existing = erros.find((e) => e.categoria === category);
          const reason = result.reason || "Erro na validação";
          if (existing) { if (!existing.motivos.includes(reason)) existing.motivos.push(reason); }
          else erros.push({ categoria: category, label: PHOTO_META[category as PhotoCategory]?.label ?? category, motivos: [reason] });
        } else if (!result.valid) {
          const existing = invalidas.find((e) => e.categoria === category);
          const reason = result.reason || "Foto reprovada";
          if (existing) { if (!existing.motivos.includes(reason)) existing.motivos.push(reason); }
          else invalidas.push({ categoria: category, label: PHOTO_META[category as PhotoCategory]?.label ?? category, motivos: [reason] });
        }
      } catch (error) {
        console.error(`Revalidation error for ${category}:`, error);
        const existing = erros.find((e) => e.categoria === category);
        if (existing) { if (!existing.motivos.includes("Falha na revalidação")) existing.motivos.push("Falha na revalidação"); }
        else erros.push({ categoria: category, label: PHOTO_META[category as PhotoCategory]?.label ?? category, motivos: ["Falha na revalidação"] });
      }
    }
  }

  return { invalidas, erros };
}

// ═══════════════════════════════════════════
// DETAIL PAGE
// ═══════════════════════════════════════════

export default function ChecklistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [scanningKm, setScanningKm] = useState(false);

  const handleScanKm = async () => {
    setScanningKm(true);
    try {
      const { data, error } = await supabase.functions.invoke("scan-km-divergence", { body: {} });
      if (error) throw error;
      const r = data as any;
      if (r?.ticketsCriados > 0) {
        toast.success(`Verificação concluída — ${r.ticketsCriados} chamado(s) criado(s)`, {
          description: `${r.scanned} checklist(s) escaneado(s) hoje, ${r.divergentes} com KM divergente.`,
        });
      } else if (r?.divergentes > 0) {
        toast.warning(`${r.divergentes} divergência(s) encontrada(s), mas já existe(m) chamado(s) aberto(s)`, {
          description: `${r.scanned} checklist(s) escaneado(s) hoje.`,
        });
      } else {
        toast.success("Nenhuma divergência de KM encontrada hoje", {
          description: `${r?.scanned ?? 0} checklist(s) escaneado(s).`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
    } catch (e: any) {
      toast.error("Erro ao verificar KM", { description: e.message ?? String(e) });
    } finally {
      setScanningKm(false);
    }
  };
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [editObs, setEditObs] = useState<Record<string, string>>({});
  const [editObsGeral, setEditObsGeral] = useState("");
  const [editResultado, setEditResultado] = useState("");

  const { data: cl, isLoading } = useQuery({
    queryKey: ["checklist-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_checklists").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-list"],
    queryFn: async () => { const { data } = await supabase.from("vehicles").select("id, placa, modelo, marca, km_atual").order("placa"); return data ?? []; },
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-list"],
    queryFn: async () => { const { data } = await supabase.from("drivers").select("id, full_name").eq("status", "ativo").order("full_name"); return data ?? []; },
  });

  const vehicle = useMemo(() => vehicles.find((v) => v.id === cl?.vehicle_id), [vehicles, cl]);
  const driver = useMemo(() => drivers.find((d) => d.id === cl?.driver_id), [drivers, cl]);
  const driverName = driver?.full_name ?? (cl as any)?.tripulacao ?? "—";
  const fotosData: Record<string, string[]> = useMemo(() => (cl?.fotos && typeof cl.fotos === "object" ? cl.fotos as any : {}), [cl]);
  const res = RESULTADO_LABELS[(cl as any)?.resultado] ?? { label: (cl as any)?.resultado ?? "—", color: "muted" };
  const detalhes = (cl as any)?.detalhes as any;

  const startEditing = () => {
    const fields: Record<string, string> = {};
    const obs: Record<string, string> = {};
    CHECKLIST_FIELDS.forEach((f) => {
      fields[f.key] = (cl as any)?.[f.key] ?? "";
      const obsVal = detalhes?.observacoes_itens?.[f.key] ?? "";
      if (obsVal) obs[f.key] = obsVal;
    });
    setEditFields(fields);
    setEditObs(obs);
    setEditObsGeral((cl as any)?.observacoes ?? "");
    setEditResultado((cl as any)?.resultado ?? "liberado");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditFields({});
    setEditObs({});
  };

  const saveEditing = async () => {
    if (!cl) return;
    setSaving(true);
    try {
      const fieldUpdates: Record<string, any> = {};
      CHECKLIST_FIELDS.forEach((f) => {
        fieldUpdates[f.key] = editFields[f.key];
      });

      // Build updated detalhes
      const newDetalhes = {
        ...detalhes,
        observacoes_itens: { ...detalhes?.observacoes_itens },
      };
      Object.entries(editObs).forEach(([key, val]) => {
        if (val.trim()) newDetalhes.observacoes_itens[key] = val.trim();
        else delete newDetalhes.observacoes_itens[key];
      });

      const { error } = await supabase.from("vehicle_checklists").update({
        ...fieldUpdates,
        observacoes: editObsGeral || null,
        resultado: editResultado,
        detalhes: newDetalhes,
      } as any).eq("id", cl.id);

      if (error) throw error;
      toast.success("Checklist atualizado com sucesso!");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["checklist-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] });

      // Check if result is non-conforme and ensure a ticket exists
      const isNonConformeResult = editResultado !== "liberado";
      const nonConformeFields = CHECKLIST_FIELDS.filter((f) => isNonConforme(f.key, editFields[f.key]));
      const fotosInvalidasCheck = (newDetalhes?.fotos_invalidas ?? []) as any[];
      const fotosErroCheck = (newDetalhes?.fotos_erro_validacao ?? []) as any[];
      const hasBadPhotos = fotosInvalidasCheck.length > 0 || fotosErroCheck.length > 0;
      const hasProblems = isNonConformeResult || nonConformeFields.length > 0 || hasBadPhotos;

      if (hasProblems && vehicle) {
        // Check if a NC ticket already exists for this vehicle around this checklist date
        const checklistDate = (cl as any).checklist_date;
        const { data: existingTickets } = await supabase
          .from("maintenance_tickets")
          .select("id")
          .eq("vehicle_id", cl.vehicle_id)
          .eq("tipo", "nao_conformidade")
          .ilike("titulo", `%Checklist NC%${vehicle.placa}%`)
          .gte("created_at", checklistDate + "T00:00:00")
          .lte("created_at", checklistDate + "T23:59:59")
          .limit(1);

        if (!existingTickets || existingTickets.length === 0) {
          // Ticket was deleted or never existed — create a new one
          const { user } = (await supabase.auth.getUser()).data;
          if (user) {
            const problemItems = nonConformeFields.map((f) => {
              const obs = (newDetalhes?.observacoes_itens?.[f.key] || "").trim();
              return `• ${f.label}: ${editFields[f.key]}${obs ? ` — "${obs}"` : ""}`;
            }).join("\n");

            const fotosInvalidas = (newDetalhes?.fotos_invalidas ?? []) as any[];
            const photoIssueLines = fotosInvalidas.map((inv: any) => {
              const meta = PHOTO_META[inv.categoria as PhotoCategory];
              return `• 📷 ${meta?.label ?? inv.categoria}: ${inv.motivos?.[0] ?? "Fora do padrão"}`;
            });
            const photoSection = photoIssueLines.length > 0 ? `\n\nFotos com problemas:\n${photoIssueLines.join("\n")}` : "";

            const dateStr = new Date(checklistDate + "T12:00:00").toLocaleDateString("pt-BR");
            const ticketDesc = `Não conformidade detectada no checklist pré-operação (reaberto após edição).\n\nVeículo: ${vehicle.placa} — ${vehicle.modelo}\nTécnico: ${driverName}\nData: ${dateStr}\nResultado: ${RESULTADO_LABELS[editResultado]?.label ?? editResultado}${problemItems ? `\n\nItens com problema:\n${problemItems}` : ""}${photoSection}${editObsGeral ? `\n\nObservações: ${editObsGeral}` : ""}`;

            const hasCritical = nonConformeFields.some((f) => f.critical);
            const ticketPrioridade = hasCritical ? "alta" : "media";

            const { data: ticketData } = await supabase.from("maintenance_tickets").insert({
              vehicle_id: cl.vehicle_id,
              driver_id: cl.driver_id || null,
              created_by: user.id,
              tipo: "nao_conformidade" as any,
              prioridade: ticketPrioridade as any,
              status: "aberto",
              titulo: `Checklist NC — ${vehicle.placa} — ${dateStr}`,
              descricao: ticketDesc,
              fotos: Object.values(fotosData).flat().slice(0, 5),
            } as any).select("id").single();

            if (ticketData?.id) {
              const actions: Array<{ ticket_id: string; descricao: string; created_by: string; sort_order: number }> = [];
              let sortOrder = 0;
              for (const f of nonConformeFields) {
                const obs = (newDetalhes?.observacoes_itens?.[f.key] || "").trim();
                const descParts = [`Verificar/corrigir: ${f.label}`];
                if (obs) descParts.push(`Obs técnico: ${obs}`);
                actions.push({ ticket_id: ticketData.id, descricao: descParts.join(" — "), created_by: user.id, sort_order: sortOrder++ });
              }
              if (actions.length > 0) {
                await supabase.from("ticket_actions").insert(actions);
              }
              toast.info("📋 Novo chamado de não conformidade criado automaticamente.");
            }
          }
        }
      }
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err?.message ?? "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const handleRevalidatePhotos = async () => {
    if (!cl) return;
    setRevalidating(true);
    try {
      toast.info("Revalidando fotos... isso pode levar alguns segundos.");
      const { invalidas, erros } = await revalidatePhotos(fotosData, vehicle?.marca, vehicle?.modelo);

      // Update detalhes with new validation results
      const newDetalhes = {
        ...detalhes,
        fotos_invalidas: invalidas,
        fotos_erro_validacao: erros,
        fotos_forcadas: [], // Clear forced since admin is revalidating
        revalidado_em: new Date().toISOString(),
      };

      const { error } = await supabase.from("vehicle_checklists").update({
        detalhes: newDetalhes,
      } as any).eq("id", cl.id);

      if (error) throw error;

      const totalIssues = invalidas.length + erros.length;
      if (totalIssues === 0) {
        toast.success("✅ Todas as fotos foram aprovadas na revalidação!");
      } else {
        toast.warning(`Revalidação concluída: ${invalidas.length} foto(s) reprovada(s), ${erros.length} erro(s).`);
      }

      queryClient.invalidateQueries({ queryKey: ["checklist-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] });
    } catch (err: any) {
      toast.error("Erro ao revalidar: " + (err?.message ?? "Erro desconhecido"));
    } finally {
      setRevalidating(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try { await exportChecklistPDF(cl, vehicle, driverName); } catch (e) { console.error(e); }
    finally { setExportingPdf(false); }
  };

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
    const { error } = await supabase.from("vehicle_checklists").delete().eq("id", cl!.id);
    setDeleting(false);
    if (error) toast.error("Erro: " + error.message);
    else { toast.success("Checklist apagado!"); queryClient.invalidateQueries({ queryKey: ["vehicle-checklists"] }); navigate("/checklist"); }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (!cl) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <p className="text-muted-foreground">Checklist não encontrado</p>
      <Button variant="outline" onClick={() => navigate("/checklist")}><ChevronLeft className="w-4 h-4 mr-1" /> Voltar</Button>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/checklist")} className="shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">
              {vehicle?.placa ?? "—"} — {new Date((cl as any).checklist_date + "T12:00:00").toLocaleDateString("pt-BR")}
            </h1>
            <p className="text-xs text-muted-foreground">Checklist Pré-Operação</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && !editing && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={startEditing}>
                <Pencil className="w-4 h-4" /> Editar
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRevalidatePhotos} disabled={revalidating}>
                {revalidating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {revalidating ? "Revalidando..." : "Revalidar Fotos"}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleScanKm} disabled={scanningKm}>
                {scanningKm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
                {scanningKm ? "Verificando..." : "Verificar KM"}
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button size="sm" className="gap-1.5" onClick={saveEditing} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "Salvando..." : "Salvar"}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={cancelEditing} disabled={saving}>
                <X className="w-4 h-4" /> Cancelar
              </Button>
            </>
          )}
          {!editing && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPdf} disabled={exportingPdf}>
                {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {exportingPdf ? "Gerando..." : "Baixar PDF"}
              </Button>
              {isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1.5"><Trash2 className="w-4 h-4" /> Apagar</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Apagar checklist?</AlertDialogTitle>
                      <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Apagar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editing banner */}
      {editing && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 flex items-center gap-2">
          <Pencil className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium text-primary">Modo edição — altere os campos e clique em Salvar</p>
        </div>
      )}

      {/* Info Card */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground text-xs">Veículo</span><p className="font-semibold">{vehicle?.placa} — {vehicle?.modelo}</p></div>
            <div><span className="text-muted-foreground text-xs">Técnico</span><p className="font-semibold">{driverName}</p></div>
            <div><span className="text-muted-foreground text-xs">Data / Hora</span><p className="font-semibold">{new Date((cl as any).checklist_date + "T12:00:00").toLocaleDateString("pt-BR")} às {new Date((cl as any).created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p></div>
            {(cl as any).tripulacao && <div><span className="text-muted-foreground text-xs">Tripulação</span><p className="font-semibold">{(cl as any).tripulacao}</p></div>}
            {(cl as any).destino && <div><span className="text-muted-foreground text-xs">Destino</span><p className="font-semibold">{(cl as any).destino}</p></div>}
          </div>

          <div className="flex items-center gap-3 mt-4">
            {editing ? (
              <Select value={editResultado} onValueChange={setEditResultado}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="liberado">✅ Liberado</SelectItem>
                  <SelectItem value="liberado_obs">⚠️ Liberado c/ observação</SelectItem>
                  <SelectItem value="bloqueado">🚫 Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <>
                <Badge className={`gap-1.5 px-3 py-1.5 text-sm ${
                  res.color === "success" ? "bg-success/10 text-success border-success/30" :
                  res.color === "warning" ? "bg-warning/10 text-warning border-warning/30" :
                  "bg-destructive/10 text-destructive border-destructive/30"
                }`}>
                  {res.color === "success" ? <ShieldCheck className="w-4 h-4" /> :
                   res.color === "warning" ? <AlertCircle className="w-4 h-4" /> :
                   <ShieldAlert className="w-4 h-4" />}
                  {res.label}
                </Badge>
                {(cl as any).resultado_motivo && <p className="text-sm italic text-muted-foreground">{(cl as any).resultado_motivo}</p>}
              </>
            )}
          </div>

          {/* Photo validation alerts */}
          {!editing && ((detalhes?.fotos_invalidas?.length ?? 0) > 0 || (detalhes?.fotos_erro_validacao?.length ?? 0) > 0 || (detalhes?.fotos_forcadas?.length ?? 0) > 0) && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2 mt-4">
              <p className="text-xs font-bold text-destructive flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> ⚠️ Fotos fora do padrão
              </p>
              {(detalhes?.fotos_invalidas ?? []).map((ff: any, i: number) => (
                <div key={`invalid-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">{ff.label}:</span> {ff.motivos?.join("; ") ?? "Foto reprovada pela IA"}
                </div>
              ))}
              {(detalhes?.fotos_erro_validacao ?? []).map((ff: any, i: number) => (
                <div key={`error-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-medium text-destructive">{ff.label}:</span> {ff.motivos?.join("; ") ?? "Falha na validação automática"}
                </div>
              ))}
              {(detalhes?.fotos_forcadas ?? []).map((ff: any, i: number) => (
                <div key={`forced-${i}`} className="text-xs text-muted-foreground">
                  <span className="font-medium text-warning">{ff.label}:</span> {ff.motivos?.join("; ") ?? "Foto forçada pelo técnico"}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Troca de óleo */}
      {((cl as any).troca_oleo || detalhes?.km_proxima_troca) && (
        <Card>
          <CardContent className="p-4 sm:p-6 space-y-2">
            <h3 className="text-sm font-bold flex items-center gap-2"><Droplets className="w-4 h-4 text-primary" /> Troca de Óleo</h3>
            <div className="flex items-center justify-between">
              <span className="text-sm">Status</span>
              <span className={`text-sm font-semibold ${(cl as any).troca_oleo === "vencido" ? "text-destructive" : "text-success"}`}>
                {(cl as any).troca_oleo === "vencido" ? "⚠️ VENCIDO" : "✅ OK"}
              </span>
            </div>
            {detalhes?.km_proxima_troca && (
              <div className="flex items-center justify-between">
                <span className="text-sm">KM próxima troca</span>
                <span className="text-sm font-semibold tabular-nums">{Number(detalhes.km_proxima_troca).toLocaleString("pt-BR")} km</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* KM do painel × Cadastro (Rota Exata) — calculado SOB DEMANDA */}
      {(() => {
        const kp = computeKmPainelDivergence(detalhes, vehicle?.km_atual);
        if (!kp) return null;
        const divergente = kp.divergente;
        return (
          <Card className={divergente ? "border-destructive/40" : ""}>
            <CardContent className="p-4 sm:p-6 space-y-2">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Gauge className="w-4 h-4 text-primary" /> KM do Painel × Cadastro
                {divergente ? (
                  <Badge variant="destructive" className="text-[10px] gap-1 ml-auto">
                    <AlertTriangle className="w-3 h-3" /> Divergente
                  </Badge>
                ) : (
                  <Badge className="text-[10px] gap-1 ml-auto bg-success/10 text-success border-success/30">
                    <CheckCircle className="w-3 h-3" /> Bate
                  </Badge>
                )}
              </h3>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Lido na foto do painel (IA)</span>
                <span className="text-sm font-semibold tabular-nums">{kp.lido.toLocaleString("pt-BR")} km</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Cadastro do veículo (Rota Exata, atual)</span>
                <span className="text-sm font-semibold tabular-nums">{kp.esperado.toLocaleString("pt-BR")} km</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2 mt-1">
                <span className="text-sm font-medium">Diferença</span>
                <span className={`text-sm font-bold tabular-nums ${divergente ? "text-destructive" : "text-success"}`}>
                  {kp.diferenca > 0 ? "+" : ""}{kp.diferenca.toLocaleString("pt-BR")} km
                </span>
              </div>
              {divergente && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-md p-2 mt-2">
                  ⚠️ Diferença acima de 5.000 km. Pode indicar foto trocada, painel ilegível, KM cadastrado desatualizado ou falha de leitura da IA. Revise a foto do painel.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground italic mt-1">
                Comparação recalculada agora com o KM mais recente do veículo.
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Sections: Photos + Fields together */}
      {DETAIL_SECTIONS.map((section) => {
        const sectionPhotos = section.photos.filter((cat) => fotosData[cat]?.length > 0);
        const sectionFields = CHECKLIST_FIELDS.filter((f) => section.fields.includes(f.category));
        if (sectionPhotos.length === 0 && sectionFields.length === 0) return null;

        const fotosForcadas: any[] = detalhes?.fotos_forcadas ?? [];
        const fotosInvalidas: any[] = detalhes?.fotos_invalidas ?? [];
        const fotosErroValidacao: any[] = detalhes?.fotos_erro_validacao ?? [];
        const flaggedMap: Record<string, string[]> = {};
        [...fotosInvalidas, ...fotosErroValidacao, ...fotosForcadas].forEach((ff: any) => {
          flaggedMap[ff.categoria] = ff.motivos ?? ["Foto fora do padrão"];
        });

        const hasFlaggedPhotos = sectionPhotos.some((cat) => !!flaggedMap[cat]);

        const Icon = section.icon;
        return (
          <Card key={section.id} className={hasFlaggedPhotos ? "border-destructive/40" : ""}>
            <CardContent className="p-4 sm:p-6 space-y-4">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Icon className="w-4 h-4 text-primary" /> {section.title}
                {hasFlaggedPhotos && (
                  <Badge variant="destructive" className="text-[10px] gap-1 ml-auto">
                    <AlertTriangle className="w-3 h-3" /> Fotos fora do padrão
                  </Badge>
                )}
              </h3>

              <div className="space-y-1 divide-y divide-border">
                {sectionPhotos.map((cat) => (
                  <PhotoRow key={cat} category={cat} urls={fotosData[cat]} isFlagged={!!flaggedMap[cat]} flagReasons={flaggedMap[cat]} />
                ))}

                {sectionFields.map((f) => {
                  const currentVal = editing ? editFields[f.key] : (cl as any)[f.key];
                  const nc = isNonConforme(f.key, currentVal);
                  const opt = f.options.find((o) => o.value === currentVal);
                  const obsValue = editing
                    ? (editObs[f.key] ?? "")
                    : ((cl as any)[`obs_${f.key}`] ?? detalhes?.observacoes_itens?.[f.key] ?? "");

                  return (
                    <div key={f.key} className="py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm flex-1">{f.label}</span>
                        {editing ? (
                          <Select value={editFields[f.key]} onValueChange={(v) => setEditFields((prev) => ({ ...prev, [f.key]: v }))}>
                            <SelectTrigger className="w-[180px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {f.options.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${nc ? "text-destructive" : opt?.color === "warning" ? "text-warning" : "text-success"}`}>
                            {nc ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                            {opt?.label ?? currentVal ?? "—"}
                          </span>
                        )}
                      </div>
                      {editing && isNonConforme(f.key, editFields[f.key]) && (
                        <div className="ml-4 pl-3 border-l-2 border-destructive/30 mt-1 mb-1">
                          <Textarea
                            placeholder="Descreva o problema..."
                            value={editObs[f.key] ?? ""}
                            rows={2}
                            className="text-xs"
                            onChange={(e) => setEditObs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          />
                        </div>
                      )}
                      {!editing && nc && obsValue && (
                        <div className="ml-4 pl-3 border-l-2 border-destructive/30 mt-1 mb-1">
                          <p className="text-xs text-muted-foreground italic">📝 {obsValue}</p>
                        </div>
                      )}
                      {/* Photos for non-conforme items (exc_ photos) */}
                      {nc && fotosData[`exc_${f.key}`] && (fotosData[`exc_${f.key}`] as string[]).length > 0 && (
                        <div className="ml-4 pl-3 border-l-2 border-destructive/30 mt-1 mb-1">
                          <div className="flex gap-2 flex-wrap">
                            {(fotosData[`exc_${f.key}`] as string[]).map((url: string, i: number) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 border-destructive/30 block hover:ring-2 hover:ring-primary transition-all">
                                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Observações */}
      {(editing || (cl as any).observacoes) && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><ClipboardCheck className="w-4 h-4 text-primary" /> Observações</h3>
            {editing ? (
              <Textarea
                value={editObsGeral}
                onChange={(e) => setEditObsGeral(e.target.value)}
                rows={3}
                placeholder="Observações gerais..."
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{(cl as any).observacoes}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Termo */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <h3 className="text-sm font-bold flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-primary" /> Termo de Ciência</h3>
          <p className="text-xs text-muted-foreground">
            Declaro que conferi o veículo antes da saída e registrei neste checklist qualquer anormalidade identificada. Estou ciente de que qualquer problema decorrente de verificação inadequada será de minha inteira responsabilidade.
          </p>
          <div className="flex items-center gap-2 mt-2">
            {(cl as any).termo_aceito ? <CheckCircle className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-destructive" />}
            <span className="text-sm font-semibold">{(cl as any).termo_aceito ? "Aceito" : "Não aceito"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}