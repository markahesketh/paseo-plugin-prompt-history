import type { AgentQueue, QueueSnapshot } from "../shared/queue.ts";

// The daemon cannot push queue changes, so the client reads them again after
// agent activity and on this interval.
const POLL_INTERVAL_MS = 10_000;
const REFRESH_SOON_DELAY_MS = 300;

export type QueueApi = {
  list(): Promise<QueueSnapshot>;
  send(input: { agentId: string; text: string }): Promise<{
    result: "sent" | "queued";
    snapshot: QueueSnapshot;
  }>;
  remove(input: { agentId: string; promptId: string }): Promise<QueueSnapshot>;
  resume(input: { agentId: string }): Promise<QueueSnapshot>;
};

export type QueueStore = {
  get(agentId: string): AgentQueue | null;
  /** True while a send, remove, or resume for the agent is in flight. */
  busy(agentId: string): boolean;
  subscribe(listener: () => void): () => void;
  /** Resolves undefined without sending when the agent already has a mutation in flight. */
  send(agentId: string, text: string): Promise<"sent" | "queued" | undefined>;
  remove(agentId: string, promptId: string): Promise<void>;
  resume(agentId: string): Promise<void>;
  refresh(): Promise<void>;
  refreshSoon(): void;
  dispose(): void;
};

// Responses can arrive out of order, so only the newest request may replace
// the snapshot.
export function createQueueStore(api: QueueApi): QueueStore {
  let queues = new Map<string, AgentQueue>();
  const listeners = new Set<() => void>();
  const busyAgents = new Set<string>();
  let generation = 0;
  let disposed = false;
  let refreshSoonTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function replace(snapshot: QueueSnapshot): void {
    queues = new Map(snapshot.queues.map((queue) => [queue.agentId, queue]));
    notify();
  }

  function apply(snapshot: QueueSnapshot): void {
    if (!disposed) {
      generation += 1;
      replace(snapshot);
    }
  }

  async function guarded<T>(agentId: string, run: () => Promise<T>): Promise<T | undefined> {
    if (busyAgents.has(agentId)) {
      return undefined;
    }
    busyAgents.add(agentId);
    notify();
    try {
      return await run();
    } finally {
      busyAgents.delete(agentId);
      notify();
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) {
      return;
    }
    generation += 1;
    const requested = generation;
    try {
      const snapshot = await api.list();
      if (!disposed && requested === generation) {
        replace(snapshot);
      }
    } catch (error) {
      if (!disposed) {
        console.warn("Could not read the prompt queue", error);
      }
    }
  }

  const pollTimer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  void refresh();

  return {
    get: (agentId) => queues.get(agentId) ?? null,
    busy: (agentId) => busyAgents.has(agentId),

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    send: (agentId, text) =>
      guarded(agentId, async () => {
        const { result, snapshot } = await api.send({ agentId, text });
        apply(snapshot);
        return result;
      }),

    async remove(agentId, promptId) {
      await guarded(agentId, async () => apply(await api.remove({ agentId, promptId })));
    },

    async resume(agentId) {
      await guarded(agentId, async () => apply(await api.resume({ agentId })));
    },

    refresh,

    refreshSoon() {
      if (disposed || refreshSoonTimer !== null) {
        return;
      }
      refreshSoonTimer = setTimeout(() => {
        refreshSoonTimer = null;
        void refresh();
      }, REFRESH_SOON_DELAY_MS);
    },

    dispose() {
      disposed = true;
      clearInterval(pollTimer);
      if (refreshSoonTimer !== null) {
        clearTimeout(refreshSoonTimer);
      }
      listeners.clear();
      queues.clear();
    },
  };
}
