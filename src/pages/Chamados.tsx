import { Card, CardContent } from "@/components/ui/card";
import { Wrench } from "lucide-react";

export default function Chamados() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chamados de Manutenção</h1>
        <p className="text-muted-foreground">Kanban de chamados e manutenção</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Wrench className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium">Módulo em construção</p>
          <p className="text-sm">Em breve: Kanban com drag & drop</p>
        </CardContent>
      </Card>
    </div>
  );
}
