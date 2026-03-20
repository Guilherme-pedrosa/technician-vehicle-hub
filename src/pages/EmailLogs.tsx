import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, CheckCircle, XCircle, Clock, RefreshCw, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

type EmailLog = {
  id: string;
  checklist_id: string | null;
  recipient_email: string;
  subject: string | null;
  status: string;
  error_message: string | null;
  resend_id: string | null;
  metadata: any;
  created_at: string;
};

const EmailLogs = () => {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("7d");

  const getDateFilter = () => {
    const now = new Date();
    switch (timeFilter) {
      case "24h": return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      case "7d": return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      case "30d": return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      default: return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
  };

  const { data: logs, isLoading, refetch } = useQuery({
    queryKey: ["email-logs", statusFilter, timeFilter],
    queryFn: async () => {
      let query = supabase
        .from("email_send_log")
        .select("*")
        .gte("created_at", getDateFilter())
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as EmailLog[];
    },
  });

  const stats = {
    total: logs?.length || 0,
    sent: logs?.filter((l) => l.status === "sent").length || 0,
    failed: logs?.filter((l) => l.status === "failed").length || 0,
    pending: logs?.filter((l) => l.status === "pending").length || 0,
  };

  const handleResend = async (log: EmailLog) => {
    if (!log.metadata || !log.checklist_id) {
      toast.error("Dados insuficientes para reenviar");
      return;
    }

    try {
      toast.loading("Reenviando e-mail...", { id: "resend" });

      const { data, error } = await supabase.functions.invoke("notify-checklist-nc", {
        body: {
          checklist_id: log.checklist_id,
          placa: log.metadata.placa || "N/A",
          modelo: log.metadata.modelo || "N/A",
          tecnico: log.metadata.tecnico || "N/A",
          data: format(new Date(), "dd/MM/yyyy HH:mm"),
          resultado: log.metadata.resultado || "N/A",
          itens_problema: [],
          fotos_problema: [],
        },
      });

      if (error) throw error;

      toast.success(`E-mail reenviado! Enviados: ${data.emails_sent}, Falhas: ${data.emails_failed}`, { id: "resend" });
      refetch();
    } catch (err: any) {
      toast.error(`Erro ao reenviar: ${err.message}`, { id: "resend" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><CheckCircle className="w-3 h-3 mr-1" />Enviado</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Falhou</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pendente</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">E-mails Enviados</h1>
          <p className="text-muted-foreground">Log de notificações por e-mail do sistema</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Mail className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.sent}</p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-50">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.failed}</p>
                <p className="text-xs text-muted-foreground">Falharam</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pending}</p>
                <p className="text-xs text-muted-foreground">Pendentes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Últimas 24h</SelectItem>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="sent">Enviados</SelectItem>
            <SelectItem value="failed">Falharam</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : !logs?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum e-mail encontrado no período selecionado</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead className="w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {format(new Date(log.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{log.recipient_email}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{log.subject || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {log.metadata?.placa || "—"}
                    </TableCell>
                    <TableCell>{getStatusBadge(log.status)}</TableCell>
                    <TableCell className="text-xs text-red-600 max-w-[200px] truncate">
                      {log.error_message || "—"}
                    </TableCell>
                    <TableCell>
                      {log.status === "failed" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleResend(log)}
                          title="Reenviar"
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmailLogs;
