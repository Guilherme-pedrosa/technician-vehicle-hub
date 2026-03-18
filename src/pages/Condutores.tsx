import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

export default function Condutores() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Condutores</h1>
          <p className="text-muted-foreground">Gerenciamento de condutores da frota</p>
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Users className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium">Módulo em construção</p>
          <p className="text-sm">Em breve: cadastro e scorecard de condutores</p>
        </CardContent>
      </Card>
    </div>
  );
}
