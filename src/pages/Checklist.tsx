import { Card, CardContent } from "@/components/ui/card";
import { ClipboardCheck } from "lucide-react";

export default function Checklist() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Checklist Veicular</h1>
        <p className="text-muted-foreground">Inspeções e checklists diários</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <ClipboardCheck className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium">Módulo em construção</p>
          <p className="text-sm">Em breve: templates e preenchimento de checklists</p>
        </CardContent>
      </Card>
    </div>
  );
}
