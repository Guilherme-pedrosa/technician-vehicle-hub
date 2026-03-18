import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function Relatorios() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">KM rodado, telemetria e desempenho</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <BarChart3 className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium">Módulo em construção</p>
          <p className="text-sm">Em breve: relatórios com gráficos e exportação</p>
        </CardContent>
      </Card>
    </div>
  );
}
