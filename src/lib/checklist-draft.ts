// ═══════════════════════════════════════════════════════════════
// CICLO DE VIDA DO RASCUNHO × UPLOADS EM BACKGROUND
// ───────────────────────────────────────────────────────────────
// Problema resolvido aqui (race real observada em produção):
//  - o upload só criava o rascunho ao TERMINAR;
//  - se o técnico salvasse antes, nascia um checklist finalizado novo;
//  - o upload terminava depois, o form já tinha resetado e um RASCUNHO
//    FANTASMA era criado só para receber a foto.
//
// Contrato desta unidade:
//  1. A captura da PRIMEIRA foto já dispara a criação do registro
//     (promessa estável, single-flight).
//  2. Quem finaliza espera essa MESMA promessa — nunca decide por state.
//  3. Cada upload carrega o ID capturado no início e faz merge nele,
//     mesmo que o registro já esteja finalizado.
//  4. Fechar/resetar NÃO muda o destino de uploads já iniciados.
//  5. Descartar de verdade invalida a geração: upload que terminar depois
//     apaga o objeto órfão e não recria registro nenhum.
// ═══════════════════════════════════════════════════════════════

export type DraftCoordinatorDeps = {
  /** Cria (ou recupera) o registro rascunho e devolve o id. */
  createRecord: () => Promise<string>;
  /** Faz merge da URL da foto no registro alvo (rascunho OU finalizado). */
  attachPhoto: (recordId: string, storageKey: string, url: string) => Promise<void>;
  /** Remove o registro rascunho (nunca chamado para finalizado). */
  deleteRecord: (recordId: string) => Promise<void>;
  /** Remove um objeto do storage (best-effort). */
  removeStorageObject: (storagePath: string) => Promise<void>;
  /**
   * Paths já persistidos no registro (rascunho RETOMADO em outra sessão).
   * Sem isto, descartar só apagaria as fotos capturadas nesta sessão.
   */
  listRemoteStoragePaths?: (recordId: string) => Promise<string[]>;
};


export type UploadTicket = {
  /** Geração viva no momento da captura. */
  generation: number;
  /** Promessa estável do id do registro destino. */
  recordId: Promise<string>;
};

export type DraftCoordinator = ReturnType<typeof createDraftCoordinator>;

export function createDraftCoordinator(deps: DraftCoordinatorDeps) {
  let generation = 0;
  const discardedGenerations = new Set<number>();
  let recordPromise: Promise<string> | null = null;
  let recordId: string | null = null;
  let finalized = false;
  /** Objetos de storage criados nesta geração (para descarte real). */
  let storagePaths: string[] = [];
  /** Fila serial para evitar leitura/escrita concorrente do mesmo JSON de fotos. */
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(task);
    queue = next.catch(() => undefined);
    return next;
  };

  /** Promessa estável e single-flight do id do registro. */
  function ensureRecord(): Promise<string> {
    if (recordPromise) return recordPromise;
    const promise = (async () => {
      const id = await deps.createRecord();
      recordId = id;
      return id;
    })();
    // Falha não pode "grudar": permite nova tentativa na próxima captura/save.
    recordPromise = promise;
    promise.catch(() => {
      if (recordPromise === promise) recordPromise = null;
    });
    return promise;
  }

  return {
    get generation() {
      return generation;
    },
    /** Id já conhecido (pode ser null antes da criação terminar). */
    get currentId() {
      return recordId;
    },
    get isFinalized() {
      return finalized;
    },
    /** Rascunho pré-existente retomado pelo técnico. */
    adopt(id: string) {
      recordId = id;
      recordPromise = Promise.resolve(id);
      finalized = false;
    },
    /** Chamado no início de CADA captura: já garante o registro. */
    beginUpload(): UploadTicket {
      return { generation, recordId: ensureRecord() };
    },
    registerStoragePath(path: string) {
      storagePaths.push(path);
    },
    /**
     * ID estável para finalizar. Sempre o MESMO registro criado pelos uploads.
     * Nunca decide por state do React.
     */
    async resolveRecordIdForSubmit(): Promise<string> {
      const id = await ensureRecord();
      return id;
    },
    markFinalized(id: string) {
      finalized = true;
      recordId = id;
      recordPromise = Promise.resolve(id);
    },
    /**
     * Conclusão de upload. Faz merge no MESMO registro capturado no início,
     * mesmo se já finalizado. Se a geração foi descartada, apaga o órfão.
     */
    async completeUpload(
      ticket: UploadTicket,
      storageKey: string,
      url: string,
      storagePath?: string,
    ): Promise<"attached" | "orphan_removed"> {
      if (discardedGenerations.has(ticket.generation)) {
        if (storagePath) await deps.removeStorageObject(storagePath).catch(() => undefined);
        return "orphan_removed";
      }
      const id = await ticket.recordId;
      if (discardedGenerations.has(ticket.generation)) {
        if (storagePath) await deps.removeStorageObject(storagePath).catch(() => undefined);
        return "orphan_removed";
      }
      await enqueue(() => deps.attachPhoto(id, storageKey, url));
      return "attached";
    },
    /** Serializa qualquer trabalho na mesma fila das fotos. */
    enqueue,
    /** Espera a fila drenar (usado antes de finalizar). */
    async settle() {
      await queue.catch(() => undefined);
    },
    /**
     * "Sair e manter rascunho": zera o formulário sem tocar no servidor e
     * SEM mudar o destino dos uploads em andamento (eles guardam o ticket).
     */
    releaseKeepingDraft() {
      generation += 1;
      recordPromise = null;
      recordId = null;
      finalized = false;
      storagePaths = [];
    },
    /**
     * "Descartar de verdade": invalida a geração, apaga o registro rascunho e
     * os objetos de storage dele. NUNCA apaga checklist finalizado.
     */
    async discard(): Promise<{ deletedRecord: boolean; removedObjects: number }> {
      const gen = generation;
      discardedGenerations.add(gen);
      const paths = storagePaths;
      const wasFinalized = finalized;
      const pending = recordPromise;

      generation += 1;
      recordPromise = null;
      recordId = null;
      finalized = false;
      storagePaths = [];

      let id: string | null = null;
      try {
        id = pending ? await pending : null;
      } catch {
        id = null;
      }

      let removed = 0;
      for (const path of paths) {
        try {
          await deps.removeStorageObject(path);
          removed += 1;
        } catch {
          /* best-effort */
        }
      }

      if (id && !wasFinalized) {
        await deps.deleteRecord(id);
        return { deletedRecord: true, removedObjects: removed };
      }
      return { deletedRecord: false, removedObjects: removed };
    },
  };
}
