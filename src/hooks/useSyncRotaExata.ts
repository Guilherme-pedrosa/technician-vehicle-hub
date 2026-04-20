import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const baseUrl = `https://${projectId}.supabase.co/functions/v1/rotaexata-proxy`;

async function fetchRotaExata(path: string, extraParams?: Record<string, string>) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error("Não autenticado");

  const params = new URLSearchParams({ path, ...extraParams });
  const res = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });
  if (!res.ok) throw new Error(`Erro API [${res.status}]`);
  const json = await res.json();
  return json?.data ?? json;
}

/** KM bruto do rastreador (não reflete o KM real — use combineKmAtual) */
function getRastreadorKm(source: Record<string, any> | undefined) {
  const raw = source?.odometro_original ?? source?.odometro_gps ?? source?.odometro ?? 0;
  return Math.round(Number(raw) / 1000);
}

/**
 * Busca a última correção manual de odômetro (`/odometro`) por adesão.
 * Retorna mapa adesao_id → { adesaoKm, rastreadorKm } da correção mais recente.
 */
async function fetchUltimasCorrecoesOdometro(
  adesoesIds: string[]
): Promise<Map<string, { adesaoKm: number; rastreadorKm: number }>> {
  const result = new Map<string, { adesaoKm: number; rastreadorKm: number }>();
  // Sequencial pra não estourar rate limit do proxy
  for (const adesaoId of adesoesIds) {
    try {
      const where = JSON.stringify({ adesao_id: Number(adesaoId) });
      const data = await fetchRotaExata("/odometro", { where, limit: "1000" });
      const items: any[] = Array.isArray(data) ? data : (data?.data ?? []);
      if (!items.length) continue;
      let latest: any = null;
      let latestTs = 0;
      for (const item of items) {
        const ts = new Date(String(item.created ?? item.updated ?? 0)).getTime();
        if (ts > latestTs) { latestTs = ts; latest = item; }
      }
      if (!latest) continue;
      const adesaoKm = Math.round(Number(latest.odometro_adesao ?? 0) / 1000);
      const rastreadorKm = Math.round(Number(latest.odometro_rastreador ?? 0) / 1000);
      if (adesaoKm > 0) result.set(adesaoId, { adesaoKm, rastreadorKm });
    } catch {
      /* skip */
    }
  }
  return result;
}

/** KM real = correção manual + delta GPS desde a correção (espelha painel Rota Exata) */
function combineKmAtual(
  rastreadorAtualKm: number,
  correcao: { adesaoKm: number; rastreadorKm: number } | undefined
): number {
  if (!correcao || correcao.adesaoKm <= 0) return rastreadorAtualKm;
  const delta = Math.max(0, rastreadorAtualKm - correcao.rastreadorKm);
  return correcao.adesaoKm + delta;
}

// ========== SYNC VEHICLES ==========
function parseVehiclesFromPositions(
  rawItems: any[],
  correcoes: Map<string, { adesaoKm: number; rastreadorKm: number }>
) {
  return rawItems
    .filter((item: any) => item.posicao?.adesao)
    .map((item: any) => {
      const adesao = item.posicao.adesao;
      const pos = item.posicao;
      const adesaoIdStr = String(adesao.id ?? pos.adesao_id ?? "");
      const rastreadorKm = getRastreadorKm(pos);
      return {
        adesao_id: adesaoIdStr,
        placa: adesao.vei_placa ?? "",
        marca: adesao.marca?.marca ?? "",
        modelo: adesao.modelo?.modelo ?? adesao.vei_descricao ?? "",
        ano: adesao.vei_ano ? parseInt(adesao.vei_ano) : null,
        tipo: adesao.tipo_veiculo ?? null,
        km_atual: combineKmAtual(rastreadorKm, correcoes.get(adesaoIdStr)),
      };
    })
    .filter((v: any) => v.placa && v.adesao_id);
}

