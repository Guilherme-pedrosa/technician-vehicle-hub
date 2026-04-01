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

// ========== SYNC VEHICLES ==========
function parseVehiclesFromPositions(rawItems: any[]) {
  return rawItems
    .filter((item: any) => item.posicao?.adesao)
    .map((item: any) => {
      const adesao = item.posicao.adesao;
      const pos = item.posicao;
      const odometro = pos.odometro_original ?? pos.odometro_gps ?? 0;
      return {
        adesao_id: String(adesao.id ?? pos.adesao_id ?? ""),
        placa: adesao.vei_placa ?? "",
        marca: adesao.marca?.marca ?? "",
        modelo: adesao.modelo?.modelo ?? adesao.vei_descricao ?? "",
        ano: adesao.vei_ano ? parseInt(adesao.vei_ano) : null,
        tipo: adesao.tipo_veiculo ?? null,
        km_atual: Math.round(Number(odometro) / 1000),
      };
    })
    .filter((v: any) => v.placa && v.adesao_id);
}

async function syncVehiclesFromData(vehiclesToSync: ReturnType<typeof parseVehiclesFromPositions>) {
  if (vehiclesToSync.length === 0) return { created: 0, updated: 0 };

  const { data: existing } = await supabase.from("vehicles").select("id, adesao_id, placa");
  const existingByAdesao = new Map((existing ?? []).filter((v) => v.adesao_id).map((v) => [v.adesao_id!, v]));
  const existingByPlaca = new Map((existing ?? []).map((v) => [v.placa, v]));

  let created = 0, updated = 0;
  for (const vehicle of vehiclesToSync) {
    const match = existingByAdesao.get(vehicle.adesao_id) ?? existingByPlaca.get(vehicle.placa);
    if (match) {
      const { error } = await supabase.from("vehicles").update(vehicle).eq("id", match.id);
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

  if (driversToSync.length === 0) return { created: 0, updated: 0 };

  const { data: existing } = await supabase.from("drivers").select("id, full_name, phone");
  const existingByName = new Map((existing ?? []).map((d) => [d.full_name.toLowerCase().trim(), d]));

  let created = 0, updated = 0;
  for (const driver of driversToSync) {
    const normalizedName = driver.full_name.toLowerCase().trim();
    const match = existingByName.get(normalizedName);
    if (match) {
      if (driver.phone && !match.phone) {
        await supabase.from("drivers").update({ phone: driver.phone }).eq("id", match.id);
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
        existingByName.set(normalizedName, { id: "", full_name: driver.full_name, phone: driver.phone });
      }
    }
  }
  return { created, updated };
}

// ========== SYNC ASSIGNMENTS + KM (reuses positions data) ==========
async function syncAssignmentsAndKm(rawItems: any[]) {
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

    const vehicle = vehicleByAdesao.get(String(pos.adesao_id));
    if (!vehicle) continue;

    // Update KM
    const newKm = Math.round(Number(pos.odometro_original ?? pos.odometro_gps ?? 0) / 1000);
    if (newKm > vehicle.km_atual) {
      await supabase.from("vehicles").update({ km_atual: newKm }).eq("id", vehicle.id);
      kmUpdated++;
    }

    // Create assignment if needed
    if (!pos.motorista_id || !userId || !drivers?.length) continue;
    if (activeAssignmentByVehicle.has(vehicle.id)) continue;

    const motoristaName = pos.motorista_nome ?? pos.motorista_key ?? null;
    if (!motoristaName) continue;

    // Match by exact full name (case-insensitive, trimmed) — NOT substring
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
      return syncVehiclesFromData(parseVehiclesFromPositions(rawItems));
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
      toast.success(`Condutores: ${r.created} criados, ${r.updated} atualizados`);
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

      // Sync last 7 days of KM data into cache
      try {
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);

        await supabase.functions.invoke("sync-daily-km", {
          body: {
            start_date: sevenDaysAgo.toISOString().split("T")[0],
            end_date: today.toISOString().split("T")[0],
          },
        });
      } catch (e) {
        console.warn("[sync-all] KM daily sync failed:", e);
      }

      return { vehicleResult, driverResult, assignmentsCreated, kmUpdated };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      const msgs: string[] = [];
      if (r.vehicleResult.created > 0) msgs.push(`${r.vehicleResult.created} veículos criados`);
      if (r.vehicleResult.updated > 0) msgs.push(`${r.vehicleResult.updated} veículos atualizados`);
      if (r.driverResult.created > 0) msgs.push(`${r.driverResult.created} condutores criados`);
      if (r.driverResult.updated > 0) msgs.push(`${r.driverResult.updated} condutores atualizados`);
      if (r.assignmentsCreated > 0) msgs.push(`${r.assignmentsCreated} vínculos criados`);
      if (r.kmUpdated > 0) msgs.push(`${r.kmUpdated} KMs atualizados`);
      toast.success(msgs.length > 0 ? `Sincronização: ${msgs.join(", ")}` : "Tudo já está sincronizado!");
    },
    onError: (e: Error) => toast.error(`Erro na sincronização: ${e.message}`),
  });
}
