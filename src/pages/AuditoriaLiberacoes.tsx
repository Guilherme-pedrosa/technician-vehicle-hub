import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ShieldAlert, History, Eye, Search } from "lucide-react";
import { format } from "date-fns";

interface Row {
  id: string;
  checklist_id: string;
  vehicle_id: string;
  action: string;
  previous_resultado: string;
  new_resultado: string;
  motivo: string;
  created_by_name: string | null;
  created_at: string;
  vehicles?: { placa: string } | null;
}

export default function AuditoriaLiberacoes() {
  const navigate = useNavigate();
  const today = format(new Date(), "yyyy-MM-dd");
  const monthAgo = format(new Date(Date.now() - 30 * 24 * 3600 * 1000), "yyyy-MM-dd");
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const effStart = start <= end ? start : end;
  const effEnd = start <= end ? end : start;

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    supabase
      .from("checklist_release_log")
      .select("*, vehicles ( placa )")
      .gte("created_at", `${effStart}T00:00:00`)
      .lte("created_at", `${effEnd}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!ignore) {
          setRows((data as unknown as Row[]) ?? []);
          setLoading(false);
        }
      });
    return () => { ignore = true; };
  }, [effStart, effEnd]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vehicles?.placa, r.created_by_name, r.motivo].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const stats = useMemo(() => ({
    liberacoes: rows.filter((r) => r.action === "liberacao").length,
    rebloqueios: rows.filter((r) => r.action === "rebloqueio").length,
  }), [rows]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <History className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Auditoria de Liberações</h1>
          <p className="text-xs text-muted-foreground">Histórico de bloqueios e liberações da frota</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Liberações</p>
            <p className="text-2xl font-bold text-success">{stats.liberacoes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Re-bloqueios</p>
            <p className="text-2xl font-bold text-destructive">{stats.rebloqueios}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total no período</p>
            <p className="text-2xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <CardTitle className="text-base">Registros</CardTitle>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-muted-foreground">Início</label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-muted-foreground">Fim</label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-[10px] uppercase text-muted-foreground">Buscar</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Placa, usuário, motivo..." className="h-8 text-xs pl-7" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Nenhum registro encontrado</div>
          ) : (
            <ul className="divide-y">
              {filtered.map((r) => {
                const isLib = r.action === "liberacao";
                const Icon = isLib ? ShieldCheck : ShieldAlert;
                return (
                  <li key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-3 hover:bg-muted/30">
                    <div className={`shrink-0 rounded-full p-2 ${isLib ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={isLib ? "default" : "destructive"} className="text-[10px]">
                          {isLib ? "Liberação" : "Re-bloqueio"}
                        </Badge>
                        <span className="text-sm font-bold">{r.vehicles?.placa ?? "—"}</span>
                        <span className="text-xs text-muted-foreground">por {r.created_by_name ?? "—"}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {new Date(r.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">{r.motivo}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs shrink-0" onClick={() => navigate(`/checklist/${r.checklist_id}`)}>
                      <Eye className="w-3.5 h-3.5" /> Checklist
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
