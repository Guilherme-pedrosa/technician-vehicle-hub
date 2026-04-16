import { useState, useMemo } from "react";
import { ArrowUpDown, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { VeiculoCustoRow } from "@/hooks/useCustosPorVeiculo";

type SortKey = "custoTotal" | "kmRodado" | "custoPorKm" | "kmPorLitro" | "custoCombustivel" | "custoManutencao";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatNumber(value: number, decimals = 0) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

interface Props {
  rows: VeiculoCustoRow[];
  isLoading?: boolean;
}

export function CustosPorVeiculoTable({ rows, isLoading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("custoTotal");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDesc ? bv - av : av - bv;
    });
    return arr;
  }, [rows, sortKey, sortDesc]);

  // Ranking quem gasta mais/menos (apenas veículos com custo > 0)
  const comGasto = rows.filter((r) => r.custoTotal > 0);
  const maiorGasto = comGasto[0];
  const menorGasto = [...comGasto].sort((a, b) => a.custoTotal - b.custoTotal)[0];
  // Pior eficiência custo/km (apenas com KM rodado)
  const comKm = rows.filter((r) => r.kmRodado > 0 && r.custoTotal > 0);
  const piorEficiencia = [...comKm].sort((a, b) => b.custoPorKm - a.custoPorKm)[0];
  const melhorEficiencia = [...comKm].sort((a, b) => a.custoPorKm - b.custoPorKm)[0];

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const SortBtn = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 hover:text-foreground transition-colors ${
        align === "right" ? "ml-auto" : ""
      } ${sortKey === k ? "text-foreground font-semibold" : ""}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Ranking destacado */}
      {!isLoading && comGasto.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {maiorGasto && (
            <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="h-5 w-5 text-rose-600 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Quem gastou mais</p>
                    <p className="text-sm font-bold text-foreground truncate">{maiorGasto.modelo || maiorGasto.placa}</p>
                    <p className="text-base font-bold text-rose-700 dark:text-rose-400">
                      {formatCurrency(maiorGasto.custoTotal)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {menorGasto && menorGasto !== maiorGasto && (
            <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <TrendingDown className="h-5 w-5 text-emerald-600 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Quem gastou menos</p>
                    <p className="text-sm font-bold text-foreground truncate">{menorGasto.modelo || menorGasto.placa}</p>
                    <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(menorGasto.custoTotal)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {piorEficiencia && (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <TrendingUp className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Pior custo por KM</p>
                    <p className="text-sm font-bold text-foreground truncate">{piorEficiencia.modelo || piorEficiencia.placa}</p>
                    <p className="text-base font-bold text-amber-700 dark:text-amber-400">
                      R$ {formatNumber(piorEficiencia.custoPorKm, 2)}/km
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {melhorEficiencia && melhorEficiencia !== piorEficiencia && (
            <Card className="border-sky-200 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <TrendingDown className="h-5 w-5 text-sky-600 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Melhor custo por KM</p>
                    <p className="text-sm font-bold text-foreground truncate">{melhorEficiencia.modelo || melhorEficiencia.placa}</p>
                    <p className="text-base font-bold text-sky-700 dark:text-sky-400">
                      R$ {formatNumber(melhorEficiencia.custoPorKm, 2)}/km
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tabela detalhada */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Detalhamento por Veículo</CardTitle>
          <p className="text-xs text-muted-foreground">
            Clique nos cabeçalhos para ordenar. Veículos sem custo aparecem zerados.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Carregando dados por veículo...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Nenhum dado no período selecionado
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[100px]">Placa</TableHead>
                    <TableHead className="min-w-[140px]">Veículo</TableHead>
                    <TableHead className="text-right">
                      <SortBtn k="kmRodado" label="KM rodado" align="right" />
                    </TableHead>
                    <TableHead className="text-right">
                      <SortBtn k="custoTotal" label="Total" align="right" />
                    </TableHead>
                    <TableHead className="text-right">
                      <SortBtn k="custoCombustivel" label="Combustível" align="right" />
                    </TableHead>
                    <TableHead className="text-right">
                      <SortBtn k="custoManutencao" label="Manutenção" align="right" />
                    </TableHead>
                    <TableHead className="text-right">Outros</TableHead>
                    <TableHead className="text-right">
                      <SortBtn k="custoPorKm" label="R$/km" align="right" />
                    </TableHead>
                    <TableHead className="text-right">
                      <SortBtn k="kmPorLitro" label="km/L" align="right" />
                    </TableHead>
                    <TableHead className="text-right">Litros</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r) => (
                    <TableRow key={r.adesaoId || r.placa}>
                      <TableCell className="font-medium text-sm">{r.placa}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {r.modelo || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.kmRodado > 0 ? `${formatNumber(r.kmRodado, 0)} km` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {formatCurrency(r.custoTotal)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-amber-700 dark:text-amber-500">
                        {r.custoCombustivel > 0 ? formatCurrency(r.custoCombustivel) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-blue-700 dark:text-blue-400">
                        {r.custoManutencao > 0 ? formatCurrency(r.custoManutencao) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {r.custoOutros > 0 ? formatCurrency(r.custoOutros) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.custoPorKm > 0 ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            R$ {formatNumber(r.custoPorKm, 2)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.kmPorLitro > 0 ? (
                          <Badge variant="secondary" className="font-mono text-xs">
                            {formatNumber(r.kmPorLitro, 1)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {r.litros > 0 ? `${formatNumber(r.litros, 1)} L` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
