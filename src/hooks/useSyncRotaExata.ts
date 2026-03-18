import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUltimaPosicaoTodos } from "@/services/rotaexata";
import { toast } from "sonner";

interface RawAdesao {
  id?: number | string;
  empresa_id?: number;
  vei_placa?: string;
  vei_descricao?: string;
  vei_ano?: string;
  ico_tipo?: string;
  marca?: { id?: number; marca?: string };
  modelo?: { id?: number; modelo?: string };
  tipo_veiculo?: string;
  [key: string]: unknown;
}

interface RawPosicaoItem {
  posicao?: {
    adesao_id?: number;
    adesao?: RawAdesao;
    odometro_gps?: number;
    odometro_original?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function useSyncVehiclesFromRotaExata() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Fetch positions (which contain full adesao info)
      const posicoes = await getUltimaPosicaoTodos();

      // Also get the raw response for adesao details
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const baseUrl = `https://${projectId}.supabase.co/functions/v1/rotaexata-proxy`;
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      if (!token) throw new Error("Não autenticado");

      // Fetch raw ultima-posicao for adesao details
      const rawRes = await fetch(`${baseUrl}?path=/ultima-posicao/todos`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
      });

      if (!rawRes.ok) throw new Error("Erro ao buscar posições");

      const rawData = await rawRes.json();
      const rawItems: RawPosicaoItem[] = Array.isArray(rawData?.data)
        ? rawData.data
        : Array.isArray(rawData)
          ? rawData
          : [];

      // Extract vehicle info from adesao objects
      const vehiclesToSync = rawItems
        .filter((item) => item.posicao?.adesao)
        .map((item) => {
          const adesao = item.posicao!.adesao!;
          const odometro = item.posicao?.odometro_original ?? item.posicao?.odometro_gps ?? 0;

          return {
            adesao_id: String(adesao.id ?? item.posicao?.adesao_id ?? ""),
            placa: adesao.vei_placa ?? "",
            marca: adesao.marca?.marca ?? "",
            modelo: adesao.modelo?.modelo ?? adesao.vei_descricao ?? "",
            ano: adesao.vei_ano ? parseInt(adesao.vei_ano) : null,
            tipo: adesao.tipo_veiculo ?? null,
            km_atual: Math.round(Number(odometro) / 1000), // Convert meters to km
          };
        })
        .filter((v) => v.placa && v.adesao_id);

      if (vehiclesToSync.length === 0) {
        throw new Error("Nenhum veículo encontrado no Rota Exata");
      }

      // Get existing vehicles
      const { data: existing } = await supabase
        .from("vehicles")
        .select("id, adesao_id, placa");

      const existingByAdesao = new Map(
        (existing ?? []).filter((v) => v.adesao_id).map((v) => [v.adesao_id!, v])
      );
      const existingByPlaca = new Map(
        (existing ?? []).map((v) => [v.placa, v])
      );

      let created = 0;
      let updated = 0;

      for (const vehicle of vehiclesToSync) {
        const byAdesao = existingByAdesao.get(vehicle.adesao_id);
        const byPlaca = existingByPlaca.get(vehicle.placa);
        const match = byAdesao ?? byPlaca;

        if (match) {
          // Update existing
          const { error } = await supabase
            .from("vehicles")
            .update({
              adesao_id: vehicle.adesao_id,
              placa: vehicle.placa,
              marca: vehicle.marca,
              modelo: vehicle.modelo,
              ano: vehicle.ano,
              tipo: vehicle.tipo,
              km_atual: vehicle.km_atual,
            })
            .eq("id", match.id);
          if (!error) updated++;
        } else {
          // Insert new
          const { error } = await supabase
            .from("vehicles")
            .insert({
              adesao_id: vehicle.adesao_id,
              placa: vehicle.placa,
              marca: vehicle.marca,
              modelo: vehicle.modelo,
              ano: vehicle.ano,
              tipo: vehicle.tipo,
              km_atual: vehicle.km_atual,
              status: "disponivel",
            });
          if (!error) created++;
        }
      }

      return { created, updated, total: vehiclesToSync.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success(
        `Sincronização concluída! ${result.created} criados, ${result.updated} atualizados (${result.total} total)`
      );
    },
    onError: (err: Error) => {
      toast.error(`Erro na sincronização: ${err.message}`);
    },
  });
}
