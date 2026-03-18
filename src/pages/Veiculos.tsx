import { Card, CardContent } from "@/components/ui/card";
import { Truck } from "lucide-react";

export default function Veiculos() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Veículos</h1>
        <p className="text-muted-foreground">Cadastro e status dos veículos</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Truck className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium">Módulo em construção</p>
          <p className="text-sm">Em breve: CRUD de veículos com integração Rota Exata</p>
        </CardContent>
      </Card>
    </div>
  );
}