async function syncVehiclesFromData(vehiclesToSync: ReturnType<typeof parseVehiclesFromPositions>) {
  if (vehiclesToSync.length === 0) return { created: 0, updated: 0 };

  const { data: existing } = await supabase.from("vehicles").select("id, adesao_id, placa, km_atual");
  const existingByAdesao = new Map((existing ?? []).filter((v) => v.adesao_id).map((v) => [v.adesao_id!, v]));
  const existingByPlaca = new Map((existing ?? []).map((v) => [v.placa, v]));

  const REGRESSION_THRESHOLD = 5000;
  let created = 0, updated = 0;
  for (const vehicle of vehiclesToSync) {
    const match = existingByAdesao.get(vehicle.adesao_id) ?? existingByPlaca.get(vehicle.placa);
    if (match) {
      // PROTEÇÃO: nunca regredir o km_atual. Se o KM da Rota Exata for menor
      // que o cadastrado, mantemos o cadastrado (admin pode ter corrigido).
      const matchKm = (match as any).km_atual ?? 0;
      const payload: any = { ...vehicle };
      if (vehicle.km_atual < matchKm) {
        const diff = matchKm - vehicle.km_atual;
        if (diff > REGRESSION_THRESHOLD) {
          console.warn(`[sync] Ignorando regressão grande de KM para ${vehicle.placa}: cadastro=${matchKm}, RotaExata=${vehicle.km_atual} (diff=${diff}km)`);
        }
        delete payload.km_atual;
      }
      const { error } = await supabase.from("vehicles").update(payload).eq("id", match.id);
      if (!error) updated++;
    } else {
      const { error } = await supabase.from("vehicles").insert({ ...vehicle, status: "disponivel" as const });
      if (!error) created++;
    }
  }
  return { created, updated };
}

// ========== SYNC DRIVERS ==========
type RotaExataUser = {
  id?: string | number;
  nome?: string;
  name?: string;
  full_name?: string;
  telefone?: string | null;
  phone?: string | null;
  celular?: string | null;
  email?: string | null;
};

function getUserUniqueKey(user: RotaExataUser) {
  return String(user.id ?? `${user.nome ?? user.name ?? user.full_name ?? ""}`.trim().toLowerCase());
}

async function fetchAllRotaExataUsers(): Promise<RotaExataUser[]> {
  const collected = new Map<string, RotaExataUser>();

  const addUsers = (items: unknown) => {
    if (!Array.isArray(items)) return 0;
    let added = 0;
    for (const item of items as RotaExataUser[]) {
      const key = getUserUniqueKey(item);
      if (!key || collected.has(key)) continue;
      collected.set(key, item);
      added++;
    }
    return added;
  };

  // Try big batch first
  const directBatch = await fetchRotaExata("/usuarios", { limit: "1000" });
  addUsers(directBatch);

  // Only try pagination if we got exactly 10 (default limit) — means API is paginating
  if (Array.isArray(directBatch) && directBatch.length === 10) {
    for (let page = 1; page <= 20; page++) {
      try {
        const pageData = await fetchRotaExata("/usuarios", {
          page: String(page),
          limit: "100",
        });
        if (!Array.isArray(pageData) || pageData.length === 0) break;
        const added = addUsers(pageData);
        if (added === 0) break;
      } catch {
        break;
      }
    }
  }

  return Array.from(collected.values());
}

