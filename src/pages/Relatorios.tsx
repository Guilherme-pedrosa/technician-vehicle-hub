import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Clock3, Gauge, Radio } from "lucide-react";
import { useFleetMetrics } from "@/hooks/useFleetMetrics";

export default function Relatorios() {
  const { rows, summary, isLoading } = useFleetMetrics();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">KM rodado e telemetria consolidada por veículo</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">KM Hoje</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold tabular-nums">{summary.totalKmDia.toLocaleString("pt-BR")}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">KM Semana</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold tabular-nums">{summary.totalKmSemana.toLocaleString("pt-BR")}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">KM Mês</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold tabular-nums">{summary.totalKmMes.toLocaleString("pt-BR")}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Em movimento</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold tabular-nums">{summary.emMovimento}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Telemetria por KM</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando relatórios...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Placa</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead>KM Atual</TableHead>
                  <TableHead>KM Hoje</TableHead>
                  <TableHead>KM Semana</TableHead>
                  <TableHead>KM Mês</TableHead>
                  <TableHead>Telemetria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-semibold">{row.placa}</TableCell>
                    <TableCell>{row.marca} {row.modelo}</TableCell>
                    <TableCell>{row.kmAtual.toLocaleString("pt-BR")} km</TableCell>
                    <TableCell>{row.kmDia.toLocaleString("pt-BR")} km</TableCell>
                    <TableCell>{row.kmSemana.toLocaleString("pt-BR")} km</TableCell>
                    <TableCell>{row.kmMes.toLocaleString("pt-BR")} km</TableCell>
                    <TableCell>
                      {row.posicao ? (
                        <div className="flex items-center gap-2">
                          <Badge variant={row.posicao.velocidade > 0 ? "default" : "secondary"}>
                            <Gauge className="w-3 h-3 mr-1" /> {row.posicao.velocidade} km/h
                          </Badge>
                          <Badge variant={row.posicao.ignicao ? "default" : "secondary"}>
                            <Radio className="w-3 h-3 mr-1" /> {row.posicao.ignicao ? "Ligado" : "Desligado"}
                          </Badge>
                          <Badge variant="outline">
                            <Clock3 className="w-3 h-3 mr-1" />
                            {row.posicao.data_posicao ? new Date(row.posicao.data_posicao).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Sem sinal</span>
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
}
