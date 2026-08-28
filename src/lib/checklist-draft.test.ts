import { describe, expect, it, vi } from "vitest";
import { createDraftCoordinator } from "./checklist-draft";

/** Promise controlada — deixa o teste decidir QUANDO cada etapa termina. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type Store = {
  records: Map<string, { status: string; fotos: Record<string, string[]> }>;
  objects: Set<string>;
};

function makeDeps(store: Store, opts?: { createGate?: Promise<void> }) {
  let seq = 0;
  const createRecord = vi.fn(async () => {
    if (opts?.createGate) await opts.createGate;
    const id = `rec-${++seq}`;
    store.records.set(id, { status: "rascunho", fotos: {} });
    return id;
  });
  const attachPhoto = vi.fn(async (id: string, key: string, url: string) => {
    const rec = store.records.get(id);
    if (!rec) throw new Error("registro inexistente");
    rec.fotos[key] = [...(rec.fotos[key] ?? []), url];
  });
  const deleteRecord = vi.fn(async (id: string) => {
    const rec = store.records.get(id);
    if (rec?.status === "rascunho") store.records.delete(id);
  });
  const removeStorageObject = vi.fn(async (path: string) => {
    store.objects.delete(path);
  });
  return { createRecord, attachPhoto, deleteRecord, removeStorageObject };
}

function emptyStore(): Store {
  return { records: new Map(), objects: new Set() };
}

describe("coordenador de rascunho × upload", () => {
  it("salvar ANTES do upload terminar: 1 checklist, foto no mesmo id, zero rascunho fantasma", async () => {
    const store = emptyStore();
    const deps = makeDeps(store);
    const coord = createDraftCoordinator(deps);

    // 1) técnico fotografa → captura já dispara a criação do registro
    const ticket = coord.beginUpload();
    const upload = deferred<string>();

    // 2) técnico salva IMEDIATAMENTE, antes de o upload terminar
    const targetId = await coord.resolveRecordIdForSubmit();
    store.records.get(targetId)!.status = "finalizado";
    coord.markFinalized(targetId);

    // 3) o formulário é limpo (fechou a tela) — não muda o destino do upload
    coord.releaseKeepingDraft();

    // 4) upload termina DEPOIS
    store.objects.add("path/a.jpg");
    upload.resolve("https://cdn/a.jpg");
    const outcome = await coord.completeUpload(ticket, "painel", await upload.promise, "path/a.jpg");

    expect(outcome).toBe("attached");
    expect(deps.createRecord).toHaveBeenCalledTimes(1);
    expect(store.records.size).toBe(1);
    expect(store.records.get(targetId)!.status).toBe("finalizado");
    expect(store.records.get(targetId)!.fotos.painel).toEqual(["https://cdn/a.jpg"]);
  });

  it("criação do registro é single-flight mesmo com várias capturas simultâneas", async () => {
    const store = emptyStore();
    const gate = deferred<void>();
    const deps = makeDeps(store, { createGate: gate.promise });
    const coord = createDraftCoordinator(deps);

    const t1 = coord.beginUpload();
    const t2 = coord.beginUpload();
    const submit = coord.resolveRecordIdForSubmit();
    gate.resolve();

    const [id1, id2, id3] = await Promise.all([t1.recordId, t2.recordId, submit]);
    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
    expect(deps.createRecord).toHaveBeenCalledTimes(1);
  });

  it("sair mantendo rascunho: nada é apagado no servidor", async () => {
    const store = emptyStore();
    const deps = makeDeps(store);
    const coord = createDraftCoordinator(deps);

    const ticket = coord.beginUpload();
    await coord.completeUpload(ticket, "painel", "https://cdn/a.jpg", "path/a.jpg");
    coord.releaseKeepingDraft();

    expect(store.records.size).toBe(1);
    expect(deps.deleteRecord).not.toHaveBeenCalled();
    expect(deps.removeStorageObject).not.toHaveBeenCalled();
  });

  it("descartar de verdade: apaga registro rascunho e objetos de storage", async () => {
    const store = emptyStore();
    const deps = makeDeps(store);
    const coord = createDraftCoordinator(deps);

    const ticket = coord.beginUpload();
    store.objects.add("path/a.jpg");
    coord.registerStoragePath("path/a.jpg");
    await coord.completeUpload(ticket, "painel", "https://cdn/a.jpg", "path/a.jpg");

    const result = await coord.discard();
    expect(result.deletedRecord).toBe(true);
    expect(result.removedObjects).toBe(1);
    expect(store.records.size).toBe(0);
    expect(store.objects.size).toBe(0);
  });

  it("upload que termina APÓS o descarte remove o órfão e não recria registro", async () => {
    const store = emptyStore();
    const deps = makeDeps(store);
    const coord = createDraftCoordinator(deps);

    const ticket = coord.beginUpload();
    await ticket.recordId; // registro criado
    store.objects.add("path/tardio.jpg");
    coord.registerStoragePath("path/tardio.jpg");

    await coord.discard();
    expect(store.records.size).toBe(0);

    const outcome = await coord.completeUpload(ticket, "painel", "https://cdn/tardio.jpg", "path/tardio.jpg");
    expect(outcome).toBe("orphan_removed");
    expect(deps.attachPhoto).not.toHaveBeenCalled();
    expect(deps.createRecord).toHaveBeenCalledTimes(1);
    expect(store.records.size).toBe(0);
    expect(store.objects.has("path/tardio.jpg")).toBe(false);
  });

  it("nunca apaga checklist já finalizado", async () => {
    const store = emptyStore();
    const deps = makeDeps(store);
    const coord = createDraftCoordinator(deps);

    const id = await coord.resolveRecordIdForSubmit();
    store.records.get(id)!.status = "finalizado";
    coord.markFinalized(id);

    const result = await coord.discard();
    expect(result.deletedRecord).toBe(false);
    expect(deps.deleteRecord).not.toHaveBeenCalled();
    expect(store.records.size).toBe(1);
  });

  it("falha na criação não gruda: próxima captura tenta de novo", async () => {
    const store = emptyStore();
    let calls = 0;
    const coord = createDraftCoordinator({
      createRecord: async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        const id = "rec-ok";
        store.records.set(id, { status: "rascunho", fotos: {} });
        return id;
      },
      attachPhoto: async () => undefined,
      deleteRecord: async () => undefined,
      removeStorageObject: async () => undefined,
    });

    await expect(coord.beginUpload().recordId).rejects.toThrow("offline");
    await expect(coord.beginUpload().recordId).resolves.toBe("rec-ok");
    expect(calls).toBe(2);
  });
});
