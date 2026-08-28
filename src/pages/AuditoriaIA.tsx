import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Bot, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { compareAuditQueue, computeAuditIndicators, countRecurrences } from "@/lib/checklist-audit";

type AuditRow = {
  id: string;
  checklist_id: string;
  vehicle_id: string | null;
  user_id: string | null;
  categoria: string;
  label: string | null;
  status: string;
  severity: string | null;
  motivo: string | null;
  reason_original: string | null;
  reject_code: string | null;
  confidence: number | null;
  model_used: string | null;
  prompt_version: string | null;
  photo_url: string | null;
  created_at: string;
  resolved_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  forced: "Forçada pelo técnico",
  invalid: "Reprovada pela IA",
  ai_error: "Erro de IA",
  pending_at_submit: "IA pendente no envio",
  km_not_confirmed: "KM não confirmado",
  interior_incomplete: "Cobertura incompleta",
  km_divergence: "Divergência de KM",
};

function toISODate(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export default function AuditoriaIA() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const [dataInicio, setDataInicio] = useState(toISODate(inicioMes));
  const [dataFim, setDataFim] = useState(toISODate(hoje));
  const [statusFiltro, setStatusFiltro] = useState<string>("todos");
  const [severidadeFiltro, setSeveridadeFiltro] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [resolvendo, setResolvendo] = useState<string | null>(null);

  // Inverte automaticamente se o início for maior que o fim
  const [inicio, fim] = dataInicio > dataFim ? [dataFim, dataInicio] : [dataInicio, dataFim];

  const { data: events = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["checklist-ai-audit", "queue", inicio, fim],
    queryFn: async () => {
      const { data, error } = await (supabase.from("checklist_ai_audit_events" as any) as any)
        .select("*")
        .gte("created_at", `${inicio}T00:00:00`)
        .lte("created_at", `${fim}T23:59:59`)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  // Denominador correto: checklists FINALIZADOS no mesmo período
  const { data: finalizados = 0 } = useQuery({
    queryKey: ["checklists-finalizados", inicio, fim],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("vehicle_checklists")
        .select("id", { count: "exact", head: true })
        .eq("status", "finalizado" as any)
        .gte("checklist_date", inicio)
        .lte("checklist_date", fim);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("id, placa, modelo");
      return data ?? [];
    },
  });
  const placaPorVeiculo = useMemo(
    () => new Map(vehicles.map((v: any) => [v.id, `${v.placa} — ${v.modelo}`])),
    [vehicles],
  );

  const reincidencias = useMemo(() => countRecurrences(events as any), [events]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return events
      .filter((e) => (statusFiltro === "todos" ? true : e.status === statusFiltro))
      .filter((e) => (severidadeFiltro === "todas" ? true : (e.severity ?? "warning") === severidadeFiltro))
      .filter((e) => {
        if (!termo) return true;
        const placa = placaPorVeiculo.get(e.vehicle_id ?? "") ?? "";
        return [placa, e.categoria, e.label, e.motivo, e.reason_original]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(termo));
      })
      .slice()
      .sort(compareAuditQueue as any);
  }, [events, statusFiltro, severidadeFiltro, busca, placaPorVeiculo]);

  const indicadores = useMemo(
    () => computeAuditIndicators({ finalizados, events: events as any }),
    [finalizados, events],
  );

  const marcarAnalisado = async (row: AuditRow) => {
    setResolvendo(row.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase.from("checklist_ai_audit_events" as any) as any)
        .update({ resolved_at: new Date().toISOString(), resolved_by: userData.user?.id ?? null })
        .eq("id", row.id);
      if (error) throw error;
      toast.success("Evento marcado como analisado.");
      queryClient.invalidateQueries({ queryKey: ["checklist-ai-audit"] });
    } catch (err: any) {
      toast.error("Não foi possível marcar como analisado: " + (err?.message ?? "erro"));
    } finally {
      setResolvendo(null);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center gap-2">
        <Bot className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Auditoria de IA</h1>
        <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={() => refetch()} disabled={isRefetching}>
          {isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Atualizar
        </Button>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: "Finalizados", value: indicadores.finalizados },
          { label: "Com alerta", value: `${indicadores.comAlerta} (${indicadores.pctComAlerta}%)` },
          { label: "Críticos", value: `${indicadores.criticos} (${indicadores.pctCriticos}%)` },
          { label: "Pendentes/erro IA", value: indicadores.pendentes },
          { label: "Analisados", value: indicadores.analisados },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">{card.label}</p>
              <p className="text-lg font-bold tabular-nums">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-3 grid grid-cols-2 lg:grid-cols-5 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Início</Label>
            <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fim</Label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={statusFiltro} onValueChange={setStatusFiltro}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Severidade</Label>
            <Select value={severidadeFiltro} onValueChange={setSeveridadeFiltro}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="warning">Atenção</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buscar</Label>
            <Input placeholder="placa, categoria, motivo…" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-10" />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando fila…
        </div>
      ) : filtrados.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhum evento de auditoria no período/filtro selecionado.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtrados.map((e) => {
            const recorrencia = reincidencias.get(`${e.user_id ?? "?"}|${e.categoria}|${e.status}`) ?? 1;
            return (
              <Card key={e.id} className={e.severity === "critical" ? "border-destructive/40" : ""}>
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={e.severity === "critical" ? "destructive" : "outline"} className="text-[10px]">
                      {(e.severity ?? "warning").toUpperCase()}
                    </Badge>
                    <span className="text-sm font-semibold">{e.label ?? e.categoria}</span>
                    <span className="text-xs text-muted-foreground">{STATUS_LABEL[e.status] ?? e.status}</span>
                    {recorrencia > 1 && (
                      <Badge variant="secondary" className="text-[10px]">reincidência ×{recorrencia}</Badge>
                    )}
                    {e.resolved_at && <Badge variant="secondary" className="text-[10px]">analisado</Badge>}
                  </div>
                  <p className="text-xs">
                    <strong>{placaPorVeiculo.get(e.vehicle_id ?? "") ?? "Veículo —"}</strong>{" "}
                    <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</span>
                  </p>
                  {e.motivo && <p className="text-xs text-muted-foreground">{e.motivo}</p>}
                  {e.reason_original && e.reason_original !== e.motivo && (
                    <p className="text-[11px] text-muted-foreground italic">IA: {e.reason_original}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {[
                      e.model_used, e.prompt_version,
                      typeof e.confidence === "number" ? `conf ${(e.confidence * 100).toFixed(0)}%` : null,
                      e.reject_code,
                    ].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex gap-2 pt-1 flex-wrap">
                    <Button size="sm" variant="outline" className="h-8 text-xs"
                      onClick={() => navigate(`/checklist/${e.checklist_id}`)}>
                      Abrir checklist
                    </Button>
                    {e.photo_url && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                        <a href={e.photo_url} target="_blank" rel="noreferrer">Ver foto</a>
                      </Button>
                    )}
                    {isAdmin && !e.resolved_at && (
                      <Button size="sm" className="h-8 text-xs gap-1" disabled={resolvendo === e.id}
                        onClick={() => marcarAnalisado(e)}>
                        {resolvendo === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Marcar analisado
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
