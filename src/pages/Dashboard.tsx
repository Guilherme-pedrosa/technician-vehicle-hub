import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Truck, Wrench, AlertTriangle } from "lucide-react";

const stats = [
  { label: "Condutores Ativos", value: "0", icon: Users, color: "text-primary" },
  { label: "Veículos em Operação", value: "0", icon: Truck, color: "text-success" },
  { label: "Chamados Abertos", value: "0", icon: Wrench, color: "text-warning" },
  { label: "Não Conformidades", value: "0", icon: AlertTriangle, color: "text-destructive" },
];

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral da sua frota</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
