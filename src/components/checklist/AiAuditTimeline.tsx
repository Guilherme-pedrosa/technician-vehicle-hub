import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Bot, History } from "lucide-react";
import { compareAuditQueue } from "@/lib/checklist-audit";

type AuditRow = {
  id?: string;
  categoria: string;
  label?: string | null;
  status: string;
  severity?: string | null;
  motivo?: string | null;
  reason_original?: string | null;
  reject_code?: string | null;
  confidence?: number | null;
  model_used?: string | null;
  prompt_version?: string | null;
  duration_ms?: number | null;
  photo_url?: string | null;
  created_at?: string | null;
  forced_at?: string | null;
  resolved_at?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  forced: "Foto usada mesmo assim",
  invalid: "Reprovada pela IA",
  ai_error: "Erro de validação IA",
  pending_at_submit: "IA pendente no envio",
  km_not_confirmed: "KM do painel não confirmado",
  interior_incomplete: "Cobertura do interior incompleta",
  km_divergence: "Divergência de KM",
};

/**
 * Trilha de auditoria de IA do checklist (append-only).
 * Lê a tabela `checklist_ai_audit_events` e faz fallback para os
 * metadados legados em `detalhes` (compatibilidade com registros antigos).
 */
export function AiAuditTimeline({
  checklistId,
  legacyDetalhes,
}: {
  checklistId: string;
  legacyDetalhes?: any;
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["checklist-ai-audit", checklistId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("checklist_ai_audit_events" as any) as any)
        .select("*")
        .eq("checklist_id", checklistId)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("Falha ao carregar auditoria de IA:", error);
        return [] as AuditRow[];
      }
      return (data ?? []) as AuditRow[];
    },
    enabled: !!checklistId,
  });

  const legacyEvents: AuditRow[] = Array.isArray(legacyDetalhes?.ai_audit)
    ? legacyDetalhes.ai_audit
    : Array.isArray(legacyDetalhes?.audit_events)
      ? legacyDetalhes.audit_events
      : [];

  const events: AuditRow[] = (rows.length > 0 ? rows : legacyEvents).slice().sort(compareAuditQueue as any);
  const revalidacoes: any[] = Array.isArray(legacyDetalhes?.revalidacoes) ? legacyDetalhes.revalidacoes : [];
  const kmNaoConfirmado = legacyDetalhes?.km_painel_nao_confirmado === true;
  const pendencias: string[] = Array.isArray(legacyDetalhes?.acoes_pendentes) ? legacyDetalhes.acoes_pendentes : [];

  if (isLoading) return null;
  if (events.length === 0 && revalidacoes.length === 0 && !kmNaoConfirmado && pendencias.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold">Trilha de auditoria de IA</h2>
          <Badge variant="outline" className="text-[10px]">{events.length} evento(s)</Badge>
        </div>

        {kmNaoConfirmado && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <span>KM do painel <strong>não confirmado pela IA</strong> — o valor registrado foi digitado manualmente.</span>
          </div>
        )}

        {pendencias.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs">
            <strong>Ações pendentes no envio:</strong> {pendencias.join("; ")}
          </div>
        )}

        <div className="space-y-2">
          {events.map((e, i) => (
            <div key={e.id ?? `${e.categoria}-${i}`} className="rounded-lg border p-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={e.severity === "critical" ? "destructive" : "outline"}
                  className="text-[10px]"
                >
                  {(e.severity ?? "warning").toUpperCase()}
                </Badge>
                <span className="text-xs font-semibold">{e.label ?? e.categoria}</span>
                <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[e.status] ?? e.status}</span>
                {e.resolved_at && <Badge variant="secondary" className="text-[10px]">analisado</Badge>}
              </div>
              {e.motivo && <p className="text-[11px] text-muted-foreground">{e.motivo}</p>}
              {e.reason_original && e.reason_original !== e.motivo && (
                <p className="text-[11px] text-muted-foreground italic">IA: {e.reason_original}</p>
              )}
              <p className="text-[10px] text-muted-foreground">
                {[
                  e.model_used ? `modelo ${e.model_used}` : null,
                  e.prompt_version ? `prompt ${e.prompt_version}` : null,
                  typeof e.confidence === "number" ? `conf ${(e.confidence * 100).toFixed(0)}%` : null,
                  typeof e.duration_ms === "number" ? `${e.duration_ms} ms` : null,
                  e.reject_code ? `código ${e.reject_code}` : null,
                  e.created_at ?? e.forced_at
                    ? new Date((e.created_at ?? e.forced_at) as string).toLocaleString("pt-BR")
                    : null,
                ].filter(Boolean).join(" · ")}
              </p>
              {e.photo_url && (
                <a href={e.photo_url} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline">
                  Ver foto
                </a>
              )}
            </div>
          ))}
        </div>

        {revalidacoes.length > 0 && (
          <div className="pt-2 border-t space-y-1">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">Histórico de revalidações ({revalidacoes.length})</span>
            </div>
            {revalidacoes.slice().reverse().map((r: any, i: number) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                {new Date(r.em).toLocaleString("pt-BR")} — escopo {r.escopo}:{" "}
                {(r.invalidas_depois ?? []).length} reprovada(s), {(r.erros_depois ?? []).length} erro(s)
                {(r.forcadas_no_momento ?? []).length > 0
                  ? ` · ${(r.forcadas_no_momento ?? []).length} forçada(s) preservada(s)`
                  : ""}
                {r.km_lido_painel ? ` · KM lido ${Number(r.km_lido_painel).toLocaleString("pt-BR")}` : ""}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