async function syncDrivers() {
  const rawUsers = await fetchAllRotaExataUsers();
  if (!Array.isArray(rawUsers) || rawUsers.length === 0) return { created: 0, updated: 0 };

  const driversToSync = rawUsers
    .map((u) => ({
      full_name: u.nome ?? u.name ?? u.full_name ?? "",
      phone: u.telefone ?? u.phone ?? u.celular ?? null,
    }))
    .filter((d) => d.full_name.trim().length > 0);

  if (driversToSync.length === 0) return { created: 0, updated: 0, deactivated: 0, reactivated: 0 };

  const { data: existing } = await supabase.from("drivers").select("id, full_name, phone, status");
  const existingByName = new Map((existing ?? []).map((d) => [d.full_name.toLowerCase().trim(), d]));

  // Track which existing drivers are present in the API response
  const apiNamesSet = new Set(driversToSync.map((d) => d.full_name.toLowerCase().trim()));

  let created = 0, updated = 0, deactivated = 0, reactivated = 0;

  for (const driver of driversToSync) {
    const normalizedName = driver.full_name.toLowerCase().trim();
    const match = existingByName.get(normalizedName);
    if (match) {
      const updates: { phone?: string | null; status?: "ativo" | "inativo" } = {};
      if (driver.phone && !match.phone) updates.phone = driver.phone;
      // Reactivate driver who came back to RotaExata
      if (match.status === "inativo") {
        updates.status = "ativo";
        reactivated++;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from("drivers").update(updates).eq("id", match.id);
      }
      updated++;
    } else {
      const { error } = await supabase.from("drivers").insert({
        full_name: driver.full_name,
        phone: driver.phone,
        cnh: "PENDENTE",
        cnh_validade: "2030-01-01",
        categoria_cnh: "B",
        status: "ativo" as const,
      });
      if (!error) {
        created++;
        existingByName.set(normalizedName, { id: "", full_name: driver.full_name, phone: driver.phone, status: "ativo" });
      }
    }
  }

  // Deactivate drivers that are active in our DB but missing from RotaExata API
  const toDeactivate = (existing ?? []).filter(
    (d) => d.status === "ativo" && !apiNamesSet.has(d.full_name.toLowerCase().trim())
  );
  if (toDeactivate.length > 0) {
    const ids = toDeactivate.map((d) => d.id);
    const { error } = await supabase
      .from("drivers")
      .update({ status: "inativo" as const })
      .in("id", ids);
    if (!error) deactivated = toDeactivate.length;
  }

  return { created, updated, deactivated, reactivated };
}

// ========== SYNC ASSIGNMENTS + KM (reuses positions data) ==========
async function syncAssignmentsAndKm(
  rawItems: any[],
  correcoes: Map<string, { adesaoKm: number; rastreadorKm: number }>
) {
  const { data: vehicles } = await supabase.from("vehicles").select("id, adesao_id, km_atual");
  const { data: drivers } = await supabase.from("drivers").select("id, full_name");
  const { data: existingAssignments } = await supabase
    .from("driver_vehicle_assignments")
    .select("id, driver_id, vehicle_id, returned_at")
    .is("returned_at", null);

  const vehicleByAdesao = new Map((vehicles ?? []).filter(v => v.adesao_id).map(v => [v.adesao_id!, v]));
  const activeAssignmentByVehicle = new Map((existingAssignments ?? []).map(a => [a.vehicle_id, a]));

  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;

  let assignmentsCreated = 0;
  let kmUpdated = 0;

  for (const item of rawItems) {
    const pos = (item as any).posicao;
    if (!pos?.adesao_id) continue;

    const adesaoIdStr = String(pos.adesao_id);
    const vehicle = vehicleByAdesao.get(adesaoIdStr);
    if (!vehicle) continue;

    // Update KM (correção manual + delta GPS)
    const rastreadorKm = getRastreadorKm(pos);
    const newKm = combineKmAtual(rastreadorKm, correcoes.get(adesaoIdStr));
    if (newKm > vehicle.km_atual) {
      await supabase.from("vehicles").update({ km_atual: newKm }).eq("id", vehicle.id);
      kmUpdated++;
    }

    // Create assignment if needed
    if (!pos.motorista_id || !userId || !drivers?.length) continue;
    if (activeAssignmentByVehicle.has(vehicle.id)) continue;

    const motoristaName = pos.motorista_nome ?? pos.motorista_key ?? null;
    if (!motoristaName) continue;

    const normalizedApiName = motoristaName.toLowerCase().trim();
    const driver = drivers.find(d => d.full_name.toLowerCase().trim() === normalizedApiName);
    if (!driver) continue;

    const { error } = await supabase.from("driver_vehicle_assignments").insert({
      driver_id: driver.id,
      vehicle_id: vehicle.id,
      km_inicio: newKm,
      created_by: userId,
    });
    if (!error) assignmentsCreated++;
  }

  return { assignmentsCreated, kmUpdated };
}

