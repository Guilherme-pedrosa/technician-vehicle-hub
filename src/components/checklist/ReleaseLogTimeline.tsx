import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ShieldAlert, History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface LogEntry {
  id: string;
  action: string;
  previous_resultado: string;
  new_resultado: string;
  motivo: string;
  created_by_name: string | null;
  created_at: string;
}

export function ReleaseLogTimeline({ checklistId, refreshKey = 0 }: { checklistId: string; refreshKey?: number }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    supabase
      .from("checklist_release_log")
      .select("id, action, previous_resultado, new_resultado, motivo, created_by_name, created_at")
      .eq("checklist_id", checklistId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!ignore) {
          setEntries((data as LogEntry[]) ?? []);
          setLoading(false);
        }
      });
    return () => { ignore = true; };
  }, [checklistId, refreshKey]);

  if (loading) return <Skeleton className="h-20 w-full" />;
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Histórico de bloqueio/liberação</h3>
      </div>
      <ol className="space-y-3">
        {entries.map((entry) => {
          const isLiberacao = entry.action === "liberacao";
          const Icon = isLiberacao ? ShieldCheck : ShieldAlert;
          return (
            <li key={entry.id} className="flex gap-3 text-sm">
              <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${isLiberacao ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {isLiberacao ? "Liberado por ADM" : "Re-bloqueado"}
                  <span className="text-xs text-muted-foreground font-normal"> · {entry.created_by_name ?? "—"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </p>
                <p className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap break-words">{entry.motivo}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
