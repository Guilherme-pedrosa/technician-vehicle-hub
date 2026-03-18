import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Truck, Wrench, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { isPast } from "date-fns";

export default function Dashboard() {
  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, status");
      if (error) throw error;
      return data;
    },
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id, status, cnh_validade");
      if (error) throw error;
      return data;
    },
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("maintenance_tickets").select("id, status, tipo");
      if (error) throw error;
      return data;
    },
  });

  const activeDrivers = drivers.filter((d) => d.status === "ativo").length;
  const cnhVencidas = drivers.filter((d) => d.status === "ativo" && isPast(new Date(d.cnh_validade))).length;
  const vehiclesInUse = vehicles.filter((v) => v.status === "em_uso").length;
  const vehiclesAvailable = vehicles.filter((v) => v.status === "disponivel").length;
  const vehiclesMaintenance = vehicles.filter((v) => v.status === "manutencao").length;
  const openTickets = tickets.filter((t) => t.status === "aberto" || t.status === "em_andamento").length;
  const naoConformidades = tickets.filter((t) => t.tipo === "nao_conformidade").length;

  const stats = [
    {
      label: "Condutores Ativos",
      value: activeDrivers,
      icon: Users,
      color: "text-primary",
      subtitle: cnhVencidas > 0 ? `${cnhVencidas} CNH vencida` : "Todos regulares",
      subtitleColor: cnhVencidas > 0 ? "text-destructive" : "text-muted-foreground",
    },
    {
      label: "Veículos em Operação",
      value: vehiclesInUse,
      icon: Truck,
      color: "text-success",
      subtitle: `${vehiclesAvailable} disponíveis · ${vehiclesMaintenance} manutenção`,
      subtitleColor: "text-muted-foreground",
    },
    {
      label: "Chamados Abertos",
      value: openTickets,
      icon: Wrench,
      color: "text-warning",
      subtitle: `${tickets.length} total`,
      subtitleColor: "text-muted-foreground",
    },
    {
      label: "Não Conformidades",
      value: naoConformidades,
      icon: AlertTriangle,
      color: "text-destructive",
      subtitle: "Chamados do tipo NC",
      subtitleColor: "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral da sua frota</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="kpi-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{stat.value}</p>
              <p className={`text-xs mt-1 ${stat.subtitleColor}`}>{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="w-4 h-4" /> Frota
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total de veículos</span>
              <span className="font-semibold tabular-nums">{vehicles.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-success" />
                <span className="text-sm text-muted-foreground">Disponíveis</span>
              </div>
              <span className="font-semibold tabular-nums">{vehiclesAvailable}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-warning" />
                <span className="text-sm text-muted-foreground">Em uso</span>
              </div>
              <span className="font-semibold tabular-nums">{vehiclesInUse}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-destructive" />
                <span className="text-sm text-muted-foreground">Manutenção</span>
              </div>
              <span className="font-semibold tabular-nums">{vehiclesMaintenance}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" /> Condutores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total de condutores</span>
              <span className="font-semibold tabular-nums">{drivers.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-success" />
                <span className="text-sm text-muted-foreground">Ativos</span>
              </div>
              <span className="font-semibold tabular-nums">{activeDrivers}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Inativos</span>
              </div>
              <span className="font-semibold tabular-nums">{drivers.filter((d) => d.status === "inativo").length}</span>
            </div>
            {cnhVencidas > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-sm text-destructive font-medium">CNH Vencida</span>
                </div>
                <span className="font-semibold tabular-nums text-destructive">{cnhVencidas}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
