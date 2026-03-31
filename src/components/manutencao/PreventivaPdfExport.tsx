import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";

interface PdfTicketData {
  titulo: string;
  descricao: string | null;
  vehiclePlaca: string;
  vehicleModelo: string;
  vehicleKm: number;
  createdAt: string;
  items: {
    name: string;
    category: string;
    itemType: string;
    executorType: string;
    pctMax: number;
    kmSince: number;
    daysSince: number;
  }[];
}

const CATEGORY_LABELS: Record<string, string> = {
  faixa_m: "Faixa M",
  faixa_a: "Faixa A",
  faixa_b: "Faixa B",
  faixa_c: "Faixa C",
};

const TYPE_LABELS: Record<string, string> = {
  troca: "Troca",
  servico: "Serviço",
  inspecao: "Inspeção",
};

export function generatePreventivaPdf(data: PdfTicketData) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(30, 64, 120);
  doc.rect(0, 0, pageWidth, 35, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("ORDEM DE SERVIÇO — PREVENTIVA", 14, 18);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Emitido em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 28);

  // Vehicle info box
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(245, 247, 250);
  doc.roundedRect(14, 42, pageWidth - 28, 28, 3, 3, "FD");

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Veículo:", 20, 52);
  doc.setFont("helvetica", "normal");
  doc.text(`${data.vehiclePlaca} — ${data.vehicleModelo}`, 50, 52);

  doc.setFont("helvetica", "bold");
  doc.text("KM Atual:", 20, 62);
  doc.setFont("helvetica", "normal");
  doc.text(`${data.vehicleKm.toLocaleString("pt-BR")} km`, 50, 62);

  doc.setFont("helvetica", "bold");
  doc.text("Data:", pageWidth / 2, 52);
  doc.setFont("helvetica", "normal");
  doc.text(format(new Date(data.createdAt), "dd/MM/yyyy"), pageWidth / 2 + 22, 52);

  // Items table
  const tableData = data.items.map((item, i) => [
    String(i + 1),
    item.name,
    CATEGORY_LABELS[item.category] ?? item.category,
    TYPE_LABELS[item.itemType] ?? item.itemType,
    item.executorType === "tecnico" ? "Técnico" : "Oficina",
    `${Math.round(item.pctMax)}%`,
    "", // checkbox
  ]);

  autoTable(doc, {
    startY: 78,
    head: [["#", "Item de Manutenção", "Faixa", "Tipo", "Executor", "% Consumido", "✓"]],
    body: tableData,
    theme: "grid",
    headStyles: {
      fillColor: [30, 64, 120],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 24, halign: "center" },
      6: { cellWidth: 12, halign: "center" },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // Signature area
  const finalY = (doc as any).lastAutoTable?.finalY ?? 200;
  const sigY = finalY + 20;

  if (sigY + 40 > doc.internal.pageSize.getHeight()) {
    doc.addPage();
  }

  const actualSigY = sigY + 40 > doc.internal.pageSize.getHeight() ? 30 : sigY;

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("Observações do mecânico:", 14, actualSigY);
  doc.setDrawColor(200, 200, 200);
  doc.line(14, actualSigY + 8, pageWidth - 14, actualSigY + 8);
  doc.line(14, actualSigY + 16, pageWidth - 14, actualSigY + 16);
  doc.line(14, actualSigY + 24, pageWidth - 14, actualSigY + 24);

  const sigLineY = actualSigY + 42;
  doc.line(14, sigLineY, 90, sigLineY);
  doc.line(pageWidth - 90, sigLineY, pageWidth - 14, sigLineY);
  doc.setFontSize(8);
  doc.text("Assinatura do Mecânico", 30, sigLineY + 5);
  doc.text("Assinatura do Responsável", pageWidth - 80, sigLineY + 5);

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text("Documento gerado automaticamente pelo sistema de gestão de frota", pageWidth / 2, pageH - 8, { align: "center" });

  doc.save(`OS_Preventiva_${data.vehiclePlaca}_${format(new Date(), "yyyyMMdd")}.pdf`);
}
