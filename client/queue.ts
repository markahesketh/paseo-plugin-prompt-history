import type { AgentQueue, QueueSnapshot } from "../shared/queue";

export type QueueListener = () => void;

export type QueueStore = {
  get(agentId: string): AgentQueue | null;
  subscribe(listener: QueueListener): () => void;
  /** Applies a snapshot returned by a queue RPC. */
  apply(snapshot: QueueSnapshot): void;
  refresh(): Promise<void>;
  dispose(): void;
};

/**
 * Mirrors the daemon-side queue. Responses can arrive out of order, so only
 * the newest request may replace the snapshot.
 */
export function createQueueStore(fetchSnapshot: () => Promise<QueueSnapshot>): QueueStore {
  let queues = new Map<string, AgentQueue>();
  const listeners = new Set<QueueListener>();
  let generation = 0;
  let disposed = false;

  function replace(snapshot: QueueSnapshot): void {
    queues = new Map(snapshot.queues.map((queue) => [queue.agentId, queue]));
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    get(agentId) {
      return queues.get(agentId) ?? null;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    apply(snapshot) {
      if (disposed) {
        return;
      }
      generation += 1;
      replace(snapshot);
    },

    async refresh() {
      if (disposed) {
        return;
      }
      generation += 1;
      const requested = generation;
      const snapshot = await fetchSnapshot();
      if (!disposed && requested === generation) {
        replace(snapshot);
      }
    },

    dispose() {
      disposed = true;
      listeners.clear();
      queues.clear();
    },
  };
}

let installedStore: QueueStore | null = null;

export function installQueueStore(store: QueueStore): () => void {
  installedStore?.dispose();
  installedStore = store;
  return () => {
    if (installedStore === store) {
      installedStore = null;
    }
    store.dispose();
  };
}

export function queueStore(): QueueStore | null {
  return installedStore;
}