// ========== HOOKS ==========

export function useSyncVehiclesFromRotaExata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const rawItems = await fetchRotaExata("/ultima-posicao/todos");
      if (!Array.isArray(rawItems)) return { created: 0, updated: 0 };
      const adesoesIds = rawItems
        .map((it: any) => String(it?.posicao?.adesao_id ?? ""))
        .filter((id: string) => !!id);
      const correcoes = await fetchUltimasCorrecoesOdometro(adesoesIds);
      return syncVehiclesFromData(parseVehiclesFromPositions(rawItems, correcoes));
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success(`Veículos: ${r.created} criados, ${r.updated} atualizados`);
    },
    onError: (e: Error) => toast.error(`Erro veículos: ${e.message}`),
  });
}

export function useSyncDriversFromRotaExata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncDrivers,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      const parts = [`${r.created} criados`, `${r.updated} atualizados`];
      if (r.deactivated > 0) parts.push(`${r.deactivated} inativados`);
      if (r.reactivated > 0) parts.push(`${r.reactivated} reativados`);
      toast.success(`Condutores: ${parts.join(", ")}`);
    },
    onError: (e: Error) => toast.error(`Erro condutores: ${e.message}`),
  });
}

export function useSyncAllFromRotaExata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Fetch positions ONCE and reuse for vehicles, assignments, and KM
      const rawItems = await fetchRotaExata("/ultima-posicao/todos");
      const positionsArray = Array.isArray(rawItems) ? rawItems : [];

      // Run vehicles + drivers in parallel (independent data)
      const [vehicleResult, driverResult] = await Promise.all([
        syncVehiclesFromData(parseVehiclesFromPositions(positionsArray)),
        syncDrivers(),
      ]);

      // Assignments + KM depend on vehicles being synced first
      const { assignmentsCreated, kmUpdated } = positionsArray.length > 0
        ? await syncAssignmentsAndKm(positionsArray)
        : { assignmentsCreated: 0, kmUpdated: 0 };

      // KM daily sync is done manually by the user in the Dashboard
      // and should NOT be triggered automatically here to avoid data loss

      return { vehicleResult, driverResult, assignmentsCreated, kmUpdated };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["cached-km-tecnico"] });
      const msgs: string[] = [];
      if (r.vehicleResult.created > 0) msgs.push(`${r.vehicleResult.created} veículos criados`);
      if (r.vehicleResult.updated > 0) msgs.push(`${r.vehicleResult.updated} veículos atualizados`);
      if (r.driverResult.created > 0) msgs.push(`${r.driverResult.created} condutores criados`);
      if (r.driverResult.updated > 0) msgs.push(`${r.driverResult.updated} condutores atualizados`);
      if (r.driverResult.deactivated > 0) msgs.push(`${r.driverResult.deactivated} condutores inativados`);
      if (r.driverResult.reactivated > 0) msgs.push(`${r.driverResult.reactivated} condutores reativados`);
      if (r.assignmentsCreated > 0) msgs.push(`${r.assignmentsCreated} vínculos criados`);
      if (r.kmUpdated > 0) msgs.push(`${r.kmUpdated} KMs atualizados`);
      toast.success(msgs.length > 0 ? `Sincronização: ${msgs.join(", ")}` : "Tudo já está sincronizado!");
    },
    onError: (e: Error) => toast.error(`Erro na sincronização: ${e.message}`),
  });
}
