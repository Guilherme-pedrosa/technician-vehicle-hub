import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Settings, ClipboardCheck, Camera, Plus, Trash2,
  Save, Loader2, Pencil, AlertTriangle, CheckCircle,
  ChevronRight, ArrowLeft, FolderCog, Users, Shield,
  Mail, Phone, Eye, EyeOff, UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface PhotoConfig {
  key: string;
  label: string;
  hint: string;
  min: number;
  step: number;
}

interface FieldConfig {
  key: string;
  label: string;
  category: string;
  optionType: "conforme_nao" | "sim_nao" | "nao_sim";
  critical: boolean;
}

const OPTION_TYPE_LABELS: Record<string, string> = {
  conforme_nao: "Conforme / Não Conforme",
  sim_nao: "Sim / Não",
  nao_sim: "Não / Sim (invertido)",
};

const STEP_LABELS: Record<number, string> = {
  1: "Painel",
  2: "Exterior 360°",
  3: "Pneus e Estepe",
  4: "Capô Aberto",
  5: "Interior",
  6: "Danos/Avarias",
  7: "Resultado",
};

const CATEGORIES = ["Exterior", "Pneus", "Capô", "Interior", "Danos"];

type SettingsView = "root" | "checklists" | "checklist-pre-op" | "usuarios";

interface SettingsMenuItem {
  id: SettingsView;
  title: string;
  description: string;
  icon: typeof ClipboardCheck;
  badge?: string;
}

const ROOT_ITEMS: SettingsMenuItem[] = [
  {
    id: "usuarios",
    title: "Usuários",
    description: "Cadastro de usuários e permissões de acesso",
    icon: Users,
  },
  {
    id: "checklists",
    title: "Check-lists",
    description: "Gerencie os modelos de checklist do sistema",
    icon: FolderCog,
  },
];

const CHECKLIST_ITEMS: SettingsMenuItem[] = [
  {
    id: "checklist-pre-op",
    title: "Checklist Pré Operação",
    description: "Fotos obrigatórias, itens de inspeção e regras de bloqueio",
    icon: ClipboardCheck,
    badge: "Ativo",
  },
];

export default function Configuracoes() {
  const [view, setView] = useState<SettingsView>("root");

  if (view === "usuarios") {
    return <UserManagement onBack={() => setView("root")} />;
  }

  if (view === "checklist-pre-op") {
    return <ChecklistConfigEditor onBack={() => setView("checklists")} />;
  }

  if (view === "checklists") {
    return (
      <SettingsListView
        title="Check-lists"
        description="Escolha o checklist que deseja editar"
        breadcrumb="Configurações → Check-lists"
        items={CHECKLIST_ITEMS}
        onBack={() => setView("root")}
        onOpen={(id) => setView(id)}
      />
    );
  }

  return (
    <SettingsListView
      title="Configurações"
      description="Gerencie formulários, regras e preferências do sistema"
      breadcrumb="Configurações"
      items={ROOT_ITEMS}
      onOpen={(id) => setView(id)}
    />
  );
}

