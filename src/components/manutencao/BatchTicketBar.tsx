import { Button } from "@/components/ui/button";
import { Wrench, X, FileText } from "lucide-react";

interface BatchTicketBarProps {
  count: number;
  onCreateTicket: () => void;
  onClear: () => void;
  isPending: boolean;
}

export function BatchTicketBar({ count, onCreateTicket, onClear, isPending }: BatchTicketBarProps) {
  if (count === 0) return null;

  return (
    <div className="sticky bottom-4 z-50 mx-auto max-w-2xl">
      <div className="bg-primary text-primary-foreground rounded-xl shadow-lg px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          <span className="text-sm font-medium">
            {count} {count === 1 ? "item selecionado" : "itens selecionados"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onClear}
            className="h-8 text-xs"
          >
            <X className="w-3 h-3 mr-1" /> Limpar
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onCreateTicket}
            disabled={isPending}
            className="h-8 text-xs bg-white text-primary hover:bg-white/90"
          >
            <Wrench className="w-3 h-3 mr-1" /> Abrir Chamado Consolidado
          </Button>
        </div>
      </div>
    </div>
  );
}