function SettingsListView({
  title,
  description,
  breadcrumb,
  items,
  onOpen,
  onBack,
}: {
  title: string;
  description: string;
  breadcrumb: string;
  items: SettingsMenuItem[];
  onOpen: (id: SettingsView) => void;
  onBack?: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{breadcrumb}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-6 w-6" />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card
            key={item.id}
            className="cursor-pointer hover:shadow-md transition-shadow group"
            onClick={() => onOpen(item.id)}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <item.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{item.title}</p>
                  {item.badge && (
                    <Badge variant="secondary" className="text-[10px]">{item.badge}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{item.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ChecklistConfigEditor({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [photos, setPhotos] = useState<PhotoConfig[]>([]);
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const [editingPhoto, setEditingPhoto] = useState<PhotoConfig | null>(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldConfig | null>(null);
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ["checklist-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("checklist_config")
        .select("*")
        .eq("config_key", "default")
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (config) {
      setPhotos((config.photo_categories as any) || []);
      setFields((config.inspection_fields as any) || []);
      setHasChanges(false);
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("checklist_config")
        .update({
          photo_categories: photos as any,
          inspection_fields: fields as any,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        })
        .eq("config_key", "default");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist-config"] });
      setHasChanges(false);
      toast.success("Configurações salvas com sucesso!");
    },
    onError: () => toast.error("Erro ao salvar configurações"),
  });

  const handleSavePhoto = (photo: PhotoConfig) => {
    setPhotos((prev) => {
      const idx = prev.findIndex((p) => p.key === photo.key);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = photo;
        return updated;
      }
      return [...prev, photo];
    });
    setHasChanges(true);
    setPhotoDialogOpen(false);
    setEditingPhoto(null);
  };

  const handleDeletePhoto = (key: string) => {
    setPhotos((prev) => prev.filter((p) => p.key !== key));
    setHasChanges(true);
  };

  const handleSaveField = (field: FieldConfig) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.key === field.key);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = field;
        return updated;
      }
      return [...prev, field];
    });
    setHasChanges(true);
    setFieldDialogOpen(false);
    setEditingField(null);
  };

  const handleDeleteField = (key: string) => {
    setFields((prev) => prev.filter((f) => f.key !== key));
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const groupedPhotos = Object.entries(STEP_LABELS).map(([step, label]) => ({
    step: Number(step),
    label,
    items: photos.filter((p) => p.step === Number(step)),
  }));

  const groupedFields = CATEGORIES.map((cat) => ({
    category: cat,
    items: fields.filter((f) => f.category === cat),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Configurações → Check-lists → Checklist Pré Operação
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Checklist Pré Operação
            </h1>
          </div>
        </div>
        {hasChanges && (
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" />
              Fotos Obrigatórias
            </CardTitle>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditingPhoto(null); setPhotoDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
          <CardDescription>Total: {photos.length} fotos</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupedPhotos.map(({ step, label, items }) =>
            items.length > 0 ? (
              <div key={step} className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Etapa {step} — {label}
                </p>
                <div className="grid gap-2">
                  {items.map((photo) => (
                    <div key={photo.key} className="flex items-center justify-between rounded-lg border bg-card p-3 group hover:shadow-sm transition-shadow">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{photo.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{photo.hint}</p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge variant="secondary" className="text-[10px]">mín. {photo.min}</Badge>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingPhoto(photo); setPhotoDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remover foto?</AlertDialogTitle>
                              <AlertDialogDescription>A foto "{photo.label}" será removida do checklist.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeletePhoto(photo.key)}>Remover</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle className="h-4 w-4" />
              Itens de Inspeção
            </CardTitle>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditingField(null); setFieldDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
          <CardDescription>Total: {fields.length} itens ({fields.filter((f) => f.critical).length} críticos)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupedFields.map(({ category, items }) =>
            items.length > 0 ? (
              <div key={category} className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</p>
                <div className="grid gap-2">
                  {items.map((field) => (
                    <div key={field.key} className="flex items-center justify-between rounded-lg border bg-card p-3 group hover:shadow-sm transition-shadow">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{field.label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{OPTION_TYPE_LABELS[field.optionType]}</span>
                          {field.critical && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                              Crítico
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingField(field); setFieldDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remover item?</AlertDialogTitle>
                              <AlertDialogDescription>O item "{field.label}" será removido do checklist.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteField(field.key)}>Remover</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </CardContent>
      </Card>

      {hasChanges && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-primary px-6 py-3 text-primary-foreground shadow-lg animate-fade-in">
          <span className="text-sm font-medium">Alterações não salvas</span>
          <Button variant="secondary" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-1.5">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar
          </Button>
        </div>
      )}

      <PhotoDialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen} photo={editingPhoto} onSave={handleSavePhoto} existingKeys={photos.map((p) => p.key)} />
      <FieldDialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen} field={editingField} onSave={handleSaveField} existingKeys={fields.map((f) => f.key)} />
    </div>
  );
}

function PhotoDialog({
  open,
  onOpenChange,
  photo,
  onSave,
  existingKeys,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  photo: PhotoConfig | null;
  onSave: (p: PhotoConfig) => void;
  existingKeys: string[];
}) {
  const isEdit = !!photo;
  const [form, setForm] = useState<PhotoConfig>({
    key: "",
    label: "",
    hint: "",
    min: 1,
    step: 1,
  });

  useEffect(() => {
    if (photo) {
      setForm(photo);
    } else {
      setForm({ key: "", label: "", hint: "", min: 1, step: 1 });
    }
  }, [photo, open]);

  const canSave = form.key.trim() && form.label.trim() && form.hint.trim() && (isEdit || !existingKeys.includes(form.key.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Foto" : "Nova Foto Obrigatória"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Identificador (chave)</Label>
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[^a-z0-9_]/g, "") })} placeholder="ex: foto_motor" disabled={isEdit} />
          </div>
          <div className="space-y-2">
            <Label>Nome da foto</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex: Compartimento do Motor" />
          </div>
          <div className="space-y-2">
            <Label>Instrução para o técnico</Label>
            <Input value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })} placeholder="ex: Foto do motor aberto" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Mínimo de fotos</Label>
              <Input type="number" min={1} max={5} value={form.min} onChange={(e) => setForm({ ...form, min: Number(e.target.value) || 1 })} />
            </div>
            <div className="space-y-2">
              <Label>Etapa do formulário</Label>
              <Select value={String(form.step)} onValueChange={(v) => setForm({ ...form, step: Number(v) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STEP_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{val} — {label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => canSave && onSave(form)} disabled={!canSave}>{isEdit ? "Salvar" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldDialog({
  open,
  onOpenChange,
  field,
  onSave,
  existingKeys,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  field: FieldConfig | null;
  onSave: (f: FieldConfig) => void;
  existingKeys: string[];
}) {
  const isEdit = !!field;
  const [form, setForm] = useState<FieldConfig>({
    key: "",
    label: "",
    category: "Exterior",
    optionType: "conforme_nao",
    critical: false,
  });

  useEffect(() => {
    if (field) {
      setForm(field);
    } else {
      setForm({ key: "", label: "", category: "Exterior", optionType: "conforme_nao", critical: false });
    }
  }, [field, open]);

  const canSave = form.key.trim() && form.label.trim() && (isEdit || !existingKeys.includes(form.key.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Item" : "Novo Item de Inspeção"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Identificador (chave)</Label>
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[^a-z0-9_]/g, "") })} placeholder="ex: freios" disabled={isEdit} />
          </div>
          <div className="space-y-2">
            <Label>Pergunta exibida</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex: Freios funcionando corretamente?" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de resposta</Label>
              <Select value={form.optionType} onValueChange={(v: any) => setForm({ ...form, optionType: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(OPTION_TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
            <Switch checked={form.critical} onCheckedChange={(v) => setForm({ ...form, critical: v })} />
            <div>
              <p className="text-sm font-medium">Item crítico</p>
              <p className="text-xs text-muted-foreground">Se não conforme, sugere bloqueio automático</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => canSave && onSave(form)} disabled={!canSave}>{isEdit ? "Salvar" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════

interface ManagedUser {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  cargo: string;
  roles: string[];
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: "Administrador", color: "bg-primary text-primary-foreground" },
  tecnico: { label: "Técnico", color: "bg-amber-100 text-amber-800 border-amber-200" },
};

function UserManagement({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);

  const { data: users = [], isLoading, refetch } = useQuery({
    queryKey: ["managed-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data.users as ManagedUser[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "create", ...payload },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
    },
    onSuccess: () => { refetch(); toast.success("Usuário criado com sucesso!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "update", ...payload },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
    },
    onSuccess: () => { refetch(); toast.success("Usuário atualizado!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke("manage-users", {
        body: { action: "delete", user_id: userId },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
    },
    onSuccess: () => { refetch(); toast.success("Usuário removido!"); setDeleteUserId(null); },
    onError: (e: any) => { toast.error(e.message); setDeleteUserId(null); },
  });

  const admins = users.filter((u) => u.roles.includes("admin"));
  const tecnicos = users.filter((u) => u.roles.includes("tecnico"));
  const semPerfil = users.filter((u) => u.roles.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="mt-0.5 h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Configurações → Usuários
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight flex items-center gap-2">
              <Users className="h-5 w-5" />
              Cadastro de Usuários
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gerencie os acessos e permissões do sistema</p>
          </div>
        </div>
        <Button onClick={() => { setEditingUser(null); setDialogOpen(true); }} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      {/* Role info */}
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4 flex gap-3 items-start">
          <Shield className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Permissões por perfil</p>
            <div className="mt-2 space-y-1 text-amber-800">
              <p><strong>Administrador:</strong> Acesso total — dashboard, condutores, veículos, checklists, chamados, relatórios, configurações</p>
              <p><strong>Técnico:</strong> Acesso limitado — dashboard, veículos, checklists (preenchimento) e chamados</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{users.length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{admins.length}</p>
            <p className="text-xs text-muted-foreground">Admins</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-400">
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{tecnicos.length}</p>
            <p className="text-xs text-muted-foreground">Técnicos</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-semibold">Nome</th>
                    <th className="text-left p-3 font-semibold">E-mail</th>
                    <th className="text-left p-3 font-semibold">Perfil</th>
                    <th className="text-left p-3 font-semibold">Cargo</th>
                    <th className="text-left p-3 font-semibold">Último acesso</th>
                    <th className="text-right p-3 font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((u) => {
                    const role = u.roles[0];
                    const roleInfo = ROLE_LABELS[role] ?? { label: "Sem perfil", color: "bg-muted text-muted-foreground" };
                    const isSelf = u.id === user?.id;

                    return (
                      <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <p className="font-medium">{u.full_name || "—"}</p>
                          {u.phone && <p className="text-xs text-muted-foreground">{u.phone}</p>}
                        </td>
                        <td className="p-3 text-muted-foreground">{u.email}</td>
                        <td className="p-3">
                          <Badge variant="outline" className={roleInfo.color}>{roleInfo.label}</Badge>
                          {isSelf && <Badge variant="secondary" className="ml-1 text-[10px]">Você</Badge>}
                        </td>
                        <td className="p-3 text-muted-foreground">{u.cargo || "—"}</td>
                        <td className="p-3 text-muted-foreground text-xs">
                          {u.last_sign_in_at ? format(new Date(u.last_sign_in_at), "dd/MM/yy HH:mm") : "Nunca"}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingUser(u); setDialogOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {!isSelf && (
                              <AlertDialog open={deleteUserId === u.id} onOpenChange={(o) => !o && setDeleteUserId(null)}>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteUserId(u.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      O usuário <strong>{u.full_name || u.email}</strong> será removido permanentemente do sistema.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground"
                                      onClick={() => deleteMutation.mutate(u.id)}
                                    >
                                      Excluir
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <UserFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={editingUser}
        onSave={(data) => {
          if (editingUser) {
            updateMutation.mutate({ user_id: editingUser.id, ...data });
          } else {
            createMutation.mutate(data);
          }
          setDialogOpen(false);
          setEditingUser(null);
        }}
        saving={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function UserFormDialog({
  open,
  onOpenChange,
  user,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: ManagedUser | null;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const isEdit = !!user;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cargo, setCargo] = useState("");
  const [role, setRole] = useState("tecnico");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name);
      setEmail(user.email);
      setPhone(user.phone);
      setCargo(user.cargo);
      setRole(user.roles[0] || "tecnico");
      setPassword("");
    } else {
      setFullName(""); setEmail(""); setPhone(""); setCargo(""); setRole("tecnico"); setPassword("");
    }
  }, [user, open]);

  const canSave = fullName.trim() && (isEdit || (email.trim() && password.length >= 6));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome completo *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome do usuário" />
          </div>

          <div className="space-y-2">
            <Label>E-mail *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com" disabled={isEdit} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex: Mecânico" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Perfil de acesso *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5" />
                    Administrador — Acesso total
                  </div>
                </SelectItem>
                <SelectItem value="tecnico">
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" />
                    Técnico — Dashboard, veículos, checklists, chamados
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{isEdit ? "Nova senha (opcional)" : "Senha *"}</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? "Deixe vazio para manter" : "Mínimo 6 caracteres"}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => canSave && onSave({ email, password: password || undefined, full_name: fullName, role, phone, cargo })}
            disabled={!canSave || saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? "Salvar" : "Criar Usuário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
